import { useState, useEffect, useRef, useCallback } from "react";
import {
  useGateway,
  type EventFrame,
  type ChatMessage,
  type ToolCall,
  type AgentEvent,
} from "@intelli-claw/shared";

// ─── Types ───

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls: ToolCall[];
  streaming?: boolean;
}

export type AgentStatus =
  | { phase: "idle" }
  | { phase: "thinking" }
  | { phase: "writing" }
  | { phase: "tool"; toolName: string };

// ─── Hook ───

export function useChat(sessionKey?: string) {
  const { client, state } = useGateway();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ phase: "idle" });

  const streamBuf = useRef<{
    id: string;
    content: string;
    toolCalls: Map<string, ToolCall>;
  } | null>(null);
  const runIdRef = useRef<string | null>(null);
  const sessionKeyRef = useRef(sessionKey);

  // ─── Reset on session change ───
  useEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      setMessages([]);
      setStreaming(false);
      setAgentStatus({ phase: "idle" });
      streamBuf.current = null;
      runIdRef.current = null;
    }
  }, [sessionKey]);

  // ─── Load history ───
  const loadHistory = useCallback(async () => {
    if (!client || state !== "connected" || !sessionKey) return;
    setLoading(true);
    try {
      const res = await client.request<{ messages: ChatMessage[] }>(
        "chat.history",
        { sessionKey, limit: 100 },
      );
      const HIDDEN = /^(NO_REPLY|HEARTBEAT_OK)\s*$/;
      const histMsgs: DisplayMessage[] = (res?.messages || [])
        .filter((m) => {
          if (m.role !== "user" && m.role !== "assistant") return false;
          const raw = typeof m.content === "string" ? m.content
            : Array.isArray(m.content) ? m.content.map((b: any) => b.text || "").join("") : String(m.content || "");
          return !HIDDEN.test(raw.trim());
        })
        .map((m, i) => {
          let text = typeof m.content === "string" ? m.content
            : Array.isArray(m.content) ? m.content.map((b: any) => b.text || "").join("") : String(m.content || "");
          // Strip MEDIA: lines for mobile (no media support yet)
          text = text.replace(/^MEDIA:.+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
          return {
            id: `hist-${i}`,
            role: m.role as "user" | "assistant",
            content: text,
            timestamp: m.timestamp || new Date().toISOString(),
            toolCalls: m.toolCalls || [],
          };
        });
      setMessages(histMsgs);
    } catch (err) {
      console.error("[useChat] history error:", err);
    } finally {
      setLoading(false);
    }
  }, [client, state, sessionKey]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ─── Stream handler ───
  useEffect(() => {
    if (!client) return;

    const unsub = client.onEvent((frame: EventFrame) => {
      if (frame.event !== "agent") return;
      const raw = frame.payload as Record<string, unknown>;
      const stream = raw.stream as string | undefined;
      const data = raw.data as Record<string, unknown> | undefined;
      const evtSessionKey = raw.sessionKey as string | undefined;

      // Only process events for our session
      if (sessionKey && evtSessionKey && evtSessionKey !== sessionKey) return;

      if (stream === "lifecycle") {
        const phase = data?.phase as string | undefined;
        if (phase === "run-start") {
          runIdRef.current = (data?.runId as string) || null;
          setStreaming(true);
          setAgentStatus({ phase: "thinking" });
          // Create streaming placeholder
          const id = `stream-${Date.now()}`;
          streamBuf.current = { id, content: "", toolCalls: new Map() };
          setMessages((prev) => [
            ...prev,
            { id, role: "assistant", content: "", timestamp: new Date().toISOString(), toolCalls: [], streaming: true },
          ]);
        } else if (phase === "run-end" || phase === "run-error") {
          if (streamBuf.current) {
            const buf = streamBuf.current;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === buf.id
                  ? { ...m, content: buf.content, toolCalls: [...buf.toolCalls.values()], streaming: false }
                  : m,
              ),
            );
            streamBuf.current = null;
          }
          runIdRef.current = null;
          setStreaming(false);
          setAgentStatus({ phase: "idle" });
        }
        return;
      }

      if (stream === "assistant") {
        if (!streamBuf.current) return;
        const buf = streamBuf.current;

        if (data?.delta) {
          buf.content += String(data.delta);
          setAgentStatus({ phase: "writing" });
          // Throttled update
          setMessages((prev) =>
            prev.map((m) =>
              m.id === buf.id ? { ...m, content: buf.content } : m,
            ),
          );
        } else if (data?.kind === "tool-call-start") {
          const callId = String(data.callId || "");
          const name = String(data.name || "");
          buf.toolCalls.set(callId, { callId, name, status: "running" });
          setAgentStatus({ phase: "tool", toolName: name });
        } else if (data?.kind === "tool-call-end") {
          const callId = String(data.callId || "");
          const existing = buf.toolCalls.get(callId);
          if (existing) {
            existing.status = "done";
            existing.result = String(data.result || "");
          }
        }
      }
    });

    return unsub;
  }, [client, sessionKey]);

  // ─── Send message ───
  const sendMessage = useCallback(
    async (text: string) => {
      if (!client || state !== "connected" || !sessionKey || !text.trim()) return;

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text.trim(),
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        await client.request("chat.send", {
          sessionKey,
          message: text.trim(),
          idempotencyKey: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        });
      } catch (err) {
        console.error("[useChat] send error:", err);
      }
    },
    [client, state, sessionKey],
  );

  // ─── Abort ───
  const abort = useCallback(async () => {
    if (!client || !sessionKey) return;
    try {
      await client.request("chat.abort", { sessionKey, runId: runIdRef.current });
    } catch {}
  }, [client, sessionKey]);

  return {
    messages,
    streaming,
    loading,
    agentStatus,
    sendMessage,
    abort,
    reload: loadHistory,
  };
}
