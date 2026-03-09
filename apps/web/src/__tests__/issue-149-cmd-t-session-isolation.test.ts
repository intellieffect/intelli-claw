/**
 * issue-149-cmd-t-session-isolation.test.ts
 *
 * TDD tests for #149: Cmd+T creates a new topic but displays messages from
 * an existing session instead of showing a blank chat.
 *
 * Root causes identified:
 * 1. The backfill effect extracts agentId from sessionKey and fetches ALL
 *    previous sessions for that agent — even for brand new thread sessions.
 *    After backfilling, it calls loadHistory() which merges backfilled data
 *    into the new (empty) thread, making old messages appear.
 * 2. Stale history responses from concurrent loadHistory calls could
 *    overwrite the cleared message state.
 *
 * Tests verify:
 * 1. New session key is immediately used (no fallback to main)
 * 2. Messages are cleared on session switch before history loads
 * 3. Stale history responses for old sessions are discarded
 * 4. Local storage messages don't leak across sessions
 * 5. Backfill is skipped for fresh thread sessions (no previous topics)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { createMockClient, type MockClient } from "./helpers/mock-gateway-client";
import { installMockStorage, type MockStorage } from "./helpers/mock-storage";
import {
  makeGatewayMessage,
  resetFixtureCounter,
} from "./helpers/fixtures";

// ---------------------------------------------------------------------------
// Module mocks (same pattern as hooks-streaming-lifecycle.test.ts)
// ---------------------------------------------------------------------------
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
  deleteMessagesByIds: vi.fn().mockResolvedValue(undefined),
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
    const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg", pdf: "application/pdf" };
    return map[ext] || "application/octet-stream";
  },
}));

import { useChat } from "@/lib/gateway/hooks";

let storageCleanup: () => void;
let mockLocalStorage: MockStorage;
let mockSessionStorage: MockStorage;

beforeEach(() => {
  resetFixtureCounter();
  vi.useFakeTimers();
  const storage = installMockStorage();
  mockLocalStorage = storage.localStorage;
  mockSessionStorage = storage.sessionStorage;
  storageCleanup = storage.cleanup;
  mockClient = createMockClient("agent:testbot:main");
  mockState = "connected";
  mockClient.request.mockResolvedValue({ messages: [] });
});

afterEach(() => {
  vi.useRealTimers();
  storageCleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Issue #149 — Cmd+T new topic session isolation", () => {
  it("switching sessionKey clears messages before loading new history", async () => {
    // Start with main session that has history
    const mainMessages = [
      makeGatewayMessage({ role: "user", content: "Hello from main" }),
      makeGatewayMessage({ role: "assistant", content: "Reply in main" }),
    ];

    mockClient!.request.mockImplementation(async (method: string, params?: any) => {
      if (method === "chat.history") {
        const key = params?.sessionKey;
        if (key === "agent:testbot:main") {
          return { messages: mainMessages };
        }
        // New thread — return empty
        return { messages: [] };
      }
      return {};
    });

    const { result, rerender } = renderHook(
      ({ sessionKey }: { sessionKey: string }) => useChat(sessionKey),
      { initialProps: { sessionKey: "agent:testbot:main" } },
    );

    // Let main session history load
    await act(async () => { vi.advanceTimersByTime(200); });

    // Main session should have messages
    expect(result.current.messages.length).toBeGreaterThan(0);
    expect(result.current.messages.some((m) => m.content.includes("Hello from main"))).toBe(true);

    // Simulate Cmd+T: switch to a brand new thread key
    const newThreadKey = "agent:testbot:main:thread:abc123";

    rerender({ sessionKey: newThreadKey });
    await act(async () => { vi.advanceTimersByTime(200); });

    // New session must have NO messages (empty history, no leaks)
    expect(result.current.messages.length).toBe(0);
    // Verify the main session messages are NOT present
    expect(result.current.messages.some((m) => m.content.includes("Hello from main"))).toBe(false);
  });

  it("stale history response from old session is discarded after key change", async () => {
    // Simulate a slow response: main session history takes 500ms
    let resolveMainHistory: ((value: unknown) => void) | null = null;

    mockClient!.request.mockImplementation(async (method: string, params?: any) => {
      if (method === "chat.history") {
        const key = params?.sessionKey;
        if (key === "agent:testbot:main") {
          // Slow response — will be pending when session switches
          return new Promise((resolve) => { resolveMainHistory = resolve; });
        }
        return { messages: [] };
      }
      return {};
    });

    const { result, rerender } = renderHook(
      ({ sessionKey }: { sessionKey: string }) => useChat(sessionKey),
      { initialProps: { sessionKey: "agent:testbot:main" } },
    );

    // Don't wait for main history yet — switch immediately
    await act(async () => { vi.advanceTimersByTime(10); });

    // Switch to new thread before main history resolves
    const newThreadKey = "agent:testbot:main:thread:def456";
    rerender({ sessionKey: newThreadKey });
    await act(async () => { vi.advanceTimersByTime(10); });

    // Now resolve the stale main history
    if (resolveMainHistory) {
      await act(async () => {
        resolveMainHistory!({
          messages: [
            makeGatewayMessage({ role: "user", content: "Stale main message" }),
            makeGatewayMessage({ role: "assistant", content: "Stale reply" }),
          ],
        });
        vi.advanceTimersByTime(200);
      });
    }

    // The stale response must NOT appear in the new session
    expect(result.current.messages.some((m) => m.content.includes("Stale"))).toBe(false);
    expect(result.current.messages.length).toBe(0);
  });

  it("local storage messages do not leak from main session to new thread", async () => {
    // Pre-populate local storage with messages for the main session
    const { getLocalMessages } = await import("@/lib/gateway/message-store");
    const mockedGetLocal = vi.mocked(getLocalMessages);

    mockedGetLocal.mockImplementation(async (sessionKey: string) => {
      if (sessionKey === "agent:testbot:main") {
        return [
          {
            sessionKey: "agent:testbot:main",
            id: "local-1",
            role: "user",
            content: "Local main message",
            timestamp: new Date().toISOString(),
          },
        ];
      }
      return [];
    });

    mockClient!.request.mockImplementation(async (method: string, params?: any) => {
      if (method === "chat.history") {
        return { messages: [] };
      }
      return {};
    });

    const { result, rerender } = renderHook(
      ({ sessionKey }: { sessionKey: string }) => useChat(sessionKey),
      { initialProps: { sessionKey: "agent:testbot:main" } },
    );

    await act(async () => { vi.advanceTimersByTime(200); });

    // Switch to new thread
    rerender({ sessionKey: "agent:testbot:main:thread:ghi789" });
    await act(async () => { vi.advanceTimersByTime(200); });

    // New thread must not show main session's local messages
    expect(result.current.messages.some((m) => m.content.includes("Local main message"))).toBe(false);
    expect(result.current.messages.length).toBe(0);
  });

  it("restoredFromSnapshotRef does not block clearing on genuine new topic creation", async () => {
    // This tests the specific edge case where restoredFromSnapshotRef might
    // prevent message clearing during a genuine Cmd+T session switch

    const mainMessages = [
      makeGatewayMessage({ role: "assistant", content: "Snapshot content" }),
    ];

    mockClient!.request.mockImplementation(async (method: string, params?: any) => {
      if (method === "chat.history") {
        if (params?.sessionKey === "agent:testbot:main") {
          return { messages: mainMessages };
        }
        return { messages: [] };
      }
      return {};
    });

    const { result, rerender } = renderHook(
      ({ sessionKey }: { sessionKey: string }) => useChat(sessionKey),
      { initialProps: { sessionKey: "agent:testbot:main" } },
    );

    // Load main session
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(result.current.messages.length).toBeGreaterThan(0);

    // Now simulate Cmd+T creating a brand new thread
    // Even if there's a pending stream snapshot situation, the new thread must start clean
    rerender({ sessionKey: "agent:testbot:main:thread:jkl012" });
    await act(async () => { vi.advanceTimersByTime(200); });

    expect(result.current.messages.length).toBe(0);
    expect(result.current.streaming).toBe(false);
  });

  it("rapid Cmd+T presses only show the final new session", async () => {
    // User presses Cmd+T multiple times quickly
    const mainMessages = [
      makeGatewayMessage({ role: "user", content: "Main conversation" }),
    ];

    mockClient!.request.mockImplementation(async (method: string, params?: any) => {
      if (method === "chat.history") {
        if (params?.sessionKey === "agent:testbot:main") {
          return { messages: mainMessages };
        }
        return { messages: [] };
      }
      return {};
    });

    const { result, rerender } = renderHook(
      ({ sessionKey }: { sessionKey: string }) => useChat(sessionKey),
      { initialProps: { sessionKey: "agent:testbot:main" } },
    );

    await act(async () => { vi.advanceTimersByTime(200); });

    // Rapid switches
    rerender({ sessionKey: "agent:testbot:main:thread:rapid1" });
    await act(async () => { vi.advanceTimersByTime(5); });
    rerender({ sessionKey: "agent:testbot:main:thread:rapid2" });
    await act(async () => { vi.advanceTimersByTime(5); });
    rerender({ sessionKey: "agent:testbot:main:thread:rapid3" });
    await act(async () => { vi.advanceTimersByTime(200); });

    // Only the last session's state should be active — empty
    expect(result.current.messages.length).toBe(0);
    expect(result.current.messages.some((m) => m.content.includes("Main conversation"))).toBe(false);
  });

  it("backfill effect does NOT inject old agent messages into fresh thread (#149)", async () => {
    // Core bug: The backfill effect fetches /api/session-history/{agentId}
    // for ALL sessions including fresh threads. When the API returns previous
    // sessions, their messages get backfilled into IndexedDB under the THREAD key,
    // and loadHistory() re-merges them via getLocalMessages, making old messages
    // appear in a brand new Cmd+T chat.
    const { backfillFromApi, isBackfillDone, getLocalMessages, saveMessages } = await import("@/lib/gateway/message-store");
    const mockedBackfillFromApi = vi.mocked(backfillFromApi);
    const mockedIsBackfillDone = vi.mocked(isBackfillDone);
    const mockedGetLocalMessages = vi.mocked(getLocalMessages);
    const mockedSaveMessages = vi.mocked(saveMessages);

    // Simulate the real IndexedDB behavior: after backfill, getLocalMessages
    // returns the backfilled messages (stored under the thread's sessionKey)
    const backfilledMessages = [
      {
        sessionKey: "agent:testbot:main:thread:freshthread149",
        id: "backfill-1",
        role: "user",
        content: "Old conversation from previous session",
        timestamp: "2026-01-01T00:00:00Z",
      },
      {
        sessionKey: "agent:testbot:main:thread:freshthread149",
        id: "backfill-2",
        role: "assistant",
        content: "Old reply that should NOT appear in new thread",
        timestamp: "2026-01-01T00:00:01Z",
      },
    ];

    let backfillDone = false;
    mockedIsBackfillDone.mockReturnValue(false);
    mockedBackfillFromApi.mockImplementation(async () => {
      backfillDone = true;
      return backfilledMessages as any;
    });
    // After backfill, getLocalMessages returns the stored messages
    mockedGetLocalMessages.mockImplementation(async (key: string) => {
      if (backfillDone && key.includes("freshthread149")) {
        return backfilledMessages as any;
      }
      return [];
    });

    // Mock fetch to return a previous session (simulating production behavior)
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (typeof url === "string" && url.includes("/api/session-history/")) {
        return {
          ok: true,
          json: async () => ({
            sessions: [
              { sessionId: "old-session-001", startedAt: "2026-01-01T00:00:00Z", messageCount: 5 },
              { sessionId: "current-session-002", startedAt: "2026-03-05T00:00:00Z", messageCount: 0 },
            ],
          }),
        };
      }
      return { ok: false, status: 404 };
    }) as any;

    mockClient!.request.mockImplementation(async (method: string, params?: any) => {
      if (method === "chat.history") {
        return { messages: [] };
      }
      return {};
    });

    // Render with a fresh thread key (simulating Cmd+T)
    const threadKey = "agent:testbot:main:thread:freshthread149";
    const { result } = renderHook(() => useChat(threadKey));

    await act(async () => { vi.advanceTimersByTime(2000); });

    // Restore fetch
    globalThis.fetch = originalFetch;

    // The fresh thread MUST NOT contain any backfilled messages
    const hasOldMessages = result.current.messages.some(
      (m) => m.content.includes("Old conversation") || m.content.includes("should NOT appear"),
    );
    expect(hasOldMessages).toBe(false);
    expect(result.current.messages.length).toBe(0);
  });
});
