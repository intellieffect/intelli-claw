/**
 * hooks-streaming-lifecycle.test.ts — Tests for streaming event handling in useChat.
 *
 * Uses renderHook with mocked useGateway to test the streaming state machine:
 * lifecycle.start → assistant.stream → tool-start/end → lifecycle.end
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
  };
});

// Mock local dependencies that useChat imports
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
    const map: Record<string, string> = { png: "image/png", jpg: "image/jpeg", pdf: "application/pdf" };
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
  // Mock chat.history to return empty
  mockClient.request.mockResolvedValue({ messages: [] });
});

afterEach(() => {
  vi.useRealTimers();
  storageCleanup();
  vi.restoreAllMocks();
});

describe("Streaming lifecycle", () => {
  it("lifecycle.start sets streaming=true and agentStatus=thinking", async () => {
    const { result } = renderHook(() => useChat("test:agent"));

    // Wait for initial loadHistory
    await act(async () => { vi.advanceTimersByTime(100); });

    // Emit lifecycle.start
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });

    expect(result.current.streaming).toBe(true);
    expect(result.current.agentStatus.phase).toBe("thinking");
  });

  it("assistant stream chunks accumulate content", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Start streaming
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });

    // Send cumulative chat deltas (each delta contains full text so far)
    act(() => {
      mockClient!.emitEvent(makeChatDelta("Hello ", "test:agent"));
    });

    // Flush rAF
    await act(async () => { vi.advanceTimersByTime(20); });

    act(() => {
      // Chat delta is cumulative — second delta contains "Hello World"
      mockClient!.emitEvent(makeChatDelta("Hello World", "test:agent"));
    });

    await act(async () => { vi.advanceTimersByTime(20); });

    // There should be a streaming message with the latest cumulative content
    const streamingMsg = result.current.messages.find((m) => m.streaming);
    expect(streamingMsg).toBeTruthy();
    expect(streamingMsg!.content).toContain("Hello ");
    expect(streamingMsg!.content).toContain("World");
  });

  it("lifecycle.end finalizes stream (streaming=false, agentStatus=idle)", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });

    act(() => {
      mockClient!.emitEvent(makeChatDelta("Response", "test:agent"));
    });

    await act(async () => { vi.advanceTimersByTime(20); });

    // End lifecycle (no longer finalizes — just records the key)
    act(() => {
      mockClient!.emitEvent(makeLifecycleEnd("test:agent", "run-1"));
    });

    // Chat final is the authoritative finalization signal (#255)
    act(() => {
      mockClient!.emitEvent(makeChatFinal("test:agent", "run-1"));
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");

    // Streaming message should be finalized
    const msg = result.current.messages.find((m) => m.content.includes("Response"));
    if (msg) {
      expect(msg.streaming).toBeFalsy();
    }
  });

  it("hidden reply (NO_REPLY) is removed on finalize", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });

    // Start with normal text, then replace
    act(() => {
      mockClient!.emitEvent(makeChatDelta("NO_REPLY", "test:agent"));
    });

    await act(async () => { vi.advanceTimersByTime(20); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleEnd("test:agent", "run-1"));
    });

    // The NO_REPLY message should be filtered out
    const noReplyMsg = result.current.messages.find((m) => m.content.trim() === "NO_REPLY");
    expect(noReplyMsg).toBeUndefined();
  });

  it("error stream appends error and finalizes", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1"));
    });

    act(() => {
      mockClient!.emitEvent(makeChatDelta("Partial response", "test:agent"));
    });

    await act(async () => { vi.advanceTimersByTime(20); });

    // Error event
    act(() => {
      mockClient!.emitEvent(makeAgentEvent(
        "error",
        { message: "Rate limit exceeded" },
        { sessionKey: "test:agent" },
      ));
    });

    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");

    // Check error was appended
    const errorMsg = result.current.messages.find((m) => m.content.includes("Error"));
    expect(errorMsg).toBeTruthy();
  });

  it("duplicate lifecycle.end for same runId is ignored", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeChatDelta("Text", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    const msgCountBefore = result.current.messages.length;

    // First end
    act(() => { mockClient!.emitEvent(makeLifecycleEnd("test:agent", "run-1")); });
    const msgCountAfterFirst = result.current.messages.length;

    // Second end (duplicate) — should be no-op
    act(() => { mockClient!.emitEvent(makeLifecycleEnd("test:agent", "run-1")); });
    const msgCountAfterSecond = result.current.messages.length;

    expect(msgCountAfterSecond).toBe(msgCountAfterFirst);
  });

  it("events from different sessionKey are ignored", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    // Emit event for different session
    act(() => {
      mockClient!.emitEvent(makeLifecycleStart("other:agent", "run-1"));
    });

    expect(result.current.streaming).toBe(false);

    act(() => {
      mockClient!.emitEvent(makeChatDelta("Should be ignored", "other:agent"));
    });

    await act(async () => { vi.advanceTimersByTime(20); });

    // No streaming messages should be added
    expect(result.current.messages.filter((m) => m.streaming)).toHaveLength(0);
  });

  it("abort immediately stops streaming", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => { mockClient!.emitEvent(makeChatDelta("Partial", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });

    expect(result.current.streaming).toBe(true);

    // Abort
    act(() => { result.current.abort(); });

    expect(result.current.streaming).toBe(false);
    expect(result.current.agentStatus.phase).toBe("idle");
  });

  it("tool-start sets agentStatus to tool phase", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });

    act(() => {
      mockClient!.emitEvent(makeAgentEvent(
        "tool-start",
        { callId: "tc-1", name: "web_search" },
        { sessionKey: "test:agent" },
      ));
    });

    expect(result.current.agentStatus.phase).toBe("tool");
    if (result.current.agentStatus.phase === "tool") {
      expect(result.current.agentStatus.toolName).toBe("web_search");
    }
  });

  it("tool-end sets agentStatus back to thinking", async () => {
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    act(() => {
      mockClient!.emitEvent(makeAgentEvent(
        "tool-start",
        { callId: "tc-1", name: "web_search" },
        { sessionKey: "test:agent" },
      ));
    });
    act(() => {
      mockClient!.emitEvent(makeAgentEvent(
        "tool-end",
        { callId: "tc-1", result: "search results" },
        { sessionKey: "test:agent" },
      ));
    });

    expect(result.current.agentStatus.phase).toBe("thinking");
  });

  it("agentStatus transitions: idle → thinking → writing → tool → thinking → idle", async () => {
    const phases: string[] = [];
    const { result } = renderHook(() => useChat("test:agent"));
    await act(async () => { vi.advanceTimersByTime(100); });

    phases.push(result.current.agentStatus.phase);

    // lifecycle.start → thinking
    act(() => { mockClient!.emitEvent(makeLifecycleStart("test:agent", "run-1")); });
    phases.push(result.current.agentStatus.phase);

    // stream chunk → writing
    act(() => { mockClient!.emitEvent(makeChatDelta("text", "test:agent")); });
    await act(async () => { vi.advanceTimersByTime(20); });
    phases.push(result.current.agentStatus.phase);

    // tool-start → tool
    act(() => {
      mockClient!.emitEvent(makeAgentEvent("tool-start", { callId: "t1", name: "search" }, { sessionKey: "test:agent" }));
    });
    phases.push(result.current.agentStatus.phase);

    // tool-end → thinking
    act(() => {
      mockClient!.emitEvent(makeAgentEvent("tool-end", { callId: "t1", result: "ok" }, { sessionKey: "test:agent" }));
    });
    phases.push(result.current.agentStatus.phase);

    // lifecycle.end (no longer finalizes)
    act(() => { mockClient!.emitEvent(makeLifecycleEnd("test:agent", "run-1")); });

    // chat final → idle (#255)
    act(() => { mockClient!.emitEvent(makeChatFinal("test:agent", "run-1")); });
    phases.push(result.current.agentStatus.phase);

    expect(phases).toEqual(["idle", "thinking", "writing", "tool", "thinking", "idle"]);
  });
});
