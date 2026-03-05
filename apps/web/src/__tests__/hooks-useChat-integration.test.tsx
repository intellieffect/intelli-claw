/**
 * hooks-useChat-integration.test.tsx — Integration tests for the useChat hook.
 *
 * Tests the full hook lifecycle: initial render, loadHistory, sendMessage,
 * cancelQueued, sessionKey change, and reload behavior.
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

vi.mock("@/lib/gateway/message-store", () => ({
  saveMessages: vi.fn().mockResolvedValue(undefined),
  getLocalMessages: vi.fn().mockResolvedValue([]),
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

describe("useChat integration", () => {
  it("initial render: messages=[], streaming=false, loading becomes false", async () => {
    const { result } = renderHook(() => useChat("test:agent"));

    // Initially loading should become true then false
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result.current.messages).toEqual([]);
    expect(result.current.streaming).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("loadHistory populates messages from gateway response", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "What is React?", timestamp: "2026-01-01T00:00:01Z" },
        { role: "assistant", content: "React is a JavaScript library...", timestamp: "2026-01-01T00:00:02Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result.current.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.current.messages.some((m) => m.content === "What is React?")).toBe(true);
    expect(result.current.messages.some((m) => m.content.includes("React is a JavaScript"))).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("sendMessage adds optimistic user message immediately", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    act(() => { result.current.sendMessage("Hello agent!"); });

    expect(result.current.messages.some((m) =>
      m.role === "user" && m.content === "Hello agent!",
    )).toBe(true);
  });

  it("sendMessage during streaming queues the message", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Start streaming
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("Response...", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Send a message while streaming
    act(() => { result.current.sendMessage("Follow up question"); });

    const queuedMsg = result.current.messages.find(
      (m) => m.content === "Follow up question",
    );
    expect(queuedMsg).toBeTruthy();
    expect(queuedMsg!.queued).toBe(true);
  });

  it("cancelQueued removes queued message", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Start streaming first
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeStreamChunk("...", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    // Queue a message
    act(() => { result.current.sendMessage("Cancel me"); });

    const queuedMsg = result.current.messages.find(
      (m) => m.content === "Cancel me",
    );
    expect(queuedMsg).toBeTruthy();

    // Cancel it
    act(() => { result.current.cancelQueued(queuedMsg!.id); });

    const afterCancel = result.current.messages.find(
      (m) => m.content === "Cancel me",
    );
    expect(afterCancel).toBeUndefined();
  });

  it("sessionKey change resets all state", async () => {
    let sessionKey = "test:agent-1";
    const { result, rerender } = renderHook(() => useChat(sessionKey));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Add a message
    act(() => { result.current.sendMessage("Message in session 1"); });
    expect(result.current.messages.length).toBeGreaterThan(0);

    // Change session key
    sessionKey = "test:agent-2";
    rerender();
    await act(async () => { vi.advanceTimersByTime(200); });

    // State should be reset
    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("retries chat.send once and uses latest sessionKey during session switch (Issue #50)", async () => {
    let sessionKey = "test:agent-1";
    const { result, rerender } = renderHook(() => useChat(sessionKey));
    await act(async () => { vi.advanceTimersByTime(200); });

    let sendAttempt = 0;
    mockClient!.request.mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === "chat.history") return { messages: [] };
      if (method === "chat.send") {
        sendAttempt++;
        if (sendAttempt === 1) {
          throw new Error("Session bootstrap in progress");
        }
        return { ok: true, params };
      }
      return {};
    });

    // Send while old session is active
    act(() => { result.current.sendMessage("send-through-switch"); });

    // Simulate immediate new-session switch right after user send
    sessionKey = "test:agent-2";
    rerender();

    // Run retry timer + pending microtasks
    await act(async () => {
      await Promise.resolve();
      vi.advanceTimersByTime(300);
      await Promise.resolve();
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    const sendCalls = mockClient!.request.mock.calls.filter((c) => c[0] === "chat.send");
    expect(sendCalls.length).toBe(2);

    // First send used old key, retry should follow latest session key
    expect(sendCalls[0][1]).toMatchObject({ sessionKey: "test:agent-1" });
    expect(sendCalls[1][1]).toMatchObject({ sessionKey: "test:agent-2" });
  });

  it("subsequent loadHistory does NOT show loading (Bug #1 regression)", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "First", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Messages loaded
    expect(result.current.messages.length).toBeGreaterThan(0);

    // Trigger reload
    act(() => { result.current.reload(); });

    // Loading should NOT be true when we already have messages
    expect(result.current.loading).toBe(false);

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(result.current.loading).toBe(false);
  });

  it("reload function triggers fresh loadHistory", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    const callCountBefore = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.history",
    ).length;

    act(() => { result.current.reload(); });
    await act(async () => { vi.advanceTimersByTime(200); });

    const callCountAfter = mockClient!.request.mock.calls.filter(
      (c) => c[0] === "chat.history",
    ).length;

    expect(callCountAfter).toBeGreaterThan(callCountBefore);
  });

  it("sendMessage with replyTo includes reply context", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "assistant", content: "Original message", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    // Set reply target
    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    if (assistantMsg) {
      act(() => { result.current.setReplyTo(assistantMsg); });
      expect(result.current.replyingTo).toBeTruthy();

      // Send with reply
      act(() => { result.current.sendMessage("My reply"); });

      const replyMsg = result.current.messages.find(
        (m) => m.content === "My reply",
      );
      expect(replyMsg).toBeTruthy();
      expect(replyMsg!.replyTo).toBeTruthy();

      // Reply should be cleared after sending
      expect(result.current.replyingTo).toBeNull();
    }
  });

  it("clearReplyTo removes the reply target", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "assistant", content: "Some message", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    const assistantMsg = result.current.messages.find((m) => m.role === "assistant");
    if (assistantMsg) {
      act(() => { result.current.setReplyTo(assistantMsg); });
      expect(result.current.replyingTo).toBeTruthy();

      act(() => { result.current.clearReplyTo(); });
      expect(result.current.replyingTo).toBeNull();
    }
  });

  it("clearMessages empties the message list", async () => {
    mockClient!.request.mockResolvedValue({
      messages: [
        { role: "user", content: "Hello", timestamp: "2026-01-01T00:00:01Z" },
      ],
    });

    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result.current.messages.length).toBeGreaterThan(0);

    act(() => { result.current.clearMessages(); });

    expect(result.current.messages).toHaveLength(0);
  });

  it("addLocalMessage appends a system message", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(200); });

    act(() => { result.current.addLocalMessage("System notification"); });

    const sysMsg = result.current.messages.find(
      (m) => m.content === "System notification" && m.role === "system",
    );
    expect(sysMsg).toBeTruthy();
  });
});
