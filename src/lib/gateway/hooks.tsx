"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { GatewayClient, type ConnectionState } from "./client";
import type {
  EventFrame,
  AgentEvent,
  Agent,
  Session,
  ChatMessage,
  ToolCall,
} from "./protocol";

// --- Gateway Context ---

interface GatewayContextValue {
  client: GatewayClient | null;
  state: ConnectionState;
}

const GatewayContext = createContext<GatewayContextValue>({
  client: null,
  state: "disconnected",
});

export function GatewayProvider({ children }: { children: ReactNode }) {
  const [client, setClient] = useState<GatewayClient | null>(null);
  const [state, setState] = useState<ConnectionState>("disconnected");

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_GATEWAY_URL || "ws://127.0.0.1:18789";
    const token = process.env.NEXT_PUBLIC_GATEWAY_TOKEN || "";
    console.log("[AWF] Connecting to gateway:", url, "token:", token ? "✓" : "✗");

    const c = new GatewayClient(url, token);
    setClient(c);

    const unsub = c.onStateChange((s) => {
      console.log("[AWF] Gateway state:", s);
      setState(s);
    });
    c.connect();

    return () => {
      unsub();
      c.disconnect();
    };
  }, []);

  return (
    <GatewayContext.Provider value={{ client, state }}>
      {children}
    </GatewayContext.Provider>
  );
}

export function useGateway() {
  const ctx = useContext(GatewayContext);
  return { ...ctx, mainSessionKey: ctx.client?.mainSessionKey || "" };
}

// --- useAgents ---

export function useAgents() {
  const { client, state } = useGateway();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAgents = useCallback(async () => {
    if (!client || state !== "connected") return;
    setLoading(true);
    try {
      const res = await client.request<{ defaultId: string; agents: Agent[] }>("agents.list");
      setAgents(res?.agents || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [client, state]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, refresh: fetchAgents };
}

// --- useSessions ---

export function useSessions() {
  const { client, state } = useGateway();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const lastRefreshAtRef = useRef(0);

  const fetchSessions = useCallback(async () => {
    if (!client || state !== "connected") return;
    setLoading(true);
    try {
      const res = await client.request<{ sessions: Array<Record<string, unknown>> }>("sessions.list", { limit: 200 });
      // Map gateway sessions to our Session type, preserving extra fields
      const mapped = (res?.sessions || []).map((s) => ({
        key: String(s.key || ""),
        agentId: undefined,
        agentName: undefined,
        title: s.label ? String(s.label) : undefined,
        lastMessage: undefined,
        updatedAt: typeof s.updatedAt === "number" ? new Date(s.updatedAt).toISOString() : undefined,
        messageCount: undefined,
        // Extra fields for session-switcher
        ...s,
      })) as Session[];
      setSessions(mapped);
      lastRefreshAtRef.current = Date.now();
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [client, state]);

  const refreshThrottled = useCallback(() => {
    const now = Date.now();
    // Prevent burst refreshes when many agent events arrive
    if (now - lastRefreshAtRef.current < 1200) return;
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Realtime-ish updates: refresh sessions when agent turn finishes
  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((frame) => {
      if (frame.event !== "agent") return;
      const raw = frame.payload as Record<string, unknown>;
      const stream = raw.stream as string | undefined;
      const data = raw.data as Record<string, unknown> | undefined;

      if (stream === "lifecycle" && (data?.phase === "end" || data?.phase === "start")) {
        refreshThrottled();
      }
    });
    return unsub;
  }, [client, refreshThrottled]);

  // Periodic safety refresh so header metadata does not go stale
  useEffect(() => {
    if (state !== "connected") return;
    const id = setInterval(() => {
      refreshThrottled();
    }, 15000);
    return () => clearInterval(id);
  }, [state, refreshThrottled]);

  // Optimistic local patch — update a session field immediately without waiting for gateway refresh
  const patchSession = useCallback((key: string, patch: Record<string, unknown>) => {
    setSessions((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  return { sessions, loading, refresh: fetchSessions, patchSession };
}

// --- Helpers ---

/** Strip OpenClaw inbound metadata from user messages */
function stripInboundMeta(text: string): string {
  // Remove "Conversation info (untrusted metadata):\n```json\n{...}\n```\n" blocks
  let cleaned = text.replace(/Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g, "");
  // Remove "[Thu 2026-02-19 21:46 GMT+9] " style timestamps at start
  cleaned = cleaned.replace(/^\[[\w\s\-:+]+\]\s*/g, "");
  return cleaned.trim();
}

/** Strip unresolved gateway template variables like [[reply_to_current]] */
function stripTemplateVars(text: string): string {
  return text.replace(/\[\[[^\]]+\]\]\s*/g, "").trim();
}

// --- useChat ---

export interface DisplayAttachment {
  fileName: string;
  mimeType: string;
  /** data URL for local preview */
  dataUrl?: string;
  /** URL for downloading the file (e.g. gateway-served MEDIA path) */
  downloadUrl?: string;
}

/** Parse MEDIA:<path-or-url> lines from assistant content, returning attachments and cleaned text */
function extractMediaAttachments(text: string): { cleanedText: string; attachments: DisplayAttachment[] } {
  const MEDIA_RE = /^MEDIA:(.+)$/gm;
  const attachments: DisplayAttachment[] = [];
  let match: RegExpExecArray | null;
  while ((match = MEDIA_RE.exec(text)) !== null) {
    const raw = match[1].trim();
    const fileName = raw.split("/").pop() || raw;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const MIME_MAP: Record<string, string> = {
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
      webp: "image/webp", svg: "image/svg+xml",
      pdf: "application/pdf", zip: "application/zip",
      mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4",
      mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime",
      json: "application/json", csv: "text/csv", txt: "text/plain",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    const mimeType = MIME_MAP[ext] || "application/octet-stream";
    const isImage = mimeType.startsWith("image/");
    const isHttp = raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:");
    const downloadUrl = isHttp ? raw : `/api/media?path=${encodeURIComponent(raw)}`;
    attachments.push({
      fileName,
      mimeType,
      dataUrl: isImage ? downloadUrl : undefined,
      downloadUrl,
    });
  }
  const cleanedText = text.replace(/^MEDIA:.+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
  return { cleanedText, attachments };
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  toolCalls: ToolCall[];
  streaming?: boolean;
  /** Message is queued and not yet sent to the gateway */
  queued?: boolean;
  /** Attachments (images, files) */
  attachments?: DisplayAttachment[];
}

export type AgentStatus =
  | { phase: "idle" }
  | { phase: "thinking" }
  | { phase: "writing" }
  | { phase: "tool"; toolName: string }
  | { phase: "waiting" }; // agent finished, awaiting user input

export function useChat(sessionKey?: string) {
  const { client, state } = useGateway();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ phase: "idle" });
  // Debug: log status changes
  const setAgentStatusDebug = useCallback((s: AgentStatus) => {
    console.log("[AWF] agentStatus →", s.phase, "toolName" in s ? (s as any).toolName : "");
    setAgentStatus(s);
  }, []);
  const streamBuf = useRef<{
    id: string;
    content: string;
    toolCalls: Map<string, ToolCall>;
  } | null>(null);
  const sessionKeyRef = useRef(sessionKey);

  // Queue storage key (must be before loadHistory which references it)
  const queueStorageKey = sessionKey ? `awf:queue:${sessionKey}` : null;

  // Reset state on session change
  useEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      setMessages([]);
      setStreaming(false);
      setAgentStatusDebug({ phase: "idle" });
      streamBuf.current = null;
    }
  }, [sessionKey]);

  // Load history
  const loadHistory = useCallback(async () => {
    if (!client || state !== "connected") return;
    setLoading(true);
    try {
      const res = await client.request<{ messages: ChatMessage[] }>(
        "chat.history",
        { sessionKey, limit: 100 }
      );
      /** Internal system messages and empty agent replies to hide from UI */
      const HIDDEN_PATTERNS = /^(NO_REPLY|HEARTBEAT_OK|NO_)\s*$|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now/;
      const isHiddenMessage = (role: string, text: string) => {
        if (role === "system") return true; // hide all system-role messages
        return HIDDEN_PATTERNS.test(text.trim());
      };

      const histMsgs: DisplayMessage[] = (res?.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
        .map((m, i) => {
          // Extract text and images from content
          let textContent = '';
          const imgAttachments: DisplayAttachment[] = [];

          if (typeof m.content === 'string') {
            textContent = m.content;
          } else if (Array.isArray(m.content)) {
            const parts = m.content as Array<Record<string, unknown>>;
            const hasToolUse = parts.some(p => p.type === 'tool_use');
            for (const p of parts) {
              if (p.type === 'text' && typeof p.text === 'string') {
                // Skip short narration between tool calls (e.g. "패널 루트에 ref:")
                if (hasToolUse && m.role === 'assistant') {
                  const text = (p.text as string).trim();
                  // Keep substantial text blocks (>100 chars or multi-line with content)
                  if (text.length < 100 && !text.includes('\n')) continue;
                }
                textContent += p.text;
              } else if (p.type === 'image_url' || p.type === 'image') {
                const url = typeof p.image_url === 'object' && p.image_url
                  ? (p.image_url as Record<string, string>).url
                  : typeof p.url === 'string' ? p.url
                  : typeof p.source === 'object' && p.source
                    ? `data:${(p.source as Record<string, string>).media_type};base64,${(p.source as Record<string, string>).data}`
                    : undefined;
                if (url) {
                  imgAttachments.push({
                    fileName: 'image',
                    mimeType: 'image/png',
                    dataUrl: url,
                  });
                }
              }
            }
          } else {
            textContent = String(m.content || '');
          }

          if (m.role === 'user') textContent = stripInboundMeta(textContent);

          // Extract MEDIA: attachments from assistant messages
          let mediaAttachments: DisplayAttachment[] = [];
          if (m.role === 'assistant' && textContent.includes('MEDIA:')) {
            const extracted = extractMediaAttachments(textContent);
            textContent = extracted.cleanedText;
            mediaAttachments = extracted.attachments;
          }

          const allAttachments = [...imgAttachments, ...mediaAttachments];

          // Strip unresolved template variables from assistant messages
          if (m.role === 'assistant') textContent = stripTemplateVars(textContent);

          return {
          id: `hist-${i}`,
          role: (m.role === 'system' || (m.role === 'user' && /\[System Message\]|\[sessionId:|^System:\s*\[/.test(textContent)))
            ? 'system' as const
            : m.role as "user" | "assistant",
          content: textContent,
          timestamp: m.timestamp || new Date().toISOString(),
          toolCalls: m.toolCalls || [],
          attachments: allAttachments.length > 0 ? allAttachments : undefined,
        };})
        .filter((m) => !isHiddenMessage(m.role, m.content));
      // Restore queued messages from localStorage
      const savedQueue = queueStorageKey ? localStorage.getItem(queueStorageKey) : null;
      if (savedQueue) {
        try {
          const queue = JSON.parse(savedQueue) as { id: string; text: string }[];
          queueRef.current = queue;
          const queuedMsgs: DisplayMessage[] = queue.map((q) => ({
            id: q.id,
            role: "user" as const,
            content: q.text,
            timestamp: new Date().toISOString(),
            toolCalls: [],
            queued: true,
          }));
          setMessages([...histMsgs, ...queuedMsgs]);
        } catch {
          setMessages(histMsgs);
        }
      } else {
        setMessages(histMsgs);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [client, state, sessionKey, queueStorageKey]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Handle agent events
  useEffect(() => {
    if (!client) return;

    // Deduplicate events by frame.seq to prevent double-rendering
    let lastSeq = -1;

    const unsub = client.onEvent((frame: EventFrame) => {
      if (frame.event !== "agent") return;

      // Deduplicate: gateway sometimes sends the same event twice
      // Use frame-level seq (not payload.seq)
      if (frame.seq != null) {
        if (frame.seq <= lastSeq) return;
        lastSeq = frame.seq;
      }

      const raw = frame.payload as Record<string, unknown>;

      // Real Gateway payload: {runId, stream, data:{text,delta}, sessionKey}
      const stream = raw.stream as string | undefined;
      const data = raw.data as Record<string, unknown> | undefined;
      const evSessionKey = raw.sessionKey as string | undefined;

      // Filter events: only process events matching current session
      if (evSessionKey && evSessionKey !== sessionKeyRef.current) return;
      if (!evSessionKey && sessionKeyRef.current) return;

      // Map real gateway events to our handler
      if (stream === "assistant" && (typeof data?.delta === "string" || typeof data?.text === "string")) {
        // Streamed delta or one-shot text
        const chunk = (data?.delta as string | undefined) ?? (data?.text as string);
          setStreaming(true);
          setAgentStatusDebug({ phase: "writing" });
          if (!streamBuf.current) {
            const id = `stream-${Date.now()}`;
            streamBuf.current = { id, content: "", toolCalls: new Map() };
          }
          streamBuf.current.content += chunk;
          const snap = streamBuf.current;
          // Extract MEDIA: during streaming for stable image rendering
          let displayContent = snap.content;
          let streamAttachments: DisplayAttachment[] | undefined;
          if (displayContent.includes('MEDIA:')) {
            const extracted = extractMediaAttachments(displayContent);
            displayContent = extracted.cleanedText;
            streamAttachments = extracted.attachments.length > 0 ? extracted.attachments : undefined;
          }
          setMessages((prev) => {
            const existing = prev.findIndex((m) => m.id === snap.id);
            const msg: DisplayMessage = {
              id: snap.id,
              role: "assistant",
              content: displayContent,
              timestamp: new Date().toISOString(),
              toolCalls: Array.from(snap.toolCalls.values()),
              streaming: true,
              attachments: streamAttachments,
            };
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = msg;
              return next;
            }
            return [...prev, msg];
          });
      } else if (stream === "tool-start" && data) {
        // tool-call-start
          const callId = (data.toolCallId || data.callId || "") as string;
          const name = (data.name || data.tool || "") as string;
          setAgentStatusDebug({ phase: "tool", toolName: name });
          const args = data.args as string | undefined;
          if (!streamBuf.current) {
            const id = `stream-${Date.now()}`;
            streamBuf.current = { id, content: "", toolCalls: new Map() };
          }
          streamBuf.current.toolCalls.set(callId, {
            callId,
            name,
            args,
            status: "running",
          });
          const snapTool = streamBuf.current;
          setMessages((prev) => {
            const existing = prev.findIndex((m) => m.id === snapTool.id);
            const msg: DisplayMessage = {
              id: snapTool.id,
              role: "assistant",
              content: snapTool.content,
              timestamp: new Date().toISOString(),
              toolCalls: Array.from(snapTool.toolCalls.values()),
              streaming: true,
            };
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = msg;
              return next;
            }
            return [...prev, msg];
          });
      } else if (stream === "tool-end" && data) {
        // tool-call-end
          const callId = (data.toolCallId || data.callId || "") as string;
          const result = data.result as string | undefined;
          setAgentStatusDebug({ phase: "thinking" });
          if (streamBuf.current) {
            const tc = streamBuf.current.toolCalls.get(callId);
            if (tc) {
              tc.status = "done";
              tc.result = result;
            }
            const snapEnd = streamBuf.current;
            setMessages((prev) => {
              const existing = prev.findIndex((m) => m.id === snapEnd.id);
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = {
                  ...next[existing],
                  toolCalls: Array.from(snapEnd.toolCalls.values()),
                };
                return next;
              }
              return prev;
            });
          }
      } else if (stream === "lifecycle" && data?.phase === "start") {
        // lifecycle start
          setStreaming(true);
          setAgentStatusDebug({ phase: "thinking" });
      } else if (stream === "lifecycle" && data?.phase === "end") {
        // lifecycle end = done
          setStreaming(false);
          setAgentStatusDebug({ phase: "waiting" });
          if (streamBuf.current) {
            const finalId = streamBuf.current.id;
            let finalContent = streamBuf.current.content;
            finalContent = stripTemplateVars(finalContent);
            const finalTools = Array.from(streamBuf.current.toolCalls.values());
            // Extract MEDIA: attachments from final content
            let finalAttachments: DisplayAttachment[] | undefined;
            if (finalContent.includes('MEDIA:')) {
              const extracted = extractMediaAttachments(finalContent);
              finalContent = extracted.cleanedText;
              finalAttachments = extracted.attachments.length > 0 ? extracted.attachments : undefined;
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === finalId
                  ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false, attachments: finalAttachments || m.attachments }
                  : m
              )
            );
            streamBuf.current = null;
          }
      } else if (stream === "done" || stream === "end" || stream === "finish") {
        // done
          setStreaming(false);
          setAgentStatusDebug({ phase: "waiting" });
          if (streamBuf.current) {
            const finalId = streamBuf.current.id;
            let finalContent = (data?.text as string) || streamBuf.current.content;
            finalContent = stripTemplateVars(finalContent);
            const finalTools = Array.from(streamBuf.current.toolCalls.values());
            let finalAttachments: DisplayAttachment[] | undefined;
            if (finalContent.includes('MEDIA:')) {
              const extracted = extractMediaAttachments(finalContent);
              finalContent = extracted.cleanedText;
              finalAttachments = extracted.attachments.length > 0 ? extracted.attachments : undefined;
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === finalId
                  ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false, attachments: finalAttachments || m.attachments }
                  : m
              )
            );
            streamBuf.current = null;
          }
      } else if (stream === "error") {
        // error
          setStreaming(false);
          setAgentStatusDebug({ phase: "idle" });
          const errMsg = (data?.message || data?.error || "Unknown error") as string;
          if (streamBuf.current) {
            const errId = streamBuf.current.id;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === errId
                  ? { ...m, content: m.content + `\n\n**Error:** ${errMsg}`, streaming: false }
                  : m
              )
            );
            streamBuf.current = null;
          }
      }
    });

    return unsub;
  }, [client, sessionKey]);

  // Message queue for messages sent while streaming — persist to localStorage
  const queueRef = useRef<{ id: string; text: string }[]>(
    (() => {
      if (queueStorageKey && typeof window !== "undefined") {
        try {
          const saved = localStorage.getItem(queueStorageKey);
          return saved ? JSON.parse(saved) : [];
        } catch { return []; }
      }
      return [];
    })()
  );
  const processingQueue = useRef(false);

  const persistQueue = useCallback(() => {
    if (!queueStorageKey) return;
    if (queueRef.current.length > 0) {
      localStorage.setItem(queueStorageKey, JSON.stringify(queueRef.current));
    } else {
      localStorage.removeItem(queueStorageKey);
    }
  }, [queueStorageKey]);

  // Actually send a message to the gateway
  const doSend = useCallback(
    async (text: string, msgId: string) => {
      if (!client || state !== "connected") return;
      // Mark message as no longer queued
      setMessages((prev) =>
        prev.map((m) => (m.id === msgId ? { ...m, queued: false } : m))
      );
      setStreaming(true);
      setAgentStatusDebug({ phase: "thinking" });
      try {
        await client.request("chat.send", {
          message: text,
          idempotencyKey: `awf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          sessionKey,
        });
      } catch (err) {
        console.error("[AWF] chat.send error:", String(err));
        setStreaming(false);
      }
    },
    [client, state, sessionKey]
  );

  // Process queue: send next message when streaming ends
  const processQueue = useCallback(async () => {
    if (processingQueue.current) return;
    processingQueue.current = true;
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()!;
      persistQueue();
      // Check if message was cancelled (removed from messages)
      const stillExists = await new Promise<boolean>((resolve) => {
        setMessages((prev) => {
          resolve(prev.some((m) => m.id === next.id));
          return prev;
        });
      });
      if (stillExists) {
        await doSend(next.text, next.id);
        // Wait for streaming to finish before sending next
        await new Promise<void>((resolve) => {
          const check = () => {
            // Poll streaming state - resolve when not streaming
            setTimeout(() => {
              setStreaming((s) => {
                if (!s) resolve();
                else check();
                return s;
              });
            }, 200);
          };
          check();
        });
      }
    }
    processingQueue.current = false;
  }, [doSend]);

  // Send message (queues if currently streaming)
  const sendMessage = useCallback(
    (text: string) => {
      if (!client || state !== "connected" || !text.trim()) return;

      const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const userMsg: DisplayMessage = {
        id: msgId,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
        toolCalls: [],
        queued: streaming,
      };
      setMessages((prev) => [...prev, userMsg]);

      if (streaming) {
        // Queue for later
        queueRef.current.push({ id: msgId, text });
        persistQueue();
      } else {
        // Send immediately
        doSend(text, msgId);
      }
    },
    [client, state, streaming, doSend]
  );

  // When streaming ends, process queue
  useEffect(() => {
    if (!streaming && queueRef.current.length > 0) {
      processQueue();
    }
  }, [streaming, processQueue]);

  // Cancel a queued message
  const cancelQueued = useCallback((msgId: string) => {
    queueRef.current = queueRef.current.filter((q) => q.id !== msgId);
    persistQueue();
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }, [persistQueue]);

  // Abort
  const abort = useCallback(async () => {
    if (!client || state !== "connected") return;
    try {
      await client.request("chat.abort", { sessionKey });
    } catch {
      // silently fail
    }
    setStreaming(false);
    setAgentStatusDebug({ phase: "idle" });
  }, [client, state, sessionKey]);

  // Add a user message to the display (for external callers like attachment sends)
  const addUserMessage = useCallback((text: string, attachments?: DisplayAttachment[]) => {
    const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userMsg: DisplayMessage = {
      id: msgId,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      toolCalls: [],
      queued: streaming,
      attachments,
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!streaming) {
      setStreaming(true);
    }
  }, [streaming]);

  return {
    messages,
    streaming,
    loading,
    agentStatus,
    sendMessage,
    addUserMessage,
    cancelQueued,
    abort,
    reload: loadHistory,
  };
}
