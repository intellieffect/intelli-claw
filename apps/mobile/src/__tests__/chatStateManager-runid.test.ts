/**
 * chatStateManager-runid.test.ts — Verify runId clearing in ChatStateManager (#225)
 *
 * The ChatStateManager must clear runId (set to null) after:
 * 1. lifecycle.end
 * 2. done/end/finish events
 * 3. error events
 * 4. streaming timeout
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EventFrame, GatewayClient } from "@intelli-claw/shared";
import { ChatStateManager } from "../stores/chatStateManager";

// ── Mock GatewayClient that lets us emit events ──

function createMockClient() {
  let handler: ((frame: EventFrame) => void) | null = null;
  const client = {
    onEvent(h: (frame: EventFrame) => void) {
      handler = h;
      return () => { handler = null; };
    },
    emitEvent(frame: EventFrame) {
      handler?.(frame);
    },
  } as unknown as GatewayClient & { emitEvent: (f: EventFrame) => void };
  return client;
}

// ── Event factories (matching web test helpers) ──

function lifecycleStart(sessionKey: string, runId?: string): EventFrame {
  return {
    type: "event",
    event: "agent",
    payload: {
      stream: "lifecycle",
      data: { phase: "start" },
      sessionKey,
      ...(runId ? { runId } : {}),
    },
  };
}

function lifecycleEnd(sessionKey: string, runId?: string): EventFrame {
  return {
    type: "event",
    event: "agent",
    payload: {
      stream: "lifecycle",
      data: { phase: "end" },
      sessionKey,
      ...(runId ? { runId } : {}),
    },
  };
}

function streamChunk(sessionKey: string, delta: string): EventFrame {
  return {
    type: "event",
    event: "agent",
    payload: {
      stream: "assistant",
      data: { delta },
      sessionKey,
    },
  };
}

function streamSignal(
  signal: "done" | "end" | "finish",
  sessionKey: string,
): EventFrame {
  return {
    type: "event",
    event: "agent",
    payload: {
      stream: signal,
      data: {},
      sessionKey,
    },
  };
}

function errorEvent(sessionKey: string, message: string): EventFrame {
  return {
    type: "event",
    event: "agent",
    payload: {
      stream: "error",
      data: { message },
      sessionKey,
    },
  };
}

// ── Tests ──

const SK = "test:agent";

describe("ChatStateManager runId clearing (#225)", () => {
  let mgr: ChatStateManager;
  let client: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.useFakeTimers();
    mgr = new ChatStateManager();
    client = createMockClient();
    mgr.bind(client);
  });

  afterEach(() => {
    mgr.unbind();
    vi.useRealTimers();
  });

  it("lifecycle.start sets runId", () => {
    client.emitEvent(lifecycleStart(SK, "run-abc"));
    expect(mgr.getRunId(SK)).toBe("run-abc");
  });

  it("runId is null after lifecycle.end", () => {
    client.emitEvent(lifecycleStart(SK, "run-1"));
    client.emitEvent(streamChunk(SK, "Hello"));
    expect(mgr.getRunId(SK)).toBe("run-1");

    client.emitEvent(lifecycleEnd(SK, "run-1"));
    expect(mgr.getRunId(SK)).toBeNull();
  });

  it("runId is null after done event", () => {
    client.emitEvent(lifecycleStart(SK, "run-done"));
    client.emitEvent(streamChunk(SK, "text"));
    expect(mgr.getRunId(SK)).toBe("run-done");

    client.emitEvent(streamSignal("done", SK));
    expect(mgr.getRunId(SK)).toBeNull();
  });

  it("runId is null after end event", () => {
    client.emitEvent(lifecycleStart(SK, "run-end"));
    client.emitEvent(streamChunk(SK, "text"));

    client.emitEvent(streamSignal("end", SK));
    expect(mgr.getRunId(SK)).toBeNull();
  });

  it("runId is null after finish event", () => {
    client.emitEvent(lifecycleStart(SK, "run-finish"));
    client.emitEvent(streamChunk(SK, "text"));

    client.emitEvent(streamSignal("finish", SK));
    expect(mgr.getRunId(SK)).toBeNull();
  });

  it("runId is null after error event", () => {
    client.emitEvent(lifecycleStart(SK, "run-error"));
    client.emitEvent(streamChunk(SK, "Partial"));
    expect(mgr.getRunId(SK)).toBe("run-error");

    client.emitEvent(errorEvent(SK, "Server error"));
    expect(mgr.getRunId(SK)).toBeNull();
  });

  it("runId is null after streaming timeout", () => {
    client.emitEvent(lifecycleStart(SK, "run-timeout"));
    client.emitEvent(streamChunk(SK, "Partial"));
    expect(mgr.getRunId(SK)).toBe("run-timeout");

    // Advance past the 45s streaming timeout
    vi.advanceTimersByTime(46_000);
    expect(mgr.getRunId(SK)).toBeNull();
  });

  it("new lifecycle.start replaces previous runId", () => {
    client.emitEvent(lifecycleStart(SK, "run-old"));
    expect(mgr.getRunId(SK)).toBe("run-old");

    client.emitEvent(lifecycleEnd(SK, "run-old"));
    expect(mgr.getRunId(SK)).toBeNull();

    client.emitEvent(lifecycleStart(SK, "run-new"));
    expect(mgr.getRunId(SK)).toBe("run-new");
  });

  it("getRunId returns null for unknown session", () => {
    expect(mgr.getRunId("unknown:session")).toBeNull();
  });

  it("clearRunId eagerly clears and returns previous value", () => {
    client.emitEvent(lifecycleStart(SK, "run-eager"));
    expect(mgr.getRunId(SK)).toBe("run-eager");

    const captured = mgr.clearRunId(SK);
    expect(captured).toBe("run-eager");
    expect(mgr.getRunId(SK)).toBeNull();
  });

  it("clearRunId returns null when no runId is set", () => {
    const captured = mgr.clearRunId(SK);
    expect(captured).toBeNull();
  });
});
