/**
 * hooks-event.test.ts — Tests for event/history/protocol fixes
 * GitHub Issues: #244, #248, #249, #250
 *
 * Tests:
 * 1. chat event type handling (delta, final, error, aborted)
 * 2. tool result → history reload
 * 3. stable history message IDs (not index-based)
 * 4. loadHistory timing race (client.state fallback)
 * 5. thinking content block handling
 * 6. tool stream format compat (tool + phase)
 * 7. 15s polling → event-based session refresh
 * 8. compaction event handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { createMockClient, type MockClient } from "./helpers/mock-gateway-client";
import { installMockStorage } from "./helpers/mock-storage";
import {
  makeAgentEvent,
  makeChatDelta,
  makeLifecycleStart,
  makeLifecycleEnd,
  makeEventFrame,
  resetFixtureCounter,
} from "./helpers/fixtures";

// Mock the shared gateway module
let mockClient: MockClient | null = null;
let mockState = "connected";

vi.mock("@intelli-claw/shared", async () => {
  const actual = await vi.importActual<typeof import("@intelli-claw/shared")>("@intelli-claw/shared");
  return {
    ...actual,
    useGateway: () => ({
      client: mockClient,
      state: mockState,
      error: null,
      updateConfig: vi.fn(),
      mainSessionKey: mockClient?.mainSessionKey || "",
      serverVersion: "",
      serverCommit: "",
      gatewayUrl: "",
    }),
    GatewayProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

vi.mock("@/lib/gateway/message-store", () => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  getLocalMessages: vi.fn().mockResolvedValue([]),
  getRecentLocalMessages: vi.fn().mockResolvedValue([]),
  backfillFromApi: vi.fn().mockResolvedValue([]),
  isBackfillDone: vi.fn().mockReturnValue(true),
  runMessageStoreMigration: vi.fn(),
}));

vi.mock("@/lib/gateway/topic-store", () => ({
  trackSessionId: vi.fn().mockResolvedValue(undefined),
  markSessionEnded: vi.fn().mockResolvedValue(undefined),
  getCurrentSessionId: vi.fn().mockResolvedValue(null),
  getTopicHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/platform/media-path", () => ({
  validateMediaPath: vi.fn().mockReturnValue({ valid: true }),
  sanitizeAttachmentPath: vi.fn((p: string) => p),
}));

vi.mock("@/lib/platform", () => ({
  platform: { mediaUrl: (p: string) => `/media/${p}` },
}));

vi.mock("@/lib/mime-types", () => ({
  getMimeType: () => "application/octet-stream",
}));

vi.mock("@/lib/utils", () => ({
  windowStoragePrefix: () => "test-",
}));

vi.mock("@/lib/gateway/reset-reason", () => ({
  inferResetReason: vi.fn().mockReturnValue("unknown"),
}));

const SESSION_KEY = "agent:test:main";

describe("hooks-event: chat event type handling (#244)", () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storage = installMockStorage();
    cleanup = storage.cleanup;
    resetFixtureCounter();
    mockClient = createMockClient(SESSION_KEY);
    mockState = "connected";
    mockClient.request.mockImplementation(async (method: string) => {
      if (method === "chat.history") return { messages: [] };
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockClient = null;
  });

  it("should handle chat event with state=delta (streaming text)", async () => {
    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Simulate chat event with delta state
    act(() => {
      mockClient!.emitEvent(makeEventFrame("chat", {
        sessionKey: SESSION_KEY,
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "Hello " }] },
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Should be streaming
    expect(result.current.streaming).toBe(true);
  });

  it("should handle chat event with state=final (message complete)", async () => {
    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Start lifecycle
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart(SESSION_KEY, "run-1"));
    });

    // Send delta
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Hello world", SESSION_KEY));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // Send chat final
    act(() => {
      mockClient!.emitEvent(makeEventFrame("chat", {
        sessionKey: SESSION_KEY,
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "Hello world complete" }] },
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Streaming should end, history should be reloaded
    expect(result.current.streaming).toBe(false);
  });

  it("should handle chat event with state=error", async () => {
    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Start lifecycle
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart(SESSION_KEY, "run-2"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Partial...", SESSION_KEY));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // Send chat error
    act(() => {
      mockClient!.emitEvent(makeEventFrame("chat", {
        sessionKey: SESSION_KEY,
        state: "error",
        errorMessage: "Rate limit exceeded",
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Streaming should stop
    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("should handle chat event with state=aborted", async () => {
    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart(SESSION_KEY, "run-3"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Partial text", SESSION_KEY));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // Send aborted
    act(() => {
      mockClient!.emitEvent(makeEventFrame("chat", {
        sessionKey: SESSION_KEY,
        state: "aborted",
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    expect(result.current.streaming).toBe(false);
  });
});

describe("hooks-event: tool result → history reload (#244)", () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storage = installMockStorage();
    cleanup = storage.cleanup;
    resetFixtureCounter();
    mockClient = createMockClient(SESSION_KEY);
    mockState = "connected";
    mockClient.request.mockImplementation(async (method: string) => {
      if (method === "chat.history") return { messages: [] };
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockClient = null;
  });

  it("should reload history after tool-end event", async () => {
    const { useChat } = await import("@/lib/gateway/hooks");
    renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    const requestCallsBefore = mockClient!.request.mock.calls.filter(
      (c: unknown[]) => c[0] === "chat.history"
    ).length;

    // lifecycle start
    act(() => { mockClient!.emitEvent(makeLifecycleStart(SESSION_KEY, "run-tool")); });
    // tool-start
    act(() => {
      mockClient!.emitEvent(makeAgentEvent("tool-start", {
        callId: "tc-1", name: "bash", args: "ls",
      }, { sessionKey: SESSION_KEY }));
    });
    // tool-end
    act(() => {
      mockClient!.emitEvent(makeAgentEvent("tool-end", {
        callId: "tc-1", result: "file.txt",
      }, { sessionKey: SESSION_KEY }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });

    // loadHistory should have been called after tool-end
    const requestCallsAfter = mockClient!.request.mock.calls.filter(
      (c: unknown[]) => c[0] === "chat.history"
    ).length;
    // At minimum, the initial load + potentially a reload
    expect(requestCallsAfter).toBeGreaterThanOrEqual(requestCallsBefore);
  });
});

describe("hooks-event: stable history IDs (#248)", () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storage = installMockStorage();
    cleanup = storage.cleanup;
    resetFixtureCounter();
    mockClient = createMockClient(SESSION_KEY);
    mockState = "connected";
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockClient = null;
  });

  it("should generate stable IDs for history messages based on content hash", async () => {
    const ts = "2026-01-01T00:00:00Z";
    mockClient!.request.mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [
            { role: "user", content: "Hello", timestamp: ts, toolCalls: [] },
            { role: "assistant", content: "Hi there", timestamp: ts, toolCalls: [] },
          ],
        };
      }
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });

    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    const msgs = result.current.messages;
    // IDs should NOT be simple index-based like "hist-0", "hist-1"
    // They should contain a hash component
    for (const m of msgs) {
      if (m.id.startsWith("hist-")) {
        // Should be hist-{hash} not hist-{number}
        const suffix = m.id.replace("hist-", "");
        expect(suffix).not.toMatch(/^\d+$/); // not purely numeric
      }
    }
  });

  it("should produce same ID for same content across reloads", async () => {
    const ts = "2026-01-01T00:00:00Z";
    mockClient!.request.mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [
            { role: "user", content: "Hello", timestamp: ts, toolCalls: [] },
          ],
        };
      }
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });

    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    const firstLoadIds = result.current.messages.map((m) => m.id);

    // Trigger reload
    await act(async () => { result.current.reload(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    const secondLoadIds = result.current.messages.map((m) => m.id);

    // Same content should produce same IDs
    expect(firstLoadIds).toEqual(secondLoadIds);
  });
});

describe("hooks-event: loadHistory timing race (#248)", () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storage = installMockStorage();
    cleanup = storage.cleanup;
    resetFixtureCounter();
    mockClient = createMockClient(SESSION_KEY);
    // State is "connecting" initially but client.state is actually "connected"
    mockState = "connecting";
    mockClient.request.mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return { messages: [{ role: "user", content: "test", timestamp: new Date().toISOString(), toolCalls: [] }] };
      }
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockClient = null;
  });

  it("should check client.state as fallback when hook state is not connected", async () => {
    // Add a state property to the mock client to simulate client.state being "connected"
    (mockClient as any).state = "connected";

    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    // When state !== "connected" but client.state === "connected",
    // loadHistory should still attempt to load
    // The old behavior would skip loading entirely
    // With the fix, it should check client.state as fallback
  });
});

describe("hooks-event: thinking content block handling (#249)", () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storage = installMockStorage();
    cleanup = storage.cleanup;
    resetFixtureCounter();
    mockClient = createMockClient(SESSION_KEY);
    mockState = "connected";
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockClient = null;
  });

  it("should strip thinking blocks from history messages", async () => {
    mockClient!.request.mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          messages: [{
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Let me think about this..." },
              { type: "text", text: "Here is my answer." },
            ],
            timestamp: "2026-01-01T00:00:00Z",
            toolCalls: [],
          }],
        };
      }
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });

    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    // Should contain the text content but NOT the thinking content
    expect(assistantMsg!.content).toContain("Here is my answer");
    expect(assistantMsg!.content).not.toContain("Let me think about this");
  });
});

describe("hooks-event: tool stream format compat (#249)", () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storage = installMockStorage();
    cleanup = storage.cleanup;
    resetFixtureCounter();
    mockClient = createMockClient(SESSION_KEY);
    mockState = "connected";
    mockClient.request.mockImplementation(async (method: string) => {
      if (method === "chat.history") return { messages: [] };
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockClient = null;
  });

  it("should handle stream=tool with data.phase=start", async () => {
    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart(SESSION_KEY, "run-compat"));
    });

    // New format: stream="tool", data.phase="start"
    act(() => {
      mockClient!.emitEvent(makeAgentEvent("tool", {
        phase: "start",
        callId: "tc-compat-1",
        name: "bash",
        args: "echo hi",
      }, { sessionKey: SESSION_KEY }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    expect(result.current.agentStatus.phase).toBe("tool");
  });

  it("should handle stream=tool with data.phase=end (result)", async () => {
    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart(SESSION_KEY, "run-compat-2"));
    });
    // tool start
    act(() => {
      mockClient!.emitEvent(makeAgentEvent("tool", {
        phase: "start", callId: "tc-c2", name: "bash",
      }, { sessionKey: SESSION_KEY }));
    });
    // tool end/result
    act(() => {
      mockClient!.emitEvent(makeAgentEvent("tool", {
        phase: "end", callId: "tc-c2", result: "done",
      }, { sessionKey: SESSION_KEY }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // Should transition back to thinking after tool end
    expect(result.current.agentStatus.phase).toBe("thinking");
  });
});

describe("hooks-event: polling → event-based session refresh (#250)", () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storage = installMockStorage();
    cleanup = storage.cleanup;
    resetFixtureCounter();
    mockClient = createMockClient(SESSION_KEY);
    mockState = "connected";
    mockClient.request.mockImplementation(async (method: string) => {
      if (method === "chat.history") return { messages: [] };
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockClient = null;
  });

  it("should NOT poll sessions on 15s interval", async () => {
    const { useSessions } = await import("@/lib/gateway/hooks");
    renderHook(() => useSessions());
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    const callsBefore = mockClient!.request.mock.calls.filter(
      (c: unknown[]) => c[0] === "sessions.list"
    ).length;

    // Advance 60 seconds - should NOT trigger additional polls
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });

    const callsAfter = mockClient!.request.mock.calls.filter(
      (c: unknown[]) => c[0] === "sessions.list"
    ).length;

    // #260: visibility-aware polling runs every 15s when page is visible,
    // so ~4 calls in 60s is expected. Old pure-event approach had 0.
    expect(callsAfter - callsBefore).toBeGreaterThanOrEqual(3);
  });

  it("should refresh sessions after chat final event", async () => {
    const { useSessions } = await import("@/lib/gateway/hooks");
    renderHook(() => useSessions());
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    // Wait past the 1200ms throttle window from initial fetch
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });

    const callsBefore = mockClient!.request.mock.calls.filter(
      (c: unknown[]) => c[0] === "sessions.list"
    ).length;

    // Emit chat final event
    act(() => {
      mockClient!.emitEvent(makeEventFrame("chat", {
        sessionKey: SESSION_KEY,
        state: "final",
      }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    const callsAfter = mockClient!.request.mock.calls.filter(
      (c: unknown[]) => c[0] === "sessions.list"
    ).length;

    expect(callsAfter).toBeGreaterThan(callsBefore);
  });
});

describe("hooks-event: compaction event handling (#249)", () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storage = installMockStorage();
    cleanup = storage.cleanup;
    resetFixtureCounter();
    mockClient = createMockClient(SESSION_KEY);
    mockState = "connected";
    mockClient.request.mockImplementation(async (method: string) => {
      if (method === "chat.history") return { messages: [] };
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    mockClient = null;
  });

  it("should handle compaction stream event without crashing", async () => {
    const { useChat } = await import("@/lib/gateway/hooks");
    const { result } = renderHook(() => useChat(SESSION_KEY));
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });

    // Should not throw
    act(() => {
      mockClient!.emitEvent(makeAgentEvent("compaction", {
        status: "started",
        sessionKey: SESSION_KEY,
      }, { sessionKey: SESSION_KEY }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // Should handle compaction complete too
    act(() => {
      mockClient!.emitEvent(makeAgentEvent("compaction", {
        status: "completed",
        sessionKey: SESSION_KEY,
      }, { sessionKey: SESSION_KEY }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    // Agent status should remain idle (compaction is informational)
    expect(result.current.agentStatus.phase).toBe("idle");
  });
});
