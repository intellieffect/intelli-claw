/**
 * Central chat state manager — owns per-session state and processes gateway
 * events so that multiple screens can subscribe without duplicating listeners.
 *
 * Uses shared streaming utilities from @intelli-claw/shared for consistent
 * behavior between web and mobile (3-buffer architecture, hidden message
 * filtering, internal prompt suppression).
 */
import type {
  GatewayClient,
  EventFrame,
  ChatMessage,
  ToolCall,
  DisplayMessage,
  AgentStatus,
  ToolStreamEntry,
  ToolStreamRefs,
} from "@intelli-claw/shared";

import {
  isHiddenMessage,
  stripInboundMeta,
  stripTrailingControlTokens,
  INTERNAL_PROMPT_RE,
  resetAllStreamRefs,
  commitChatStreamToSegment,
  hasActiveStream,
  buildStreamContent,
  buildStreamToolCalls,
} from "@intelli-claw/shared";

// Re-export shared types for mobile consumers
export type { DisplayMessage, AgentStatus } from "@intelli-claw/shared";

// ─── 3-buffer streaming state (plain objects compatible with shared ToolStreamRefs) ───

function createStreamRefs(): ToolStreamRefs {
  return {
    chatStream: { current: null },
    chatStreamId: { current: null },
    chatStreamStartedAt: { current: null },
    chatStreamSegments: { current: [] },
    toolStreamById: { current: new Map() },
    toolStreamOrder: { current: [] },
  };
}

// ─── Internal state per session ───

export interface ChatState {
  messages: DisplayMessage[];
  streaming: boolean;
  agentStatus: AgentStatus;
  loading: boolean;
  // internal — 3-buffer streaming refs (shared ToolStreamRefs)
  streamRefs: ToolStreamRefs;
  runId: string | null;
  historyLoaded: boolean;
  lastAccessedAt: number;
}

const STREAMING_TIMEOUT_MS = 45_000;

function createDefaultState(): ChatState {
  return {
    messages: [],
    streaming: false,
    agentStatus: { phase: "idle" },
    loading: false,
    streamRefs: createStreamRefs(),
    runId: null,
    historyLoaded: false,
    lastAccessedAt: Date.now(),
  };
}

// ─── ChatStateManager ───

export class ChatStateManager {
  private states = new Map<string, ChatState>();
  private subscribers = new Map<string, Set<() => void>>();
  private eventUnsub: (() => void) | null = null;
  private streamingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private streamIdCounter = 0;

  // ── GatewayClient binding ──

  bind(client: GatewayClient): void {
    this.unbind();
    this.eventUnsub = client.onEvent((frame: EventFrame) => {
      this.handleEvent(frame);
    });
  }

  unbind(): void {
    if (this.eventUnsub) {
      this.eventUnsub();
      this.eventUnsub = null;
    }
    // Clear all streaming timers
    for (const timer of this.streamingTimers.values()) {
      clearTimeout(timer);
    }
    this.streamingTimers.clear();
  }

  // ── State access ──

  getState(sessionKey: string): ChatState {
    let s = this.states.get(sessionKey);
    if (!s) {
      s = createDefaultState();
      this.states.set(sessionKey, s);
    }
    s.lastAccessedAt = Date.now();
    return s;
  }

  // ── Subscription (for useSyncExternalStore) ──

  subscribe(sessionKey: string, listener: () => void): () => void {
    let subs = this.subscribers.get(sessionKey);
    if (!subs) {
      subs = new Set();
      this.subscribers.set(sessionKey, subs);
    }
    subs.add(listener);
    return () => {
      subs!.delete(listener);
      if (subs!.size === 0) {
        this.subscribers.delete(sessionKey);
      }
    };
  }

  // ── History loading (lazy, one-shot per session) ──

  async loadHistory(client: GatewayClient, sessionKey: string): Promise<void> {
    const state = this.getState(sessionKey);
    if (state.historyLoaded) return;
    state.historyLoaded = true;

    this.mutate(sessionKey, (s) => {
      s.loading = true;
    });

    try {
      const res = await client.request<{ messages: ChatMessage[] }>(
        "chat.history",
        { sessionKey, limit: 100 },
      );
      const histMsgs: DisplayMessage[] = (res?.messages || [])
        .filter((m) => {
          if (m.role !== "user" && m.role !== "assistant") return false;
          const blocks = m.content as any;
          const raw =
            typeof m.content === "string"
              ? m.content
              : Array.isArray(blocks)
                ? blocks.map((b: any) => b?.text || "").join("")
                : String(m.content || "");
          // Use shared isHiddenMessage for consistent filtering
          if (isHiddenMessage(m.role, raw)) return false;
          // Filter internal orchestration prompts (#255)
          if (m.role === "user" && INTERNAL_PROMPT_RE.test(raw.trim()))
            return false;
          return true;
        })
        .map((m, i) => {
          const blocks = m.content as any;
          let text =
            typeof m.content === "string"
              ? m.content
              : Array.isArray(blocks)
                ? blocks.map((b: any) => b?.text || "").join("")
                : String(m.content || "");
          text = stripInboundMeta(text);
          text = stripTrailingControlTokens(text);
          text = text.replace(/\n{3,}/g, "\n\n").trim();
          return {
            id: `hist-${i}`,
            role: m.role as "user" | "assistant",
            content: text,
            timestamp: m.timestamp || new Date().toISOString(),
            toolCalls: m.toolCalls || [],
          };
        });

      this.mutate(sessionKey, (s) => {
        s.messages = histMsgs;
        s.loading = false;
      });
    } catch (err) {
      console.error("[ChatStateManager] history error:", err);
      this.mutate(sessionKey, (s) => {
        s.loading = false;
      });
    }
  }

  // ── Memory management ──

  /**
   * Evict sessions that haven't been accessed in the last N ms and have no
   * active subscribers.  Called externally (e.g. on a timer or navigation).
   */
  trimInactive(maxAgeMs = 5 * 60_000): void {
    const now = Date.now();
    for (const [key, state] of this.states) {
      const subs = this.subscribers.get(key);
      if ((!subs || subs.size === 0) && now - state.lastAccessedAt > maxAgeMs) {
        this.states.delete(key);
        this.clearStreamingTimeout(key);
      }
    }
  }

  /**
   * Append a user message to the session.  Called from useChat.sendMessage
   * so the optimistic message shows immediately.
   */
  appendUserMessage(sessionKey: string, msg: DisplayMessage): void {
    this.mutate(sessionKey, (s) => {
      s.messages = [...s.messages, msg];
    });
  }

  /**
   * Return the current runId for a session (used by abort).
   */
  getRunId(sessionKey: string): string | null {
    return this.getState(sessionKey).runId;
  }

  /**
   * Eagerly clear the runId for a session, returning the previous value.
   * Used by abort to capture the runId before clearing it, matching the
   * web client's eager-clear pattern (#225).
   */
  clearRunId(sessionKey: string): string | null {
    const s = this.getState(sessionKey);
    const prev = s.runId;
    if (prev !== null) {
      this.mutate(sessionKey, (state) => {
        state.runId = null;
      });
    }
    return prev;
  }

  // ══════════════════════════════════════════════════════════════════════
  // Private — event handling
  // ══════════════════════════════════════════════════════════════════════

  private handleEvent(frame: EventFrame): void {
    // ── Chat events (text streaming) ──
    if (frame.event === "chat") {
      const chatPayload = frame.payload as Record<string, unknown>;
      const chatState = chatPayload.state as string | undefined;
      const chatSessionKey = chatPayload.sessionKey as string | undefined;
      if (!chatSessionKey) return;

      if (chatState === "delta") {
        const text = chatPayload.text as string | undefined;
        if (!text) return;

        this.mutate(chatSessionKey, (s) => {
          s.streaming = true;
          s.agentStatus = { phase: "writing" };

          if (!s.streamRefs.chatStreamId.current) {
            s.streamRefs.chatStreamId.current = `stream-${Date.now()}-${++this.streamIdCounter}`;
            s.streamRefs.chatStreamStartedAt.current = Date.now();
          }
          s.streamRefs.chatStream.current =
            (s.streamRefs.chatStream.current || "") + text;

          const snapId = s.streamRefs.chatStreamId.current;
          const snapContent = buildStreamContent(s.streamRefs);
          const snapTools = buildStreamToolCalls(s.streamRefs);
          const msg: DisplayMessage = {
            id: snapId,
            role: "assistant",
            content: snapContent,
            timestamp: new Date().toISOString(),
            toolCalls: snapTools,
            streaming: true,
          };
          const idx = s.messages.findIndex((m) => m.id === snapId);
          if (idx >= 0) {
            s.messages = [...s.messages];
            s.messages[idx] = msg;
          } else {
            s.messages = [...s.messages, msg];
          }
        });

        this.startStreamingTimeout(chatSessionKey);
      } else if (chatState === "final") {
        this.finalizeStream(chatSessionKey);
      } else if (chatState === "error") {
        this.clearStreamingTimeout(chatSessionKey);
        const errMsg = String(
          chatPayload.errorMessage || chatPayload.error || "Chat error",
        );

        this.mutate(chatSessionKey, (s) => {
          s.streaming = false;
          s.agentStatus = { phase: "idle" };
          s.runId = null;

          if (hasActiveStream(s.streamRefs)) {
            const errId = s.streamRefs.chatStreamId.current;
            if (errId) {
              s.messages = s.messages.map((m) =>
                m.id === errId
                  ? {
                      ...m,
                      content: m.content + `\n\n**Error:** ${errMsg}`,
                      streaming: false,
                    }
                  : m,
              );
            }
            resetAllStreamRefs(s.streamRefs);
          }
        });
      } else if (chatState === "aborted") {
        this.finalizeStream(chatSessionKey);
      }
      return;
    }

    // ── Agent events (tool calls, lifecycle) ──
    if (frame.event !== "agent") return;

    const raw = frame.payload as Record<string, unknown>;
    const stream = raw.stream as string | undefined;
    const data = raw.data as Record<string, unknown> | undefined;

    // Determine which session this event belongs to (#48)
    const evtSessionKey = (raw.sessionKey ?? data?.sessionKey) as
      | string
      | undefined;
    if (!evtSessionKey) return; // Cannot route without a session key

    const sessionKey = evtSessionKey;

    // #255: Agent events do NOT handle stream === "assistant" text.
    // Following OpenClaw architecture: assistant text is handled exclusively
    // by the chat event handler above. The gateway sends both agent + chat
    // events for assistant text; processing both causes content duplication.

    // ── tool start ──
    if (stream === "tool-start" && data) {
      const callId = String(data.toolCallId || data.callId || "");
      const name = String(data.name || data.tool || "");
      const args = data.args as string | undefined;

      this.mutate(sessionKey, (s) => {
        s.agentStatus = { phase: "tool", toolName: name };

        // Commit current text to segments before tool starts (3-buffer pattern)
        commitChatStreamToSegment(s.streamRefs);

        if (!s.streamRefs.chatStreamId.current) {
          s.streamRefs.chatStreamId.current = `stream-${Date.now()}-${++this.streamIdCounter}`;
          s.streamRefs.chatStreamStartedAt.current = Date.now();
        }

        const entry: ToolStreamEntry = {
          toolCallId: callId,
          name,
          args,
          startedAt: Date.now(),
          updatedAt: Date.now(),
        };
        s.streamRefs.toolStreamById.current.set(callId, entry);
        s.streamRefs.toolStreamOrder.current.push(callId);

        const snapId = s.streamRefs.chatStreamId.current;
        const snapContent = buildStreamContent(s.streamRefs);
        const snapTools = buildStreamToolCalls(s.streamRefs);
        const msg: DisplayMessage = {
          id: snapId,
          role: "assistant",
          content: snapContent,
          timestamp: new Date().toISOString(),
          toolCalls: snapTools,
          streaming: true,
        };
        const idx = s.messages.findIndex((m) => m.id === snapId);
        if (idx >= 0) {
          s.messages = [...s.messages];
          s.messages[idx] = msg;
        } else {
          s.messages = [...s.messages, msg];
        }
      });

      // ── tool end ──
    } else if (stream === "tool-end" && data) {
      const callId = String(data.toolCallId || data.callId || "");
      const result = data.result as string | undefined;

      this.mutate(sessionKey, (s) => {
        s.agentStatus = { phase: "thinking" };

        const entry = s.streamRefs.toolStreamById.current.get(callId);
        if (entry) {
          entry.output = result;
          entry.updatedAt = Date.now();
        }

        if (hasActiveStream(s.streamRefs)) {
          const snapId = s.streamRefs.chatStreamId.current;
          if (snapId) {
            const snapTools = buildStreamToolCalls(s.streamRefs);
            const idx = s.messages.findIndex((m) => m.id === snapId);
            if (idx >= 0) {
              s.messages = [...s.messages];
              s.messages[idx] = {
                ...s.messages[idx],
                toolCalls: snapTools,
              };
            }
          }
        }
      });

      // ── lifecycle start ──
    } else if (stream === "lifecycle" && data?.phase === "start") {
      this.mutate(sessionKey, (s) => {
        s.streaming = true;
        s.runId = (raw.runId as string) ?? null;
        s.agentStatus = { phase: "thinking" };
      });
      this.startStreamingTimeout(sessionKey);

      // ── lifecycle end — only reset status, do NOT finalize stream ──
      // Stream finalization is handled by chat "final" event.
    } else if (stream === "lifecycle" && data?.phase === "end") {
      // No-op for stream finalization — chat "final" handles it.
      // Only update lifecycle tracking.
      this.mutate(sessionKey, (s) => {
        s.runId = null;
      });

      // ── done/end/finish (legacy alternative end signals) ──
    } else if (
      stream === "done" ||
      stream === "end" ||
      stream === "finish"
    ) {
      // Legacy signals — finalize if no chat "final" was received
      this.finalizeStream(sessionKey, data?.text as string | undefined);

      // ── error ──
    } else if (stream === "error") {
      this.clearStreamingTimeout(sessionKey);
      const errMsg = String(
        data?.message || data?.error || "Unknown error",
      );

      this.mutate(sessionKey, (s) => {
        s.streaming = false;
        s.agentStatus = { phase: "idle" };
        s.runId = null;

        if (hasActiveStream(s.streamRefs)) {
          const errId = s.streamRefs.chatStreamId.current;
          if (errId) {
            s.messages = s.messages.map((m) =>
              m.id === errId
                ? {
                    ...m,
                    content: m.content + `\n\n**Error:** ${errMsg}`,
                    streaming: false,
                  }
                : m,
            );
          }
          resetAllStreamRefs(s.streamRefs);
        }
      });
    }
  }

  /**
   * Finalize the active stream — build final content, apply hidden message
   * filtering, and reset streaming state.
   */
  private finalizeStream(
    sessionKey: string,
    overrideText?: string,
  ): void {
    this.clearStreamingTimeout(sessionKey);

    this.mutate(sessionKey, (s) => {
      s.streaming = false;
      s.agentStatus = { phase: "idle" };
      s.runId = null;

      if (hasActiveStream(s.streamRefs)) {
        const finalId = s.streamRefs.chatStreamId.current;
        let finalContent = overrideText || buildStreamContent(s.streamRefs);
        finalContent = stripTrailingControlTokens(finalContent);
        const finalTools = buildStreamToolCalls(s.streamRefs);

        if (finalId) {
          if (isHiddenMessage("assistant", finalContent)) {
            s.messages = s.messages.filter((m) => m.id !== finalId);
          } else {
            s.messages = s.messages.map((m) =>
              m.id === finalId
                ? {
                    ...m,
                    content: finalContent,
                    toolCalls: finalTools,
                    streaming: false,
                  }
                : m,
            );
          }
        }
        resetAllStreamRefs(s.streamRefs);
      }
    });
  }

  // ── Helpers ──

  /**
   * Mutate a session's state and notify subscribers.
   * The callback receives the current ChatState and may modify it in-place.
   * After the callback, we replace the state reference so that
   * useSyncExternalStore detects the change via identity comparison.
   */
  private mutate(
    sessionKey: string,
    fn: (state: ChatState) => void,
  ): void {
    const prev = this.getState(sessionKey);
    fn(prev);
    // Replace the reference so getSnapshot returns a new object
    const next = { ...prev };
    this.states.set(sessionKey, next);
    this.notify(sessionKey);
  }

  private notify(sessionKey: string): void {
    const subs = this.subscribers.get(sessionKey);
    if (subs) {
      for (const cb of subs) cb();
    }
  }

  private startStreamingTimeout(sessionKey: string): void {
    this.clearStreamingTimeout(sessionKey);
    this.streamingTimers.set(
      sessionKey,
      setTimeout(() => {
        console.warn(
          "[ChatStateManager] streaming timeout — forcing idle for",
          sessionKey,
        );
        this.mutate(sessionKey, (s) => {
          s.streaming = false;
          s.agentStatus = { phase: "idle" };
          s.runId = null;
          if (hasActiveStream(s.streamRefs)) {
            const finalId = s.streamRefs.chatStreamId.current;
            if (finalId) {
              s.messages = s.messages.map((m) =>
                m.id === finalId ? { ...m, streaming: false } : m,
              );
            }
            resetAllStreamRefs(s.streamRefs);
          }
        });
        this.streamingTimers.delete(sessionKey);
      }, STREAMING_TIMEOUT_MS),
    );
  }

  private clearStreamingTimeout(sessionKey: string): void {
    const timer = this.streamingTimers.get(sessionKey);
    if (timer) {
      clearTimeout(timer);
      this.streamingTimers.delete(sessionKey);
    }
  }
}
