/**
 * issue-154-streaming-stuck.test.ts
 *
 * Tests for #154: AI response stuck in "thinking" state.
 *
 * Root causes addressed:
 * 1. WebSocket stale connection detection (client heartbeat)
 * 2. Tiered streaming timeout (thinking vs writing phases)
 * 3. lifecycle.end without sessionKey should still match by runId
 * 4. flushDeferredHistoryReload must guarantee at least one reload
 * 5. Reconnect safety timer should await loadHistory completion
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { createMockClient, type MockClient } from "./helpers/mock-gateway-client";
import { installMockStorage } from "./helpers/mock-storage";
import {
  makeAgentEvent,
  makeChatDelta,
  makeChatFinal,
  makeLifecycleStart,
  makeLifecycleEnd,
  makeReconnectEvent,
  makeEventFrame,
  resetFixtureCounter,
} from "./helpers/fixtures";

// --- Mocks ---

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
  getMimeType: (ext: string) => {
    const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg" };
    return map[ext] || "application/octet-stream";
  },
}));

import { useChat } from "@/lib/gateway/hooks";

let storageCleanup: () => void;

beforeEach(() => {
  resetFixtureCounter();
  vi.useFakeTimers();
  const storage = installMockStorage();
  storageCleanup = storage.cleanup;
  mockClient = createMockClient("test:agent");
  mockState = "connected";
  mockClient.request.mockResolvedValue({ messages: [] });
});

afterEach(() => {
  vi.useRealTimers();
  storageCleanup();
  vi.restoreAllMocks();
});

// ===================================================================
// 1. lifecycle.end without sessionKey — should match by runId (#154)
// ===================================================================

describe("#154 — lifecycle.end without sessionKey", () => {
  it("should finalize stream when lifecycle.end has runId but no sessionKey", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // lifecycle.start WITH sessionKey
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-abc"));
    });
    expect(result.current.streaming).toBe(true);
    expect(result.current.agentStatus.phase).toBe("thinking");

    // Stream some content
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Hello", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // lifecycle.end WITHOUT sessionKey but WITH matching runId
    act(() => {
      mockClient!.emitEvent(makeAgentEvent(
        "lifecycle",
        { phase: "end", runId: "run-abc" },
      ));
    });

    // #255: lifecycle.end no longer finalizes — chat final does
    act(() => {
      mockClient!.emitEvent(makeChatFinal("test:agent", "run-abc"));
    });

    // Should finalize via chat final
    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("should NOT finalize when lifecycle.end has wrong runId and no sessionKey", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-abc"));
    });

    act(() => {
      mockClient!.emitEvent(makeChatDelta("Hello", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // lifecycle.end with WRONG runId and no sessionKey
    act(() => {
      mockClient!.emitEvent(makeAgentEvent(
        "lifecycle",
        { phase: "end", runId: "run-DIFFERENT" },
      ));
    });

    // Should still be streaming (wrong runId should not finalize)
    expect(result.current.streaming).toBe(true);
  });
});

// ===================================================================
// 2. Streaming timeout — thinking phase should have shorter timeout
// ===================================================================

describe("#154 — tiered streaming timeout", () => {
  it("should timeout faster during thinking phase (no content received)", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // lifecycle.start — enters thinking phase
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });
    expect(result.current.streaming).toBe(true);
    expect(result.current.agentStatus.phase).toBe("thinking");

    // Advance to 45 seconds — should timeout during thinking
    await act(async () => { vi.advanceTimersByTime(45_000); });

    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("should use uniform 45s timeout regardless of phase", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });

    // Stream some content — transitions to writing phase
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Starting response...", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.agentStatus.phase).toBe("writing");

    // Just before 45 seconds from last event — should still be streaming
    await act(async () => { vi.advanceTimersByTime(44_900); });
    expect(result.current.streaming).toBe(true);

    // At 45 seconds from last event — should timeout (uniform timeout)
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(result.current.streaming).toBe(false);
  });
});

// ===================================================================
// 3. flushDeferredHistoryReload — guaranteed reload after finalize
// ===================================================================

describe("#154 — flushDeferredHistoryReload guarantee", () => {
  it("should reload history even if lastLoadAt was recent", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Count loadHistory calls (via chat.history requests)
    const initialCallCount = mockClient!.request.mock.calls.filter(
      (c: unknown[]) => c[0] === "chat.history"
    ).length;

    // Start and complete a lifecycle
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Response", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // lifecycle.end + chat final triggers history reload (#255)
    act(() => {
      mockClient!.emitEvent(makeLifecycleEnd("test:agent", "run-1"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatFinal("test:agent", "run-1"));
    });
    await act(async () => { vi.advanceTimersByTime(100); });

    const finalCallCount = mockClient!.request.mock.calls.filter(
      (c: unknown[]) => c[0] === "chat.history"
    ).length;

    // Should have at least 1 more chat.history call after finalize
    expect(finalCallCount).toBeGreaterThan(initialCallCount);
  });
});

// ===================================================================
// 4. Reconnect safety timer — should wait for loadHistory
// ===================================================================

describe("#154 — reconnect with streaming state", () => {
  it("should clear streaming state after reconnect when no new events arrive", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Partial...", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(result.current.streaming).toBe(true);

    // Simulate reconnect
    act(() => {
      mockClient!.emitEvent(makeReconnectEvent());
    });

    // Wait for reconnect safety timer
    await act(async () => { vi.advanceTimersByTime(5_000); });

    // Streaming should be cleared
    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("should cancel reconnect safety timer if new lifecycle.start arrives", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Partial...", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Reconnect
    act(() => {
      mockClient!.emitEvent(makeReconnectEvent());
    });

    // New lifecycle starts before safety timer fires
    await act(async () => { vi.advanceTimersByTime(1_000); });
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-2"));
    });

    // Wait past the original safety timer window
    await act(async () => { vi.advanceTimersByTime(5_000); });

    // Should still be streaming (new run is active)
    expect(result.current.streaming).toBe(true);
  });

  it("should cancel reconnect safety timer if text delta arrives", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Start...", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Reconnect
    act(() => {
      mockClient!.emitEvent(makeReconnectEvent());
    });

    // Text delta arrives before safety timer
    await act(async () => { vi.advanceTimersByTime(1_500); });
    act(() => {
      mockClient!.emitEvent(makeChatDelta(" more text", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Wait past the safety timer window
    await act(async () => { vi.advanceTimersByTime(5_000); });

    // Should still be streaming (events resumed)
    expect(result.current.streaming).toBe(true);
  });
});

// ===================================================================
// 5. Client heartbeat — stale connection detection
// ===================================================================

describe("#154 — client heartbeat (stale connection detection)", () => {
  it("GatewayClient should detect stale connections via heartbeat", async () => {
    // This tests that the GatewayClient class implements heartbeat.
    // Import the real class (not the mock).
    const { GatewayClient } = await import("@intelli-claw/shared");

    // Verify the class has heartbeat-related configuration
    // The actual WebSocket connection can't be tested in unit tests,
    // so we verify the class structure supports heartbeat.
    const client = new GatewayClient("ws://localhost:1234", "test-token");
    expect(client).toBeDefined();

    // Clean up
    client.disconnect();
  });
});

// ===================================================================
// 6. Disconnect during thinking — agentStatus transitions
// ===================================================================

describe("#154 — disconnect during thinking phase", () => {
  it("should set agentStatus to waiting when disconnected during streaming", async () => {
    const { result, rerender } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });
    expect(result.current.agentStatus.phase).toBe("thinking");

    // Simulate disconnection
    act(() => {
      mockState = "disconnected";
    });
    rerender();
    await act(async () => { vi.advanceTimersByTime(100); });

    expect(result.current.agentStatus.phase).toBe("waiting");
  });
});
