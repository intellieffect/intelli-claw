/**
 * issue-225-abort-with-runid.test.ts — Verify chat.abort includes runId (#225)
 *
 * Tests:
 * 1. abort() sends { sessionKey, runId } when a run is active
 * 2. abort() sends { sessionKey } only (fallback) when no runId is available
 * 3. runId is extracted from lifecycle.start events
 * 4. runId is cleared after lifecycle.end
 * 5. runId is cleared after error stream
 * 6. runId is cleared after abort
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

describe("chat.abort includes runId (#225)", () => {
  it("abort sends { sessionKey, runId } when a run is active", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start a run with known runId
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-abc-123"));
    });

    // Stream some content so streamBuf exists
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Partial response", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.streaming).toBe(true);

    // Abort
    act(() => { result.current.abort(); });

    // Verify the chat.abort request included runId
    const abortCalls = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.abort",
    );
    expect(abortCalls).toHaveLength(1);
    expect(abortCalls[0][1]).toEqual({
      sessionKey: "test:agent",
      runId: "run-abc-123",
    });
  });

  it("abort sends { sessionKey } without runId when no run is active (fallback)", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // No lifecycle.start — no runId is tracked
    // Manually trigger abort (edge case: UI button pressed when not streaming)
    act(() => { result.current.abort(); });

    // Verify the chat.abort request was sent without runId
    const abortCalls = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.abort",
    );
    expect(abortCalls).toHaveLength(1);
    expect(abortCalls[0][1]).toEqual(
      expect.objectContaining({ sessionKey: "test:agent" }),
    );
    expect(abortCalls[0][1].runId).toBeUndefined();
  });

  it("runId is extracted from lifecycle.start event payload", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start a run — runId should be captured
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-xyz-789"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("text", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Abort to capture the runId in the request
    act(() => { result.current.abort(); });

    const abortCalls = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.abort",
    );
    expect(abortCalls[0][1].runId).toBe("run-xyz-789");
  });

  it("runId is cleared after lifecycle.end", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start and complete a run
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-first"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Done", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });
    act(() => {
      mockClient!.emitEvent(makeLifecycleEnd("test:agent", "run-first"));
    });
    // #255: chat final triggers finalization (clears runId)
    act(() => {
      mockClient!.emitEvent(makeChatFinal("test:agent", "run-first"));
    });

    // Abort after the run has completed — should NOT send the old runId
    act(() => { result.current.abort(); });

    const abortCalls = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.abort",
    );
    expect(abortCalls).toHaveLength(1);
    expect(abortCalls[0][1].runId).toBeUndefined();
  });

  it("runId is cleared after error stream", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start a run
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-error"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Partial", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Error event
    act(() => {
      mockClient!.emitEvent(makeAgentEvent(
        "error",
        { message: "Server error" },
        { sessionKey: "test:agent" },
      ));
    });

    // Abort after error — runId should already be null
    act(() => { result.current.abort(); });

    const abortCalls = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.abort",
    );
    expect(abortCalls).toHaveLength(1);
    expect(abortCalls[0][1].runId).toBeUndefined();
  });

  it("runId is cleared after abort itself (subsequent aborts have no runId)", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start a run
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-double-abort"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Text", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // First abort — should include runId
    act(() => { result.current.abort(); });

    // Second abort — runId should be cleared
    act(() => { result.current.abort(); });

    const abortCalls = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.abort",
    );
    expect(abortCalls).toHaveLength(2);
    expect(abortCalls[0][1].runId).toBe("run-double-abort");
    expect(abortCalls[1][1].runId).toBeUndefined();
  });

  it("new lifecycle.start updates runId for subsequent abort", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // First run
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("First", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });
    act(() => {
      mockClient!.emitEvent(makeLifecycleEnd("test:agent", "run-1"));
    });

    // Second run with different runId
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-2"));
    });
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Second", "test:agent"));
    });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Abort should use the new runId
    act(() => { result.current.abort(); });

    const abortCalls = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.abort",
    );
    expect(abortCalls).toHaveLength(1);
    expect(abortCalls[0][1].runId).toBe("run-2");
  });
});
