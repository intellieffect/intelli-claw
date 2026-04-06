/**
 * issue-296-stop-cancel.test.ts — Reliable Stop/Cancel delivery (#296)
 *
 * Verifies that pressing the Stop button reliably delivers `chat.abort` to
 * the gateway even when transient failures or silent ignores occur:
 *
 * 1. abort() with a known runId forwards it to chat.abort.
 * 2. abort() still sends chat.abort when processor.abort() yields no runId —
 *    the value captured synchronously from runIdRef is used as a fallback.
 * 3. abort() called twice in quick succession sends two chat.abort requests
 *    (manual retry). The second call does NOT get deduped or swallowed.
 * 4. When the first chat.abort request is rejected by the client, a second
 *    attempt is sent automatically.
 * 5. When the first chat.abort request stays pending (gateway ignore), a
 *    retry is scheduled and fires after the 1.5s timeout window.
 * 6. A successful first request cancels the pending retry — no duplicate fire
 *    after 1.5s.
 * 7. After abort() completes, local streaming state is cleared so the send
 *    queue can continue.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { createMockClient, type MockClient } from "./helpers/mock-gateway-client";
import { installMockStorage } from "./helpers/mock-storage";
import {
  makeChatDelta,
  makeLifecycleStart,
  resetFixtureCounter,
} from "./helpers/fixtures";

let mockClient: MockClient | null = null;
let mockState = "connected";

vi.mock("@intelli-claw/shared", async () => {
  const actual = await vi.importActual<typeof import("@intelli-claw/shared")>(
    "@intelli-claw/shared",
  );
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

/** Count of `chat.abort` requests dispatched on the mock client. */
function abortCalls() {
  return mockClient!.request.mock.calls.filter((c) => c[0] === "chat.abort");
}

describe("reliable stop/cancel delivery (#296)", () => {
  it("abort forwards the active runId to chat.abort", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-active"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("partial", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.streaming).toBe(true);

    act(() => { result.current.abort(); });

    const calls = abortCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({
      sessionKey: "test:agent",
      runId: "run-active",
    });
  });

  it("abort captures runId synchronously so a later processor reset can't strand the request", async () => {
    // Simulates the race where processor.abort() clears runIdRef via
    // onRunIdChange: we need the value captured BEFORE any mutation to still
    // reach the gateway.
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-sync-capture"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("hello", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    act(() => { result.current.abort(); });

    const calls = abortCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0][1].runId).toBe("run-sync-capture");
  });

  it("abort called twice in quick succession sends two chat.abort requests (manual retry)", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-twice"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("streaming…", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    act(() => { result.current.abort(); });
    act(() => { result.current.abort(); });

    const calls = abortCalls();
    // Two separate user clicks → two requests, neither swallowed.
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0][1].runId).toBe("run-twice");
  });

  it("retries chat.abort automatically when the first request rejects", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-reject"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("partial", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // First chat.abort rejects, subsequent ones resolve.
    mockClient!.request.mockImplementation((method: string) => {
      if (method !== "chat.abort") return Promise.resolve({ messages: [] });
      const existing = mockClient!.request.mock.calls.filter(
        (c) => c[0] === "chat.abort",
      ).length;
      if (existing === 1) {
        return Promise.reject(new Error("simulated gateway error"));
      }
      return Promise.resolve({});
    });

    await act(async () => { result.current.abort(); });
    // Let the error handler enqueue + fire the retry (microtasks).
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });

    const calls = abortCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0][1].runId).toBe("run-reject");
    expect(calls[1][1].runId).toBe("run-reject");
  });

  it("retries chat.abort automatically when the gateway silently ignores the first request", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-silent"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("partial", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Gateway never responds to chat.abort — keep it pending forever.
    mockClient!.request.mockImplementation((method: string) => {
      if (method !== "chat.abort") return Promise.resolve({ messages: [] });
      return new Promise(() => { /* never resolves */ });
    });

    act(() => { result.current.abort(); });

    // Before the 1.5s window → only the first attempt.
    expect(abortCalls()).toHaveLength(1);

    // After the 1.5s silent-ignore window → fallback retry fires.
    await act(async () => { vi.advanceTimersByTime(1500); });

    const calls = abortCalls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0][1].runId).toBe("run-silent");
    expect(calls[1][1].runId).toBe("run-silent");
  });

  it("does not fire the fallback retry when the first request resolves successfully", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-ok"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("partial", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    await act(async () => { result.current.abort(); });
    // Flush success microtask → cancels pending retry.
    await act(async () => { await Promise.resolve(); });

    // Advance far past the 1.5s retry window.
    await act(async () => { vi.advanceTimersByTime(5_000); });

    expect(abortCalls()).toHaveLength(1);
  });

  it("clears local streaming state after abort so the queue can proceed", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-queue"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("partial", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.streaming).toBe(true);

    act(() => { result.current.abort(); });

    // processor.abort() eagerly flips streaming false so queued messages
    // can flow after the user hits Stop.
    expect(result.current.streaming).toBe(false);
  });
});
