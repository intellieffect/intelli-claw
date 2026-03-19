/**
 * Central chat state manager — owns per-session state and processes gateway
 * events so that multiple screens can subscribe without duplicating listeners.
 *
 * Delegates all event processing to the shared ChatStreamProcessor.
 * This class only manages multi-session orchestration, subscriptions
 * (useSyncExternalStore), and history loading.
 */
import type {
  GatewayClient,
  EventFrame,
  ChatMessage,
  DisplayMessage,
  AgentStatus,
} from "@intelli-claw/shared";

import {
  ChatStreamProcessor,
  isHiddenMessage,
  stripInboundMeta,
  stripTrailingControlTokens,
  INTERNAL_PROMPT_RE,
} from "@intelli-claw/shared";

// Re-export shared types for mobile consumers
export type { DisplayMessage, AgentStatus } from "@intelli-claw/shared";

// ─── Internal state per session ───

export interface ChatState {
  messages: DisplayMessage[];
  streaming: boolean;
  agentStatus: AgentStatus;
  loading: boolean;
  runId: string | null;
  historyLoaded: boolean;
  lastAccessedAt: number;
}

function createDefaultState(): ChatState {
  return {
    messages: [],
    streaming: false,
    agentStatus: { phase: "idle" },
    loading: false,
    runId: null,
    historyLoaded: false,
    lastAccessedAt: Date.now(),
  };
}

// ─── ChatStateManager ───

export class ChatStateManager {
  private states = new Map<string, ChatState>();
  private processors = new Map<string, ChatStreamProcessor>();
  private subscribers = new Map<string, Set<() => void>>();
  private eventUnsub: (() => void) | null = null;
  private boundClient: GatewayClient | null = null;

  // ── GatewayClient binding ──

  bind(client: GatewayClient): void {
    this.unbind();
    this.boundClient = client;
    this.eventUnsub = client.onEvent((frame: EventFrame) => {
      this.routeEvent(frame);
    });
  }

  unbind(): void {
    this.boundClient = null;
    if (this.eventUnsub) {
      this.eventUnsub();
      this.eventUnsub = null;
    }
    // Dispose all processors
    for (const proc of this.processors.values()) {
      proc.dispose();
    }
    this.processors.clear();
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
          if (isHiddenMessage(m.role, raw)) return false;
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

  trimInactive(maxAgeMs = 5 * 60_000): void {
    const now = Date.now();
    for (const [key, state] of this.states) {
      const subs = this.subscribers.get(key);
      if ((!subs || subs.size === 0) && now - state.lastAccessedAt > maxAgeMs) {
        this.states.delete(key);
        const proc = this.processors.get(key);
        if (proc) {
          proc.dispose();
          this.processors.delete(key);
        }
      }
    }
  }

  appendUserMessage(sessionKey: string, msg: DisplayMessage): void {
    this.mutate(sessionKey, (s) => {
      s.messages = [...s.messages, msg];
    });
  }

  getRunId(sessionKey: string): string | null {
    const proc = this.processors.get(sessionKey);
    return proc ? proc.getRunId() : this.getState(sessionKey).runId;
  }

  clearRunId(sessionKey: string): string | null {
    const proc = this.processors.get(sessionKey);
    if (proc) {
      const result = proc.abort();
      return result.previousRunId;
    }
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
  // Private — event routing and processor management
  // ══════════════════════════════════════════════════════════════════════

  /**
   * Route an event to the correct session's processor.
   * Extracts sessionKey from the event payload.
   */
  private routeEvent(frame: EventFrame): void {
    const sessionKey = this.extractSessionKey(frame);
    if (!sessionKey) return;

    const processor = this.getOrCreateProcessor(sessionKey);
    processor.processEvent(frame);
  }

  private extractSessionKey(frame: EventFrame): string | undefined {
    const payload = frame.payload as Record<string, unknown>;

    if (frame.event === "chat") {
      return payload.sessionKey as string | undefined;
    }

    if (frame.event === "agent") {
      const data = payload.data as Record<string, unknown> | undefined;
      return (payload.sessionKey ?? data?.sessionKey) as string | undefined;
    }

    return undefined;
  }

  private getOrCreateProcessor(sessionKey: string): ChatStreamProcessor {
    let proc = this.processors.get(sessionKey);
    if (!proc) {
      proc = new ChatStreamProcessor({
        sessionKey,
        callbacks: {
          onMessagesUpdate: (updater) => {
            this.mutate(sessionKey, (s) => {
              s.messages = updater(s.messages);
            });
          },
          onStreamingChange: (streaming) => {
            this.mutate(sessionKey, (s) => {
              s.streaming = streaming;
            });
          },
          onAgentStatusChange: (status) => {
            this.mutate(sessionKey, (s) => {
              s.agentStatus = status;
            });
          },
          onRunIdChange: (runId) => {
            this.mutate(sessionKey, (s) => {
              s.runId = runId;
            });
          },
          requestHistoryReload: () => {
            this.reloadHistory(sessionKey);
          },
        },
      });
      this.processors.set(sessionKey, proc);
    }
    return proc;
  }

  private reloadHistory(sessionKey: string): void {
    if (!this.boundClient) return;
    const state = this.getState(sessionKey);
    state.historyLoaded = false;
    this.loadHistory(this.boundClient, sessionKey);
  }

  // ── Helpers ──

  private mutate(
    sessionKey: string,
    fn: (state: ChatState) => void,
  ): void {
    const prev = this.getState(sessionKey);
    fn(prev);
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
}
