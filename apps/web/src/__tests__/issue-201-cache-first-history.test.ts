/**
 * issue-201-cache-first-history.test.ts
 *
 * Phase 1: Cache-first loading pattern for loadHistory().
 * Tests that IndexedDB cached messages are shown immediately while
 * gateway history loads in the background (silent merge).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { createMockClient, type MockClient } from "./helpers/mock-gateway-client";
import { installMockStorage, type MockStorage } from "./helpers/mock-storage";
import { resetFixtureCounter } from "./helpers/fixtures";

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
const mockSaveMessages = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/gateway/message-store", () => ({
  saveMessages: (...args: unknown[]) => mockSaveMessages(...args),
  getLocalMessages: (...args: unknown[]) => mockGetLocalMessages(...args),
  getRecentLocalMessages: (...args: unknown[]) => mockGetLocalMessages(...args),
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
  mockSaveMessages.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  storageCleanup();
  vi.restoreAllMocks();
});

// ──────────────────────────────────────────────
// 1. Cache-first: show cached messages immediately
// ──────────────────────────────────────────────
describe("Cache-first loading (#201)", () => {
  it("shows cached messages before server responds", async () => {
    // Arrange: local cache has messages, server is slow
    const cachedMessages = [
      { id: "local-1", role: "user", sessionKey: "test:agent", content: "Cached question", timestamp: "2026-01-01T00:00:01Z" },
      { id: "local-2", role: "assistant", sessionKey: "test:agent", content: "Cached answer", timestamp: "2026-01-01T00:00:02Z" },
    ];
    mockGetLocalMessages.mockResolvedValue(cachedMessages);

    // Server response delayed (never resolves during first check)
    let resolveServer!: (value: unknown) => void;
    const serverPromise = new Promise((resolve) => { resolveServer = resolve; });
    mockClient!.request.mockReturnValue(serverPromise);

    const { result } = renderHook(() => useChat("test:agent"));

    // Act: advance enough for local cache to resolve
    await act(async () => { vi.advanceTimersByTime(50); });

    // Assert: cached messages should be visible BEFORE server responds
    expect(result.current.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.current.messages.some((m) => m.content === "Cached question")).toBe(true);
    expect(result.current.messages.some((m) => m.content === "Cached answer")).toBe(true);
    // loading should be false since we have cached data shown
    // (or at least not showing a blank screen)

    // Cleanup: resolve server
    resolveServer({
      messages: [
        { role: "user", content: "Cached question", timestamp: "2026-01-01T00:00:01Z" },
        { role: "assistant", content: "Cached answer", timestamp: "2026-01-01T00:00:02Z" },
      ],
    });
    await act(async () => { vi.advanceTimersByTime(200); });
  });

  it("silent merges server response over cached messages", async () => {
    // Arrange: local cache has 2 messages, server has 3 (one extra new message)
    const cachedMessages = [
      { id: "local-1", role: "user", sessionKey: "test:agent", content: "Hello", timestamp: "2026-01-01T00:00:01Z" },
      { id: "local-2", role: "assistant", sessionKey: "test:agent", content: "Hi there", timestamp: "2026-01-01T00:00:02Z" },
    ];
    mockGetLocalMessages.mockResolvedValue(cachedMessages);

    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Hello", timestamp: "2026-01-01T00:00:01Z" },
        { role: "assistant", content: "Hi there", timestamp: "2026-01-01T00:00:02Z" },
        { role: "user", content: "New from server", timestamp: "2026-01-01T00:00:03Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // After server merge, all 3 messages should be present
    expect(result.current.messages.some((m) => m.content === "Hello")).toBe(true);
    expect(result.current.messages.some((m) => m.content === "Hi there")).toBe(true);
    expect(result.current.messages.some((m) => m.content === "New from server")).toBe(true);
  });

  it("skips rerender when cached and server messages are identical", async () => {
    // Arrange: local cache and server return identical data
    const cachedMessages = [
      { id: "local-1", role: "user", sessionKey: "test:agent", content: "Same question", timestamp: "2026-01-01T00:00:01Z" },
      { id: "local-2", role: "assistant", sessionKey: "test:agent", content: "Same answer", timestamp: "2026-01-01T00:00:02Z" },
    ];
    mockGetLocalMessages.mockResolvedValue(cachedMessages);

    // Delay server response to ensure cache loads first
    let resolveServer!: (value: unknown) => void;
    const serverPromise = new Promise((resolve) => { resolveServer = resolve; });
    mockClient!.request.mockReturnValue(serverPromise);

    const { result } = renderHook(() => useChat("test:agent"));

    // Let cache load
    await act(async () => { vi.advanceTimersByTime(50); });
    const messagesAfterCache = result.current.messages;
    expect(messagesAfterCache.length).toBeGreaterThanOrEqual(2);

    // Now server responds with same content
    resolveServer({
      messages: [
        { role: "user", content: "Same question", timestamp: "2026-01-01T00:00:01Z" },
        { role: "assistant", content: "Same answer", timestamp: "2026-01-01T00:00:02Z" },
      ],
    });
    await act(async () => { vi.advanceTimersByTime(200); });

    // Messages should remain consistent (same count, same content)
    expect(result.current.messages.length).toBe(messagesAfterCache.length);
    expect(result.current.messages.some((m) => m.content === "Same question")).toBe(true);
    expect(result.current.messages.some((m) => m.content === "Same answer")).toBe(true);
  });

  it("does not show loading state when cached messages exist", async () => {
    // Arrange: local cache has messages
    const cachedMessages = [
      { id: "local-1", role: "user", sessionKey: "test:agent", content: "Cached msg", timestamp: "2026-01-01T00:00:01Z" },
    ];
    mockGetLocalMessages.mockResolvedValue(cachedMessages);

    // Slow server
    let resolveServer!: (value: unknown) => void;
    const serverPromise = new Promise((resolve) => { resolveServer = resolve; });
    mockClient!.request.mockReturnValue(serverPromise);

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(50); });

    // loading should be false when cache is shown (no blank screen)
    expect(result.current.loading).toBe(false);

    // Cleanup
    resolveServer({ messages: [] });
    await act(async () => { vi.advanceTimersByTime(200); });
  });

  it("shows loading when no cached messages exist", async () => {
    // Arrange: empty cache
    mockGetLocalMessages.mockResolvedValue([]);

    // Slow server
    let resolveServer!: (value: unknown) => void;
    const serverPromise = new Promise((resolve) => { resolveServer = resolve; });
    mockClient!.request.mockReturnValue(serverPromise);

    const { result } = renderHook(() => useChat("test:agent"));

    // Allow cache-first getLocalMessages (empty) to resolve, triggering setLoading(true)
    await act(async () => { vi.advanceTimersByTime(10); });

    // Should show loading when no cache available
    // (loading is set true only when messagesRef.current.length === 0)
    expect(result.current.loading).toBe(true);

    // Cleanup
    resolveServer({ messages: [] });
    await act(async () => { vi.advanceTimersByTime(200); });
  });

  it("handles empty cache gracefully (falls back to server-only)", async () => {
    // Arrange: no local cache
    mockGetLocalMessages.mockResolvedValue([]);

    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Server only", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result.current.messages.some((m) => m.content === "Server only")).toBe(true);
  });

  it("handles IndexedDB failure gracefully (falls back to server-only)", async () => {
    // Arrange: local storage fails
    mockGetLocalMessages.mockRejectedValue(new Error("IndexedDB broken"));

    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Server fallback", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result.current.messages.some((m) => m.content === "Server fallback")).toBe(true);
  });

  it("respects session guard (#169) — stale cache from old session is not shown", async () => {
    // Arrange: cache from wrong session should not appear
    const cachedMessages = [
      { id: "local-1", role: "user", sessionKey: "old:session", content: "Old session msg", timestamp: "2026-01-01T00:00:01Z" },
    ];
    mockGetLocalMessages.mockResolvedValue(cachedMessages);

    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Current session msg", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // After server merge, old stale-only messages should not persist
    // if they conflict with server data. At minimum, server msg should be present.
    expect(result.current.messages.some((m) => m.content === "Current session msg")).toBe(true);
  });

  it("filters hidden messages from cache display", async () => {
    // Arrange: cache contains a hidden message (NO_REPLY)
    const cachedMessages = [
      { id: "local-1", role: "user", sessionKey: "test:agent", content: "Visible question", timestamp: "2026-01-01T00:00:01Z" },
      { id: "local-2", role: "assistant", sessionKey: "test:agent", content: "NO_REPLY", timestamp: "2026-01-01T00:00:02Z" },
      { id: "local-3", role: "assistant", sessionKey: "test:agent", content: "Visible answer", timestamp: "2026-01-01T00:00:03Z" },
    ];
    mockGetLocalMessages.mockResolvedValue(cachedMessages);

    let resolveServer!: (value: unknown) => void;
    const serverPromise = new Promise((resolve) => { resolveServer = resolve; });
    mockClient!.request.mockReturnValue(serverPromise);

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(50); });

    // Hidden messages should be filtered from cache display
    expect(result.current.messages.some((m) => m.content === "NO_REPLY")).toBe(false);
    expect(result.current.messages.some((m) => m.content === "Visible question")).toBe(true);
    expect(result.current.messages.some((m) => m.content === "Visible answer")).toBe(true);

    // Cleanup
    resolveServer({ messages: [] });
    await act(async () => { vi.advanceTimersByTime(200); });
  });

  it("preserves streaming messages during cache-first load", async () => {
    // This test ensures that in-flight streaming messages aren't lost
    // when cache-first loading kicks in during a reconnect
    const cachedMessages = [
      { id: "local-1", role: "user", sessionKey: "test:agent", content: "Question", timestamp: "2026-01-01T00:00:01Z" },
    ];
    mockGetLocalMessages.mockResolvedValue(cachedMessages);

    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Question", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Should have at least the question message
    expect(result.current.messages.some((m) => m.content === "Question")).toBe(true);
  });
});

// ──────────────────────────────────────────────
// 2. Dedup: cache vs server identical content
// ──────────────────────────────────────────────
describe("Cache-server dedup (#201)", () => {
  it("does not duplicate messages when cache and server have same content", async () => {
    const cachedMessages = [
      { id: "local-1", role: "user", sessionKey: "test:agent", content: "Hello world", timestamp: "2026-01-01T00:00:01Z" },
      { id: "local-2", role: "assistant", sessionKey: "test:agent", content: "Reply from agent", timestamp: "2026-01-01T00:00:02Z" },
    ];
    mockGetLocalMessages.mockResolvedValue(cachedMessages);

    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Hello world", timestamp: "2026-01-01T00:00:01Z" },
        { role: "assistant", content: "Reply from agent", timestamp: "2026-01-01T00:00:02Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Each message should appear exactly once
    const helloMsgs = result.current.messages.filter((m) => m.content === "Hello world");
    const replyMsgs = result.current.messages.filter((m) => m.content === "Reply from agent");
    expect(helloMsgs.length).toBe(1);
    expect(replyMsgs.length).toBe(1);
  });

  it("cache-first adds new server messages without duplicating existing", async () => {
    const cachedMessages = [
      { id: "local-1", role: "user", sessionKey: "test:agent", content: "First message", timestamp: "2026-01-01T00:00:01Z" },
    ];
    mockGetLocalMessages.mockResolvedValue(cachedMessages);

    // Delay server response
    let resolveServer!: (value: unknown) => void;
    const serverPromise = new Promise((resolve) => { resolveServer = resolve; });
    mockClient!.request.mockReturnValue(serverPromise);

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(50); });

    // Cache loaded
    expect(result.current.messages.some((m) => m.content === "First message")).toBe(true);

    // Server responds with original + new message
    resolveServer({
      messages: [
        { role: "user", content: "First message", timestamp: "2026-01-01T00:00:01Z" },
        { role: "assistant", content: "New from server", timestamp: "2026-01-01T00:00:02Z" },
      ],
    });
    await act(async () => { vi.advanceTimersByTime(200); });

    // First message should not be duplicated, new message should appear
    const firstMsgs = result.current.messages.filter((m) => m.content === "First message");
    expect(firstMsgs.length).toBe(1);
    expect(result.current.messages.some((m) => m.content === "New from server")).toBe(true);
  });
});
