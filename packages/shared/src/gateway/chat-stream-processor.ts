/**
 * chat-stream-processor.ts — Platform-independent streaming event processor.
 *
 * Processes OpenClaw gateway chat & agent events, managing 3-buffer streaming
 * state internally and notifying the platform via callbacks. Used by both
 * mobile (ChatStateManager) and web (useChat hook).
 *
 * Key design: the processor owns ALL mutable streaming state and timer
 * management. Platforms only provide callbacks for state propagation and
 * platform-specific side effects (persistence, history reload, etc.).
 */

import type { EventFrame, ToolCall } from "./protocol";
import type {
  DisplayMessage,
  AgentStatus,
  ToolStreamRefs,
  ToolStreamEntry,
} from "./chat-stream-types";
import {
  createToolStreamRefs,
  resetAllStreamRefs,
  commitChatStreamToSegment,
  hasActiveStream,
  buildStreamContent,
  buildStreamToolCalls,
} from "./tool-stream";
import {
  HIDDEN_REPLY_RE,
  stripTrailingControlTokens,
  isHiddenMessage,
  shouldSuppressStreamingPreview,
} from "./chat-stream-core";

// ── Callback interface ──────────────────────────────────────────────────

export interface ChatStreamCallbacks {
  /** Sole way to mutate the message list. Accepts a React-style updater. */
  onMessagesUpdate: (
    updater: (prev: DisplayMessage[]) => DisplayMessage[],
  ) => void;
  /** Toggle streaming flag. */
  onStreamingChange: (streaming: boolean) => void;
  /** Update agent status indicator. */
  onAgentStatusChange: (status: AgentStatus) => void;
  /** Track current runId. */
  onRunIdChange: (runId: string | null) => void;
  /** Ask platform to reload chat history from gateway. */
  requestHistoryReload: () => void;
  /** Optional: persist streaming snapshot for crash recovery (web: sessionStorage). */
  onPersistPendingStream?: () => void;
  /** Optional: clear persisted streaming snapshot. */
  onClearPersistedStream?: () => void;
  /** Optional: notify that a stream was finalized (web: save to IndexedDB). */
  onStreamFinalized?: (
    streamId: string,
    content: string,
    toolCalls: ToolCall[],
  ) => void;
  /**
   * Optional: transform final content before display (web: stripTemplateVars + extractMediaAttachments).
   * Returns transformed content and optional attachments.
   */
  onContentTransform?: (content: string) => {
    content: string;
    attachments?: Array<{
      fileName: string;
      mimeType: string;
      dataUrl?: string;
      downloadUrl?: string;
      textContent?: string;
    }>;
  };
  /** Optional: called on streaming timeout for platform-specific feedback. */
  onTimeout?: () => void;
  /**
   * Optional: called for agent events not handled by the processor
   * (e.g., inbound, compaction, exec approval). Platform can handle these.
   */
  onUnhandledAgentEvent?: (
    stream: string,
    raw: Record<string, unknown>,
    data: Record<string, unknown> | undefined,
  ) => void;
}

export interface ChatStreamProcessorConfig {
  /** The bound session key for this processor. */
  sessionKey: string;
  /** Platform callbacks. */
  callbacks: ChatStreamCallbacks;
  /** Streaming timeout in ms (default: 45000). */
  timeoutMs?: number;
}

// ── Helper: extract text from chat delta payload ──

function extractDeltaText(
  chatPayload: Record<string, unknown>,
): string {
  // Primary: payload.message with ContentPart[] (OpenClaw protocol)
  const chatMsg = chatPayload.message as
    | Record<string, unknown>
    | undefined;
  if (chatMsg) {
    if (typeof chatMsg.content === "string") {
      return chatMsg.content;
    }
    if (Array.isArray(chatMsg.content)) {
      let text = "";
      for (const p of chatMsg.content as Array<
        Record<string, unknown>
      >) {
        if (p.type === "thinking") continue;
        if (p.type === "text" && typeof p.text === "string") {
          text += p.text;
        }
      }
      return text;
    }
  }
  // Fallback: payload.text (older gateway versions)
  if (typeof chatPayload.text === "string") {
    return chatPayload.text as string;
  }
  return "";
}

// ── Helper: build a final event dedup key ──

function finalEventKey(
  runId: string | null | undefined,
): string | null {
  if (!runId) return null;
  return `run:${runId}`;
}

// ── Helper: resolve runId from various payload locations ──

function resolveRunId(
  raw: Record<string, unknown>,
  data: Record<string, unknown> | undefined,
): string | null {
  return (
    ((raw.runId ?? data?.runId) as string | undefined) ?? null
  );
}

// ── ChatStreamProcessor ─────────────────────────────────────────────────

export class ChatStreamProcessor {
  private readonly sessionKey: string;
  private readonly cb: ChatStreamCallbacks;
  private readonly timeoutMs: number;

  // Streaming state
  private streamRefs: ToolStreamRefs = createToolStreamRefs();
  private streamIdCounter = 0;
  private runId: string | null = null;
  private aborted = false;

  // Deferred history reload gate
  private pendingHistoryReload = false;

  // Dedup: finalized event keys (prevents done/end/finish from re-finalizing)
  private finalizedEventKeys = new Set<string>();

  // Streaming timeout timer
  private streamingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: ChatStreamProcessorConfig) {
    this.sessionKey = config.sessionKey;
    this.cb = config.callbacks;
    this.timeoutMs = config.timeoutMs ?? 45_000;
  }

  // ── Public API ──

  /** Main entry point — routes event to chat/agent handlers. */
  processEvent(frame: EventFrame): void {
    if (frame.event === "chat") {
      this.handleChatEvent(frame);
      return;
    }
    if (frame.event === "agent") {
      this.handleAgentEvent(frame);
      return;
    }
  }

  /** Eagerly abort — clears runId, sets aborted flag, returns previous runId. */
  abort(): { previousRunId: string | null } {
    const prev = this.runId;
    this.aborted = true;
    this.runId = null;
    this.cb.onRunIdChange(null);
    this.cb.onStreamingChange(false);
    this.cb.onAgentStatusChange({ phase: "idle" });
    this.clearStreamingTimeout();
    // Preserve any partial content as non-streaming
    if (hasActiveStream(this.streamRefs)) {
      const streamId = this.streamRefs.chatStreamId.current;
      if (streamId) {
        this.cb.onMessagesUpdate((prev) =>
          prev.map((m) =>
            m.id === streamId ? { ...m, streaming: false } : m,
          ),
        );
      }
      resetAllStreamRefs(this.streamRefs);
    }
    this.cb.onClearPersistedStream?.();
    return { previousRunId: prev };
  }

  getRunId(): string | null {
    return this.runId;
  }

  getStreamRefs(): ToolStreamRefs {
    return this.streamRefs;
  }

  hasActiveStream(): boolean {
    return hasActiveStream(this.streamRefs);
  }

  /** Full reset for session switch. */
  reset(): void {
    this.clearStreamingTimeout();
    resetAllStreamRefs(this.streamRefs);
    this.runId = null;
    this.aborted = false;
    this.pendingHistoryReload = false;
    this.finalizedEventKeys.clear();
    this.streamIdCounter = 0;
  }

  /** Clean up timers. Call when disposing. */
  dispose(): void {
    this.clearStreamingTimeout();
  }

  // ── Chat event handler ──

  private handleChatEvent(frame: EventFrame): void {
    const chatPayload = frame.payload as Record<string, unknown>;
    const chatState = chatPayload.state as string | undefined;
    const chatSessionKey = chatPayload.sessionKey as string | undefined;

    // Session-key guard: reject events for other sessions
    if (chatSessionKey && chatSessionKey !== this.sessionKey) return;

    if (chatState === "delta") {
      this.handleChatDelta(chatPayload);
    } else if (chatState === "final") {
      this.finalizeActiveStream();
      this.cb.requestHistoryReload();
    } else if (chatState === "error") {
      this.handleChatError(chatPayload);
    } else if (chatState === "aborted") {
      this.finalizeActiveStream();
      this.flushDeferredHistoryReload();
    }
  }

  private handleChatDelta(chatPayload: Record<string, unknown>): void {
    const text = extractDeltaText(chatPayload);
    if (!text) return;

    // First suppress check: raw incoming text
    if (shouldSuppressStreamingPreview(text)) return;

    this.cb.onStreamingChange(true);
    this.startStreamingTimeout();
    this.cb.onAgentStatusChange({ phase: "writing" });

    if (!this.streamRefs.chatStreamId.current) {
      this.streamRefs.chatStreamId.current = `stream-${Date.now()}-${++this.streamIdCounter}`;
      this.streamRefs.chatStreamStartedAt.current = Date.now();
    }

    // Replace-only: cumulative text replaces buffer only if longer.
    const current = this.streamRefs.chatStream.current || "";
    if (text.length >= current.length) {
      this.streamRefs.chatStream.current = text;
    }

    const snapId = this.streamRefs.chatStreamId.current;
    const snapContent = buildStreamContent(this.streamRefs);

    // Second suppress check: combined content (segments + current stream)
    if (shouldSuppressStreamingPreview(snapContent)) {
      this.cb.onMessagesUpdate((prev) =>
        prev.filter((m) => m.id !== snapId),
      );
      return;
    }

    const snapTools = buildStreamToolCalls(this.streamRefs);
    const msg: DisplayMessage = {
      id: snapId,
      role: "assistant",
      content: snapContent,
      timestamp: new Date().toISOString(),
      toolCalls: snapTools,
      streaming: true,
    };

    this.cb.onMessagesUpdate((prev) => {
      const idx = prev.findIndex((m) => m.id === snapId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = msg;
        return next;
      }
      return [...prev, msg];
    });

    this.cb.onPersistPendingStream?.();
  }

  private handleChatError(chatPayload: Record<string, unknown>): void {
    this.clearStreamingTimeout();
    this.cb.onStreamingChange(false);
    this.cb.onAgentStatusChange({ phase: "idle" });
    const errMsg = String(
      chatPayload.errorMessage || chatPayload.error || "Chat error",
    );

    if (hasActiveStream(this.streamRefs)) {
      const errId = this.streamRefs.chatStreamId.current;
      if (errId) {
        this.cb.onMessagesUpdate((prev) =>
          prev.map((m) =>
            m.id === errId
              ? {
                  ...m,
                  content: m.content + `\n\n**Error:** ${errMsg}`,
                  streaming: false,
                }
              : m,
          ),
        );
      }
      resetAllStreamRefs(this.streamRefs);
    }

    this.runId = null;
    this.cb.onRunIdChange(null);
    this.cb.onClearPersistedStream?.();
    this.flushDeferredHistoryReload();
  }

  // ── Agent event handler ──

  private handleAgentEvent(frame: EventFrame): void {
    const raw = frame.payload as Record<string, unknown>;
    const stream = raw.stream as string | undefined;
    const data = raw.data as Record<string, unknown> | undefined;

    // Session-key guard
    const evSessionKey = (raw.sessionKey ?? data?.sessionKey) as
      | string
      | undefined;
    if (evSessionKey && evSessionKey !== this.sessionKey) return;
    if (!evSessionKey) {
      // Allow lifecycle events whose runId matches ours
      const eventRunId = resolveRunId(raw, data);
      const isMatchingLifecycle =
        stream === "lifecycle" &&
        eventRunId &&
        this.runId &&
        eventRunId === this.runId;
      if (!isMatchingLifecycle) return;
    }

    // Ignore events after abort until next lifecycle start
    if (this.aborted && stream !== "lifecycle") return;

    // #255: Agent events do NOT handle stream === "assistant" text.
    // Chat events are the sole source of assistant text.

    if (stream === "tool-start" && data) {
      this.handleToolStart(data);
    } else if (stream === "tool-end" && data) {
      this.handleToolEnd(data);
    } else if (stream === "tool" && data) {
      // Alternative format with data.phase
      const phase = data.phase as string | undefined;
      if (phase === "start") {
        this.handleToolStart(data);
      } else if (phase === "end" || phase === "result") {
        this.handleToolEnd(data);
      }
    } else if (stream === "lifecycle" && data?.phase === "start") {
      this.handleLifecycleStart(raw, data);
    } else if (stream === "lifecycle" && data?.phase === "end") {
      // NO-OP for stream finalization — chat "final" handles it.
      // Only record finalized event key for dedup.
      const eventRunId = resolveRunId(raw, data);
      const key = finalEventKey(eventRunId);
      if (key) this.finalizedEventKeys.add(key);
    } else if (
      stream === "done" ||
      stream === "end" ||
      stream === "finish"
    ) {
      // NO-OP — same as lifecycle.end. Only record dedup key.
      const eventRunId = resolveRunId(raw, data);
      const key = finalEventKey(eventRunId);
      if (key) this.finalizedEventKeys.add(key);
    } else if (stream === "error") {
      this.handleAgentError(data);
    } else if (stream) {
      // Pass unhandled agent events to platform (inbound, compaction, exec, etc.)
      this.cb.onUnhandledAgentEvent?.(stream, raw, data);
    }
  }

  private handleToolStart(data: Record<string, unknown>): void {
    const callId = String(data.toolCallId || data.callId || "");
    const name = String(data.name || data.tool || "");
    const args = data.args as string | undefined;

    this.cb.onAgentStatusChange({ phase: "tool", toolName: name });

    // Commit current text to segments before tool starts (3-buffer pattern)
    commitChatStreamToSegment(this.streamRefs);

    if (!this.streamRefs.chatStreamId.current) {
      this.streamRefs.chatStreamId.current = `stream-${Date.now()}-${++this.streamIdCounter}`;
      this.streamRefs.chatStreamStartedAt.current = Date.now();
    }

    const entry: ToolStreamEntry = {
      toolCallId: callId,
      name,
      args,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.streamRefs.toolStreamById.current.set(callId, entry);
    this.streamRefs.toolStreamOrder.current.push(callId);

    const snapId = this.streamRefs.chatStreamId.current;
    const snapContent = buildStreamContent(this.streamRefs);
    const snapTools = buildStreamToolCalls(this.streamRefs);

    this.cb.onMessagesUpdate((prev) => {
      const idx = prev.findIndex((m) => m.id === snapId);
      const msg: DisplayMessage = {
        id: snapId,
        role: "assistant",
        content: snapContent,
        timestamp: new Date().toISOString(),
        toolCalls: snapTools,
        streaming: true,
      };
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = msg;
        return next;
      }
      return [...prev, msg];
    });

    this.cb.onPersistPendingStream?.();
  }

  private handleToolEnd(data: Record<string, unknown>): void {
    const callId = String(data.toolCallId || data.callId || "");
    const result = data.result as string | undefined;

    this.cb.onAgentStatusChange({ phase: "thinking" });

    if (hasActiveStream(this.streamRefs)) {
      const entry = this.streamRefs.toolStreamById.current.get(callId);
      if (entry) {
        entry.output = result;
        entry.updatedAt = Date.now();
      }

      const snapId = this.streamRefs.chatStreamId.current;
      if (snapId) {
        const snapTools = buildStreamToolCalls(this.streamRefs);
        this.cb.onMessagesUpdate((prev) => {
          const idx = prev.findIndex((m) => m.id === snapId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = { ...next[idx], toolCalls: snapTools };
            return next;
          }
          return prev;
        });
      }

      this.cb.onPersistPendingStream?.();
    }
  }

  private handleLifecycleStart(
    raw: Record<string, unknown>,
    data: Record<string, unknown>,
  ): void {
    this.aborted = false;
    this.runId = resolveRunId(raw, data);
    this.cb.onRunIdChange(this.runId);
    this.cb.onStreamingChange(true);
    this.cb.onAgentStatusChange({ phase: "thinking" });
    this.pendingHistoryReload = true;
    this.startStreamingTimeout();
    this.cb.onPersistPendingStream?.();
  }

  private handleAgentError(
    data: Record<string, unknown> | undefined,
  ): void {
    this.clearStreamingTimeout();
    this.cb.onStreamingChange(false);
    this.cb.onAgentStatusChange({ phase: "idle" });
    const errMsg = String(
      data?.message || data?.error || "Unknown error",
    );

    if (hasActiveStream(this.streamRefs)) {
      const errId = this.streamRefs.chatStreamId.current;
      if (errId) {
        this.cb.onMessagesUpdate((prev) =>
          prev.map((m) =>
            m.id === errId
              ? {
                  ...m,
                  content: m.content + `\n\n**Error:** ${errMsg}`,
                  streaming: false,
                }
              : m,
          ),
        );
      }
      resetAllStreamRefs(this.streamRefs);
    }

    this.runId = null;
    this.cb.onRunIdChange(null);
    this.cb.onClearPersistedStream?.();
    this.flushDeferredHistoryReload();
  }

  // ── Finalization ──

  private finalizeActiveStream(): void {
    this.clearStreamingTimeout();
    this.cb.onStreamingChange(false);
    this.cb.onAgentStatusChange({ phase: "idle" });

    if (!hasActiveStream(this.streamRefs)) {
      this.cb.onClearPersistedStream?.();
      this.flushDeferredHistoryReload();
      return;
    }

    const finalId = this.streamRefs.chatStreamId.current!;
    let finalContent = stripTrailingControlTokens(
      buildStreamContent(this.streamRefs),
    );
    const finalToolCalls = buildStreamToolCalls(this.streamRefs);

    // Platform-specific content transform (web: stripTemplateVars + extractMediaAttachments)
    let finalAttachments: DisplayMessage["attachments"];
    if (this.cb.onContentTransform) {
      const transformed = this.cb.onContentTransform(finalContent);
      finalContent = transformed.content;
      finalAttachments = transformed.attachments;
    }

    if (isHiddenMessage("assistant", finalContent)) {
      this.cb.onMessagesUpdate((prev) =>
        prev.filter((m) => m.id !== finalId),
      );
    } else {
      this.cb.onMessagesUpdate((prev) => {
        const idx = prev.findIndex((m) => m.id === finalId);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            content: finalContent,
            toolCalls: finalToolCalls,
            streaming: false,
            ...(finalAttachments
              ? { attachments: finalAttachments }
              : {}),
          };
          return next;
        }
        return [
          ...prev,
          {
            id: finalId,
            role: "assistant" as const,
            content: finalContent,
            timestamp: new Date().toISOString(),
            toolCalls: finalToolCalls,
            streaming: false,
            ...(finalAttachments
              ? { attachments: finalAttachments }
              : {}),
          },
        ];
      });

      this.cb.onStreamFinalized?.(finalId, finalContent, finalToolCalls);
    }

    resetAllStreamRefs(this.streamRefs);
    this.runId = null;
    this.cb.onRunIdChange(null);
    this.cb.onClearPersistedStream?.();
    this.flushDeferredHistoryReload();
  }

  // ── Deferred history reload gate ──

  private flushDeferredHistoryReload(): void {
    if (!this.pendingHistoryReload) return;
    this.pendingHistoryReload = false;
    this.cb.requestHistoryReload();
  }

  // ── Streaming timeout ──

  private startStreamingTimeout(): void {
    this.clearStreamingTimeout();
    this.streamingTimer = setTimeout(() => {
      this.streamingTimer = null;
      this.cb.onStreamingChange(false);
      this.cb.onAgentStatusChange({ phase: "idle" });
      this.runId = null;
      this.cb.onRunIdChange(null);

      if (hasActiveStream(this.streamRefs)) {
        const finalId = this.streamRefs.chatStreamId.current;
        if (finalId) {
          this.cb.onMessagesUpdate((prev) =>
            prev.map((m) =>
              m.id === finalId ? { ...m, streaming: false } : m,
            ),
          );
        }
        resetAllStreamRefs(this.streamRefs);
      }

      this.cb.onClearPersistedStream?.();
      this.cb.onTimeout?.();
    }, this.timeoutMs);
  }

  private clearStreamingTimeout(): void {
    if (this.streamingTimer) {
      clearTimeout(this.streamingTimer);
      this.streamingTimer = null;
    }
  }
}
