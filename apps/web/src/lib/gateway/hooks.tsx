
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { getMimeType } from "@/lib/mime-types";
import { platform } from "@/lib/platform";
import type {
  EventFrame,
  Session,
  ChatMessage,
  ToolCall,
} from "@intelli-claw/shared";

// Re-export everything from shared for backward compatibility
export {
  GatewayProvider as GatewayProviderBase,
  useGateway,
  useAgents,
  onSessionReset,
  emitSessionReset,
  GATEWAY_CONFIG_STORAGE_KEY,
  DEFAULT_GATEWAY_URL,
  type GatewayConfig,
  type SessionResetEvent,
} from "@intelli-claw/shared";

import {
  GatewayProvider as GatewayProviderBase,
  useGateway,
  onSessionReset,
  emitSessionReset,
  GATEWAY_CONFIG_STORAGE_KEY,
  DEFAULT_GATEWAY_URL,
  type GatewayConfig,
} from "@intelli-claw/shared";

import {
  trackSessionId,
  markSessionEnded,
  getCurrentSessionId,
} from "./topic-store";

// --- Web Config Persistence ---

export function loadGatewayConfig(): GatewayConfig {
  try {
    const saved = localStorage.getItem(GATEWAY_CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<GatewayConfig>;
      if (parsed.url && parsed.token) return parsed as GatewayConfig;
    }
  } catch { /* ignore */ }
  return {
    url: import.meta.env.VITE_GATEWAY_URL || DEFAULT_GATEWAY_URL,
    token: import.meta.env.VITE_GATEWAY_TOKEN || "",
  };
}

function saveConfig(url: string, token: string): void {
  localStorage.setItem(GATEWAY_CONFIG_STORAGE_KEY, JSON.stringify({ url, token }));
}

// --- Web GatewayProvider (wraps shared with localStorage persistence) ---

export function GatewayProvider({ children }: { children: ReactNode }) {
  const config = loadGatewayConfig();
  return (
    <GatewayProviderBase
      url={config.url}
      token={config.token}
      onConfigChange={saveConfig}
    >
      {children}
    </GatewayProviderBase>
  );
}

// --- useSessions (web-specific: uses IndexedDB topic-store) ---

export function useSessions() {
  const { client, state } = useGateway();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const lastRefreshAtRef = useRef(0);
  const trackedSessionIdsRef = useRef<Map<string, string>>(new Map());

  const fetchSessions = useCallback(async () => {
    if (!client || state !== "connected") return;
    setLoading(true);
    try {
      const res = await client.request<{ sessions: Array<Record<string, unknown>> }>("sessions.list", { limit: 200 });
      const mapped = (res?.sessions || []).map((s) => ({
        key: String(s.key || ""),
        agentId: undefined,
        agentName: undefined,
        title: s.label ? String(s.label) : undefined,
        lastMessage: undefined,
        updatedAt: typeof s.updatedAt === "number" ? new Date(s.updatedAt).toISOString() : undefined,
        messageCount: undefined,
        ...s,
      })) as Session[];
      setSessions(mapped);
      lastRefreshAtRef.current = Date.now();

      for (const s of res?.sessions || []) {
        const key = String(s.key || "");
        const newSessionId = s.sessionId ? String(s.sessionId) : undefined;
        if (!key || !newSessionId) continue;

        const oldSessionId = trackedSessionIdsRef.current.get(key);
        trackedSessionIdsRef.current.set(key, newSessionId);

        if (oldSessionId && oldSessionId !== newSessionId) {
          console.log(`[AWF] Session reset detected: ${key} ${oldSessionId.slice(0, 8)} → ${newSessionId.slice(0, 8)}`);
          const label = s.label ? String(s.label) : undefined;
          const totalTokens = typeof s.totalTokens === "number" ? s.totalTokens : undefined;
          markSessionEnded(key, oldSessionId, { totalTokens }).catch(() => {});
          trackSessionId(key, newSessionId, { label }).catch(() => {});
          emitSessionReset({ key, oldSessionId, newSessionId });
        } else if (!oldSessionId) {
          const existing = await getCurrentSessionId(key);
          if (!existing || existing !== newSessionId) {
            if (existing) {
              markSessionEnded(key, existing).catch(() => {});
            }
            trackSessionId(key, newSessionId, {
              label: s.label ? String(s.label) : undefined,
            }).catch(() => {});
          }
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [client, state]);

  const refreshThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastRefreshAtRef.current < 1200) return;
    fetchSessions();
  }, [fetchSessions]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

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

  useEffect(() => {
    if (state !== "connected") return;
    const id = setInterval(() => { refreshThrottled(); }, 15000);
    return () => clearInterval(id);
  }, [state, refreshThrottled]);

  const patchSession = useCallback((key: string, patch: Record<string, unknown>) => {
    setSessions((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  return { sessions, loading, refresh: fetchSessions, patchSession };
}

// --- Helpers ---

function stripInboundMeta(text: string): string {
  let cleaned = text.replace(/Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g, "");
  // Only strip gateway-injected timestamp prefixes like [2024-01-15 10:30:45+09:00]
  // Do NOT strip arbitrary bracketed text like [important], [TODO], etc. (#55)
  cleaned = cleaned.replace(/^\[\d{4}-\d{2}-\d{2}[\w\s\-:+]*\]\s*/g, "");
  return cleaned.trim();
}

function stripTemplateVars(text: string): string {
  return text.replace(/\[\[[^\]]+\]\]\s*/g, "").trim();
}

// --- useChat (web-specific: uses localStorage, platform, mime-types) ---

export interface DisplayAttachment {
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  downloadUrl?: string;
  textContent?: string;
}

function extractMediaAttachments(text: string): { cleanedText: string; attachments: DisplayAttachment[] } {
  const MEDIA_RE = /^MEDIA:(.+)$/gm;
  const attachments: DisplayAttachment[] = [];
  let match: RegExpExecArray | null;
  while ((match = MEDIA_RE.exec(text)) !== null) {
    const raw = match[1].trim();
    const fileName = raw.split("/").pop() || raw;
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const mimeType = getMimeType(ext);
    const isImage = mimeType.startsWith("image/");
    const isHttp = raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:");
    const downloadUrl = isHttp ? raw : platform.mediaUrl(raw);
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
  role: "user" | "assistant" | "system" | "session-boundary";
  content: string;
  timestamp: string;
  toolCalls: ToolCall[];
  streaming?: boolean;
  queued?: boolean;
  attachments?: DisplayAttachment[];
  oldSessionId?: string;
  newSessionId?: string;
}

export type AgentStatus =
  | { phase: "idle" }
  | { phase: "thinking" }
  | { phase: "writing" }
  | { phase: "tool"; toolName: string }
  | { phase: "waiting" };

export function useChat(sessionKey?: string) {
  const { client, state } = useGateway();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ phase: "idle" });
  const setAgentStatusDebug = useCallback((s: AgentStatus) => {
    console.log("[AWF] agentStatus →", s.phase, "toolName" in s ? (s as any).toolName : "");
    setAgentStatus(s);
  }, []);
  const streamBuf = useRef<{
    id: string;
    content: string;
    toolCalls: Map<string, ToolCall>;
  } | null>(null);
  const streamIdCounter = useRef(0);
  const runIdRef = useRef<string | null>(null);
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionKeyRef = useRef(sessionKey);

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
      console.warn("[AWF] streaming timeout — force reset");
      if (streamBuf.current) {
        const id = streamBuf.current.id;
        setMessages((prev) =>
          prev.map((m) => m.id === id ? { ...m, streaming: false } : m)
        );
        streamBuf.current = null;
      }
      runIdRef.current = null;
      setStreaming(false);
      setAgentStatusDebug({ phase: "idle" });
    }, STREAMING_TIMEOUT_MS);
  }, [clearStreamingTimeout]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  const queueStorageKey = sessionKey ? `awf:queue:${sessionKey}` : null;

  useEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      setMessages([]);
      setStreaming(false);
      clearStreamingTimeout();
      setAgentStatusDebug({ phase: "idle" });
      streamBuf.current = null;
    }
  }, [sessionKey, clearStreamingTimeout]);

  useEffect(() => {
    if (state === "disconnected" && streaming) {
      console.warn("[AWF] connection lost — resetting streaming state");
      clearStreamingTimeout();
      if (streamBuf.current) {
        const id = streamBuf.current.id;
        setMessages((prev) =>
          prev.map((m) => m.id === id ? { ...m, streaming: false } : m)
        );
        streamBuf.current = null;
      }
      runIdRef.current = null;
      setStreaming(false);
      setAgentStatusDebug({ phase: "idle" });
    }
  }, [state]);

  const loadHistory = useCallback(async () => {
    if (!client || state !== "connected") return;
    setLoading(true);
    try {
      const res = await client.request<{ messages: ChatMessage[] }>(
        "chat.history",
        { sessionKey, limit: 100 }
      );
      const HIDDEN_PATTERNS = /^(NO_REPLY|HEARTBEAT_OK|NO_)\s*$|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now|\[System\] 이전 세션이 컨텍스트 한도로 갱신|\[이전 세션 맥락\]/;
      const isHiddenMessage = (role: string, text: string) => {
        if (role === "system") return true;
        return HIDDEN_PATTERNS.test(text.trim());
      };

      const histMsgs: DisplayMessage[] = (res?.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
        .map((m, i) => {
          let textContent = '';
          const imgAttachments: DisplayAttachment[] = [];

          if (typeof m.content === 'string') {
            textContent = m.content;
          } else if (Array.isArray(m.content)) {
            const parts = m.content as Array<Record<string, unknown>>;
            const hasToolUse = parts.some(p => p.type === 'tool_use');
            for (const p of parts) {
              if (p.type === 'text' && typeof p.text === 'string') {
                if (hasToolUse && m.role === 'assistant') {
                  const text = (p.text as string).trim();
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
                  imgAttachments.push({ fileName: 'image', mimeType: 'image/png', dataUrl: url });
                }
              }
            }
          } else {
            textContent = String(m.content || '');
          }

          if (m.role === 'user') textContent = stripInboundMeta(textContent);

          let mediaAttachments: DisplayAttachment[] = [];
          if (m.role === 'assistant' && textContent.includes('MEDIA:')) {
            const extracted = extractMediaAttachments(textContent);
            textContent = extracted.cleanedText;
            mediaAttachments = extracted.attachments;
          }

          const allAttachments = [...imgAttachments, ...mediaAttachments];
          if (m.role === 'assistant') textContent = stripTemplateVars(textContent);

          // Check ORIGINAL content for system-injected markers (before stripping) (#55)
          // Use ^ anchors to avoid false positives on user text containing these substrings mid-text
          const rawContentStr = typeof m.content === 'string' ? m.content : textContent;
          const isSystemInjected = m.role === 'user' && /^\[System Message\]|^\[sessionId:|^System:\s*\[/.test(rawContentStr);

          return {
            id: `hist-${i}`,
            role: (m.role === 'system' || isSystemInjected)
              ? 'system' as const
              : m.role as "user" | "assistant",
            content: textContent,
            timestamp: m.timestamp || new Date().toISOString(),
            toolCalls: m.toolCalls || [],
            attachments: allAttachments.length > 0 ? allAttachments : undefined,
          };
        })
        .filter((m) => !isHiddenMessage(m.role, m.content));

      const savedQueue = queueStorageKey ? localStorage.getItem(queueStorageKey) : null;
      if (savedQueue) {
        try {
          const queue = JSON.parse(savedQueue) as { id: string; text: string }[];
          queueRef.current = queue;
          const queuedMsgs: DisplayMessage[] = queue.map((q) => ({
            id: q.id, role: "user" as const, content: q.text,
            timestamp: new Date().toISOString(), toolCalls: [], queued: true,
          }));
          setMessages([...histMsgs, ...queuedMsgs]);
        } catch { setMessages(histMsgs); }
      } else {
        setMessages(histMsgs);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [client, state, sessionKey, queueStorageKey]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Handle agent events
  useEffect(() => {
    if (!client) return;
    let lastSeq = -1;

    const unsub = client.onEvent((frame: EventFrame) => {
      if (frame.event !== "agent") return;
      if (frame.seq != null) {
        if (frame.seq <= lastSeq) return;
        lastSeq = frame.seq;
      }

      const raw = frame.payload as Record<string, unknown>;
      const stream = raw.stream as string | undefined;
      const data = raw.data as Record<string, unknown> | undefined;
      // Check both top-level sessionKey and data.sessionKey — gateway may
      // nest the key inside data depending on event type (#48)
      const evSessionKey = (raw.sessionKey ?? data?.sessionKey) as string | undefined;
      if (evSessionKey && evSessionKey !== sessionKeyRef.current) return;
      if (!evSessionKey && sessionKeyRef.current) return;

      if (stream === "assistant" && (typeof data?.delta === "string" || typeof data?.text === "string")) {
        const chunk = (data?.delta as string | undefined) ?? (data?.text as string);
        setStreaming(true);
        startStreamingTimeout();
        setAgentStatusDebug({ phase: "writing" });
        if (!streamBuf.current) {
          streamBuf.current = { id: `stream-${Date.now()}-${++streamIdCounter.current}`, content: "", toolCalls: new Map() };
        }
        streamBuf.current.content += chunk;
        const snap = streamBuf.current;
        let displayContent = snap.content;
        let streamAttachments: DisplayAttachment[] | undefined;
        if (displayContent.includes('MEDIA:')) {
          const extracted = extractMediaAttachments(displayContent);
          displayContent = extracted.cleanedText;
          streamAttachments = extracted.attachments.length > 0 ? extracted.attachments : undefined;
        }
        setMessages((prev) => {
          const existing = prev.findIndex((m) => m.id === snap.id);
          const prevAttachments = existing >= 0 ? prev[existing].attachments : undefined;
          const msg: DisplayMessage = {
            id: snap.id, role: "assistant", content: displayContent,
            timestamp: new Date().toISOString(),
            toolCalls: Array.from(snap.toolCalls.values()),
            streaming: true, attachments: streamAttachments ?? prevAttachments,
          };
          if (existing >= 0) { const next = [...prev]; next[existing] = msg; return next; }
          return [...prev, msg];
        });
      } else if (stream === "tool-start" && data) {
        const callId = (data.toolCallId || data.callId || "") as string;
        const name = (data.name || data.tool || "") as string;
        setAgentStatusDebug({ phase: "tool", toolName: name });
        const args = data.args as string | undefined;
        if (!streamBuf.current) {
          streamBuf.current = { id: `stream-${Date.now()}-${++streamIdCounter.current}`, content: "", toolCalls: new Map() };
        }
        streamBuf.current.toolCalls.set(callId, { callId, name, args, status: "running" });
        const snapTool = streamBuf.current;
        setMessages((prev) => {
          const existing = prev.findIndex((m) => m.id === snapTool.id);
          const msg: DisplayMessage = {
            id: snapTool.id, role: "assistant", content: snapTool.content,
            timestamp: new Date().toISOString(),
            toolCalls: Array.from(snapTool.toolCalls.values()), streaming: true,
          };
          if (existing >= 0) { const next = [...prev]; next[existing] = msg; return next; }
          return [...prev, msg];
        });
      } else if (stream === "tool-end" && data) {
        const callId = (data.toolCallId || data.callId || "") as string;
        const result = data.result as string | undefined;
        setAgentStatusDebug({ phase: "thinking" });
        if (streamBuf.current) {
          const tc = streamBuf.current.toolCalls.get(callId);
          if (tc) { tc.status = "done"; tc.result = result; }
          const snapEnd = streamBuf.current;
          setMessages((prev) => {
            const existing = prev.findIndex((m) => m.id === snapEnd.id);
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = { ...next[existing], toolCalls: Array.from(snapEnd.toolCalls.values()) };
              return next;
            }
            return prev;
          });
        }
      } else if (stream === "inbound" && data) {
        // Messages from other surfaces (Telegram, other devices, etc.)
        const text = ((data.text ?? data.content ?? "") as string);
        const role = (data.role ?? "user") as "user" | "assistant";
        if (text) {
          const cleanedText = role === "user" ? stripInboundMeta(text) : text;
          const inboundId = `inbound-${Date.now()}-${++streamIdCounter.current}`;
          setMessages((prev) => [...prev, {
            id: inboundId,
            role,
            content: cleanedText,
            timestamp: new Date().toISOString(),
            toolCalls: [],
          }]);
        }
      } else if (stream === "lifecycle" && data?.phase === "start") {
        setStreaming(true);
        startStreamingTimeout();
        runIdRef.current = (raw.runId as string) ?? null;
        setAgentStatusDebug({ phase: "thinking" });
      } else if (stream === "lifecycle" && data?.phase === "end") {
        clearStreamingTimeout();
        setStreaming(false);
        setAgentStatusDebug({ phase: "idle" });
        if (streamBuf.current) {
          const finalId = streamBuf.current.id;
          let finalContent = stripTemplateVars(streamBuf.current.content);
          const finalTools = Array.from(streamBuf.current.toolCalls.values());
          let finalAttachments: DisplayAttachment[] | undefined;
          if (finalContent.includes('MEDIA:')) {
            const extracted = extractMediaAttachments(finalContent);
            finalContent = extracted.cleanedText;
            finalAttachments = extracted.attachments.length > 0 ? extracted.attachments : undefined;
          }
          setMessages((prev) =>
            prev.map((m) => m.id === finalId
              ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false, attachments: finalAttachments || m.attachments }
              : m)
          );
          streamBuf.current = null;
        }
      } else if (stream === "done" || stream === "end" || stream === "finish") {
        clearStreamingTimeout();
        setStreaming(false);
        setAgentStatusDebug({ phase: "idle" });
        if (streamBuf.current) {
          const finalId = streamBuf.current.id;
          let finalContent = stripTemplateVars((data?.text as string) || streamBuf.current.content);
          const finalTools = Array.from(streamBuf.current.toolCalls.values());
          let finalAttachments: DisplayAttachment[] | undefined;
          if (finalContent.includes('MEDIA:')) {
            const extracted = extractMediaAttachments(finalContent);
            finalContent = extracted.cleanedText;
            finalAttachments = extracted.attachments.length > 0 ? extracted.attachments : undefined;
          }
          setMessages((prev) =>
            prev.map((m) => m.id === finalId
              ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false, attachments: finalAttachments || m.attachments }
              : m)
          );
          streamBuf.current = null;
        }
      } else if (stream === "error") {
        clearStreamingTimeout();
        setStreaming(false);
        setAgentStatusDebug({ phase: "idle" });
        const errMsg = (data?.message || data?.error || "Unknown error") as string;
        if (streamBuf.current) {
          const errId = streamBuf.current.id;
          setMessages((prev) =>
            prev.map((m) => m.id === errId
              ? { ...m, content: m.content + `\n\n**Error:** ${errMsg}`, streaming: false }
              : m)
          );
          streamBuf.current = null;
        }
      }
    });
    return unsub;
  }, [client, sessionKey]);

  // Message queue
  const queueRef = useRef<{ id: string; text: string }[]>(
    (() => {
      if (queueStorageKey && typeof window !== "undefined") {
        try { const saved = localStorage.getItem(queueStorageKey); return saved ? JSON.parse(saved) : []; }
        catch { return []; }
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

  const doSend = useCallback(
    async (text: string, msgId: string) => {
      if (!client || state !== "connected") return;
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, queued: false } : m)));
      setStreaming(true);
      startStreamingTimeout();
      setAgentStatusDebug({ phase: "thinking" });
      try {
        await client.request("chat.send", {
          message: text,
          idempotencyKey: `awf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          sessionKey,
        });
      } catch (err) {
        console.error("[AWF] chat.send error:", String(err));
        clearStreamingTimeout();
        setStreaming(false);
      }
    },
    [client, state, sessionKey]
  );

  const processQueue = useCallback(async () => {
    if (processingQueue.current) return;
    processingQueue.current = true;
    try {
      while (queueRef.current.length > 0) {
        const next = queueRef.current.shift()!;
        persistQueue();
        const stillExists = await new Promise<boolean>((resolve) => {
          setMessages((prev) => { resolve(prev.some((m) => m.id === next.id)); return prev; });
        });
        if (stillExists) {
          await doSend(next.text, next.id);
          await new Promise<void>((resolve) => {
            const start = Date.now();
            const check = () => {
              setTimeout(() => {
                if (!streamingRef.current) resolve();
                else if (Date.now() - start > 60_000) { console.warn("[AWF] processQueue streaming wait timeout"); resolve(); }
                else check();
              }, 300);
            };
            check();
          });
        }
      }
    } finally { processingQueue.current = false; }
  }, [doSend, persistQueue]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!client || state !== "connected" || !text.trim()) return;
      const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const userMsg: DisplayMessage = {
        id: msgId, role: "user", content: text,
        timestamp: new Date().toISOString(), toolCalls: [], queued: streaming,
      };
      setMessages((prev) => [...prev, userMsg]);
      if (streaming) { queueRef.current.push({ id: msgId, text }); persistQueue(); }
      else { doSend(text, msgId); }
    },
    [client, state, streaming, doSend]
  );

  useEffect(() => {
    if (!streaming && queueRef.current.length > 0) processQueue();
  }, [streaming, processQueue]);

  const cancelQueued = useCallback((msgId: string) => {
    queueRef.current = queueRef.current.filter((q) => q.id !== msgId);
    persistQueue();
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }, [persistQueue]);

  const abort = useCallback(async () => {
    if (!client || state !== "connected") return;
    try { await client.request("chat.abort", { sessionKey, runId: runIdRef.current ?? undefined }); }
    catch (err) { console.warn("[AWF] chat.abort failed:", String(err)); }
    clearStreamingTimeout();
    if (streamBuf.current) {
      const abortedId = streamBuf.current.id;
      setMessages((prev) => prev.map((m) => m.id === abortedId ? { ...m, streaming: false } : m));
      streamBuf.current = null;
    }
    runIdRef.current = null;
    setStreaming(false);
    setAgentStatusDebug({ phase: "idle" });
  }, [client, state, sessionKey, clearStreamingTimeout]);

  const addUserMessage = useCallback((text: string, attachments?: DisplayAttachment[]) => {
    const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userMsg: DisplayMessage = {
      id: msgId, role: "user", content: text,
      timestamp: new Date().toISOString(), toolCalls: [], queued: streaming, attachments,
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!streaming) setStreaming(true);
  }, [streaming]);

  const addLocalMessage = useCallback((content: string, role: "user" | "assistant" | "system" = "system") => {
    const msgId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages((prev) => [...prev, { id: msgId, role, content, timestamp: new Date().toISOString(), toolCalls: [] }]);
  }, []);

  const sendCommand = useCallback(
    async (text: string) => {
      if (!client || state !== "connected") return;
      try {
        await client.request("chat.send", {
          message: text,
          idempotencyKey: `awf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          sessionKey,
        });
      } catch (err) { console.error("[AWF] command error:", String(err)); }
    },
    [client, state, sessionKey]
  );

  const buildContextSummary = useCallback((): string | null => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user" && m.content.trim());
    if (!lastUser) return null;
    const userText = lastUser.content.slice(0, 150).replace(/\n/g, " ").trim();
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant" && m.content.trim());
    const assistantExcerpt = lastAssistant ? lastAssistant.content.slice(0, 120).replace(/\n/g, " ").trim() : null;
    const lines = ["[System] 이전 세션이 컨텍스트 한도로 갱신되었습니다.", `마지막 요청: ${userText}`];
    if (assistantExcerpt) lines.push(`마지막 응답 요약: ${assistantExcerpt}…`);
    lines.push("위 맥락을 참고하여 대화를 이어주세요. 이 메시지에 대해 별도 답변하지 마세요.");
    return lines.join("\n");
  }, [messages]);

  const sendContextBridge = useCallback(async () => {
    if (!client || state !== "connected" || !sessionKey) return;
    const summary = buildContextSummary();
    if (!summary) return;
    try {
      await client.request("chat.send", { message: summary, idempotencyKey: `context-bridge-${Date.now()}`, sessionKey });
      console.log("[AWF] Context bridge sent to new session");
    } catch (err) { console.error("[AWF] Context bridge send error:", err); }
  }, [client, state, sessionKey, buildContextSummary]);

  useEffect(() => {
    const unsub = onSessionReset((event) => {
      if (event.key !== sessionKeyRef.current) return;
      console.log(`[AWF] Session reset for current chat: ${event.key}`);
      const boundaryMsg: DisplayMessage = {
        id: `boundary-${event.oldSessionId.slice(0, 8)}-${Date.now()}`,
        role: "session-boundary", content: "", timestamp: new Date().toISOString(),
        toolCalls: [], oldSessionId: event.oldSessionId, newSessionId: event.newSessionId,
      };
      setMessages((prev) => [...prev, boundaryMsg]);
    });
    return unsub;
  }, []);

  return {
    messages, streaming, loading, agentStatus,
    sendMessage, sendCommand, addUserMessage, addLocalMessage,
    cancelQueued, abort, reload: loadHistory, sendContextBridge,
  };
}
