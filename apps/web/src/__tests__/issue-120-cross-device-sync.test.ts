/**
 * TDD tests for #120: Cross-device user message sync
 *
 * Problem: User messages sent from device A don't appear on device B in real-time.
 * When the gateway broadcasts inbound user messages, the originating device
 * must deduplicate them against its own optimistic messages.
 *
 * Uses the same createChatHandler pattern from realtime-rendering.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EventFrame } from "@intelli-claw/shared";
import type { DisplayMessage } from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// Minimal reproduction of useChat logic with cross-device dedup support
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
  deviceId: string;
}

function stripInboundMeta(text: string): string {
  let cleaned = text.replace(/Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g, "");
  cleaned = cleaned.replace(/^\[\d{4}-\d{2}-\d{2}[\w\s\-:+]*\]\s*/g, "");
  return cleaned.trim();
}

/**
 * Check if an inbound user message is a duplicate of an existing optimistic message.
 * Matches by: same role + similar content (first 200 chars normalized) + timestamp within 30s.
 */
function isDuplicateOfOptimistic(
  existing: DisplayMessage[],
  role: string,
  content: string,
  timestamp: string,
): boolean {
  const normalizedContent = content.replace(/\s+/g, " ").trim().slice(0, 200);
  const inboundTs = new Date(timestamp).getTime();

  return existing.some((m) => {
    if (m.role !== role) return false;
    const existingContent = m.content.replace(/\s+/g, " ").trim().slice(0, 200);
    const existingTs = new Date(m.timestamp).getTime();
    return existingContent === normalizedContent && Math.abs(existingTs - inboundTs) < 30_000;
  });
}

function createChatHandler(sessionKey?: string, deviceId?: string) {
  let idCounter = 0;
  const state: ChatState = {
    messages: [],
    streaming: false,
    agentStatus: { phase: "idle" },
    streamBuf: null,
    runId: null,
    sessionKey,
    deviceId: deviceId ?? `device-${Math.random().toString(36).slice(2)}`,
  };

  function uniqueStreamId(): string {
    return `stream-${Date.now()}-${++idCounter}`;
  }

  /** Simulate sending a message (optimistic add) */
  function sendMessage(text: string): string {
    const msgId = `user-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    state.messages.push({
      id: msgId,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      toolCalls: [],
    });
    return msgId;
  }

  function handleEvent(frame: EventFrame): void {
    if (frame.event !== "agent") return;

    const raw = frame.payload as Record<string, unknown>;
    const stream = raw.stream as string | undefined;
    const data = raw.data as Record<string, unknown> | undefined;
    const evSessionKey = raw.sessionKey as string | undefined;

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
      // === Cross-device sync with dedup (fix for #120) ===
      const text = (data.text ?? data.content ?? "") as string;
      const role = (data.role ?? "user") as "user" | "assistant";
      if (text) {
        const cleanedText = role === "user" ? stripInboundMeta(text) : text;
        const originDeviceId = data.deviceId as string | undefined;
        const timestamp = (data.timestamp as string) ?? new Date().toISOString();

        // Skip if this is an echo from our own device
        if (originDeviceId && originDeviceId === state.deviceId) {
          return;
        }

        // Content-based dedup only when no deviceId is present (legacy gateway)
        // When deviceId is present and differs, always show (different device = real message)
        if (!originDeviceId && role === "user" && isDuplicateOfOptimistic(state.messages, role, cleanedText, timestamp)) {
          return;
        }

        const inboundId = `inbound-${Date.now()}-${++idCounter}`;
        state.messages.push({
          id: inboundId,
          role,
          content: cleanedText,
          timestamp,
          toolCalls: [],
        });
      }
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
            : m,
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
            : m,
        );
        state.streamBuf = null;
      }
    } else if (stream === "error") {
      state.streaming = false;
      state.agentStatus = { phase: "idle" };
    }
  }

  return { state, handleEvent, sendMessage };
}

function agentEvent(payload: Record<string, unknown>, seq?: number): EventFrame {
  return { type: "event", event: "agent", payload, seq };
}

// ---------------------------------------------------------------------------
// #120: Cross-device user message sync
// ---------------------------------------------------------------------------

describe("#120 — inbound user messages appear for cross-device sync", () => {
  it("inbound user message from another device is added to messages", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main", "device-A");

    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "Hello from my phone",
        role: "user",
        deviceId: "device-B",
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("Hello from my phone");
    expect(state.messages[0].role).toBe("user");
  });

  it("inbound user message with metadata is stripped via stripInboundMeta", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main", "device-A");

    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "[2024-01-15 10:30:45+09:00] Hello from phone",
        role: "user",
        deviceId: "device-B",
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("Hello from phone");
  });
});

describe("#120 — dedup: inbound echo from own device is ignored", () => {
  it("inbound echo with matching deviceId is dropped", () => {
    const { state, handleEvent, sendMessage } = createChatHandler("agent:alpha:main", "device-A");

    // User sends a message locally (optimistic)
    sendMessage("Hello world");
    expect(state.messages).toHaveLength(1);

    // Gateway echoes the message back with our deviceId
    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "Hello world",
        role: "user",
        deviceId: "device-A",
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    // Should still be 1 message (echo was dropped)
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toMatch(/^user-/);
  });

  it("inbound from different deviceId is NOT dropped", () => {
    const { state, handleEvent, sendMessage } = createChatHandler("agent:alpha:main", "device-A");

    sendMessage("Hello world");

    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "Hello world",
        role: "user",
        deviceId: "device-B",
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    // Different device, same content = NOT a duplicate (legitimately typed same thing)
    // Actually, this IS a dedup candidate by content+timestamp proximity
    // But since deviceId differs, it should be added (different user intent)
    // Wait — re-reading requirements: if different device sent same text, it's a real msg from another device
    // The deviceId check alone should handle this: device-B != device-A, so it passes deviceId check
    // But content dedup might still catch it... Let's think:
    // - device-A sends "Hello world" optimistically
    // - device-B sends "Hello world" (coincidentally same text)
    // This should show both. Content dedup should NOT apply across different devices.
    expect(state.messages).toHaveLength(2);
  });
});

describe("#120 — dedup: optimistic message matched by content+timestamp", () => {
  it("inbound without deviceId deduplicates against recent optimistic message", () => {
    const { state, handleEvent, sendMessage } = createChatHandler("agent:alpha:main", "device-A");

    // User sends message locally
    sendMessage("Test message");
    expect(state.messages).toHaveLength(1);

    // Gateway echoes back WITHOUT deviceId (legacy gateway)
    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "Test message",
        role: "user",
        timestamp: new Date().toISOString(),
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    // Should deduplicate based on content + timestamp proximity
    expect(state.messages).toHaveLength(1);
  });

  it("inbound with same content but old timestamp is NOT deduplicated", () => {
    const { state, handleEvent, sendMessage } = createChatHandler("agent:alpha:main", "device-A");

    sendMessage("Repeated phrase");

    // Inbound with timestamp 2 minutes ago — too far apart
    const oldTimestamp = new Date(Date.now() - 120_000).toISOString();
    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "Repeated phrase",
        role: "user",
        timestamp: oldTimestamp,
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    // Should NOT deduplicate — timestamps too far apart
    expect(state.messages).toHaveLength(2);
  });

  it("inbound assistant message is never deduplicated against user optimistic", () => {
    const { state, handleEvent, sendMessage } = createChatHandler("agent:alpha:main", "device-A");

    sendMessage("Hello");

    handleEvent(agentEvent({
      stream: "inbound",
      data: {
        text: "Hello",
        role: "assistant",
        timestamp: new Date().toISOString(),
      },
      sessionKey: "agent:alpha:main",
    }, 1));

    // Different role — no dedup
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe("user");
    expect(state.messages[1].role).toBe("assistant");
  });
});

describe("#120 — multiple inbound messages from other devices", () => {
  it("multiple different messages from other devices all appear", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main", "device-A");

    handleEvent(agentEvent({
      stream: "inbound",
      data: { text: "First from phone", role: "user", deviceId: "device-B" },
      sessionKey: "agent:alpha:main",
    }, 1));

    handleEvent(agentEvent({
      stream: "inbound",
      data: { text: "Second from tablet", role: "user", deviceId: "device-C" },
      sessionKey: "agent:alpha:main",
    }, 2));

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].content).toBe("First from phone");
    expect(state.messages[1].content).toBe("Second from tablet");
  });

  it("inbound user messages do not interfere with ongoing assistant stream", () => {
    const { state, handleEvent } = createChatHandler("agent:alpha:main", "device-A");

    // Start assistant streaming
    handleEvent(agentEvent({
      stream: "lifecycle",
      data: { phase: "start" },
      runId: "run-1",
      sessionKey: "agent:alpha:main",
    }, 1));
    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: "Working on it..." },
      sessionKey: "agent:alpha:main",
    }, 2));

    // Inbound user message from another device
    handleEvent(agentEvent({
      stream: "inbound",
      data: { text: "Quick question", role: "user", deviceId: "device-B" },
      sessionKey: "agent:alpha:main",
    }, 3));

    // More assistant streaming
    handleEvent(agentEvent({
      stream: "assistant",
      data: { delta: " Done!" },
      sessionKey: "agent:alpha:main",
    }, 4));

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].content).toBe("Working on it... Done!");
    expect(state.messages[0].streaming).toBe(true);
    expect(state.messages[1].content).toBe("Quick question");
    expect(state.messages[1].role).toBe("user");
  });
});

describe("#120 — isDuplicateOfOptimistic edge cases", () => {
  it("whitespace differences are normalized for dedup", () => {
    const msgs: DisplayMessage[] = [{
      id: "user-1", role: "user", content: "hello  world",
      timestamp: new Date().toISOString(), toolCalls: [],
    }];

    expect(isDuplicateOfOptimistic(msgs, "user", "hello world", new Date().toISOString())).toBe(true);
  });

  it("completely different content is not a duplicate", () => {
    const msgs: DisplayMessage[] = [{
      id: "user-1", role: "user", content: "hello",
      timestamp: new Date().toISOString(), toolCalls: [],
    }];

    expect(isDuplicateOfOptimistic(msgs, "user", "goodbye", new Date().toISOString())).toBe(false);
  });

  it("empty messages array never matches", () => {
    expect(isDuplicateOfOptimistic([], "user", "hello", new Date().toISOString())).toBe(false);
  });
});
