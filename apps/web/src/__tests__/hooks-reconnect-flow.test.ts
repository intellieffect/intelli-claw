/**
 * hooks-reconnect-flow.test.ts — Tests for reconnect behavior in useChat.
 *
 * Covers: reconnect → loadHistory, safety timer, beforeunload persist,
 * disconnect buffer preservation, pending stream snapshot restore/discard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { createMockClient, type MockClient } from "./helpers/mock-gateway-client";
import { installMockStorage, type MockStorage } from "./helpers/mock-storage";
import {
  makeAgentEvent,
  makeStreamChunk,
  makeLifecycleStart,
  makeLifecycleEnd,
  makeReconnectEvent,
  resetFixtureCounter,
} from "./helpers/fixtures";
import { createPendingStreamSnapshot, type PendingStreamSnapshot } from "@/lib/gateway/hooks";

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
    onSessionReset: vi.fn(() => () => {}),
    emitSessionReset: vi.fn(),
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

let mockLocal: MockStorage;
let mockSession: MockStorage;
let storageCleanup: () => void;

beforeEach(() => {
  resetFixtureCounter();
  vi.useFakeTimers();
  const storage = installMockStorage();
  mockLocal = storage.localStorage;
  mockSession = storage.sessionStorage;
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

describe("Reconnect flow", () => {
  it("reconnect triggers loadHistory (chat.history request)", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    const callCountBefore = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.history",
    ).length;

    // Emit reconnect
    act(() => {
      mockClient!.emitEvent(makeReconnectEvent());
    });

    await act(async () => { vi.advanceTimersByTime(100); });

    const callCountAfter = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.history",
    ).length;

    expect(callCountAfter).toBeGreaterThan(callCountBefore);
  });

  it("safety timer (3s) finalizes stale stream after reconnect", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("Partial", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.streaming).toBe(true);

    // Emit reconnect (with streaming state active)
    act(() => { mockClient!.emitEvent(makeReconnectEvent()); });

    // Before 3s → still streaming
    await act(async () => { vi.advanceTimersByTime(2000); });
    // After reconnect, loadHistory fires, but safety timer is separate

    // Advance past 3s safety timer
    await act(async () => { vi.advanceTimersByTime(2000); });

    // Stream should be finalized now
    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("safety timer is cancelled when new lifecycle.start arrives", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("Partial", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Reconnect
    act(() => { mockClient!.emitEvent(makeReconnectEvent()); });

    // Wait 1s
    await act(async () => { vi.advanceTimersByTime(1000); });

    // New lifecycle.start arrives → should cancel safety timer
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-2")); });

    // Advance past original 3s safety timer
    await act(async () => { vi.advanceTimersByTime(5000); });

    // Should still be streaming (new lifecycle active, safety timer didn't fire)
    expect(result.current.streaming).toBe(true);
  });

  it("safety timer is cancelled when new stream chunk arrives", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("Partial", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Reconnect
    act(() => { mockClient!.emitEvent(makeReconnectEvent()); });
    await act(async () => { vi.advanceTimersByTime(1000); });

    // New stream chunk → cancels safety timer
    act(() => { mockClient!.emitEvent(makeStreamChunk(" more content", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Advance past 3s
    await act(async () => { vi.advanceTimersByTime(5000); });

    // Streaming should still be true (safety timer was cancelled by the new chunk)
    // Note: the 120s main timeout might still be running, but that's separate
    expect(result.current.streaming).toBe(true);
  });

  it("disconnect preserves buffer and sets agentStatus to waiting", async () => {
    const { result, rerender } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("In-flight content", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.streaming).toBe(true);

    // Simulate disconnect by changing state
    mockState = "disconnected";
    rerender();

    await act(async () => { vi.advanceTimersByTime(100); });

    // Should still have messages (buffer preserved)
    const streamingMsg = result.current.messages.find((m) => m.streaming);
    expect(streamingMsg).toBeTruthy();
    expect(result.current.agentStatus.phase).toBe("waiting");
  });

  it("beforeunload flushes pending stream to sessionStorage", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("Must not lose this", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Trigger beforeunload
    act(() => {
      window.dispatchEvent(new Event("beforeunload"));
    });

    // Check that pending stream was persisted to sessionStorage
    const key = "awf:pending-stream:test:agent";
    const stored = mockSession.getItem(key);
    expect(stored).toBeTruthy();
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.content).toContain("Must not lose this");
      expect(parsed.v).toBe(2);
    }
  });

  it("sessionKey change resets all state", async () => {
    let sessionKey = "test:agent";
    const { result, rerender } = renderHook(() => useChat(sessionKey));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("content", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.streaming).toBe(true);

    // Switch session
    sessionKey = "test:other";
    rerender();
    await act(async () => { vi.advanceTimersByTime(100); });

    expect(result.current.messages).toHaveLength(0);
    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("main streaming timeout (120s) force-resets streaming state", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming but never send lifecycle.end
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("Orphaned stream", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.streaming).toBe(true);

    // Advance 120 seconds (streaming timeout)
    await act(async () => { vi.advanceTimersByTime(120_000); });

    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("disconnect during streaming triggers persistPendingStream", async () => {
    const { result, rerender } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("Content during disconnect", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.streaming).toBe(true);

    // Disconnect
    mockState = "disconnected";
    rerender();
    await act(async () => { vi.advanceTimersByTime(600); }); // past throttle

    // Should have persisted to sessionStorage
    const key = "awf:pending-stream:test:agent";
    const stored = mockSession.getItem(key);
    expect(stored).toBeTruthy();
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.content).toContain("Content during disconnect");
    }
  });
});

// ---------------------------------------------------------------------------
// Pending stream snapshot restoration (simulates post-refresh mount)
// ---------------------------------------------------------------------------
describe("Pending stream snapshot restoration", () => {
  it("restores fresh snapshot from sessionStorage on mount", async () => {
    // Pre-seed sessionStorage with a fresh snapshot (simulates beforeunload save)
    const snapshot = createPendingStreamSnapshot({
      runId: "run-prev",
      streamId: "stream-prev-1",
      content: "Partial response before refresh",
      toolCalls: [],
    });
    const key = "awf:pending-stream:test:agent";
    mockSession.setItem(key, JSON.stringify(snapshot));

    // Mount the hook (simulates page reload)
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Should have restored: streaming=true, message visible
    expect(result.current.streaming).toBe(true);
    const restoredMsg = result.current.messages.find(
      (m) => m.content.includes("Partial response before refresh"),
    );
    expect(restoredMsg).toBeTruthy();
    expect(restoredMsg!.streaming).toBe(true);
    expect(restoredMsg!.id).toBe("stream-prev-1");
  });

  it("discards stale snapshot (>45s old) on mount", async () => {
    // Create a snapshot that is 60 seconds old
    const snapshot = createPendingStreamSnapshot({
      runId: "run-old",
      streamId: "stream-old-1",
      content: "Old stale content",
      toolCalls: [],
      now: Date.now() - 60_000, // 60s ago
    });
    const key = "awf:pending-stream:test:agent";
    mockSession.setItem(key, JSON.stringify(snapshot));

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Should NOT restore: streaming=false, no stale message
    expect(result.current.streaming).toBe(false);
    const staleMsg = result.current.messages.find(
      (m) => m.content.includes("Old stale content"),
    );
    expect(staleMsg).toBeUndefined();

    // sessionStorage should be cleaned up
    expect(mockSession.getItem(key)).toBeNull();
  });

  it("restores snapshot with toolCalls intact", async () => {
    const snapshot = createPendingStreamSnapshot({
      runId: "run-tc",
      streamId: "stream-tc-1",
      content: "Searching...",
      toolCalls: [
        { callId: "tc-1", name: "web_search", args: '{"q":"test"}', status: "running" } as any,
      ],
    });
    const key = "awf:pending-stream:test:agent";
    mockSession.setItem(key, JSON.stringify(snapshot));

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result.current.streaming).toBe(true);
    const restoredMsg = result.current.messages.find(
      (m) => m.id === "stream-tc-1",
    );
    expect(restoredMsg).toBeTruthy();
    expect(restoredMsg!.toolCalls).toHaveLength(1);
    expect(restoredMsg!.toolCalls![0].name).toBe("web_search");
  });

  it("ignores corrupted sessionStorage data gracefully", async () => {
    const key = "awf:pending-stream:test:agent";
    mockSession.setItem(key, "not-valid-json{{{");

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Should not crash, streaming=false
    expect(result.current.streaming).toBe(false);
    // Corrupted data should be cleaned up
    expect(mockSession.getItem(key)).toBeNull();
  });

  it("sets agentStatus to 'writing' when connected, 'waiting' when disconnected", async () => {
    const snapshot = createPendingStreamSnapshot({
      runId: "run-status",
      streamId: "stream-status-1",
      content: "Status test",
      toolCalls: [],
    });
    const key = "awf:pending-stream:test:agent";

    // Test 1: connected → writing
    mockSession.setItem(key, JSON.stringify(snapshot));
    mockState = "connected";
    const { result, unmount } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(result.current.agentStatus.phase).toBe("writing");
    unmount();

    // Test 2: disconnected → waiting
    // Re-seed (previous mount consumed it)
    const snapshot2 = createPendingStreamSnapshot({
      runId: "run-status-2",
      streamId: "stream-status-2",
      content: "Status test 2",
      toolCalls: [],
    });
    mockSession.setItem(key, JSON.stringify(snapshot2));
    mockState = "disconnected";
    const { result: result2 } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(result2.current.agentStatus.phase).toBe("waiting");
  });

  it("restored snapshot triggers streaming timeout (120s safety net)", async () => {
    const snapshot = createPendingStreamSnapshot({
      runId: "run-timeout",
      streamId: "stream-timeout-1",
      content: "Will timeout",
      toolCalls: [],
    });
    const key = "awf:pending-stream:test:agent";
    mockSession.setItem(key, JSON.stringify(snapshot));

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result.current.streaming).toBe(true);

    // Advance 120s — streaming timeout should force-reset
    await act(async () => { vi.advanceTimersByTime(120_000); });

    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("full refresh cycle: stream → beforeunload → mount → restore → reconnect → finalize", async () => {
    // Phase 1: Active streaming
    const { result, unmount } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-full")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("In-flight response", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(result.current.streaming).toBe(true);

    // Phase 2: beforeunload saves snapshot
    act(() => { window.dispatchEvent(new Event("beforeunload")); });
    const key = "awf:pending-stream:test:agent";
    const saved = mockSession.getItem(key);
    expect(saved).toBeTruthy();

    // Phase 3: Unmount (page unload)
    unmount();

    // Phase 4: Remount (page reload) — snapshot should be restored
    mockClient = createMockClient("test:agent");
    mockClient.request.mockResolvedValue({ messages: [] });
    mockState = "connected";

    const { result: result2 } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result2.current.streaming).toBe(true);
    expect(result2.current.messages.some(
      (m) => m.content.includes("In-flight response"),
    )).toBe(true);

    // Phase 5: Reconnect event arrives → safety timer starts
    act(() => { mockClient!.emitEvent(makeReconnectEvent()); });
    await act(async () => { vi.advanceTimersByTime(200); });

    // Phase 6: No new events → safety timer (3s) finalizes
    await act(async () => { vi.advanceTimersByTime(3_500); });

    expect(result2.current.streaming).toBe(false);
    expect(result2.current.agentStatus.phase).toBe("idle");
  });
});
