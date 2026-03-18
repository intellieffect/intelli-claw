/**
 * Central chat state manager — owns per-session state and processes gateway
 * events so that multiple screens can subscribe without duplicating listeners.
 *
 * Migrated from apps/mobile/src/hooks/useChat.ts event handling logic.
 */
import type {
  GatewayClient,
  EventFrame,
  ChatMessage,
  ToolCall,
} from "@intelli-claw/shared";

// ─── Re-export types originally defined in useChat ───

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

// ─── Internal state per session ───

export interface ChatState {
  messages: DisplayMessage[];
  streaming: boolean;
  agentStatus: AgentStatus;
  loading: boolean;
  // internal
  streamBuf: {
    id: string;
    content: string;
    toolCalls: Map<string, ToolCall>;
  } | null;
  runId: string | null;
  historyLoaded: boolean;
  lastAccessedAt: number;
}

/** Messages matching this pattern are housekeeping noise — hide from the user. */
const HIDDEN_RE =
  /^(NO_REPLY|HEARTBEAT_OK|NO_)\s*$|^System:|^\[System|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now/;

const STREAMING_TIMEOUT_MS = 45_000;

function createDefaultState(): ChatState {
  return {
    messages: [],
    streaming: false,
    agentStatus: { phase: "idle" },
    loading: false,
    streamBuf: null,
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
          return !HIDDEN_RE.test(raw.trim());
        })
        .map((m, i) => {
          const blocks = m.content as any;
          let text =
            typeof m.content === "string"
              ? m.content
              : Array.isArray(blocks)
                ? blocks.map((b: any) => b?.text || "").join("")
                : String(m.content || "");
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
  // Private — event handling (migrated from useChat.ts lines 130-283)
  // ══════════════════════════════════════════════════════════════════════

  private handleEvent(frame: EventFrame): void {
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

    // ── assistant text delta ──
    if (
      stream === "assistant" &&
      (typeof data?.delta === "string" || typeof data?.text === "string")
    ) {
      const chunk =
        (data?.delta as string | undefined) ?? (data?.text as string);

      this.mutate(sessionKey, (s) => {
        s.streaming = true;
        s.agentStatus = { phase: "writing" };

        if (!s.streamBuf) {
          s.streamBuf = {
            id: `stream-${Date.now()}`,
            content: "",
            toolCalls: new Map(),
          };
        }
        s.streamBuf.content += chunk;

        const snap = s.streamBuf;
        const msg: DisplayMessage = {
          id: snap.id,
          role: "assistant",
          content: snap.content,
          timestamp: new Date().toISOString(),
          toolCalls: Array.from(snap.toolCalls.values()),
          streaming: true,
        };
        const idx = s.messages.findIndex((m) => m.id === snap.id);
        if (idx >= 0) {
          s.messages = [...s.messages];
          s.messages[idx] = msg;
        } else {
          s.messages = [...s.messages, msg];
        }
      });

      this.startStreamingTimeout(sessionKey);

      // ── tool start ──
    } else if (stream === "tool-start" && data) {
      const callId = String(data.toolCallId || data.callId || "");
      const name = String(data.name || data.tool || "");

      this.mutate(sessionKey, (s) => {
        s.agentStatus = { phase: "tool", toolName: name };

        if (!s.streamBuf) {
          s.streamBuf = {
            id: `stream-${Date.now()}`,
            content: "",
            toolCalls: new Map(),
          };
        }
        s.streamBuf.toolCalls.set(callId, {
          callId,
          name,
          status: "running",
        });

        const snap = s.streamBuf;
        const msg: DisplayMessage = {
          id: snap.id,
          role: "assistant",
          content: snap.content,
          timestamp: new Date().toISOString(),
          toolCalls: Array.from(snap.toolCalls.values()),
          streaming: true,
        };
        const idx = s.messages.findIndex((m) => m.id === snap.id);
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

        if (s.streamBuf) {
          const tc = s.streamBuf.toolCalls.get(callId);
          if (tc) {
            tc.status = "done";
            tc.result = result;
          }
          const snap = s.streamBuf;
          const idx = s.messages.findIndex((m) => m.id === snap.id);
          if (idx >= 0) {
            s.messages = [...s.messages];
            s.messages[idx] = {
              ...s.messages[idx],
              toolCalls: Array.from(snap.toolCalls.values()),
            };
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

      // ── lifecycle end ──
    } else if (stream === "lifecycle" && data?.phase === "end") {
      this.clearStreamingTimeout(sessionKey);

      this.mutate(sessionKey, (s) => {
        s.streaming = false;
        s.agentStatus = { phase: "idle" };
        s.runId = null;

        if (s.streamBuf) {
          const finalId = s.streamBuf.id;
          const finalContent = s.streamBuf.content;
          const finalTools = Array.from(s.streamBuf.toolCalls.values());
          if (HIDDEN_RE.test(finalContent.trim())) {
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
          s.streamBuf = null;
        }
      });

      // ── done/end/finish (alternative end signals) ──
    } else if (
      stream === "done" ||
      stream === "end" ||
      stream === "finish"
    ) {
      this.clearStreamingTimeout(sessionKey);

      this.mutate(sessionKey, (s) => {
        s.streaming = false;
        s.agentStatus = { phase: "idle" };
        s.runId = null;

        if (s.streamBuf) {
          const finalId = s.streamBuf.id;
          const finalContent =
            (data?.text as string) || s.streamBuf.content;
          const finalTools = Array.from(s.streamBuf.toolCalls.values());
          if (HIDDEN_RE.test(finalContent.trim())) {
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
          s.streamBuf = null;
        }
      });

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

        if (s.streamBuf) {
          const errId = s.streamBuf.id;
          s.messages = s.messages.map((m) =>
            m.id === errId
              ? {
                  ...m,
                  content: m.content + `\n\n**Error:** ${errMsg}`,
                  streaming: false,
                }
              : m,
          );
          s.streamBuf = null;
        }
      });
    }
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
          if (s.streamBuf) {
            const finalId = s.streamBuf.id;
            s.messages = s.messages.map((m) =>
              m.id === finalId ? { ...m, streaming: false } : m,
            );
            s.streamBuf = null;
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
