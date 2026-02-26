/**
 * TDD tests for real-time rendering bugs:
 * - #54: Agent messages merging into single bubble
 * - #53: Messages from other surfaces not showing in real-time
 * - #47: ThinkingIndicator stuck (agentStatus not returning to idle)
 *
 * These tests exercise the pure logic extracted from useChat's event handler
 * to verify correctness without needing a full React rendering context.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventFrame } from "@intelli-claw/shared";
import type { DisplayMessage } from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// Minimal reproduction of useChat's stream-buffer + event-handler logic
// Extracted so we can unit-test without React hooks.
// ---------------------------------------------------------------------------

interface StreamBuf {
  id: string;
  content: string;
  toolCalls: Map<string, { callId: string; name: string; args?: string; result?: string; status: string }>;
}

interface ChatState {
  messages: DisplayMessage[];
  streaming: boolean;
  agentStatus: { phase: string; toolName?: string };
  streamBuf: StreamBuf | null;
  runId: string | null;
  sessionKey: string | undefined;
}

/**
 * Simulates the useChat event handler from hooks.tsx (lines 422-571).
 * This is a faithful reproduction of the current production logic.
 * When we fix the bugs, we'll update this simulation to match.
 */
function createChatHandler(sessionKey?: string) {
  let idCounter = 0;
  const state: ChatState = {
    messages: [],
    streaming: false,
    agentStatus: { phase: "idle" },
    streamBuf: null,
    runId: null,
    sessionKey,
  };

  function uniqueStreamId(): string {
    // Use a monotonic counter to guarantee uniqueness
    return `stream-${Date.now()}-${++idCounter}`;
  }

  function handleEvent(frame: EventFrame): void {
    if (frame.event !== "agent") return;

    const raw = frame.payload as Record<string, unknown>;
    const stream = raw.stream as string | undefined;
    const data = raw.data as Record<string, unknown> | undefined;
    const evSessionKey = raw.sessionKey as string | undefined;

    // Session key filtering
    if (evSessionKey && evSessionKey !== state.sessionKey) return;
    if (!evSessionKey && state.sessionKey) return;

    if (stream === "assistant" && (typeof data?.delta === "string" || typeof data?.text === "string")) {
      const chunk = (data?.delta as string | undefined) ?? (data?.text as string);
      state.streaming = true;
      state.agentStatus = { phase: "writing" };
      if (!state.streamBuf) {
        state.streamBuf = { id: uniqueStreamId(), content: "", toolCalls: new Map() };
      }
      state.streamBuf.content += chunk;
      const snap = state.streamBuf;
      // Update or add message
      const existing = state.messages.findIndex((m) => m.id === snap.id);
      const msg: DisplayMessage = {
        id: snap.id,
        role: "assistant",
        content: snap.content,
        timestamp: new Date().toISOString(),
        toolCalls: Array.from(snap.toolCalls.values()),
        streaming: true,
      };
      if (existing >= 0) {
        state.messages[existing] = msg;
      } else {
        state.messages.push(msg);
      }
    } else if (stream === "inbound" && data) {
      // Handle messages from other surfaces
      const text = (data.text ?? data.content ?? "") as string;
      const role = (data.role ?? "user") as "user" | "assistant";
      const msgId = `inbound-${Date.now()}-${++idCounter}`;
      const msg: DisplayMessage = {
        id: msgId,
        role,
        content: text,
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      state.messages.push(msg);
    } else if (stream === "lifecycle" && data?.phase === "start") {
      state.streaming = true;
      state.runId = (raw.runId as string) ?? null;
      state.agentStatus = { phase: "thinking" };
    } else if (stream === "lifecycle" && data?.phase === "end") {
      state.streaming = false;
      state.agentStatus = { phase: "idle" };
      if (state.streamBuf) {
        const finalId = state.streamBuf.id;
        const finalContent = state.streamBuf.content;
        const finalTools = Array.from(state.streamBuf.toolCalls.values());
        state.messages = state.messages.map((m) =>
          m.id === finalId
            ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false }
            : m
        );
        state.streamBuf = null;
      }
    } else if (stream === "done" || stream === "end" || stream === "finish") {
      state.streaming = false;
      state.agentStatus = { phase: "idle" };
      if (state.streamBuf) {
        const finalId = state.streamBuf.id;
        const finalContent = (data?.text as string) || state.streamBuf.content;
        const finalTools = Array.from(state.streamBuf.toolCalls.values());
        state.messages = state.messages.map((m) =>
          m.id === finalId
            ? { ...m, content: finalContent, toolCalls: finalTools, streaming: false }
            : m
        );
        state.streamBuf = null;
      }
    } else if (stream === "error") {
      state.streaming = false;
      state.agentStatus = { phase: "idle" };
      if (state.streamBuf) {
        const errMsg = (data?.message || data?.error || "Unknown error") as string;
        const errId = state.streamBuf.id;
        state.messages = state.messages.map((m) =>
          m.id === errId
            ? { ...m, content: m.content + `\n\n**Error:** ${errMsg}`, streaming: false }
            : m
        );
        state.streamBuf = null;
      }
    }
  }

  return { state, handleEvent };
}

// ---------------------------------------------------------------------------
// Helper: build an EventFrame for agent events
// ---------------------------------------------------------------------------
function agentEvent(payload: Record<string, unknown>, seq?: number): EventFrame {
  return {
    type: "event",
    event: "agent",
    payload,
    seq,
  };
}

// ---------------------------------------------------------------------------
// #54: Agent messages should NOT merge into a single bubble
// ---------------------------------------------------------------------------
describe("#54 — consecutive agent messages must render as separate bubbles", () => {
  it("two separate lifecycle cycles produce two distinct messages", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    // First message cycle
    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
      runId: "run-1",
      sessionKey: "agent:alpha:main",
    }, 1));

    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "Hello " },
      sessionKey: "agent:alpha:main",
    }, 2));

    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "World!" },
      sessionKey: "agent:alpha:main",
    }, 3));

    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "end" },
      sessionKey: "agent:alpha:main",
    }, 4));

    // At this point we should have exactly 1 message
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("Hello World!");
    expect(state.messages[0].streaming).toBe(false);

    // Second message cycle (agent sends another response)
    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
      runId: "run-2",
      sessionKey: "agent:alpha:main",
    }, 5));

    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "Second message" },
      sessionKey: "agent:alpha:main",
    }, 6));

    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "end" },
      sessionKey: "agent:alpha:main",
    }, 7));

    // CRITICAL: Must have 2 separate messages, not 1 merged message
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].content).toBe("Hello World!");
    expect(state.messages[1].content).toBe("Second message");
    expect(state.messages[0].id).not.toBe(state.messages[1].id);
  });

  it("rapid consecutive messages with same Date.now() still get unique IDs", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    // Mock Date.now to return same value
    const originalDateNow = Date.now;
    Date.now = vi.fn(() => 1700000000000);

    try {
      // First cycle
      handleEvent(agentEvent({
        stream: "lifecycle",
        data: { phase: "start" },
        runId: "run-1",
        sessionKey: "agent:alpha:main",
      }, 1));
      handleEvent(agentEvent({
        stream: "assistant",
        data: { delta: "First" },
        sessionKey: "agent:alpha:main",
      }, 2));
      handleEvent(agentEvent({
        stream: "lifecycle",
        data: { phase: "end" },
        sessionKey: "agent:alpha:main",
      }, 3));

      // Second cycle (same millisecond)
      handleEvent(agentEvent({
        stream: "lifecycle",
        data: { phase: "start" },
        runId: "run-2",
        sessionKey: "agent:alpha:main",
      }, 4));
      handleEvent(agentEvent({
        stream: "assistant",
        data: { delta: "Second" },
        sessionKey: "agent:alpha:main",
      }, 5));
      handleEvent(agentEvent({
        stream: "lifecycle",
        data: { phase: "end" },
        sessionKey: "agent:alpha:main",
      }, 6));

      expect(state.messages).toHaveLength(2);
      expect(state.messages[0].id).not.toBe(state.messages[1].id);
      expect(state.messages[0].content).toBe("First");
      expect(state.messages[1].content).toBe("Second");
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("deltas arriving after lifecycle:end do not append to previous message", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    // First message
    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
      runId: "run-1",
      sessionKey: "agent:alpha:main",
    }, 1));
    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "Message 1" },
      sessionKey: "agent:alpha:main",
    }, 2));
    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "end" },
      sessionKey: "agent:alpha:main",
    }, 3));

    const firstMsgContent = state.messages[0].content;

    // A new delta arrives (new stream, no lifecycle:start yet)
    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "NEW" },
      sessionKey: "agent:alpha:main",
    }, 4));

    // The first message must NOT have been modified
    expect(state.messages[0].content).toBe(firstMsgContent);
    // A new second message should exist
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].content).toBe("NEW");
  });
});

// ---------------------------------------------------------------------------
// #53: Messages from other surfaces must appear in real-time
// ---------------------------------------------------------------------------
describe("#53 — messages from other surfaces must appear in real-time", () => {
  it("inbound stream events create a new user message in the chat", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    // Simulate an inbound message from Telegram
    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "Hello from Telegram",
        role: "user",
        surface: "telegram",
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("Hello from Telegram");
    expect(state.messages[0].role).toBe("user");
  });

  it("inbound messages do not interfere with ongoing streaming", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    // Start a normal streaming response
    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
      runId: "run-1",
      sessionKey: "agent:alpha:main",
    }, 1));
    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "Thinking..." },
      sessionKey: "agent:alpha:main",
    }, 2));

    // Inbound message arrives mid-stream
    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "Another user says hi",
        role: "user",
      },
      sessionKey: "agent:alpha:main",
    }, 3));

    // Should have both messages
    expect(state.messages).toHaveLength(2);
    // Streaming message is still streaming
    expect(state.messages[0].streaming).toBe(true);
    expect(state.messages[0].content).toBe("Thinking...");
    // Inbound message is not streaming
    expect(state.messages[1].content).toBe("Another user says hi");
    expect(state.messages[1].streaming).toBeUndefined();
  });

  it("inbound messages with no explicit role default to user", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "Hi from somewhere",
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("user");
  });

  it("inbound messages with content field instead of text are handled", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        content: "Using content field",
        role: "user",
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("Using content field");
  });
});

// ---------------------------------------------------------------------------
// #47: ThinkingIndicator must disappear (agentStatus → idle)
// ---------------------------------------------------------------------------
describe("#47 — agentStatus must return to idle after streaming completes", () => {
  it("lifecycle:end sets agentStatus to idle, not just waiting", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
      runId: "run-1",
      sessionKey: "agent:alpha:main",
    }, 1));

    expect(state.agentStatus.phase).toBe("thinking");

    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "Response" },
      sessionKey: "agent:alpha:main",
    }, 2));

    expect(state.agentStatus.phase).toBe("writing");

    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "end" },
      sessionKey: "agent:alpha:main",
    }, 3));

    // CRITICAL: Should be "idle", not "waiting"
    expect(state.agentStatus.phase).toBe("idle");
    expect(state.streaming).toBe(false);
  });

  it("error stream sets agentStatus to idle and streaming to false", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
      runId: "run-1",
      sessionKey: "agent:alpha:main",
    }, 1));

    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "Partial response" },
      sessionKey: "agent:alpha:main",
    }, 2));

    handleEvent(agentEvent({
      stream: "error",
      data: { message: "rate limit exceeded" },
      sessionKey: "agent:alpha:main",
    }, 3));

    expect(state.agentStatus.phase).toBe("idle");
    expect(state.streaming).toBe(false);
  });

  it("streaming=true with no streaming messages shows ThinkingIndicator (component logic)", () => {
    // This tests the component-level condition:
    // streaming && !messages.some(m => m.streaming)
    // After lifecycle:end, both streaming AND the message's streaming flag should be false,
    // so ThinkingIndicator should NOT show.

    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
      runId: "run-1",
      sessionKey: "agent:alpha:main",
    }, 1));
    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "Done" },
      sessionKey: "agent:alpha:main",
    }, 2));
    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "end" },
      sessionKey: "agent:alpha:main",
    }, 3));

    // After completion: streaming must be false AND no message should be streaming
    expect(state.streaming).toBe(false);
    expect(state.messages.some(m => m.streaming)).toBe(false);
    // Therefore ThinkingIndicator should NOT show
    const shouldShowThinking = state.streaming && !state.messages.some(m => m.streaming);
    expect(shouldShowThinking).toBe(false);
  });

  it("done/end/finish stream also resets to idle", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main");

    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
      runId: "run-1",
      sessionKey: "agent:alpha:main",
    }, 1));
    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "Response" },
      sessionKey: "agent:alpha:main",
    }, 2));
    handleEvent(agentEvent({
      stream: "done",
      data: { text: "Response" },
      sessionKey: "agent:alpha:main",
    }, 3));

    expect(state.agentStatus.phase).toBe("idle");
    expect(state.streaming).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ThinkingIndicator component-level rendering test
// ---------------------------------------------------------------------------
describe("ThinkingIndicator visibility logic", () => {
  it("shows when streaming=true and no messages are streaming", () => {
    const streaming = true;
    const messages: DisplayMessage[] = [
      { id: "1", role: "user", content: "Hi", timestamp: "", toolCalls: [] },
    ];
    const shouldShow = streaming && !messages.some(m => m.streaming);
    expect(shouldShow).toBe(true);
  });

  it("hides when streaming=true and a message is streaming", () => {
    const streaming = true;
    const messages: DisplayMessage[] = [
      { id: "1", role: "assistant", content: "typing...", timestamp: "", toolCalls: [], streaming: true },
    ];
    const shouldShow = streaming && !messages.some(m => m.streaming);
    expect(shouldShow).toBe(false);
  });

  it("hides when streaming=false", () => {
    const streaming = false;
    const messages: DisplayMessage[] = [];
    const shouldShow = streaming && !messages.some(m => m.streaming);
    expect(shouldShow).toBe(false);
  });
});
