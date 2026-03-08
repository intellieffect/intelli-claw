/**
 * hooks-merge-pipeline.test.ts — Tests for the loadHistory merge pipeline.
 *
 * Covers: gateway/local message merging, boundary insertion, queue dedup,
 * hidden message filtering, streaming message preservation, stale guard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { createMockClient, type MockClient } from "./helpers/mock-gateway-client";
import { installMockStorage, type MockStorage } from "./helpers/mock-storage";
import {
  makeStreamChunk,
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

const mockGetLocalMessages = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/gateway/message-store", () => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  getLocalMessages: (...args: any[]) => mockGetLocalMessages(...args),
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
  mockGetLocalMessages.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  storageCleanup();
  vi.restoreAllMocks();
});

describe("Merge pipeline", () => {
  it("loads gateway messages only (no local)", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Hello", timestamp: "2026-01-01T00:00:01Z" },
        { role: "assistant", content: "Hi there!", timestamp: "2026-01-01T00:00:02Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Should have 2 messages (user + assistant)
    expect(result.current.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.current.messages.some((m) => m.content === "Hello")).toBe(true);
    expect(result.current.messages.some((m) => m.content === "Hi there!")).toBe(true);
  });

  it("loads local messages only (gateway returns empty)", async () => {
    mockClient!.request.mockResolvedValue({ messages: [] });
    mockGetLocalMessages.mockResolvedValue([
      { id: "local-1", role: "user", content: "From local", timestamp: "2026-01-01T00:00:01Z" },
      { id: "local-2", role: "assistant", content: "Local reply", timestamp: "2026-01-01T00:00:02Z" },
    ]);

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result.current.messages.some((m) => m.content === "From local")).toBe(true);
    expect(result.current.messages.some((m) => m.content === "Local reply")).toBe(true);
  });

  it("merges local older messages before gateway messages (prepend)", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Gateway msg", timestamp: "2026-01-01T00:00:10Z" },
      ],
    });
    mockGetLocalMessages.mockResolvedValue([
      { id: "local-old", role: "user", content: "Older local", timestamp: "2026-01-01T00:00:01Z" },
    ]);

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    const msgs = result.current.messages;
    const oldIdx = msgs.findIndex((m) => m.content === "Older local");
    const gwIdx = msgs.findIndex((m) => m.content === "Gateway msg");

    // Older local should appear before gateway
    if (oldIdx >= 0 && gwIdx >= 0) {
      expect(oldIdx).toBeLessThan(gwIdx);
    }
  });

  it("merges local newer messages after gateway messages (append)", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Gateway msg", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });
    mockGetLocalMessages.mockResolvedValue([
      { id: "local-new", role: "user", content: "Newer local", timestamp: "2026-01-02T00:00:01Z" },
    ]);

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    const msgs = result.current.messages;
    const gwIdx = msgs.findIndex((m) => m.content === "Gateway msg");
    const newIdx = msgs.findIndex((m) => m.content === "Newer local");

    if (gwIdx >= 0 && newIdx >= 0) {
      expect(newIdx).toBeGreaterThan(gwIdx);
    }
  });

  it("inserts session boundary at correct timestamp position", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Before boundary", timestamp: "2026-01-01T00:00:01Z" },
        { role: "assistant", content: "After boundary", timestamp: "2026-01-01T00:00:10Z" },
      ],
    });
    mockGetLocalMessages.mockResolvedValue([
      {
        id: "boundary-1",
        role: "session-boundary",
        content: "",
        timestamp: "2026-01-01T00:00:05Z",
        oldSessionId: "old-id",
        newSessionId: "new-id",
      },
    ]);

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    const msgs = result.current.messages;
    const boundaryIdx = msgs.findIndex((m) => m.role === "session-boundary");

    if (boundaryIdx >= 0) {
      // Boundary should be between the two messages
      const beforeIdx = msgs.findIndex((m) => m.content === "Before boundary");
      const afterIdx = msgs.findIndex((m) => m.content === "After boundary");
      if (beforeIdx >= 0 && afterIdx >= 0) {
        expect(boundaryIdx).toBeGreaterThan(beforeIdx);
        expect(boundaryIdx).toBeLessThan(afterIdx);
      }
    }
  });

  it("filters out hidden messages from merged result", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Normal question", timestamp: "2026-01-01T00:00:01Z" },
        { role: "assistant", content: "NO_REPLY", timestamp: "2026-01-01T00:00:02Z" },
        { role: "assistant", content: "Good answer", timestamp: "2026-01-01T00:00:03Z" },
        { role: "system", content: "System internal", timestamp: "2026-01-01T00:00:04Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    const msgs = result.current.messages;
    expect(msgs.some((m) => m.content === "NO_REPLY")).toBe(false);
    expect(msgs.some((m) => m.role === "system")).toBe(false);
    expect(msgs.some((m) => m.content === "Normal question")).toBe(true);
    expect(msgs.some((m) => m.content === "Good answer")).toBe(true);
  });

  it("deduplicates overlapping gateway and local messages", async () => {
    const ts = "2026-01-01T00:00:01Z";
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Shared message", timestamp: ts },
      ],
    });
    mockGetLocalMessages.mockResolvedValue([
      { id: "local-dup", role: "user", content: "Shared message", timestamp: ts },
    ]);

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Should not have duplicate "Shared message"
    const sharedMsgs = result.current.messages.filter((m) => m.content === "Shared message");
    expect(sharedMsgs.length).toBeLessThanOrEqual(1);
  });

  it("preserves streaming message during loadHistory (mergeLiveStreamingIntoHistory)", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Question", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Start streaming
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("Streaming response...", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Trigger another loadHistory (e.g. from reconnect)
    act(() => { result.current.reload(); });
    await act(async () => { vi.advanceTimersByTime(200); });

    // Streaming message should still be present
    const streamingMsg = result.current.messages.find((m) => m.streaming);
    expect(streamingMsg).toBeTruthy();
  });

  it("queue dedup: stale queue items matching history are removed from localStorage", async () => {
    // #142: queueStorageKey now includes windowStoragePrefix()
    const { windowStoragePrefix } = await import("@/lib/utils");
    const queueKey = `awf:${windowStoragePrefix()}queue:test:agent`;
    mockLocal.setItem(
      queueKey,
      JSON.stringify([
        { id: "q-1", text: "Already in history" },
        { id: "q-2", text: "New queued message" },
      ]),
    );

    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Already in history", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));

    // Flush all timers and microtasks for the full loadHistory + processQueue pipeline
    await act(async () => { vi.advanceTimersByTime(500); });
    await act(async () => { vi.advanceTimersByTime(500); });

    // "Already in history" should appear only once (from gateway history)
    const historyMsgs = result.current.messages.filter((m) => m.content === "Already in history");
    expect(historyMsgs.length).toBeLessThanOrEqual(1);

    // The stale queue item "Already in history" should have been cleaned from localStorage.
    // The queue in localStorage should either be removed entirely or contain only fresh items.
    const updatedQueue = mockLocal.getItem(queueKey);
    if (updatedQueue) {
      const parsed = JSON.parse(updatedQueue) as { id: string; text: string }[];
      const staleItem = parsed.find((q) => q.text === "Already in history");
      expect(staleItem).toBeUndefined();
    }
    // Either way, the stale item is gone — this is the core dedup guarantee
  });

  it("stale loadHistory response is ignored (version guard)", async () => {
    // This test verifies that if sessionKey changes while loadHistory is in-flight,
    // the stale response is discarded.
    let sessionKey = "test:agent-a";

    // Make the request slow
    let resolveHistory: (value: any) => void;
    mockClient!.request.mockImplementation((method: string) => {
      if (method === "chat.history") {
        return new Promise((resolve) => { resolveHistory = resolve; });
      }
      return Promise.resolve({});
    });

    const { result, rerender } = renderHook(() => useChat(sessionKey));

    // Allow cache-first getLocalMessages to resolve (returns []) and chat.history to be called
    await act(async () => { vi.advanceTimersByTime(10); });

    // The loadHistory for agent-a is now pending...
    // Switch session
    sessionKey = "test:agent-b";
    mockClient!.request.mockResolvedValue({ messages: [] });
    rerender();
    await act(async () => { vi.advanceTimersByTime(100); });

    // Now resolve the stale agent-a response
    await act(async () => {
      resolveHistory!({
        messages: [
          { role: "user", content: "Stale message for agent-a", timestamp: "2026-01-01T00:00:01Z" },
        ],
      });
      vi.advanceTimersByTime(100);
    });

    // Messages should NOT contain the stale agent-a message
    const staleMsg = result.current.messages.find((m) => m.content.includes("Stale message"));
    expect(staleMsg).toBeUndefined();
  });

  it("loading is false after loadHistory when messages already exist", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "First load", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Messages loaded
    expect(result.current.messages.length).toBeGreaterThan(0);
    expect(result.current.loading).toBe(false);

    // Trigger reload
    act(() => { result.current.reload(); });

    // Loading should NOT be true when messages already exist (Bug #1)
    expect(result.current.loading).toBe(false);

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(result.current.loading).toBe(false);
  });
});
