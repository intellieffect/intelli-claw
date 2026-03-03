
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

import {
  saveMessages as saveLocalMessages,
  getLocalMessages,
  backfillFromApi,
  isBackfillDone,
  runMessageStoreMigration,
  type StoredMessage,
} from "./message-store";

import { getTopicHistory } from "./topic-store";

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

// Run one-time migration on module load to purge corrupted IndexedDB data (#5536-v2)
runMessageStoreMigration();

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

/**
 * Deduplicate messages by role + normalized content + timestamp proximity.
 * Keeps the first occurrence (gateway messages should come first in the array).
 * Two messages are considered duplicates if they have the same role, similar
 * content (first 200 chars after normalization), and timestamps within 60s.
 */
/**
 * Build an attachment fingerprint for dedup comparison.
 * Uses attachment count + first dataUrl prefix (to distinguish different images)
 * while still matching optimistic vs server echo of the same image.
 * Returns empty string for messages with no attachments.
 */
function attachmentFingerprint(attachments?: DisplayAttachment[]): string {
  if (!attachments || attachments.length === 0) return "";
  // Use count + sorted first 80 chars of each dataUrl/downloadUrl for identity
  const keys = attachments
    .map((a) => (a.dataUrl || a.downloadUrl || a.fileName || "").slice(0, 80))
    .sort();
  return `[${attachments.length}]${keys.join("|")}`;
}

export function deduplicateMessages<T extends { id: string; role: string; content: string; timestamp: string; attachments?: DisplayAttachment[] }>(
  msgs: T[],
): T[] {
  const seen: Array<{ role: string; contentKey: string; attKey: string; ts: number }> = [];
  return msgs.filter((m) => {
    // Always keep session boundaries
    if (m.role === "session-boundary") return true;
    const contentKey = m.content.replace(/\s+/g, " ").trim().slice(0, 200);
    const attKey = attachmentFingerprint(m.attachments);
    const ts = new Date(m.timestamp).getTime();
    // Check if a similar message was already seen
    const isDup = seen.some(
      (s) =>
        s.role === m.role &&
        s.contentKey === contentKey &&
        s.attKey === attKey &&
        Math.abs(s.ts - ts) < 60_000, // 60-second window
    );
    if (isDup) return false;
    seen.push({ role: m.role, contentKey, attKey, ts });
    return true;
  });
}

// --- useChat (web-specific: uses localStorage, platform, mime-types) ---

export interface DisplayAttachment {
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  downloadUrl?: string;
  textContent?: string;
}

export function extractMediaAttachments(text: string): { cleanedText: string; attachments: DisplayAttachment[] } {
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

/**
 * Patterns for messages that should be hidden from the chat UI.
 * Used in both streaming completion, history load, and display-layer filtering.
 */
export const HIDDEN_REPLY_RE = /^(NO_REPLY|HEARTBEAT_OK|NO_?)\s*$|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now|\[System\] 이전 세션이 컨텍스트 한도로 갱신|\[이전 세션 맥락\]/;

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
  const abortedRef = useRef(false);
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionKeyRef = useRef(sessionKey);
  const loadVersionRef = useRef(0);
  const sendContextBridgeRef = useRef<(() => Promise<void>) | null>(null);
  const buildContextSummaryRef = useRef<(() => string | null) | null>(null);
  const contextBridgeSentRef = useRef<string | null>(null);

  const STREAMING_TIMEOUT_MS = 120_000;

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
      // Invalidate any in-flight loadHistory before clearing messages (#63)
      ++loadVersionRef.current;
      setMessages([]);
      setStreaming(false);
      clearStreamingTimeout();
      setAgentStatusDebug({ phase: "idle" });
      streamBuf.current = null;
      contextBridgeSentRef.current = null; // 새 채팅 전환 시 dedup 리셋
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
    // Bump version to detect stale responses from concurrent loadHistory calls.
    // When sessionKey changes mid-flight, the old callback must not overwrite
    // messages loaded by the new callback (#63).
    const thisLoadVersion = ++loadVersionRef.current;
    setLoading(true);
    try {
      const res = await client.request<{ messages: ChatMessage[] }>(
        "chat.history",
        { sessionKey, limit: 100 }
      );

      // Stale response guard — another loadHistory started while we awaited
      if (loadVersionRef.current !== thisLoadVersion) return;

      const isHiddenMessage = (role: string, text: string) => {
        if (role === "system") return true;
        return HIDDEN_REPLY_RE.test(text.trim());
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
                  // Keep text blocks with markdown images/media even if short
                  const hasMedia = /!\[.*?\]\(.*?\)|^MEDIA:\s/m.test(text);
                  if (!hasMedia && text.length < 100 && !text.includes('\n')) continue;
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

          // Extract gateway-level attachments (e.g., user-sent images stored
          // separately from multipart content) (#64)
          const rawMsg = m as unknown as Record<string, unknown>;
          if (Array.isArray(rawMsg.attachments)) {
            for (const att of rawMsg.attachments as Array<Record<string, unknown>>) {
              const content = att.content as string | undefined;
              const mimeType = (att.mimeType as string) || 'application/octet-stream';
              const fileName = (att.fileName as string) || 'attachment';
              if (content && mimeType.startsWith('image/')) {
                const dataUrl = content.startsWith('data:') ? content : `data:${mimeType};base64,${content}`;
                imgAttachments.push({ fileName, mimeType, dataUrl });
              } else if (att.url && typeof att.url === 'string') {
                imgAttachments.push({
                  fileName,
                  mimeType,
                  dataUrl: mimeType.startsWith('image/') ? (att.url as string) : undefined,
                  downloadUrl: att.url as string,
                });
              }
            }
          }

          if (m.role === 'user') textContent = stripInboundMeta(textContent);

          // Extract MEDIA: lines from both user and assistant messages (#64)
          let mediaAttachments: DisplayAttachment[] = [];
          if (textContent.includes('MEDIA:')) {
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

      // Dedup gateway messages in case the API returns duplicates (#121)
      const dedupedHistMsgs = deduplicateMessages(histMsgs);
      if (dedupedHistMsgs.length !== histMsgs.length) {
        console.warn(`[AWF] Removed ${histMsgs.length - dedupedHistMsgs.length} duplicate gateway messages`);
      }

      // Final stale check before writing state
      if (loadVersionRef.current !== thisLoadVersion) return;

      // --- Merge local messages (pre-compaction) with gateway history ---
      let mergedMsgs = dedupedHistMsgs;
      try {
        const localMsgs = await getLocalMessages(sessionKey);
        if (localMsgs.length > 0 && dedupedHistMsgs.length > 0) {
          // Build lookup sets for dedup — match by id AND by content+role+close-timestamp
          const gatewayIds = new Set(dedupedHistMsgs.map((m) => m.id));
          const gatewayContentKeys = new Set(
            dedupedHistMsgs.map((m) => `${m.role}:${m.content.replace(/\s+/g, " ").trim().slice(0, 200)}:${attachmentFingerprint(m.attachments)}`),
          );
          const oldestGatewayTs = Math.min(
            ...dedupedHistMsgs.map((m) => new Date(m.timestamp).getTime()),
          );
          const newestGatewayTs = Math.max(
            ...dedupedHistMsgs.map((m) => new Date(m.timestamp).getTime()),
          );

          const toDisplayMsg = (lm: StoredMessage): DisplayMessage => ({
            id: lm.id,
            role: lm.role as DisplayMessage["role"],
            content: lm.content,
            timestamp: lm.timestamp,
            toolCalls: (lm.toolCalls || []) as ToolCall[],
            attachments: lm.attachments as DisplayAttachment[] | undefined,
            oldSessionId: lm.oldSessionId,
            newSessionId: lm.newSessionId,
          });

          // Local messages not in gateway — split into older (prepend) and newer (append)
          // Use normalized content matching (consistent with gatewayContentKeys) (#121)
          const isNotInGateway = (lm: StoredMessage) =>
            !gatewayIds.has(lm.id) &&
            !gatewayContentKeys.has(`${lm.role}:${lm.content.replace(/\s+/g, " ").trim().slice(0, 200)}:${attachmentFingerprint(lm.attachments as DisplayAttachment[] | undefined)}`);

          const prependMsgs = localMsgs
            .filter((lm) => isNotInGateway(lm) && new Date(lm.timestamp).getTime() < oldestGatewayTs)
            .map(toDisplayMsg);

          const appendMsgs = localMsgs
            .filter((lm) => isNotInGateway(lm) && new Date(lm.timestamp).getTime() >= newestGatewayTs)
            .map(toDisplayMsg);

          // Restore attachments stripped by compaction (e.g. images)
          const localWithAtts = localMsgs.filter(
            (lm) => lm.attachments && (lm.attachments as DisplayAttachment[]).length > 0
          );
          const IMAGE_PLACEHOLDERS = new Set(["(image)", "(첨부 파일)", ""]);
          for (const hm of dedupedHistMsgs) {
            if (hm.attachments && hm.attachments.length > 0) continue;
            // 1. Match by content
            let local = localWithAtts.find(
              (lm) => lm.role === hm.role && lm.content.slice(0, 100) === hm.content.slice(0, 100)
            );
            // 2. Fallback: match image placeholders by role + close timestamp
            if (!local && IMAGE_PLACEHOLDERS.has(hm.content.trim())) {
              const hmTs = new Date(hm.timestamp).getTime();
              local = localWithAtts.find(
                (lm) => lm.role === hm.role
                  && IMAGE_PLACEHOLDERS.has(lm.content.trim())
                  && Math.abs(new Date(lm.timestamp).getTime() - hmTs) < 30000
              );
            }
            if (local?.attachments && (local.attachments as DisplayAttachment[]).length > 0) {
              hm.attachments = local.attachments as DisplayAttachment[];
              if (IMAGE_PLACEHOLDERS.has(hm.content.trim())) hm.content = local.content;
            }
          }

          if (prependMsgs.length > 0 || appendMsgs.length > 0) {
            mergedMsgs = [...prependMsgs, ...dedupedHistMsgs, ...appendMsgs];
            console.log(
              `[AWF] Restored ${prependMsgs.length} pre + ${appendMsgs.length} post messages from local store`,
            );
          }
        } else if (localMsgs.length > 0 && dedupedHistMsgs.length === 0) {
          // Gateway returned nothing — show local messages
          mergedMsgs = localMsgs.map((lm) => ({
            id: lm.id,
            role: lm.role as DisplayMessage["role"],
            content: lm.content,
            timestamp: lm.timestamp,
            toolCalls: (lm.toolCalls || []) as ToolCall[],
            attachments: lm.attachments as DisplayAttachment[] | undefined,
            oldSessionId: lm.oldSessionId,
            newSessionId: lm.newSessionId,
          }));
        }
      } catch (e) {
        console.warn("[AWF] Failed to load local messages:", e);
      }

      // Final dedup safety net on merged messages (#121)
      mergedMsgs = deduplicateMessages(mergedMsgs);

      // Persist gateway history to local store for future recovery
      const toStore: StoredMessage[] = dedupedHistMsgs
        .filter((m) => !m.id.startsWith("local-"))
        .map((m) => ({
          sessionKey,
          id: m.id,
          role: m.role as StoredMessage["role"],
          content: m.content,
          timestamp: m.timestamp,
          toolCalls: m.toolCalls,
          attachments: m.attachments,
          oldSessionId: m.oldSessionId,
          newSessionId: m.newSessionId,
        }));
      saveLocalMessages(sessionKey, toStore).catch(() => {});

      // Preserve in-flight streaming message that isn't in history yet
      const streamingMsg = streamBuf.current
        ? (() => {
            const mergedIds = new Set(mergedMsgs.map((m) => m.id));
            if (!mergedIds.has(streamBuf.current!.id)) {
              return {
                id: streamBuf.current!.id,
                role: "assistant" as const,
                content: streamBuf.current!.content,
                timestamp: new Date().toISOString(),
                toolCalls: Array.from(streamBuf.current!.toolCalls.values()),
                streaming: true,
              } satisfies DisplayMessage;
            }
            return null;
          })()
        : null;

      const savedQueue = queueStorageKey ? localStorage.getItem(queueStorageKey) : null;
      if (savedQueue) {
        try {
          const queue = JSON.parse(savedQueue) as { id: string; text: string }[];
          queueRef.current = queue;
          const queuedMsgs: DisplayMessage[] = queue.map((q) => ({
            id: q.id, role: "user" as const, content: q.text,
            timestamp: new Date().toISOString(), toolCalls: [], queued: true,
          }));
          setMessages([...mergedMsgs, ...(streamingMsg ? [streamingMsg] : []), ...queuedMsgs]);
        } catch { setMessages([...mergedMsgs, ...(streamingMsg ? [streamingMsg] : [])]); }
      } else {
        setMessages([...mergedMsgs, ...(streamingMsg ? [streamingMsg] : [])]);
      }
    } catch {
      // silently fail
    } finally {
      if (loadVersionRef.current === thisLoadVersion) {
        setLoading(false);
      }
    }
  }, [client, state, sessionKey, queueStorageKey]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Backfill previous session messages from API server logs
  useEffect(() => {
    if (!sessionKey || state !== "connected") return;
    const agentId = sessionKey.split(":")[1] || sessionKey;
    const apiBase = import.meta.env.VITE_API_URL || "";  // Use same origin (Vite proxies /api to :4001)

    (async () => {
      try {
        const topics = await getTopicHistory(sessionKey);
        console.log("[AWF] Backfill: topics found:", topics.length, "sessionKey:", sessionKey, topics.map(t => ({ id: t.sessionId?.slice(0,8), endedAt: !!t.endedAt })));

        // If no ended topics in IndexedDB, try fetching session list from API
        // and backfill ALL sessions except the current one
        let previousSessions = topics.filter((t) => t.endedAt);
        // Always fetch from API — topic-store may not have endedAt marked
        {
          console.log("[AWF] Fetching session list from API for backfill...");
          try {
            const listRes = await fetch(`${apiBase}/api/session-history/${encodeURIComponent(agentId)}`);
            if (listRes.ok) {
              const listData = await listRes.json();
              const allSessions = (listData.sessions || []) as Array<{ sessionId: string; startedAt: string; messageCount: number }>;
              // Exclude the most recent session (current)
              const sorted = allSessions.sort((a: { startedAt: string }, b: { startedAt: string }) => a.startedAt.localeCompare(b.startedAt));
              if (sorted.length > 1) {
                previousSessions = sorted.slice(0, -1).map((s: { sessionId: string; startedAt: string }) => ({
                  sessionKey,
                  sessionId: s.sessionId,
                  startedAt: new Date(s.startedAt).getTime(),
                  endedAt: Date.now(),
                }));
                console.log("[AWF] Found", previousSessions.length, "previous sessions from API");
              }
            }
          } catch (e) {
            console.warn("[AWF] Session list fetch failed:", e);
          }
        }
        for (const topic of previousSessions) {
          if (isBackfillDone(sessionKey, topic.sessionId)) continue;
          const backfilled = await backfillFromApi(
            sessionKey,
            topic.sessionId,
            apiBase,
            agentId,
          );
          if (backfilled.length > 0) {
            console.log(
              `[AWF] Backfilled ${backfilled.length} messages from session ${topic.sessionId.slice(0, 8)}`,
            );
          }
        }
        // Always reload after backfill attempts to merge any newly backfilled messages
        // The previous condition was unreliable due to operator precedence issues (#112)
        if (previousSessions.length > 0) {
          console.log("[AWF] Reloading history after backfill to merge previous session messages");
          loadHistory();
        }
      } catch (e) {
        console.warn("[AWF] Backfill error:", e);
      }
    })();
  }, [sessionKey, state]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reload history on reconnect (catches messages missed during disconnect)
  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((frame: EventFrame) => {
      if (frame.event === "client.reconnected") {
        console.log("[AWF] Reconnected — reloading history");
        loadHistory();
      }
    });
    return unsub;
  }, [client, loadHistory]);

  // Handle agent events
  useEffect(() => {
    if (!client) return;
    let lastSeq = -1;
    // Capture sessionKey from the effect closure for strict matching (#5536-v2).
    // Using the closure value (not the ref) ensures the handler always checks
    // against the sessionKey that was active when the effect was registered.
    const boundSessionKey = sessionKey;

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

      // Strict session isolation (#5536-v2):
      // 1) If event has a sessionKey, it MUST match our bound session key
      // 2) If event has NO sessionKey, reject it when we have a session
      // 3) Double-check against both the closure value AND the ref to catch
      //    any edge case where one drifts from the other
      if (evSessionKey && evSessionKey !== boundSessionKey) return;
      if (evSessionKey && evSessionKey !== sessionKeyRef.current) return;
      if (!evSessionKey && (boundSessionKey || sessionKeyRef.current)) return;


      // Ignore events after abort until next lifecycle start
      if (abortedRef.current && stream !== "lifecycle") return;

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
        abortedRef.current = false;
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
          if (HIDDEN_REPLY_RE.test(finalContent.trim())) {
            // Remove hidden message (HEARTBEAT_OK, NO_REPLY, etc.) from display
            setMessages((prev) => prev.filter((m) => m.id !== finalId));
          } else {
            setMessages((prev) =>
              prev.map((m) => m.id === finalId
                ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false, attachments: finalAttachments || m.attachments }
                : m)
            );
          }
          // Persist assistant message to local store (skip hidden)
          // Use the event's own sessionKey (evSessionKey) or the bound closure
          // value — NEVER sessionKeyRef.current which may have drifted (#5536-v2)
          const saveKey = evSessionKey || boundSessionKey;
          if (saveKey && !HIDDEN_REPLY_RE.test(finalContent.trim())) saveLocalMessages(saveKey, [{
            sessionKey: saveKey,
            id: finalId,
            role: "assistant",
            content: finalContent,
            timestamp: new Date().toISOString(),
            toolCalls: finalTools,
            attachments: finalAttachments,
          }]).catch(() => {});
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
          if (HIDDEN_REPLY_RE.test(finalContent.trim())) {
            setMessages((prev) => prev.filter((m) => m.id !== finalId));
          } else {
            setMessages((prev) =>
              prev.map((m) => m.id === finalId
                ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false, attachments: finalAttachments || m.attachments }
                : m)
            );
          }
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
      // Persist user message to local store
      saveLocalMessages(sessionKey, [{
        sessionKey,
        id: msgId,
        role: "user",
        content: text,
        timestamp: userMsg.timestamp,
        attachments: userMsg.attachments,
      }]).catch(() => {});
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

  const abort = useCallback(() => {
    // Immediately stop UI — don't await the RPC
    abortedRef.current = true;
    const currentRunId = runIdRef.current;
    clearStreamingTimeout();
    if (streamBuf.current) {
      const abortedId = streamBuf.current.id;
      setMessages((prev) => prev.map((m) => m.id === abortedId ? { ...m, streaming: false } : m));
      streamBuf.current = null;
    }
    runIdRef.current = null;
    setStreaming(false);
    setAgentStatusDebug({ phase: "idle" });
    // Fire-and-forget the gateway abort
    if (client && state === "connected") {
      client.request("chat.abort", { sessionKey, runId: currentRunId ?? undefined })
        .catch((err: unknown) => console.warn("[AWF] chat.abort failed:", String(err)));
    }
  }, [client, state, sessionKey, clearStreamingTimeout]);

  const addUserMessage = useCallback((text: string, attachments?: DisplayAttachment[]) => {
    const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userMsg: DisplayMessage = {
      id: msgId, role: "user", content: text,
      timestamp: new Date().toISOString(), toolCalls: [], queued: streaming, attachments,
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!streaming) setStreaming(true);
    // Persist user message (with attachments/images) to local store
    // Use sessionKey from closure (not ref) to ensure correct session (#5536-v2)
    const saveKey = sessionKey;
    if (saveKey) saveLocalMessages(saveKey, [{
      sessionKey: saveKey,
      id: msgId,
      role: "user",
      content: text,
      timestamp: userMsg.timestamp,
      attachments: attachments,
    }]).then(() => {
      if (attachments?.length) console.log('[AWF] Saved user msg with', attachments.length, 'attachments, id:', msgId);
    }).catch((err) => { console.error('[AWF] Failed to save user message:', err); });
  }, [streaming, sessionKey]);

  const addLocalMessage = useCallback((content: string, role: "user" | "assistant" | "system" = "system") => {
    const msgId = `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages((prev) => [...prev, { id: msgId, role, content, timestamp: new Date().toISOString(), toolCalls: [] }]);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
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
    const relevant = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
      .slice(-10);
    if (relevant.length === 0) return null;

    const MAX_PER_MSG = 1000;
    const lines: string[] = ["[이전 세션 맥락] 이전 세션이 컨텍스트 한도로 갱신되었습니다. 아래는 최근 대화 요약입니다."];

    for (const m of relevant) {
      const label = m.role === "user" ? "사용자" : "어시스턴트";
      const text = m.content.slice(0, MAX_PER_MSG).replace(/\n/g, " ").trim();
      const toolNames = m.toolCalls?.map((tc) => tc.name).filter(Boolean);
      const toolSuffix = toolNames && toolNames.length > 0 ? ` [tools: ${toolNames.join(", ")}]` : "";
      lines.push(`${label}: ${text}${text.length >= MAX_PER_MSG ? "…" : ""}${toolSuffix}`);
    }

    lines.push("에이전트 메모리 파일(memory/)을 참조하여 프로젝트 컨텍스트를 복원하세요.");
    lines.push("위 맥락을 참고하여 대화를 이어주세요. 이 메시지에 대해 별도 답변하지 마세요.");
    const full = lines.join("\n");
    return full.length > 4000 ? full.slice(0, 3997) + "…" : full;
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

  // Keep refs in sync so the mount-time onSessionReset handler sees the latest closures
  useEffect(() => { sendContextBridgeRef.current = sendContextBridge; }, [sendContextBridge]);
  useEffect(() => { buildContextSummaryRef.current = buildContextSummary; }, [buildContextSummary]);

  useEffect(() => {
    const unsub = onSessionReset((event) => {
      if (event.key !== sessionKeyRef.current) return;
      console.log(`[AWF] Session reset for current chat: ${event.key}`);

      // Boundary UI message (기존 동작 유지)
      const boundaryMsg: DisplayMessage = {
        id: `boundary-${event.oldSessionId.slice(0, 8)}-${Date.now()}`,
        role: "session-boundary", content: "", timestamp: new Date().toISOString(),
        toolCalls: [], oldSessionId: event.oldSessionId, newSessionId: event.newSessionId,
      };
      setMessages((prev) => [...prev, boundaryMsg]);
      // Persist boundary to local store
      saveLocalMessages(event.key, [{
        sessionKey: event.key,
        id: boundaryMsg.id,
        role: "session-boundary",
        content: "",
        timestamp: boundaryMsg.timestamp,
        oldSessionId: event.oldSessionId,
        newSessionId: event.newSessionId,
      }]).catch(() => {});

      // Auto context bridge: 500ms 후 자동 전송 (새 sessionId 안착 대기)
      if (contextBridgeSentRef.current === event.newSessionId) return; // 중복 방지
      setTimeout(async () => {
        try {
          // IndexedDB에 요약 저장
          const summary = buildContextSummaryRef.current?.();
          if (summary) {
            markSessionEnded(event.key, event.oldSessionId, { summary }).catch(() => {});
          }
          // 자동 전송
          await sendContextBridgeRef.current?.();
          contextBridgeSentRef.current = event.newSessionId;
          console.log("[AWF] Auto context bridge sent successfully");
        } catch (err) {
          console.error("[AWF] Auto context bridge failed:", err);
          contextBridgeSentRef.current = null; // 실패 시 리셋 → 수동 재시도 가능
        }
      }, 500);
    });
    return unsub;
  }, []);

  return {
    messages, streaming, loading, agentStatus,
    sendMessage, sendCommand, addUserMessage, addLocalMessage, clearMessages,
    cancelQueued, abort, reload: loadHistory, sendContextBridge,
  };
}
