
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
  type SetStateAction,
} from "react";
import { getMimeType } from "@/lib/mime-types";
import { windowStoragePrefix } from "@/lib/utils";
import { validateMediaPath, sanitizeAttachmentPath } from "@/lib/platform/media-path";
import { platform } from "@/lib/platform";
import type {
  EventFrame,
  Session,
  ChatMessage,
  ToolCall,
} from "@intelli-claw/shared";

import {
  type ToolStreamRefs,
  type ToolStreamEntry,
  resetAllStreamRefs,
  commitChatStreamToSegment,
  hasActiveStream,
  buildStreamContent,
  buildStreamToolCalls,
} from "./tool-stream";

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

import { inferResetReason } from "./reset-reason";
import {
  trackSessionId,
  markSessionEnded,
  getCurrentSessionId,
} from "./topic-store";

import {
  saveMessages as saveLocalMessages,
  getLocalMessages,
  getRecentLocalMessages,
  backfillFromApi,
  isBackfillDone,
  runMessageStoreMigration,
  type StoredMessage,
} from "./message-store";

import { getTopicHistory } from "./topic-store";

// --- Chat command utilities (#251) ---

/** Check if user input is a stop/abort command. */
export function isChatStopCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return t === "/stop" || t === "stop" || t === "abort" || t === "/abort";
}

/** Check if user input is a session reset command. Returns message text after command if present. */
export function isChatResetCommand(text: string): { reset: boolean; message?: string } {
  const t = text.trim();
  if (!t) return { reset: false };
  if (/^\/new(\s|$)/i.test(t)) return { reset: true, message: t.slice(4).trim() || undefined };
  if (/^\/reset(\s|$)/i.test(t)) return { reset: true, message: t.slice(6).trim() || undefined };
  return { reset: false };
}

// --- Web Config Persistence ---

export function loadGatewayConfig(): GatewayConfig {
  const envUrl = import.meta.env.VITE_GATEWAY_URL || "";
  const envToken = import.meta.env.VITE_GATEWAY_TOKEN || "";

  try {
    const saved = localStorage.getItem(GATEWAY_CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<GatewayConfig>;
      // Trust localStorage if: (a) URL is non-default (user explicitly configured), or (b) token is set.
      // Stale entries with default URL + empty token should fall through to env vars.
      if (parsed.url && (parsed.token || parsed.url !== DEFAULT_GATEWAY_URL)) {
        // If env var provides a specific (non-default) URL that differs from localStorage,
        // the deployment target changed — env var wins and stale localStorage is cleared.
        if (envUrl && envUrl !== DEFAULT_GATEWAY_URL && envUrl !== parsed.url) {
          localStorage.removeItem(GATEWAY_CONFIG_STORAGE_KEY);
          return { url: envUrl, token: envToken } as GatewayConfig;
        }
        return { url: parsed.url, token: parsed.token ?? "" } as GatewayConfig;
      }
    }
  } catch { /* ignore */ }
  return {
    url: envUrl || DEFAULT_GATEWAY_URL,
    token: envToken,
  };
}

function saveConfig(url: string, token: string): void {
  const data = JSON.stringify({ url, token });
  localStorage.setItem(GATEWAY_CONFIG_STORAGE_KEY, data);
  // Verify persistence
  const stored = localStorage.getItem(GATEWAY_CONFIG_STORAGE_KEY);
  if (stored !== data) {
    console.warn("[GW] Config save verification failed — stored value does not match");
  }
}

// --- Web GatewayProvider (wraps shared with localStorage persistence) ---

// Run one-time migration on module load to purge corrupted IndexedDB data (#5536-v2)
runMessageStoreMigration();

/**
 * Auto-approve pairing requests from this device's node-role connection.
 * When the node client connects, the gateway may emit a device.pair.requested
 * event to the operator client. We automatically approve if it's the same device.
 */
function useNodePairAutoApprove() {
  const { client, state } = useGateway();

  useEffect(() => {
    if (!client || state !== "connected") return;

    const unsub = client.onEvent(async (frame) => {
      if (frame.event !== "device.pair.requested") return;
      const payload = frame.payload as {
        deviceId?: string;
        role?: string;
        requestId?: string;
      } | undefined;
      if (!payload?.requestId) return;

      // Only auto-approve if the request is for a "node" role
      if (payload.role !== "node") return;

      try {
        await client.request("devices.approve", { requestId: payload.requestId });
        console.log("[AWF] Auto-approved node pairing for device:", payload.deviceId);
      } catch (err) {
        console.warn("[AWF] Failed to auto-approve node pairing:", err);
      }
    });

    return unsub;
  }, [client, state]);
}

export function GatewayProvider({ children }: { children: ReactNode }) {
  const config = loadGatewayConfig();
  return (
    <GatewayProviderBase
      url={config.url}
      token={config.token}
      onConfigChange={saveConfig}
    >
      <NodePairAutoApprover />
      {children}
    </GatewayProviderBase>
  );
}

/** Internal component that runs the auto-approve hook inside GatewayProviderBase context */
function NodePairAutoApprover() {
  useNodePairAutoApprove();
  return null;
}

// --- useSessions (web-specific: uses IndexedDB topic-store) ---

export function useSessions() {
  const { client, state } = useGateway();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const lastRefreshAtRef = useRef(0);
  const trackedSessionIdsRef = useRef<Map<string, string>>(new Map());
  /** Preserve user-set labels across session resets (#216) */
  const preservedLabelsRef = useRef<Map<string, string>>(new Map());

  const fetchSessions = useCallback(async () => {
    if (!client || state !== "connected") return;
    setLoading(true);
    try {
      const res = await client.request<{ sessions: Array<Record<string, unknown>> }>("sessions.list", { limit: 200 });

      // #216: Detect session resets and preserve labels BEFORE updating UI state.
      // This ensures the UI never flashes an empty/wrong label on reset.
      const labelsToRestore = new Map<string, string>();

      for (const s of res?.sessions || []) {
        const key = String(s.key || "");
        const newSessionId = s.sessionId ? String(s.sessionId) : undefined;
        if (!key || !newSessionId) continue;

        const serverLabel = s.label ? String(s.label) : undefined;
        const oldSessionId = trackedSessionIdsRef.current.get(key);

        // Track non-empty labels so we can restore them if a reset clears them
        if (serverLabel) {
          preservedLabelsRef.current.set(key, serverLabel);
        }

        if (oldSessionId && oldSessionId !== newSessionId) {
          // Session reset detected — check if label needs preservation
          const previousLabel = preservedLabelsRef.current.get(key);
          if (previousLabel && !serverLabel) {
            labelsToRestore.set(key, previousLabel);
          }
        }
      }

      const mapped = (res?.sessions || []).map((s) => {
        const key = String(s.key || "");
        // #216: If a reset cleared the label, use the preserved one for UI
        const restoredLabel = labelsToRestore.get(key);
        const effectiveLabel = s.label ? String(s.label) : restoredLabel || undefined;
        return {
          key,
          agentId: undefined,
          agentName: undefined,
          title: effectiveLabel,
          lastMessage: undefined,
          updatedAt: typeof s.updatedAt === "number" ? new Date(s.updatedAt).toISOString() : undefined,
          messageCount: undefined,
          ...s,
          // Override the spread's label with our preserved one
          ...(restoredLabel && !s.label ? { label: restoredLabel } : {}),
        };
      }) as Session[];
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
          const serverLabel = s.label ? String(s.label) : undefined;
          const totalTokens = typeof s.totalTokens === "number" ? s.totalTokens : undefined;
          const contextTokens = typeof s.contextTokens === "number" ? s.contextTokens : undefined;
          const percentUsed = typeof s.percentUsed === "number" ? s.percentUsed : undefined;
          const gatewayReason = typeof s.resetReason === "string" ? s.resetReason : undefined;
          const lastActiveAt = typeof s.updatedAt === "number" ? s.updatedAt : undefined;

          const reason = inferResetReason({
            totalTokens,
            contextTokens,
            percentUsed,
            gatewayReason: gatewayReason as any,
            lastActiveAt,
          });

          // #216: Preserve user-set label across session resets.
          const labelToKeep = labelsToRestore.get(key) || serverLabel;
          if (labelsToRestore.has(key)) {
            // Server cleared the label — restore it on the gateway
            client.request("sessions.patch", { key, label: labelsToRestore.get(key)! }).catch(() => {});
          }

          markSessionEnded(key, oldSessionId, { totalTokens }).catch(() => {});
          trackSessionId(key, newSessionId, { label: labelToKeep }).catch(() => {});
          emitSessionReset({ key, oldSessionId, newSessionId, reason });
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

  // #250: Event-based session refresh — replace 15s polling with event-driven updates.
  // Refresh on lifecycle start/end events AND chat final events.
  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((frame) => {
      if (frame.event === "agent") {
        const raw = frame.payload as Record<string, unknown>;
        const stream = raw.stream as string | undefined;
        const data = raw.data as Record<string, unknown> | undefined;
        if (stream === "lifecycle" && (data?.phase === "end" || data?.phase === "start")) {
          refreshThrottled();
        }
      } else if (frame.event === "chat") {
        // Refresh sessions when a chat finalizes
        const chatPayload = frame.payload as Record<string, unknown> | undefined;
        const chatState = chatPayload?.state as string | undefined;
        if (chatState === "final" || chatState === "aborted") {
          refreshThrottled();
        }
      }
    });
    return unsub;
  }, [client, refreshThrottled]);

  const patchSession = useCallback((key: string, patch: Record<string, unknown>) => {
    setSessions((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }, []);

  return { sessions, loading, refresh: fetchSessions, patchSession };
}

// --- Helpers ---

export function stripInboundMeta(text: string): string {
  let cleaned = text.replace(/Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g, "");
  cleaned = cleaned.replace(/Sender \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g, "");
  cleaned = cleaned.replace(/OpenClaw runtime context \(internal\):[\s\S]*$/g, "");
  // Only strip gateway-injected timestamp prefixes like [2024-01-15 10:30:45+09:00]
  // Also handles day-prefixed format like [Sun 2026-03-08 10:45 GMT+9]
  // Do NOT strip arbitrary bracketed text like [important], [TODO], etc. (#55)
  cleaned = cleaned.replace(/^\[(?:\w{3}\s+)?\d{4}-\d{2}-\d{2}[\w\s\-:+]*\]\s*/g, "");
  return cleaned.trim();
}

function stripTemplateVars(text: string): string {
  return text.replace(/\[\[[^\]]+\]\]\s*/g, "").trim();
}

/**
 * Image placeholder variants treated as equivalent for dedup (#115).
 * Optimistic UI may use "(첨부 파일)" while gateway stores "(image)".
 */
const IMAGE_PLACEHOLDERS_DEDUP = new Set(["(image)", "(첨부 파일)", "(이미지)", ""]);

export function normalizeContentForDedup(content: string): string {
  // Keep normalization aligned across history merge + final dedup.
  // #243: Strip MEDIA: markers before whitespace normalization so that
  // streaming (already extracted) and inbound (raw) versions match.
  let normalized = content.replace(/MEDIA:\S+/g, "").replace(/\s+/g, " ").trim();

  // Normalize gateway-injected timestamp prefix on user messages
  // e.g. "[2026-03-03 15:10:00+09:00] 질문" -> "질문"
  normalized = normalized.replace(/^\[\d{4}-\d{2}-\d{2}[\w\s\-:+]*\]\s*/i, "");

  // Normalize bridge/system wrappers that may vary by source
  // e.g. "[System] ..." / "(System) ..." / "System: ..."
  normalized = normalized.replace(/^\s*(?:\[System\]|\(System\)|System:)\s*/i, "");

  // #243: Normalize spacing after punctuation — prevents dedup failure
  // when line breaks vs spaces differ between streaming and inbound
  normalized = normalized.replace(/([.!?。])\s*/g, "$1 ").trim();

  if (IMAGE_PLACEHOLDERS_DEDUP.has(normalized)) return "(image)";

  // #155: Use full content instead of truncating to 200 chars.
  // Short messages use the normalized string directly.
  // Long messages use a fast hash to keep comparison cost low
  // while still distinguishing messages that share a 200-char prefix.
  if (normalized.length <= 200) return normalized;
  return `${normalized.slice(0, 120)}|H:${simpleHash(normalized)}|L:${normalized.length}`;
}

/**
 * Fast non-cryptographic hash for dedup fingerprinting (#155).
 * DJB2 variant — deterministic, collision-resistant enough for UI dedup.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Deduplicate messages by role + normalized content + timestamp proximity.
 * Keeps the first occurrence (gateway messages should come first in the array).
 * Two messages are considered duplicates if they have the same role, similar
 * content (first 200 chars after normalization), and timestamps within 60s.
 * Image placeholder variants are normalized to prevent optimistic UI duplicates (#115).
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
    const contentKey = normalizeContentForDedup(m.content);
    const attKey = attachmentFingerprint(m.attachments);
    const ts = new Date(m.timestamp).getTime();
    // For image placeholders (#115): if the current message OR a seen message
    // has no attachments, it's likely an optimistic vs server echo mismatch.
    // In that case, skip attachment comparison. If BOTH have attachments,
    // still compare them to distinguish genuinely different images.
    const isImagePlaceholder = IMAGE_PLACEHOLDERS_DEDUP.has(m.content.replace(/\s+/g, " ").trim());
    const isDup = seen.some((s) => {
      if (s.role !== m.role || s.contentKey !== contentKey) return false;
      if (Math.abs(s.ts - ts) >= 60_000) return false;
      // For image placeholders: skip att comparison if either side has no attachments
      if (isImagePlaceholder && (!attKey || !s.attKey)) return true;
      return s.attKey === attKey;
    });
    if (isDup) return false;
    seen.push({ role: m.role, contentKey, attKey, ts });
    return true;
  });
}

/**
 * Merge consecutive assistant messages into a single message per turn (#189).
 *
 * Gateway chat.history returns a single agent turn as multiple assistant messages
 * (text segments between tool_use blocks), but streaming produces one merged message.
 * This ensures history matches streaming behavior, preventing duplicate display.
 */
export function mergeConsecutiveAssistant(msgs: DisplayMessage[]): DisplayMessage[] {
  if (msgs.length === 0) return [];
  const result: DisplayMessage[] = [];
  let accumulator: DisplayMessage | null = null;

  for (const m of msgs) {
    if (m.role === "assistant" && accumulator && accumulator.role === "assistant") {
      // #255: Detect overlapping/cumulative content before merging.
      // Gateway may return messages where each includes prior content (cumulative).
      // Naive join("\n\n") would produce "A\n\nA B\n\nA B C" duplication.
      const accTrimmed = accumulator.content.trimEnd();
      const mTrimmed = m.content.trimEnd();
      let mergedContent: string;
      if (mTrimmed.startsWith(accTrimmed)) {
        // New message is a superset of accumulator — use it directly
        mergedContent = m.content;
      } else if (accTrimmed.startsWith(mTrimmed)) {
        // Accumulator already contains everything — keep it
        mergedContent = accumulator.content;
      } else {
        // Truly separate content — join with separator
        const parts = [accumulator.content, m.content].filter((s) => s.length > 0);
        mergedContent = parts.join("\n\n");
      }
      accumulator = {
        ...accumulator,
        content: mergedContent,
        toolCalls: [...accumulator.toolCalls, ...m.toolCalls],
        attachments:
          accumulator.attachments || m.attachments
            ? [...(accumulator.attachments || []), ...(m.attachments || [])]
            : undefined,
      };
    } else {
      if (accumulator) result.push(accumulator);
      accumulator = { ...m };
    }
  }
  if (accumulator) result.push(accumulator);
  return result;
}

/**
 * Check if an inbound user message duplicates an existing optimistic message.
 * Used to prevent echoes when the gateway broadcasts a user's own message back (#120).
 */
function isDuplicateOfOptimistic(
  existing: DisplayMessage[],
  role: string,
  content: string,
  timestamp: string,
): boolean {
  const normalizedContent = normalizeContentForDedup(content);
  const inboundTs = new Date(timestamp).getTime();
  return existing.some((m) => {
    if (m.role !== role) return false;
    const existingContent = normalizeContentForDedup(m.content);
    const existingTs = new Date(m.timestamp).getTime();
    return existingContent === normalizedContent && Math.abs(existingTs - inboundTs) < 30_000;
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
    const raw = sanitizeAttachmentPath(match[1].trim());
    const pathCheck = validateMediaPath(raw);
    if (!pathCheck.valid) {
      console.warn(`[AWF] Skipping invalid media path: ${raw} (${pathCheck.reason})`);
    }
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

export interface ReplyTo {
  id: string;
  content: string;
  role: string;
}

/** Type of system-injected message detected from user-role content */
export type SystemInjectedType = "compaction" | "memory-flush" | "generic";

/**
 * Detect whether a message with the given role/content is a system-injected
 * message masquerading as a user message.
 * Returns null for normal messages, or the detected type.
 */
export function detectSystemInjectedType(role: string, content: string): SystemInjectedType | null {
  if (role !== "user" || !content) return null;

  // Compaction summary patterns
  if (/^The conversation history.*compacted/.test(content)) return "compaction";
  if (/^<summary>/.test(content)) return "compaction";

  // Pre-compaction memory flush
  if (/^Pre-compaction memory flush/.test(content)) return "memory-flush";

  // Existing generic system-injected patterns
  if (/^\[System Message\]|^\[sessionId:|^System:\s*\[/.test(content)) return "generic";

  return null;
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
  /** #156: Why the session was reset */
  resetReason?: string;
  replyTo?: ReplyTo;
  /** #187: Type of system-injected message (for distinct rendering) */
  systemType?: SystemInjectedType;
  /** #242: True when this message represents an error/timeout notification */
  isError?: boolean;
}

/**
 * During reconnect/history refresh, keep in-flight streaming messages visible
 * unless a semantically equivalent history message already exists.
 */
export function mergeLiveStreamingIntoHistory(
  historyMessages: DisplayMessage[],
  liveMessages: DisplayMessage[],
): DisplayMessage[] {
  if (liveMessages.length === 0) return historyMessages;
  const merged = [...historyMessages];
  const hasById = new Set(historyMessages.map((m) => m.id));

  for (const live of liveMessages) {
    if (!live.streaming || live.role === "system" || HIDDEN_REPLY_RE.test(live.content.trim())) continue;
    if (hasById.has(live.id)) continue;

    const liveKey = normalizeContentForDedup(live.content);
    const liveAtt = attachmentFingerprint(live.attachments);
    const duplicatedByHistory = historyMessages.some((h) => {
      if (h.role !== live.role) return false;
      const sameContent = normalizeContentForDedup(h.content) === liveKey;
      if (!sameContent) return false;
      const hAtt = attachmentFingerprint(h.attachments);
      // If either side has no attachments, treat as same message variant.
      if (!liveAtt || !hAtt) return true;
      return liveAtt === hAtt;
    });

    if (!duplicatedByHistory) {
      merged.push(live);
      hasById.add(live.id);
    }
  }

  return merged;
}

/**
 * If reconnect happens while streaming is still active, defer history reload
 * to avoid clobbering "작성중" state.
 */
export function shouldDeferHistoryReload(hasStreamingState: boolean): boolean {
  return hasStreamingState;
}

/**
 * Suppress short control-token prefixes during streaming to avoid transient
 * flashes like "N" or "NO" before hidden-message filtering fully resolves.
 */
export function shouldSuppressStreamingPreview(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (HIDDEN_REPLY_RE.test(t)) return true;
  return /^(N|NO|NO_|NO_R|NO_RE|NO_REP|NO_REPL|NO_REPLY|H|HE|HEA|HEAR|HEART|HEARTB|HEARTBE|HEARTBEA|HEARTBEAT|HEARTBEAT_|HEARTBEAT_O|HEARTBEAT_OK|R|RE|REP|REPL|REPLY|REPLY_|REPLY_S|REPLY_SK|REPLY_SKI|REPLY_SKIP)$/i.test(t);
}

const PENDING_STREAM_SESSION_KEY_PREFIX = "awf:pending-stream:";
const PENDING_STREAM_TTL_MS = 45_000;

type PendingToolCall = Pick<ToolCall, "callId" | "name" | "args" | "status" | "result">;

export interface PendingStreamSnapshot {
  v: 1 | 2 | 3;
  /** #169: Which session this snapshot belongs to (v2+) */
  sessionKey?: string;
  runId: string | null;
  streamId: string;
  content: string;
  toolCalls: PendingToolCall[];
  /** v3: committed text segments (frozen before tool calls) */
  segments?: Array<{ text: string; ts: number }>;
  updatedAt: number;
}

export function createPendingStreamSnapshot(params: {
  sessionKey?: string;
  runId: string | null;
  streamId: string;
  content: string;
  toolCalls: ToolCall[];
  segments?: Array<{ text: string; ts: number }>;
  now?: number;
}): PendingStreamSnapshot {
  return {
    v: 3,
    sessionKey: params.sessionKey,
    runId: params.runId,
    streamId: params.streamId,
    content: params.content,
    toolCalls: params.toolCalls.map((tc) => ({
      callId: tc.callId,
      name: tc.name,
      args: tc.args,
      status: tc.status,
      result: tc.result,
    })),
    segments: params.segments,
    updatedAt: params.now ?? Date.now(),
  };
}

export function isPendingStreamSnapshotFresh(
  snapshot: PendingStreamSnapshot,
  now = Date.now(),
  ttlMs = PENDING_STREAM_TTL_MS,
): boolean {
  return (snapshot.v === 1 || snapshot.v === 2 || snapshot.v === 3) && now - snapshot.updatedAt <= ttlMs;
}

export function finalEventKey(runId: string | null | undefined): string | null {
  if (!runId) return null;
  return `run:${runId}`;
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
export const HIDDEN_REPLY_RE = /^(NO_REPLY|REPLY_SKIP|HEARTBEAT_OK|NO_?)\s*$|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now|(?:\[System\]|\(System\)|System:)\s*이전 세션이 컨텍스트 한도로 갱신|^이전 세션이 컨텍스트 한도로 갱신되었습니다\.\s*아래는 최근 대화 요약입니다\.|\[이전 세션 맥락\]/;

/**
 * Internal orchestration messages that should be hidden from the main chat.
 * These are subagent task prompts, coordination messages, etc. injected by
 * the gateway into the session history as user messages.
 */
export const INTERNAL_PROMPT_RE = /\[Subagent Context\]|\[Subagent Task\]|\[Request interrupted by user\]|You are running as a subagent/;

/** Strip trailing control tokens from message content for display */
export const TRAILING_CONTROL_TOKEN_RE = /\n{1,2}(REPLY_SKIP|NO_REPLY|HEARTBEAT_OK)\s*$/;
export function stripTrailingControlTokens(text: string): string {
  return text.replace(TRAILING_CONTROL_TOKEN_RE, "").trim();
}

// --- Reply/Quote Helpers ---

/** Truncate content for reply preview display */
export function truncateForPreview(content: string, maxLen = 100): string {
  const oneLine = content.replace(/\n/g, " ").trim();
  if (oneLine.length <= maxLen) return oneLine;
  return oneLine.slice(0, maxLen - 1) + "…";
}

/** Check if a message can be used as a reply target */
export function canBeReplyTarget(msg: DisplayMessage): boolean {
  if (msg.role === "system" || msg.role === "session-boundary") return false;
  if (HIDDEN_REPLY_RE.test(msg.content.trim())) return false;
  return true;
}

/** Build a ReplyTo object from a message */
export function buildReplyTo(msg: DisplayMessage): ReplyTo | null {
  if (!canBeReplyTarget(msg)) return null;
  return {
    id: msg.id,
    content: truncateForPreview(msg.content),
    role: msg.role,
  };
}

export function useChat(sessionKey?: string) {
  const { client, state } = useGateway();
  const [messages, setMessagesRaw] = useState<DisplayMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const streamingRef = useRef(false);
  const sendingRef = useRef(false);
  const [replyingTo, setReplyingToState] = useState<ReplyTo | null>(null);
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ phase: "idle" });
  const setAgentStatusDebug = useCallback((s: AgentStatus) => {
    console.log("[AWF] agentStatus →", s.phase, "toolName" in s ? (s as any).toolName : "");
    setAgentStatus(s);
  }, []);
  // --- OpenClaw 3-buffer streaming refs (replaces single streamBuf) ---
  const chatStreamRef = useRef<string | null>(null);
  const chatStreamIdRef = useRef<string | null>(null);
  const chatStreamStartedAtRef = useRef<number | null>(null);
  const chatStreamSegmentsRef = useRef<Array<{ text: string; ts: number }>>([]);
  const toolStreamByIdRef = useRef<Map<string, ToolStreamEntry>>(new Map());
  const toolStreamOrderRef = useRef<string[]>([]);
  const streamIdCounter = useRef(0);

  // Convenience handle to pass all 6 refs to tool-stream.ts utilities
  const streamRefsHandle = useRef<ToolStreamRefs>({
    chatStream: chatStreamRef,
    chatStreamId: chatStreamIdRef,
    chatStreamStartedAt: chatStreamStartedAtRef,
    chatStreamSegments: chatStreamSegmentsRef,
    toolStreamById: toolStreamByIdRef,
    toolStreamOrder: toolStreamOrderRef,
  });
  const streamRefs = streamRefsHandle.current;
  const runIdRef = useRef<string | null>(null);
  const abortedRef = useRef(false);
  const streamingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionKeyRef = useRef(sessionKey);
  // #169: Centralized session guard — incremented on every session switch.
  // All async operations capture this version at start and check before writing state.
  const guardVersionRef = useRef(0);
  /** Set by the restore-effect when a pending-stream snapshot is successfully restored
   *  from sessionStorage. The sessionKey change effect checks this to avoid wiping
   *  the just-restored streaming state (which happens during the default→real
   *  sessionKey settlement on page load). */
  const restoredFromSnapshotRef = useRef(false);
  const loadVersionRef = useRef(0);
  const lastLoadAtRef = useRef(0); // Throttle for cross-device sync (#120)
  const pendingHistoryReloadRef = useRef(false);
  const reconnectSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalizedEventKeysRef = useRef<Set<string>>(new Set());
  // #155: Track recently finalized stream IDs so loadHistory can skip duplicates
  const finalizedStreamIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<DisplayMessage[]>([]);
  // Throttle streaming UI updates to once per animation frame
  const streamRafRef = useRef<number | null>(null);
  const pendingStreamUpdate = useRef<(() => void) | null>(null);
  const sendContextBridgeRef = useRef<(() => Promise<void>) | null>(null);
  const buildContextSummaryRef = useRef<(() => string | null) | null>(null);

  // Stable per-tab device identifier for cross-device message dedup (#120)
  const deviceIdRef = useRef<string>(
    (() => {
      const key = "__iclaw_device_id__";
      let id = sessionStorage.getItem(key);
      if (!id) { id = `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`; sessionStorage.setItem(key, id); }
      return id;
    })()
  );

  // #169: Centralized session-guarded setMessages wrapper.
  // All message state updates should go through this instead of setMessagesRaw.
  // For sync operations within an event handler that already validated sessionKey,
  // calling without opts is fine. For async operations (loadHistory, backfill,
  // reconnect), use createScopedUpdater() at the start of the async chain.
  const setMessages = useCallback((
    updater: SetStateAction<DisplayMessage[]>,
    opts?: { sessionKey?: string },
  ) => {
    if (opts?.sessionKey && opts.sessionKey !== sessionKeyRef.current) {
      console.warn(`[AWF] #169 guarded setMessages rejected: expected="${sessionKeyRef.current}" got="${opts.sessionKey}"`);
      return;
    }
    setMessagesRaw(updater);
  }, []);

  // #169: Create a scoped updater that captures the current guard version.
  // Any async operation should capture this at start and check before updating.
  const createScopedUpdater = useCallback(() => {
    const capturedVersion = guardVersionRef.current;
    const capturedKey = sessionKeyRef.current;
    return {
      isValid: () => guardVersionRef.current === capturedVersion,
      sessionKey: capturedKey,
      setMessages: (updater: SetStateAction<DisplayMessage[]>) => {
        if (guardVersionRef.current !== capturedVersion) {
          console.warn(`[AWF] #169 scoped updater expired: version ${capturedVersion} vs ${guardVersionRef.current}`);
          return;
        }
        setMessagesRaw(updater);
      },
    };
  }, []);

  // Tiered streaming timeouts (#154):
  // - Thinking phase (no content yet): 45s — stale connections are detected faster
  // - Writing phase (content streaming): 90s — allows long responses to complete
  const THINKING_TIMEOUT_MS = 45_000;
  const WRITING_TIMEOUT_MS = 90_000;
  // #142: Scope queue key per browser tab to prevent cross-tab queue collision
  const queueStorageKey = sessionKey ? `awf:${windowStoragePrefix()}queue:${sessionKey}` : null;
  const pendingStreamStorageKey = sessionKey ? `${PENDING_STREAM_SESSION_KEY_PREFIX}${sessionKey}` : null;

  const clearPersistedPendingStream = useCallback(() => {
    if (!pendingStreamStorageKey) return;
    sessionStorage.removeItem(pendingStreamStorageKey);
  }, [pendingStreamStorageKey]);

  const persistPendingStreamImmediate = useCallback(() => {
    if (!pendingStreamStorageKey || !hasActiveStream(streamRefs)) return;
    // v3: persist current chatStream (not merged) + segments separately
    const currentText = chatStreamRef.current || "";
    const toolCalls = buildStreamToolCalls(streamRefs);
    const segments = chatStreamSegmentsRef.current.length > 0
      ? chatStreamSegmentsRef.current
      : undefined;
    const snapshot = createPendingStreamSnapshot({
      sessionKey: sessionKeyRef.current,
      runId: runIdRef.current,
      streamId: chatStreamIdRef.current || `stream-persist-${Date.now()}`,
      content: currentText,
      toolCalls,
      segments,
    });
    sessionStorage.setItem(pendingStreamStorageKey, JSON.stringify(snapshot));
  }, [pendingStreamStorageKey]);

  // Throttled version: persist at most once per 500ms during streaming
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistPendingStream = useCallback(() => {
    if (persistTimerRef.current) return;
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      persistPendingStreamImmediate();
    }, 500);
  }, [persistPendingStreamImmediate]);

  const clearStreamingTimeout = useCallback(() => {
    if (streamingTimeoutRef.current) {
      clearTimeout(streamingTimeoutRef.current);
      streamingTimeoutRef.current = null;
    }
  }, []);

  const startStreamingTimeout = useCallback((phase?: "thinking" | "writing") => {
    clearStreamingTimeout();
    // Use shorter timeout for thinking phase, longer for writing (#154)
    const timeoutMs = phase === "writing" ? WRITING_TIMEOUT_MS : THINKING_TIMEOUT_MS;
    // #169: Capture guard version before setTimeout gap
    const timeoutScoped = createScopedUpdater();
    streamingTimeoutRef.current = setTimeout(() => {
      console.warn(`[AWF] streaming timeout (${phase || "thinking"}, ${timeoutMs}ms) — force reset`);
      // #169: If session switched during the timeout, bail out
      if (!timeoutScoped.isValid()) return;
      if (hasActiveStream(streamRefs)) {
        const id = chatStreamIdRef.current;
        if (id) {
          timeoutScoped.setMessages((prev) =>
            prev.map((m) => m.id === id ? { ...m, streaming: false } : m)
          );
        }
        resetAllStreamRefs(streamRefs);
      }
      runIdRef.current = null;
      clearPersistedPendingStream();
      setStreaming(false);
      setAgentStatusDebug({ phase: "idle" });
      // #242: Show timeout feedback message to user
      timeoutScoped.setMessages((prev) => [...prev, {
        id: `timeout-${Date.now()}`,
        role: "assistant" as const,
        content: "⏳ 에이전트로부터 응답이 없습니다. 다시 시도해주세요.",
        timestamp: new Date().toISOString(),
        toolCalls: [],
        isError: true,
      }]);
    }, timeoutMs);
  }, [clearStreamingTimeout, clearPersistedPendingStream, createScopedUpdater]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Force-persist pending stream before page unload so refresh doesn't lose content.
  // The throttled persistPendingStream may not have flushed yet when the user hits F5.
  // Also saves a minimal marker during "thinking" phase (streaming=true but no content yet)
  // so the restored page knows a run was active and can show the thinking indicator.
  useEffect(() => {
    const onBeforeUnload = () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      // Save full content if stream refs have data
      persistPendingStreamImmediate();
      // If streaming is active but no content yet (thinking/tool phase), save a minimal marker
      if (!hasActiveStream(streamRefs) && streamingRef.current && pendingStreamStorageKey) {
        const snapshot: PendingStreamSnapshot = {
          v: 3,
          sessionKey: sessionKeyRef.current,
          runId: runIdRef.current,
          streamId: `stream-pending-${Date.now()}`,
          content: "",
          toolCalls: [],
          updatedAt: Date.now(),
        };
        sessionStorage.setItem(pendingStreamStorageKey, JSON.stringify(snapshot));
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [persistPendingStreamImmediate, pendingStreamStorageKey]);

  useEffect(() => {
    if (!pendingStreamStorageKey || hasActiveStream(streamRefs)) return;
    try {
      const raw = sessionStorage.getItem(pendingStreamStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PendingStreamSnapshot;
      if (!isPendingStreamSnapshotFresh(parsed)) {
        sessionStorage.removeItem(pendingStreamStorageKey);
        return;
      }
      // #169: Validate sessionKey match for v2+ snapshots
      if (parsed.v >= 2 && parsed.sessionKey && parsed.sessionKey !== sessionKey) {
        console.warn(`[AWF] #169 Snapshot sessionKey mismatch: snapshot="${parsed.sessionKey}" current="${sessionKey}"`);
        sessionStorage.removeItem(pendingStreamStorageKey);
        return;
      }

      // Restore tool calls into the new refs
      const restoredToolCalls: ToolCall[] = [];
      for (const tc of parsed.toolCalls || []) {
        const entry: ToolStreamEntry = {
          toolCallId: tc.callId,
          name: tc.name,
          args: tc.args,
          output: tc.result,
          startedAt: parsed.updatedAt,
          updatedAt: parsed.updatedAt,
        };
        toolStreamByIdRef.current.set(tc.callId, entry);
        toolStreamOrderRef.current.push(tc.callId);
        restoredToolCalls.push({
          callId: tc.callId,
          name: tc.name,
          args: tc.args,
          status: tc.status,
          result: tc.result,
        });
      }

      runIdRef.current = parsed.runId;
      setStreaming(true);

      // v3: restore committed segments separately
      if (parsed.v >= 3 && Array.isArray(parsed.segments) && parsed.segments.length > 0) {
        chatStreamSegmentsRef.current = parsed.segments;
      }

      // Empty content = "thinking" marker (saved when streaming was active but
      // no text chunks had arrived yet). Just restore streaming + agentStatus
      // so the UI shows the thinking indicator. Gateway events will resume after reconnect.
      if (!parsed.content && restoredToolCalls.length === 0 && !chatStreamSegmentsRef.current.length) {
        setAgentStatusDebug({ phase: state === "connected" ? "thinking" : "waiting" });
      } else {
        chatStreamIdRef.current = parsed.streamId;
        chatStreamRef.current = parsed.content;
        chatStreamStartedAtRef.current = parsed.updatedAt;
        setAgentStatusDebug({ phase: state === "connected" ? "writing" : "waiting" });
        setMessages((prev) => {
          const existing = prev.findIndex((m) => m.id === parsed.streamId);
          const msg: DisplayMessage = {
            id: parsed.streamId,
            role: "assistant",
            content: parsed.content,
            timestamp: new Date(parsed.updatedAt).toISOString(),
            toolCalls: restoredToolCalls,
            streaming: true,
          };
          if (existing >= 0) {
            const next = [...prev];
            next[existing] = { ...next[existing], ...msg };
            return next;
          }
        return [...prev, msg];
        });
      }
      restoredFromSnapshotRef.current = true;
      startStreamingTimeout(parsed.content ? "writing" : "thinking");
      console.log("[AWF] Restored pending stream from sessionStorage", {
        runId: parsed.runId?.slice(0, 8),
        streamId: parsed.streamId,
      });
    } catch {
      // ignore corrupted sessionStorage data
      if (pendingStreamStorageKey) sessionStorage.removeItem(pendingStreamStorageKey);
    }
  }, [pendingStreamStorageKey, state, setAgentStatusDebug, startStreamingTimeout]);

  useEffect(() => {
    if (sessionKeyRef.current !== sessionKey) {
      const oldKey = sessionKeyRef.current;
      sessionKeyRef.current = sessionKey;
      // Invalidate any in-flight loadHistory before clearing messages (#63)
      ++loadVersionRef.current;
      // #169: Increment guard version to invalidate all in-flight async operations
      // (loadHistory, backfill, reconnect handlers) that captured the old version.
      ++guardVersionRef.current;

      if (restoredFromSnapshotRef.current) {
        // The restore-effect (which runs before this effect in the same commit)
        // just recovered a pending-stream snapshot from sessionStorage.
        // This happens during the default→real sessionKey settlement on page load.
        // Do NOT wipe state — the restored streaming content must be preserved.
        restoredFromSnapshotRef.current = false;
      } else {
        // Genuine session switch (user navigated to a different agent/chat):
        // wipe all state so the new session starts fresh. (#169: atomic reset)
        setMessagesRaw([]);
        setStreaming(false);
        clearStreamingTimeout();
        setAgentStatusDebug({ phase: "idle" });
        resetAllStreamRefs(streamRefs);
        runIdRef.current = null;
        finalizedEventKeysRef.current.clear();
        finalizedStreamIdsRef.current.clear();
        abortedRef.current = false;

      }
      // Clear the OLD session's pending stream, not the new one's.
      // This prevents wiping a snapshot that beforeunload saved for the new session.
      if (oldKey) {
        const oldStorageKey = `${PENDING_STREAM_SESSION_KEY_PREFIX}${oldKey}`;
        sessionStorage.removeItem(oldStorageKey);
      }
    }
  }, [sessionKey, clearStreamingTimeout]);

  useEffect(() => {
    if (state === "disconnected" && streaming) {
      console.warn("[AWF] connection lost during streaming — preserving in-flight message for reconnect");
      clearStreamingTimeout();
      persistPendingStream();
      // Keep streamBuf + message.streaming intact so refresh/reconnect doesn't
      // make the "작성중" bubble disappear.
      setAgentStatusDebug({ phase: "waiting" });
    }
  }, [state, streaming, clearStreamingTimeout, setAgentStatusDebug, persistPendingStream]);

  const loadHistory = useCallback(async () => {
    // #248: Check both hook state and client.state to handle timing race
    // where the hook state hasn't settled to "connected" yet but client is ready
    // #248: Check both hook state and client's internal state for timing race.
    // TODO: Add public getter for client.state instead of `as any` cast.
    if (!client || (state !== "connected" && (client as any).state !== "connected")) return;
    // #169: Capture guard version at start of async chain. If session switches
    // during any await, the scoped updater will reject the write.
    const scopedUpdate = createScopedUpdater();
    // Bump version to detect stale responses from concurrent loadHistory calls.
    // When sessionKey changes mid-flight, the old callback must not overwrite
    // messages loaded by the new callback (#63).
    const thisLoadVersion = ++loadVersionRef.current;

    // --- #201 Phase 1: Cache-first loading ---
    // Show cached messages from IndexedDB immediately to eliminate blank screen.
    // Server response will be merged silently afterward.
    const isHiddenMessageEarly = (role: string, text: string) => {
      if (role === "system") return true;
      const t = text.trim();
      if (HIDDEN_REPLY_RE.test(t)) return true;
      if (INTERNAL_PROMPT_RE.test(t)) return true;
      return false;
    };
    let cacheShown = false;
    if (messagesRef.current.length === 0 && sessionKey) {
      try {
        const cachedMsgs = await getRecentLocalMessages(sessionKey, 100);
        // Stale guard — bail if session switched during await
        if (loadVersionRef.current !== thisLoadVersion) return;
        if (cachedMsgs.length > 0) {
          const displayCached: DisplayMessage[] = cachedMsgs
            .filter((lm) => !isHiddenMessageEarly(lm.role, lm.content))
            .map((lm) => ({
              id: lm.id,
              role: lm.role as DisplayMessage["role"],
              content: lm.role === "user" ? stripInboundMeta(lm.content) : lm.content,
              timestamp: lm.timestamp,
              toolCalls: (lm.toolCalls || []) as ToolCall[],
              attachments: lm.attachments as DisplayAttachment[] | undefined,
              oldSessionId: lm.oldSessionId,
              newSessionId: lm.newSessionId,
              replyTo: lm.replyTo as ReplyTo | undefined,
              resetReason: lm.resetReason,
            }));
          if (displayCached.length > 0) {
            scopedUpdate.setMessages(displayCached);
            cacheShown = true;
          }
        }
      } catch {
        // IndexedDB failure — fall through to server load
      }
    }

    // Only show loading spinner when no messages are visible at all.
    // If cache was shown, skip loading indicator (silent server merge).
    if (!cacheShown && messagesRef.current.length === 0) {
      setLoading(true);
    }
    try {
      const res = await client.request<{ messages: ChatMessage[] }>(
        "chat.history",
        { sessionKey, limit: 100 }
      );

      // Stale response guard — another loadHistory started while we awaited
      if (loadVersionRef.current !== thisLoadVersion) return;

      const isHiddenMessage = (role: string, text: string) => {
        if (role === "system") return true;
        const t = text.trim();
        if (HIDDEN_REPLY_RE.test(t)) return true;
        // Hide internal orchestration prompts (subagent tasks, coordination)
        if (INTERNAL_PROMPT_RE.test(t)) return true;
        return false;
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
              // #249: Skip thinking content blocks — strip from display
              if (p.type === 'thinking') continue;
              if (p.type === 'text' && typeof p.text === 'string') {
                if (hasToolUse && m.role === 'assistant') {
                  const text = (p.text as string).trim();
                  // Keep text blocks with markdown images/media even if short
                  const hasMedia = /!\[.*?\]\(.*?\)|^MEDIA:\s/m.test(text);
                  if (!hasMedia && text.length < 100 && !text.includes('\n')) continue;
                }
                textContent += p.text;
              } else if (p.type === 'image_url' || p.type === 'image') {
                let url: string | undefined;
                if (typeof p.image_url === 'object' && p.image_url) {
                  url = (p.image_url as Record<string, string>).url;
                } else if (typeof p.url === 'string' && p.url) {
                  url = p.url;
                } else if (typeof p.source === 'object' && p.source) {
                  // Guard against empty source from Gateway compaction (#110)
                  const src = p.source as Record<string, string>;
                  if (src.media_type && src.data) {
                    url = `data:${src.media_type};base64,${src.data}`;
                  }
                }
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

          textContent = stripTrailingControlTokens(textContent);
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

          // Check ORIGINAL content for system-injected markers (before stripping) (#55, #187)
          const rawContentStr = typeof m.content === 'string' ? m.content : textContent;
          const systemType = detectSystemInjectedType(m.role, rawContentStr);

          return {
            id: `hist-${simpleHash(m.role + (m.timestamp || '') + (textContent || '').slice(0, 100))}`,
            role: (m.role === 'system' || systemType)
              ? 'system' as const
              : m.role as "user" | "assistant",
            content: textContent,
            timestamp: m.timestamp || new Date().toISOString(),
            toolCalls: m.toolCalls || [],
            attachments: allAttachments.length > 0 ? allAttachments : undefined,
            systemType: systemType ?? undefined,
          };
        })
        .filter((m) => {
          // Show compaction/memory-flush messages with distinct styling (#187)
          if (m.systemType === 'compaction' || m.systemType === 'memory-flush') return true;
          return !isHiddenMessage(m.role, m.content);
        });

      // Merge consecutive assistant messages from split tool-call turns (#189)
      const mergedHistMsgs = mergeConsecutiveAssistant(histMsgs);

      // Dedup gateway messages in case the API returns duplicates (#121)
      const dedupedHistMsgs = deduplicateMessages(mergedHistMsgs);
      if (dedupedHistMsgs.length !== mergedHistMsgs.length) {
        console.warn(`[AWF] Removed ${mergedHistMsgs.length - dedupedHistMsgs.length} duplicate gateway messages`);
      }

      // Final stale check before writing state
      if (loadVersionRef.current !== thisLoadVersion) return;

      // --- Merge local messages (pre-compaction) with gateway history ---
      // #201: Cap local messages to avoid O(n²) merge with 16k+ stored messages.
      // Pre-compaction messages beyond this limit are still in IndexedDB but not
      // loaded on session switch. Users can scroll up to trigger pagination.
      const LOCAL_MERGE_LIMIT = 500;
      let mergedMsgs = dedupedHistMsgs;
      try {
        const localMsgs = await getRecentLocalMessages(sessionKey, LOCAL_MERGE_LIMIT);
        if (localMsgs.length > 0 && dedupedHistMsgs.length > 0) {
          // Build lookup sets for dedup — match by id AND by content+role+close-timestamp
          const gatewayIds = new Set(dedupedHistMsgs.map((m) => m.id));
          const gatewayContentKeys = new Set(
            dedupedHistMsgs.map((m) => `${m.role}:${normalizeContentForDedup(m.content)}:${attachmentFingerprint(m.attachments)}`),
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
            content: lm.role === "user" ? stripInboundMeta(lm.content) : lm.content,
            timestamp: lm.timestamp,
            toolCalls: (lm.toolCalls || []) as ToolCall[],
            attachments: lm.attachments as DisplayAttachment[] | undefined,
            oldSessionId: lm.oldSessionId,
            newSessionId: lm.newSessionId,
            replyTo: lm.replyTo as ReplyTo | undefined,
            resetReason: lm.resetReason,
          });

          // Local messages not in gateway — split into older (prepend) and newer (append)
          // Use normalized content matching (consistent with gatewayContentKeys) (#121)
          // #155: Enhanced dedup — also match by role + close timestamp when
          // content differs slightly (e.g. tool_use text blocks stripped by gateway).
          const gatewayByRoleTs = dedupedHistMsgs.map((m) => ({
            role: m.role,
            ts: new Date(m.timestamp).getTime(),
            contentKey: normalizeContentForDedup(m.content),
          }));
          const isNotInGateway = (lm: StoredMessage) => {
            if (gatewayIds.has(lm.id)) return false;
            const localContentKey = normalizeContentForDedup(lm.content);
            const localAttKey = attachmentFingerprint(lm.attachments as DisplayAttachment[] | undefined);
            // Exact content+attachment match
            if (gatewayContentKeys.has(`${lm.role}:${localContentKey}:${localAttKey}`)) return false;
            // #155: Fuzzy match — same role, close timestamp (< 30s), and
            // content shares a meaningful prefix (first 80 chars after normalization).
            // Catches cases where gateway strips short tool_use text blocks.
            const localTs = new Date(lm.timestamp).getTime();
            const localPrefix = localContentKey.slice(0, 80);
            if (localPrefix.length >= 20) {
              const fuzzyMatch = gatewayByRoleTs.some((g) =>
                g.role === lm.role &&
                Math.abs(g.ts - localTs) < 30_000 &&
                g.contentKey.slice(0, 80) === localPrefix
              );
              if (fuzzyMatch) return false;
            }
            return true;
          };

          // Separate session-boundary messages — these are local-only and must
          // be re-inserted at the correct position regardless of timestamp range.
          const boundaryMsgs = localMsgs
            .filter((lm) => lm.role === "session-boundary")
            .map(toDisplayMsg);

          const prependMsgs = localMsgs
            .filter((lm) => lm.role !== "session-boundary" && isNotInGateway(lm) && !isHiddenMessage(lm.role, lm.content) && new Date(lm.timestamp).getTime() < oldestGatewayTs)
            .map(toDisplayMsg);

          const appendMsgs = localMsgs
            .filter((lm) => lm.role !== "session-boundary" && isNotInGateway(lm) && !isHiddenMessage(lm.role, lm.content) && new Date(lm.timestamp).getTime() >= newestGatewayTs)
            .map(toDisplayMsg);

          // Restore replyTo from local store (gateway doesn't persist it)
          for (const hm of dedupedHistMsgs) {
            if (hm.replyTo) continue;
            const local = localMsgs.find(
              (lm) => lm.role === hm.role && lm.replyTo && normalizeContentForDedup(lm.content) === normalizeContentForDedup(hm.content)
            );
            if (local?.replyTo) {
              hm.replyTo = local.replyTo as ReplyTo;
            }
          }

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

          // Re-insert session boundaries at the correct position by timestamp.
          // Boundaries are local-only markers and would otherwise be lost during
          // the timestamp-range merge above.
          for (const bm of boundaryMsgs) {
            const bmTs = new Date(bm.timestamp).getTime();
            // Insert just before the first message newer than the boundary
            let insertIdx = mergedMsgs.length;
            for (let j = 0; j < mergedMsgs.length; j++) {
              if (new Date(mergedMsgs[j].timestamp).getTime() > bmTs) {
                insertIdx = j;
                break;
              }
            }
            mergedMsgs.splice(insertIdx, 0, bm);
          }
        } else if (localMsgs.length > 0 && dedupedHistMsgs.length === 0) {
          // Gateway returned nothing — show local messages (filter hidden)
          mergedMsgs = localMsgs
            .filter((lm) => !isHiddenMessage(lm.role, lm.content))
            .map((lm) => ({
              id: lm.id,
              role: lm.role as DisplayMessage["role"],
              content: lm.content,
              timestamp: lm.timestamp,
              toolCalls: (lm.toolCalls || []) as ToolCall[],
              attachments: lm.attachments as DisplayAttachment[] | undefined,
              oldSessionId: lm.oldSessionId,
              newSessionId: lm.newSessionId,
              replyTo: lm.replyTo as ReplyTo | undefined,
            }));
        }
      } catch (e) {
        console.warn("[AWF] Failed to load local messages:", e);
      }

      // Final dedup + hidden filter safety net on merged messages (#121, #117)
      mergedMsgs = deduplicateMessages(mergedMsgs).filter((m) => !isHiddenMessage(m.role, m.content));

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
          replyTo: m.replyTo,
        }));
      saveLocalMessages(sessionKey, toStore).catch(() => {});

      // Preserve in-flight streaming message(s) that aren't in history yet.
      // Important on reconnect/refresh: keep "작성중" visible and drop stream-vs-history duplicates.
      const liveStreaming = messagesRef.current.filter((m) => m.streaming);
      if (hasActiveStream(streamRefs) && chatStreamIdRef.current && !liveStreaming.some((m) => m.id === chatStreamIdRef.current)) {
        liveStreaming.push({
          id: chatStreamIdRef.current,
          role: "assistant",
          content: buildStreamContent(streamRefs),
          timestamp: new Date().toISOString(),
          toolCalls: buildStreamToolCalls(streamRefs),
          streaming: true,
        });
      }
      mergedMsgs = mergeLiveStreamingIntoHistory(mergedMsgs, liveStreaming);

      // #155: Remove finalized stream messages that now have a gateway equivalent.
      // After finalizeActiveStream, both the finalized msg (stream-...) and the
      // gateway version (hist-N) can coexist. Remove the stream version if
      // a gateway message with matching content already exists.
      if (finalizedStreamIdsRef.current.size > 0 && dedupedHistMsgs.length > 0) {
        const gwContentKeys = new Set(
          dedupedHistMsgs.map((m) => `${m.role}:${normalizeContentForDedup(m.content)}`),
        );
        mergedMsgs = mergedMsgs.filter((m) => {
          if (!finalizedStreamIdsRef.current.has(m.id)) return true;
          // Keep if no gateway equivalent exists (gateway hasn't caught up yet)
          const key = `${m.role}:${normalizeContentForDedup(m.content)}`;
          return !gwContentKeys.has(key);
        });
      }

      // --- #201: Skip rerender if server merge result matches cache ---
      // When cache-first loaded messages and server merge produces identical
      // content, avoid unnecessary rerender (compare count + last message id).
      const shouldSkipUpdate = (finalMsgs: DisplayMessage[]) => {
        if (!cacheShown) return false;
        const current = messagesRef.current;
        if (current.length !== finalMsgs.length) return false;
        if (current.length === 0) return true;
        const lastCurrent = current[current.length - 1];
        const lastFinal = finalMsgs[finalMsgs.length - 1];
        // Compare last message's role + content fingerprint
        return lastCurrent.role === lastFinal.role &&
          normalizeContentForDedup(lastCurrent.content) === normalizeContentForDedup(lastFinal.content);
      };

      const savedQueue = queueStorageKey ? localStorage.getItem(queueStorageKey) : null;
      if (savedQueue) {
        try {
          const queue = JSON.parse(savedQueue) as { id: string; text: string }[];
          queueRef.current = queue;
          // Filter out queue items already present in mergedMsgs (by id or content)
          const mergedIds = new Set(mergedMsgs.map((m) => m.id));
          const mergedContentKeys = new Set(
            mergedMsgs.map((m) => `${m.role}:${normalizeContentForDedup(m.content)}`),
          );
          const freshQueue = queue.filter(
            (q) => !mergedIds.has(q.id) && !mergedContentKeys.has(`user:${normalizeContentForDedup(q.text)}`),
          );
          if (freshQueue.length < queue.length) {
            // Clean up stale queue items from localStorage
            if (freshQueue.length === 0) {
              localStorage.removeItem(queueStorageKey);
            } else {
              localStorage.setItem(queueStorageKey, JSON.stringify(freshQueue));
            }
            queueRef.current = freshQueue;
          }
          const queuedMsgs: DisplayMessage[] = freshQueue.map((q) => ({
            id: q.id, role: "user" as const, content: q.text,
            timestamp: new Date().toISOString(), toolCalls: [], queued: true,
          }));
          const finalMsgs = queuedMsgs.length > 0 ? [...mergedMsgs, ...queuedMsgs] : mergedMsgs;
          if (!shouldSkipUpdate(finalMsgs)) {
            scopedUpdate.setMessages(finalMsgs);
          }
        } catch {
          if (!shouldSkipUpdate(mergedMsgs)) {
            scopedUpdate.setMessages(mergedMsgs);
          }
        }
      } else {
        if (!shouldSkipUpdate(mergedMsgs)) {
          scopedUpdate.setMessages(mergedMsgs);
        }
      }
    } catch {
      // silently fail
    } finally {
      if (loadVersionRef.current === thisLoadVersion) {
        setLoading(false);
        lastLoadAtRef.current = Date.now();
      }
    }
  }, [client, state, sessionKey, queueStorageKey, createScopedUpdater]);

  const flushDeferredHistoryReload = useCallback(() => {
    if (!pendingHistoryReloadRef.current) return;
    pendingHistoryReloadRef.current = false;
    // Always reload after a run completes (#154).
    // The previous 800ms throttle could skip the reload when loadHistory was
    // called recently (e.g., during reconnect), leaving the final response
    // invisible until the next user interaction.
    loadHistory();
  }, [loadHistory]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Backfill previous session messages from API server logs.
  // Skip backfill for thread sessions (Cmd+T new topics) — they start fresh
  // and should never inherit messages from other sessions (#149).
  useEffect(() => {
    if (!sessionKey || state !== "connected") return;
    // Thread/topic sessions (agent:{id}:main:thread:{id} or :topic:{id}) are isolated new chats;
    // backfilling agent-level history into them causes #149.
    if (sessionKey.includes(":thread:") || sessionKey.includes(":topic:")) return;
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

  // Reload history on reconnect (catches messages missed during disconnect).
  // If an assistant stream is still in-flight, defer reload to avoid dropping
  // the visible streaming bubble during full message replacement.
  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((frame: EventFrame) => {
      if (frame.event === "client.reconnected") {
        const hasStreamingState =
          streamingRef.current ||
          hasActiveStream(streamRefs) ||
          messagesRef.current.some((m) => m.streaming);
        // Always reload history on reconnect — the loading flash is fixed
        // (setLoading only triggers when no messages exist).
        console.log("[AWF] Reconnected — reloading history", { hasStreamingState });
        pendingHistoryReloadRef.current = false;
        loadHistory();
        // If we had streaming state, set a safety timer: if no new events
        // arrive within 10s, the agent likely finished during the disconnect
        // window and lifecycle.end was missed.
        if (hasStreamingState) {
          persistPendingStream();
          if (reconnectSafetyRef.current) clearTimeout(reconnectSafetyRef.current);
          // #169: Capture guard version before the setTimeout gap
          const reconnectScoped = createScopedUpdater();
          reconnectSafetyRef.current = setTimeout(() => {
            reconnectSafetyRef.current = null;
            // #169: If session switched during the 3s gap, bail out
            if (!reconnectScoped.isValid()) return;
            if (!hasActiveStream(streamRefs)) return;
            const id = chatStreamIdRef.current;
            if (id) {
              reconnectScoped.setMessages((prev) =>
                prev.map((m) => m.id === id ? { ...m, streaming: false } : m)
              );
            }
            resetAllStreamRefs(streamRefs);
            runIdRef.current = null;
            clearPersistedPendingStream();
            setStreaming(false);
            setAgentStatusDebug({ phase: "idle" });
            clearStreamingTimeout();
          }, 3_000);
        }
      }
    });
    return unsub;
  }, [client, loadHistory, persistPendingStream, clearPersistedPendingStream, clearStreamingTimeout, createScopedUpdater]);

  // Handle agent events
  useEffect(() => {
    if (!client) return;
    let lastSeq = -1;
    // Capture sessionKey from the effect closure for strict matching (#5536-v2).
    // Using the closure value (not the ref) ensures the handler always checks
    // against the sessionKey that was active when the effect was registered.
    const boundSessionKey = sessionKey;

    const resolveRunId = (raw: Record<string, unknown>, data?: Record<string, unknown>): string | null => {
      const id = (raw.runId ?? data?.runId ?? runIdRef.current) as string | undefined;
      return id || null;
    };

    const finalizeActiveStream = (
      finalText: string | undefined,
      saveKey: string | undefined,
    ) => {
      // Flush any pending throttled persist & cancel pending rAF
      if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
      if (streamRafRef.current) { cancelAnimationFrame(streamRafRef.current); streamRafRef.current = null; }
      clearStreamingTimeout();
      setStreaming(false);
      setAgentStatusDebug({ phase: "idle" });
      if (!hasActiveStream(streamRefs)) {
        clearPersistedPendingStream();
        flushDeferredHistoryReload();
        return;
      }

      const finalId = chatStreamIdRef.current!;
      let finalContent = stripTemplateVars(finalText ?? buildStreamContent(streamRefs));
      const finalTools = buildStreamToolCalls(streamRefs);
      let finalAttachments: DisplayAttachment[] | undefined;
      if (finalContent.includes("MEDIA:")) {
        const extracted = extractMediaAttachments(finalContent);
        finalContent = extracted.cleanedText;
        finalAttachments = extracted.attachments.length > 0 ? extracted.attachments : undefined;
      }

      if (HIDDEN_REPLY_RE.test(finalContent.trim())) {
        setMessages((prev) => prev.filter((m) => m.id !== finalId));
      } else {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === finalId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              content: finalContent,
              toolCalls: finalTools,
              streaming: false,
              attachments: finalAttachments || next[idx].attachments,
            };
            return next;
          }
          return [
            ...prev,
            {
              id: finalId,
              role: "assistant",
              content: finalContent,
              timestamp: new Date().toISOString(),
              toolCalls: finalTools,
              streaming: false,
              attachments: finalAttachments,
            },
          ];
        });
      }

      if (saveKey && !HIDDEN_REPLY_RE.test(finalContent.trim())) {
        saveLocalMessages(saveKey, [{
          sessionKey: saveKey,
          id: finalId,
          role: "assistant",
          content: finalContent,
          timestamp: new Date().toISOString(),
          toolCalls: finalTools,
          attachments: finalAttachments,
        }]).catch(() => {});
      }

      // #155: Record finalized stream ID so loadHistory won't re-add it
      finalizedStreamIdsRef.current.add(finalId);
      // Auto-expire after 30s to prevent unbounded growth
      setTimeout(() => finalizedStreamIdsRef.current.delete(finalId), 30_000);

      resetAllStreamRefs(streamRefs);
      runIdRef.current = null;
      clearPersistedPendingStream();
      flushDeferredHistoryReload();
    };

    const unsub = client.onEvent((frame: EventFrame) => {
      // #250: Handle exec.approval events
      if (frame.event === "exec.approval.requested") {
        const payload = frame.payload as Record<string, unknown> | undefined;
        console.log("[AWF] Exec approval requested:", payload);
        return;
      }
      if (frame.event === "exec.approval.resolved") {
        const payload = frame.payload as Record<string, unknown> | undefined;
        console.log("[AWF] Exec approval resolved:", payload);
        return;
      }

      // #244: Handle chat events (delta, final, error, aborted)
      if (frame.event === "chat") {
        const chatPayload = frame.payload as Record<string, unknown> | undefined;
        if (!chatPayload) return;
        const chatSessionKey = chatPayload.sessionKey as string | undefined;
        if (chatSessionKey && chatSessionKey !== boundSessionKey) return;
        if (boundSessionKey !== sessionKeyRef.current) return;

        const chatState = chatPayload.state as string | undefined;

        if (chatState === "delta") {
          // #255: Chat events are the SOLE source of assistant text
          // (following OpenClaw architecture: agent events only handle tools).
          // Chat delta carries cumulative text — replace-only, never append.
          const chatMsg = chatPayload.message as Record<string, unknown> | undefined;
          if (chatMsg) {
            let text = '';
            if (typeof chatMsg.content === 'string') {
              text = chatMsg.content;
            } else if (Array.isArray(chatMsg.content)) {
              const parts = chatMsg.content as Array<Record<string, unknown>>;
              for (const p of parts) {
                if (p.type === 'thinking') continue;
                if (p.type === 'text' && typeof p.text === 'string') {
                  text += p.text;
                }
              }
            }
            if (text && !shouldSuppressStreamingPreview(text)) {
              // Cancel reconnect safety timer — events are flowing
              if (reconnectSafetyRef.current) { clearTimeout(reconnectSafetyRef.current); reconnectSafetyRef.current = null; }
              setStreaming(true);
              startStreamingTimeout("writing");
              setAgentStatusDebug({ phase: "writing" });
              if (!chatStreamIdRef.current) {
                chatStreamIdRef.current = `stream-${Date.now()}-${++streamIdCounter.current}`;
                chatStreamRef.current = "";
                chatStreamStartedAtRef.current = Date.now();
              }
              // Replace-only: cumulative text replaces buffer if longer.
              // If shorter/equal, ignore (stale throttled delta).
              const currentText = chatStreamRef.current || "";
              if (text.length >= currentText.length) {
                chatStreamRef.current = text;
              }
              if (!streamRafRef.current) {
                streamRafRef.current = requestAnimationFrame(() => {
                  streamRafRef.current = null;
                  const curId = chatStreamIdRef.current;
                  if (!curId) return;
                  // Build full content from segments + current chatStream
                  let curContent = buildStreamContent(streamRefs);
                  let curAttachments: DisplayAttachment[] | undefined;
                  if (curContent.includes('MEDIA:')) {
                    const ext = extractMediaAttachments(curContent);
                    curContent = ext.cleanedText;
                    curAttachments = ext.attachments.length > 0 ? ext.attachments : undefined;
                  }
                  const curTools = buildStreamToolCalls(streamRefs);
                  if (shouldSuppressStreamingPreview(curContent)) {
                    setMessages((prev) => prev.filter((m) => m.id !== curId));
                  } else {
                    setMessages((prev) => {
                      const existing = prev.findIndex((m) => m.id === curId);
                      const prevAttachments = existing >= 0 ? prev[existing].attachments : undefined;
                      const msg: DisplayMessage = {
                        id: curId, role: "assistant", content: curContent,
                        timestamp: new Date().toISOString(),
                        toolCalls: curTools,
                        streaming: true, attachments: curAttachments ?? prevAttachments,
                      };
                      if (existing >= 0) { const next = [...prev]; next[existing] = msg; return next; }
                      return [...prev, msg];
                    });
                  }
                });
              }
              persistPendingStream();
            }
          }
        } else if (chatState === "final") {
          // Message complete — finalize stream and reload history
          const saveKey = chatSessionKey || boundSessionKey;
          finalizeActiveStream(undefined, saveKey);
          // Reload history to get the definitive server version
          loadHistory();
        } else if (chatState === "error") {
          // Error — stop streaming and show error
          clearStreamingTimeout();
          setStreaming(false);
          setAgentStatusDebug({ phase: "idle" });
          const errMsg = (chatPayload.errorMessage || "Chat error") as string;
          if (hasActiveStream(streamRefs)) {
            const errId = chatStreamIdRef.current;
            if (errId) {
              setMessages((prev) =>
                prev.map((m) => m.id === errId
                  ? { ...m, content: m.content + `\n\n**Error:** ${errMsg}`, streaming: false }
                  : m)
              );
            }
            resetAllStreamRefs(streamRefs);
          }
          runIdRef.current = null;
          clearPersistedPendingStream();
          flushDeferredHistoryReload();
        } else if (chatState === "aborted") {
          // Aborted — preserve any streamed content and stop
          const saveKey = chatSessionKey || boundSessionKey;
          finalizeActiveStream(undefined, saveKey);
        }
        return;
      }

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

      // Strict session isolation (#5536-v2, #169):
      // 1) If event has a sessionKey, it MUST match our bound session key
      // 2) If event has NO sessionKey, reject it when we have a session —
      //    UNLESS it's a lifecycle event whose runId matches our active run (#154).
      //    Gateway may omit sessionKey on lifecycle.end while including it on
      //    lifecycle.start, causing the end event to be silently dropped.
      // 3) (#169) Also check sessionKeyRef.current — if it has changed since this
      //    handler was registered, the handler is stale and should reject everything.
      if (boundSessionKey !== sessionKeyRef.current) {
        // Handler is stale — sessionKey changed since this effect was registered.
        // Reject all events to prevent cross-session leaks during the gap
        // before React re-runs the effect with the new key.
        console.warn(`[AWF] #169 stale handler: bound="${boundSessionKey}" current="${sessionKeyRef.current}" — dropping event`);
        return;
      }
      if (evSessionKey && evSessionKey !== boundSessionKey) return;
      if (!evSessionKey && (boundSessionKey || sessionKeyRef.current)) {
        // Allow lifecycle events through if they carry a runId matching our active run
        const eventRunId = (raw.runId ?? data?.runId) as string | undefined;
        const isMatchingLifecycle =
          stream === "lifecycle" &&
          eventRunId &&
          runIdRef.current &&
          eventRunId === runIdRef.current;
        if (!isMatchingLifecycle) return;
      }


      // Ignore events after abort until next lifecycle start
      if (abortedRef.current && stream !== "lifecycle") return;

      // #255: Agent events do NOT handle stream === "assistant" text.
      // Following OpenClaw architecture: assistant text is handled exclusively
      // by the chat event handler (payload.state === "delta") above.
      // The gateway sends both agent + chat events for assistant text;
      // processing both caused content duplication.

      if (stream === "tool-start" && data) {
        const callId = (data.toolCallId || data.callId || "") as string;
        const name = (data.name || data.tool || "") as string;
        setAgentStatusDebug({ phase: "tool", toolName: name });
        const args = data.args as string | undefined;
        // Commit current text to segments before tool starts (OpenClaw pattern)
        commitChatStreamToSegment(streamRefs);
        if (!chatStreamIdRef.current) {
          chatStreamIdRef.current = `stream-${Date.now()}-${++streamIdCounter.current}`;
          chatStreamStartedAtRef.current = Date.now();
        }
        const entry: ToolStreamEntry = {
          toolCallId: callId,
          name,
          args,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        };
        toolStreamByIdRef.current.set(callId, entry);
        toolStreamOrderRef.current.push(callId);
        const snapId = chatStreamIdRef.current;
        const snapContent = buildStreamContent(streamRefs);
        const snapTools = buildStreamToolCalls(streamRefs);
        setMessages((prev) => {
          const existing = prev.findIndex((m) => m.id === snapId);
          const msg: DisplayMessage = {
            id: snapId, role: "assistant", content: snapContent,
            timestamp: new Date().toISOString(),
            toolCalls: snapTools, streaming: true,
          };
          if (existing >= 0) { const next = [...prev]; next[existing] = msg; return next; }
          return [...prev, msg];
        });
        persistPendingStream();
      } else if (stream === "tool-end" && data) {
        const callId = (data.toolCallId || data.callId || "") as string;
        const result = data.result as string | undefined;
        setAgentStatusDebug({ phase: "thinking" });
        if (hasActiveStream(streamRefs)) {
          const entry = toolStreamByIdRef.current.get(callId);
          if (entry) { entry.output = result; entry.updatedAt = Date.now(); }
          const snapId = chatStreamIdRef.current;
          if (snapId) {
            const snapTools = buildStreamToolCalls(streamRefs);
            setMessages((prev) => {
              const existing = prev.findIndex((m) => m.id === snapId);
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = { ...next[existing], toolCalls: snapTools };
                return next;
              }
              return prev;
            });
          }
          persistPendingStream();
          // #244: Reload history after tool result to get latest state
          loadHistory();
        }
      } else if (stream === "tool" && data) {
        // #249: Alternative tool stream format — stream="tool" with data.phase
        const phase = data.phase as string | undefined;
        if (phase === "start") {
          const callId = (data.toolCallId || data.callId || "") as string;
          const name = (data.name || data.tool || "") as string;
          setAgentStatusDebug({ phase: "tool", toolName: name });
          const args = data.args as string | undefined;
          // Commit current text to segments before tool starts (OpenClaw pattern)
          commitChatStreamToSegment(streamRefs);
          if (!chatStreamIdRef.current) {
            chatStreamIdRef.current = `stream-${Date.now()}-${++streamIdCounter.current}`;
            chatStreamStartedAtRef.current = Date.now();
          }
          const entry: ToolStreamEntry = {
            toolCallId: callId,
            name,
            args,
            startedAt: Date.now(),
            updatedAt: Date.now(),
          };
          toolStreamByIdRef.current.set(callId, entry);
          toolStreamOrderRef.current.push(callId);
          const snapId = chatStreamIdRef.current;
          const snapContent = buildStreamContent(streamRefs);
          const snapTools = buildStreamToolCalls(streamRefs);
          setMessages((prev) => {
            const existing = prev.findIndex((m) => m.id === snapId);
            const msg: DisplayMessage = {
              id: snapId, role: "assistant", content: snapContent,
              timestamp: new Date().toISOString(),
              toolCalls: snapTools, streaming: true,
            };
            if (existing >= 0) { const next = [...prev]; next[existing] = msg; return next; }
            return [...prev, msg];
          });
          persistPendingStream();
        } else if (phase === "end" || phase === "result") {
          const callId = (data.toolCallId || data.callId || "") as string;
          const result = data.result as string | undefined;
          setAgentStatusDebug({ phase: "thinking" });
          if (hasActiveStream(streamRefs)) {
            const toolEntry = toolStreamByIdRef.current.get(callId);
            if (toolEntry) { toolEntry.output = result; toolEntry.updatedAt = Date.now(); }
            const snapId = chatStreamIdRef.current;
            if (snapId) {
              const snapTools = buildStreamToolCalls(streamRefs);
              setMessages((prev) => {
                const existing = prev.findIndex((m) => m.id === snapId);
                if (existing >= 0) {
                  const next = [...prev];
                  next[existing] = { ...next[existing], toolCalls: snapTools };
                  return next;
                }
                return prev;
              });
            }
            persistPendingStream();
            // #244: Reload history after tool result
            loadHistory();
          }
        }
      } else if (stream === "compaction" && data) {
        // #249: Compaction event — log and update state
        const status = data.status as string | undefined;
        console.log(`[AWF] Compaction event: ${status}`, data);
        // Reload history after compaction completes to get fresh messages
        if (status === "completed" || status === "done") {
          loadHistory();
        }
      } else if (stream === "inbound" && data) {
        // Messages from other surfaces/devices (Telegram, other tabs, etc.)
        // Cross-device sync with dedup (#120)
        const text = ((data.text ?? data.content ?? "") as string);
        // Resolve role: inter-session/agent messages may arrive without explicit
        // role.  When the provenance indicates another agent session or the
        // surface is "agent", treat the message as an assistant response to
        // avoid showing agent replies as user bubbles.
        const rawRole = data.role as string | undefined;
        const isAgentSource =
          (data.inputProvenance as Record<string, unknown> | undefined)?.kind === "inter_session" ||
          data.surface === "agent" ||
          data.source === "sessions_send";
        const role: "user" | "assistant" = rawRole === "assistant" || rawRole === "user"
          ? rawRole
          : isAgentSource ? "assistant" : "user";

        // #243: Same-session assistant messages are already handled by the
        // streaming handler — skip to prevent duplicates.
        if (role === "assistant" && evSessionKey === boundSessionKey) {
          return;
        }

        // Debug: capture raw inbound data to diagnose agent-to-agent role attribution
        if (process.env.NODE_ENV !== "production") {
          console.debug("[AWF:INBOUND]", { rawRole, isAgentSource, role, surface: data.surface, source: data.source, provenance: data.inputProvenance, keys: Object.keys(data) });
        }
        if (text) {
          // Strip trailing control tokens (REPLY_SKIP, NO_REPLY, etc.)
          const stripped = text.replace(/\n{1,2}(REPLY_SKIP|NO_REPLY|HEARTBEAT_OK)\s*$/g, "").trim();
          // Skip entirely if the message is purely a control token
          if (!stripped || HIDDEN_REPLY_RE.test(stripped) || INTERNAL_PROMPT_RE.test(stripped)) return;
          let cleanedText = role === "user" ? stripInboundMeta(stripped) : stripped;
          const originDeviceId = data.deviceId as string | undefined;
          const timestamp = (data.timestamp as string) ?? new Date().toISOString();

          // Skip echo from our own device
          if (originDeviceId && originDeviceId === deviceIdRef.current) {
            return;
          }

          // #243: Extract MEDIA attachments from inbound assistant messages
          // (safety net for cross-device/session messages)
          let inboundAttachments: DisplayAttachment[] | undefined;
          if (role === "assistant" && cleanedText.includes("MEDIA:")) {
            const extracted = extractMediaAttachments(cleanedText);
            cleanedText = extracted.cleanedText;
            inboundAttachments = extracted.attachments.length > 0 ? extracted.attachments : undefined;
          }

          const inboundId = `inbound-${Date.now()}-${++streamIdCounter.current}`;
          setMessages((prev) => {
            // Content-based dedup only for legacy gateways without deviceId
            if (!originDeviceId && role === "user" && isDuplicateOfOptimistic(prev, role, cleanedText, timestamp)) {
              return prev;
            }
            // Assistant content dedup — prevent duplicate display when the same
            // response arrives via both streaming and inbound events
            if (role === "assistant") {
              const normalizedInbound = normalizeContentForDedup(cleanedText);
              const isDup = prev.some(
                (m) => m.role === "assistant" && normalizeContentForDedup(m.content) === normalizedInbound
              );
              if (isDup) {
                console.warn("[AWF] Inbound assistant message deduplicated (content match)");
                return prev;
              }
            }
            return [...prev, {
              id: inboundId,
              role,
              content: cleanedText,
              timestamp,
              toolCalls: [],
              ...(inboundAttachments && { attachments: inboundAttachments }),
            }];
          });
        }
      } else if (stream === "lifecycle" && data?.phase === "start") {
        // Cancel reconnect safety timer — new lifecycle starting
        if (reconnectSafetyRef.current) { clearTimeout(reconnectSafetyRef.current); reconnectSafetyRef.current = null; }
        setStreaming(true);
        abortedRef.current = false;
        startStreamingTimeout("thinking");
        runIdRef.current = resolveRunId(raw, data);
        const runKey = finalEventKey(runIdRef.current);
        if (runKey) {
          finalizedEventKeysRef.current.delete(runKey);
        }
        // Route post-run history sync through a single deferred gate.
        pendingHistoryReloadRef.current = true;
        setAgentStatusDebug({ phase: "thinking" });
        persistPendingStream();
      } else if (stream === "lifecycle" && data?.phase === "end") {
        // #255: Following OpenClaw architecture, lifecycle.end does NOT finalize.
        // The chat "final" event is the authoritative completion signal.
        // lifecycle.end arrives before the throttled chat final, causing premature
        // finalization with partial content (e.g., "Hello" instead of full response).
        // Just record the finalization key so duplicate lifecycle.end is ignored.
        const eventRunId = resolveRunId(raw, data);
        const key = finalEventKey(eventRunId);
        if (key) finalizedEventKeysRef.current.add(key);
      } else if (stream === "done" || stream === "end" || stream === "finish") {
        // #255: Same as lifecycle.end — don't finalize from agent events.
        // Chat final handles finalization.
        const eventRunId = resolveRunId(raw, data);
        const key = finalEventKey(eventRunId);
        if (key) finalizedEventKeysRef.current.add(key);
      } else if (stream === "error") {
        clearStreamingTimeout();
        setStreaming(false);
        setAgentStatusDebug({ phase: "idle" });
        const errMsg = (data?.message || data?.error || "Unknown error") as string;
        if (hasActiveStream(streamRefs)) {
          const errId = chatStreamIdRef.current;
          if (errId) {
            setMessages((prev) =>
              prev.map((m) => m.id === errId
                ? { ...m, content: m.content + `\n\n**Error:** ${errMsg}`, streaming: false }
                : m)
            );
          }
          resetAllStreamRefs(streamRefs);
        }
        runIdRef.current = null;
        clearPersistedPendingStream();
        flushDeferredHistoryReload();
      }
    });
    return unsub;
  }, [
    client,
    sessionKey,
    clearStreamingTimeout,
    startStreamingTimeout,
    setAgentStatusDebug,
    persistPendingStream,
    clearPersistedPendingStream,
    flushDeferredHistoryReload,
    loadHistory,
  ]);

  // Message queue
  const queueRef = useRef<{ id: string; text: string; attachments?: DisplayAttachment[] }[]>(
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
      sendingRef.current = true;
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, queued: false } : m)));
      setStreaming(true);
      startStreamingTimeout("thinking");
      setAgentStatusDebug({ phase: "thinking" });

      const idempotencyKey = `awf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const maxAttempts = 2; // initial + one retry for session bootstrap race (#50)

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await client.request("chat.send", {
            message: text,
            idempotencyKey,
            // Use the latest session key on retry to avoid new-session race (#50)
            sessionKey: sessionKeyRef.current || sessionKey,
            deliver: false, // #247: Gateway delivers via event stream, not inline response
          });
          sendingRef.current = false;
          return;
        } catch (err) {
          const isLast = attempt >= maxAttempts;
          if (isLast) {
            console.error("[AWF] chat.send error:", String(err));
            sendingRef.current = false;
            clearStreamingTimeout();
            setStreaming(false);
            setAgentStatusDebug({ phase: "idle" });
            // #242: Show error feedback message to user
            setMessages((prev) => [...prev, {
              id: `error-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              role: "assistant" as const,
              content: "⚠️ 메시지 전송에 실패했습니다. 다시 시도해주세요.",
              timestamp: new Date().toISOString(),
              toolCalls: [],
              isError: true,
            }]);
            return;
          }
          // Short retry window for immediate session-switch/bootstrap timing race.
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
    },
    [client, state, sessionKey, startStreamingTimeout, clearStreamingTimeout, setAgentStatusDebug]
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
          try {
            await doSend(next.text, next.id);
          } catch {
            // #245: Re-insert failed item at front of queue for retry
            queueRef.current = [next, ...queueRef.current];
            persistQueue();
            break;
          }
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

  const setReplyTo = useCallback((msg: DisplayMessage) => {
    const reply = buildReplyTo(msg);
    if (reply) setReplyingToState(reply);
  }, []);

  const clearReplyTo = useCallback(() => {
    setReplyingToState(null);
  }, []);

  const abort = useCallback(() => {
    // Immediately stop UI — don't await the RPC
    abortedRef.current = true;
    const currentRunId = runIdRef.current;
    clearStreamingTimeout();
    if (hasActiveStream(streamRefs)) {
      const abortedId = chatStreamIdRef.current;
      if (abortedId) {
        setMessages((prev) => prev.map((m) => m.id === abortedId ? { ...m, streaming: false } : m));
      }
      resetAllStreamRefs(streamRefs);
    }
    runIdRef.current = null;
    clearPersistedPendingStream();
    setStreaming(false);
    setAgentStatusDebug({ phase: "idle" });
    // Fire-and-forget the gateway abort
    if (client && state === "connected") {
      client.request("chat.abort", { sessionKey, runId: currentRunId ?? undefined })
        .catch((err: unknown) => console.warn("[AWF] chat.abort failed:", String(err)));
    }
  }, [client, state, sessionKey, clearStreamingTimeout, clearPersistedPendingStream]);

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

  const sendMessage = useCallback(
    (text: string, options?: { replyTo?: ReplyTo }) => {
      if (!client || state !== "connected" || !text.trim()) return;

      // #251: Intercept text-based stop/reset commands
      if (isChatStopCommand(text)) {
        abort();
        return;
      }
      const resetCmd = isChatResetCommand(text);
      if (resetCmd.reset) {
        sendCommand("reset");
        if (resetCmd.message) {
          // Send the trailing message as a new message after reset
          setTimeout(() => doSend(resetCmd.message!, `user-${Date.now()}-${Math.random().toString(36).slice(2)}`), 100);
        }
        return;
      }

      const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const replyTo = options?.replyTo || replyingTo || undefined;
      // #245: Queue when streaming OR when a send is still in-flight (race guard)
      const shouldQueue = streaming || sendingRef.current;
      const userMsg: DisplayMessage = {
        id: msgId, role: "user", content: text,
        timestamp: new Date().toISOString(), toolCalls: [], queued: shouldQueue,
        replyTo,
      };
      setMessages((prev) => [...prev, userMsg]);
      // Persist user message to local store (including replyTo for quote persistence)
      saveLocalMessages(sessionKey, [{
        sessionKey,
        id: msgId,
        role: "user",
        content: text,
        timestamp: userMsg.timestamp,
        attachments: userMsg.attachments,
        replyTo: replyTo,
      }]).catch(() => {});
      // Clear replyingTo after send
      if (replyingTo) setReplyingToState(null);
      if (shouldQueue) { queueRef.current.push({ id: msgId, text }); persistQueue(); }
      else { doSend(text, msgId); }
    },
    [client, state, streaming, doSend, replyingTo, abort, sendCommand]
  );

  useEffect(() => {
    if (!streaming && queueRef.current.length > 0) processQueue();
  }, [streaming, processQueue]);

  const cancelQueued = useCallback((msgId: string) => {
    queueRef.current = queueRef.current.filter((q) => q.id !== msgId);
    persistQueue();
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
  }, [persistQueue]);

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

      // Boundary UI message with reason (#156)
      const boundaryMsg: DisplayMessage = {
        id: `boundary-${event.oldSessionId.slice(0, 8)}-${Date.now()}`,
        role: "session-boundary", content: "", timestamp: new Date().toISOString(),
        toolCalls: [], oldSessionId: event.oldSessionId, newSessionId: event.newSessionId,
        resetReason: event.reason,
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
        resetReason: event.reason,
      }]).catch(() => {});

      // IndexedDB에 이전 세션 요약만 저장 (auto bridge 제거 — Gateway의 session reset prompt와 중복 방지)
      const summary = buildContextSummaryRef.current?.();
      if (summary) {
        markSessionEnded(event.key, event.oldSessionId, { summary }).catch(() => {});
      }
    });
    return unsub;
  }, []);

  return {
    messages, streaming, loading, agentStatus,
    sendMessage, sendCommand, addUserMessage, addLocalMessage, clearMessages,
    cancelQueued, abort, reload: loadHistory, sendContextBridge,
    replyingTo, setReplyTo, clearReplyTo,
  };
}
