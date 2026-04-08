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
import type { MessageSegment } from "./chat-stream-types";
import {
  createToolStreamRefs,
  resetAllStreamRefs,
  commitChatStreamToSegment,
  hasActiveStream,
  buildStreamContent,
  buildStreamToolCalls,
  buildStreamSegments,
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
    segments?: MessageSegment[],
    thinking?: Array<{ text: string }>,
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

// ── Helper: extract text and thinking from chat delta payload ──

function extractDeltaTextAndThinking(
  chatPayload: Record<string, unknown>,
): { text: string; thinking: Array<{ text: string }> } {
  const thinking: Array<{ text: string }> = [];
  // Primary: payload.message with ContentPart[] (OpenClaw protocol)
  const chatMsg = chatPayload.message as
    | Record<string, unknown>
    | undefined;
  if (chatMsg) {
    if (typeof chatMsg.content === "string") {
      return { text: chatMsg.content, thinking };
    }
    if (Array.isArray(chatMsg.content)) {
      let text = "";
      for (const p of chatMsg.content as Array<
        Record<string, unknown>
      >) {
        if (p.type === "thinking" && typeof p.text === "string") {
          thinking.push({ text: p.text });
          continue;
        }
        if (p.type === "text" && typeof p.text === "string") {
          text += p.text;
        }
      }
      return { text, thinking };
    }
  }
  // Fallback: payload.text (older gateway versions)
  if (typeof chatPayload.text === "string") {
    return { text: chatPayload.text as string, thinking };
  }
  return { text: "", thinking };
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
  /** #222: Accumulated thinking blocks during streaming */
  private thinkingBlocks: Array<{ text: string }> = [];

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
    this.thinkingBlocks = [];
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
    const { text, thinking } = extractDeltaTextAndThinking(chatPayload);

    // #222: Accumulate thinking blocks
    if (thinking.length > 0) {
      this.thinkingBlocks = thinking;
    }

    if (!text) {
      // Show thinking indicator even without text content
      if (thinking.length > 0) {
        this.cb.onStreamingChange(true);
        this.cb.onAgentStatusChange({ phase: "thinking" });
      }
      return;
    }

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
    const snapSegments = buildStreamSegments(this.streamRefs);
    const snapThinking = this.thinkingBlocks.length > 0 ? [...this.thinkingBlocks] : undefined;
    const msg: DisplayMessage = {
      id: snapId,
      role: "assistant",
      content: snapContent,
      timestamp: new Date().toISOString(),
      toolCalls: snapTools,
      streaming: true,
      ...(snapSegments.length > 0 ? { segments: snapSegments } : {}),
      ...(snapThinking ? { thinking: snapThinking } : {}),
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
      // #225: lifecycle.end is ground truth that the run is over. Clear
      // runId so it doesn't leak when the chat "final" event never arrives
      // (subscription drop, gateway restart, error path, agent-only flows).
      // chat "final" still calls finalizeActiveStream() which is idempotent
      // for runId, so this is safe alongside the chat-event flow.
      // Only clear if the event's runId matches ours (or is absent), to
      // avoid clearing on stale events from a previous run.
      const eventRunId = resolveRunId(raw, data);
      if (!eventRunId || eventRunId === this.runId) {
        if (this.runId !== null) {
          this.runId = null;
          this.cb.onRunIdChange(null);
        }
      }
      const key = finalEventKey(eventRunId);
      if (key) this.finalizedEventKeys.add(key);
    } else if (
      stream === "done" ||
      stream === "end" ||
      stream === "finish"
    ) {
      // #225: same as lifecycle.end — these are explicit stream-termination
      // signals. Clear runId so subsequent chat.abort fallback logic uses
      // sessionKey-only (no stale runId).
      const eventRunId = resolveRunId(raw, data);
      if (!eventRunId || eventRunId === this.runId) {
        if (this.runId !== null) {
          this.runId = null;
          this.cb.onRunIdChange(null);
        }
      }
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
    const snapSegments = buildStreamSegments(this.streamRefs);
    const snapThinking = this.thinkingBlocks.length > 0 ? [...this.thinkingBlocks] : undefined;

    this.cb.onMessagesUpdate((prev) => {
      const idx = prev.findIndex((m) => m.id === snapId);
      const msg: DisplayMessage = {
        id: snapId,
        role: "assistant",
        content: snapContent,
        timestamp: new Date().toISOString(),
        toolCalls: snapTools,
        streaming: true,
        ...(snapSegments.length > 0 ? { segments: snapSegments } : {}),
        ...(snapThinking ? { thinking: snapThinking } : {}),
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
        const snapSegments = buildStreamSegments(this.streamRefs);
        this.cb.onMessagesUpdate((prev) => {
          const idx = prev.findIndex((m) => m.id === snapId);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = {
              ...next[idx],
              toolCalls: snapTools,
              ...(snapSegments.length > 0 ? { segments: snapSegments } : {}),
            };
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
    const finalSegments = buildStreamSegments(this.streamRefs);
    const finalThinking = this.thinkingBlocks.length > 0 ? [...this.thinkingBlocks] : undefined;

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
        const extras = {
          ...(finalAttachments ? { attachments: finalAttachments } : {}),
          ...(finalThinking ? { thinking: finalThinking } : {}),
          ...(finalSegments.length > 0 ? { segments: finalSegments } : {}),
        };
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = {
            ...next[idx],
            content: finalContent,
            toolCalls: finalToolCalls,
            streaming: false,
            ...extras,
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
            ...extras,
          },
        ];
      });

      this.cb.onStreamFinalized?.(finalId, finalContent, finalToolCalls, finalSegments, finalThinking);
    }

    resetAllStreamRefs(this.streamRefs);
    this.thinkingBlocks = [];
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
