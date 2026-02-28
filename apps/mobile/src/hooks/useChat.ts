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
  /** Local image URIs for user-sent attachments (display only) */
  imageUris?: string[];
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
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const STREAMING_TIMEOUT_MS = 45_000;

  const clearStreamingTimeout = useCallback(() => {
    if (streamingTimeoutRef.current) {
      clearTimeout(streamingTimeoutRef.current);
      streamingTimeoutRef.current = null;
    }
  }, []);

  const startStreamingTimeout = useCallback(() => {
    clearStreamingTimeout();
    streamingTimeoutRef.current = setTimeout(() => {
      console.warn("[useChat] streaming timeout — forcing idle");
      setStreaming(false);
      setAgentStatus({ phase: "idle" });
      if (streamBuf.current) {
        const finalId = streamBuf.current.id;
        setMessages((prev) =>
          prev.map((m) => m.id === finalId ? { ...m, streaming: false } : m),
        );
        streamBuf.current = null;
      }
    }, STREAMING_TIMEOUT_MS);
  }, [clearStreamingTimeout]);

  // ─── Reset on session change ───
  useEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      setMessages([]);
      setStreaming(false);
      clearStreamingTimeout();
      setAgentStatus({ phase: "idle" });
      streamBuf.current = null;
      runIdRef.current = null;
    }
  }, [sessionKey, clearStreamingTimeout]);

  // ─── Load history ───
  const loadHistory = useCallback(async () => {
    if (!client || state !== "connected" || !sessionKey) return;
    setLoading(true);
    try {
      const res = await client.request<{ messages: ChatMessage[] }>(
        "chat.history",
        { sessionKey, limit: 100 },
      );
      const HIDDEN = /^(NO_REPLY|HEARTBEAT_OK|NO_)\s*$|^System:|^\[System|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now/;
      const histMsgs: DisplayMessage[] = (res?.messages || [])
        .filter((m) => {
          if (m.role !== "user" && m.role !== "assistant") return false;
          const blocks = m.content as any;
          const raw = typeof m.content === "string" ? m.content
            : Array.isArray(blocks) ? blocks.map((b: any) => b?.text || "").join("") : String(m.content || "");
          return !HIDDEN.test(raw.trim());
        })
        .map((m, i) => {
          const blocks = m.content as any;
          let text = typeof m.content === "string" ? m.content
            : Array.isArray(blocks) ? blocks.map((b: any) => b?.text || "").join("") : String(m.content || "");
          text = text.replace(/\n{3,}/g, "\n\n").trim();
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

  // ─── Stream handler (mirrors web/electron pattern) ───
  useEffect(() => {
    if (!client) return;

    const unsub = client.onEvent((frame: EventFrame) => {
      if (frame.event !== "agent") return;
      const raw = frame.payload as Record<string, unknown>;
      const stream = raw.stream as string | undefined;
      const data = raw.data as Record<string, unknown> | undefined;
      // Check both top-level sessionKey and data.sessionKey — gateway may
      // nest the key inside data depending on event type (#48)
      const evtSessionKey = (raw.sessionKey ?? data?.sessionKey) as string | undefined;

      // Only process events for our session (use ref to avoid stale closure)
      const currentKey = sessionKeyRef.current;
      if (currentKey && evtSessionKey && evtSessionKey !== currentKey) return;
      if (!evtSessionKey && currentKey) return;

      // ── assistant text delta ──
      if (stream === "assistant" && (typeof data?.delta === "string" || typeof data?.text === "string")) {
        const chunk = (data?.delta as string | undefined) ?? (data?.text as string);
        setStreaming(true);
        startStreamingTimeout();
        setAgentStatus({ phase: "writing" });

        if (!streamBuf.current) {
          streamBuf.current = { id: `stream-${Date.now()}`, content: "", toolCalls: new Map() };
        }
        streamBuf.current.content += chunk;
        const snap = streamBuf.current;

        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === snap.id);
          const msg: DisplayMessage = {
            id: snap.id, role: "assistant", content: snap.content,
            timestamp: new Date().toISOString(),
            toolCalls: Array.from(snap.toolCalls.values()), streaming: true,
          };
          if (idx >= 0) { const next = [...prev]; next[idx] = msg; return next; }
          return [...prev, msg];
        });

      // ── tool start ──
      } else if (stream === "tool-start" && data) {
        const callId = String(data.toolCallId || data.callId || "");
        const name = String(data.name || data.tool || "");
        setAgentStatus({ phase: "tool", toolName: name });

        if (!streamBuf.current) {
          streamBuf.current = { id: `stream-${Date.now()}`, content: "", toolCalls: new Map() };
        }
        streamBuf.current.toolCalls.set(callId, { callId, name, status: "running" });
        const snap = streamBuf.current;

        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === snap.id);
          const msg: DisplayMessage = {
            id: snap.id, role: "assistant", content: snap.content,
            timestamp: new Date().toISOString(),
            toolCalls: Array.from(snap.toolCalls.values()), streaming: true,
          };
          if (idx >= 0) { const next = [...prev]; next[idx] = msg; return next; }
          return [...prev, msg];
        });

      // ── tool end ──
      } else if (stream === "tool-end" && data) {
        const callId = String(data.toolCallId || data.callId || "");
        const result = data.result as string | undefined;
        setAgentStatus({ phase: "thinking" });

        if (streamBuf.current) {
          const tc = streamBuf.current.toolCalls.get(callId);
          if (tc) { tc.status = "done"; tc.result = result; }
          const snap = streamBuf.current;
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === snap.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], toolCalls: Array.from(snap.toolCalls.values()) };
              return next;
            }
            return prev;
          });
        }

      // ── lifecycle start ──
      } else if (stream === "lifecycle" && data?.phase === "start") {
        setStreaming(true);
        startStreamingTimeout();
        runIdRef.current = (raw.runId as string) ?? null;
        setAgentStatus({ phase: "thinking" });

      // ── lifecycle end ──
      } else if (stream === "lifecycle" && data?.phase === "end") {
        clearStreamingTimeout();
        setStreaming(false);
        setAgentStatus({ phase: "idle" });

        if (streamBuf.current) {
          const finalId = streamBuf.current.id;
          const finalContent = streamBuf.current.content;
          const finalTools = Array.from(streamBuf.current.toolCalls.values());
          const HIDDEN_STREAM = /^(NO_REPLY|HEARTBEAT_OK|NO_)\s*$|^System:|^\[System|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now/;
          if (HIDDEN_STREAM.test(finalContent.trim())) {
            setMessages((prev) => prev.filter((m) => m.id !== finalId));
          } else {
            setMessages((prev) =>
              prev.map((m) => m.id === finalId
                ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false }
                : m),
            );
          }
          streamBuf.current = null;
        }

      // ── done/end/finish (alternative end signals) ──
      } else if (stream === "done" || stream === "end" || stream === "finish") {
        clearStreamingTimeout();
        setStreaming(false);
        setAgentStatus({ phase: "idle" });

        if (streamBuf.current) {
          const finalId = streamBuf.current.id;
          const finalContent = (data?.text as string) || streamBuf.current.content;
          const finalTools = Array.from(streamBuf.current.toolCalls.values());
          const HIDDEN_STREAM2 = /^(NO_REPLY|HEARTBEAT_OK|NO_)\s*$|^System:|^\[System|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now/;
          if (HIDDEN_STREAM2.test(finalContent.trim())) {
            setMessages((prev) => prev.filter((m) => m.id !== finalId));
            streamBuf.current = null;
            return;
          }
          setMessages((prev) =>
            prev.map((m) => m.id === finalId
              ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false }
              : m),
          );
          streamBuf.current = null;
        }

      // ── error ──
      } else if (stream === "error") {
        clearStreamingTimeout();
        setStreaming(false);
        setAgentStatus({ phase: "idle" });
        const errMsg = String(data?.message || data?.error || "Unknown error");

        if (streamBuf.current) {
          const errId = streamBuf.current.id;
          setMessages((prev) =>
            prev.map((m) => m.id === errId
              ? { ...m, content: m.content + `\n\n**Error:** ${errMsg}`, streaming: false }
              : m),
          );
          streamBuf.current = null;
        }
      }
    });

    return () => {
      unsub();
      clearStreamingTimeout();
    };
  }, [client, startStreamingTimeout, clearStreamingTimeout]);

  // ─── Send message ───
  const sendMessage = useCallback(
    async (text: string, attachments?: Array<{ content: string; data?: string; mimeType: string; fileName?: string }>, imageUris?: string[]) => {
      if (!client || state !== "connected" || !sessionKey) return;
      if (!text.trim() && (!attachments || attachments.length === 0)) return;

      const userMsg: DisplayMessage = {
        id: `user-${Date.now()}`,
        role: "user",
        content: text.trim() || (attachments?.length ? "(이미지)" : ""),
        timestamp: new Date().toISOString(),
        toolCalls: [],
        imageUris: imageUris?.length ? imageUris : undefined,
      };
      setMessages((prev) => [...prev, userMsg]);

      try {
        const payload: Record<string, unknown> = {
          sessionKey,
          message: text.trim(),
          idempotencyKey: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
        if (attachments && attachments.length > 0) {
          payload.attachments = attachments.map((a) => ({
            content: a.content ?? a.data,
            mimeType: a.mimeType,
            fileName: a.fileName || `image-${Date.now()}.jpg`,
          }));
        }
        await client.request("chat.send", payload);
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
