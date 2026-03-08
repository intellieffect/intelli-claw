/**
 * inbound-assistant-dedup.test.ts
 *
 * Tests for inbound assistant message content dedup.
 * When a streaming response has already been displayed and the same content
 * arrives again via the "inbound" event, it should be deduplicated.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeContentForDedup,
  type DisplayMessage,
} from "@/lib/gateway/hooks";

function makeMsg(
  overrides: Partial<DisplayMessage> & { id: string },
): DisplayMessage {
  return {
    role: "assistant",
    content: "",
    timestamp: "2026-01-01T00:00:00Z",
    toolCalls: [],
    ...overrides,
  };
}

/**
 * Simulate the inbound assistant dedup logic from hooks.tsx setMessages updater.
 * Returns true if the inbound message would be deduplicated (skipped).
 */
function wouldDedup(
  prev: DisplayMessage[],
  role: string,
  content: string,
): boolean {
  if (role === "assistant") {
    const normalizedInbound = normalizeContentForDedup(content);
    return prev.some(
      (m) =>
        m.role === "assistant" &&
        normalizeContentForDedup(m.content) === normalizedInbound,
    );
  }
  return false;
}

// ---------------------------------------------------------------------------
// Inbound assistant content dedup
// ---------------------------------------------------------------------------
describe("inbound assistant message dedup", () => {
  it("deduplicates when streaming message with same content exists", () => {
    const prev = [
      makeMsg({ id: "user-1", role: "user", content: "Hello" }),
      makeMsg({ id: "stream-1", role: "assistant", content: "Hello world" }),
    ];
    expect(wouldDedup(prev, "assistant", "Hello world")).toBe(true);
  });

  it("allows assistant inbound with different content", () => {
    const prev = [
      makeMsg({ id: "stream-1", role: "assistant", content: "Hello" }),
    ];
    expect(wouldDedup(prev, "assistant", "Goodbye")).toBe(false);
  });

  it("does not apply assistant dedup to user role", () => {
    const prev = [
      makeMsg({ id: "stream-1", role: "assistant", content: "Hello world" }),
    ];
    // user message with same content as an existing assistant message
    // should NOT be deduplicated by the assistant dedup logic
    expect(wouldDedup(prev, "user", "Hello world")).toBe(false);
  });

  it("deduplicates after whitespace normalization", () => {
    const prev = [
      makeMsg({ id: "stream-1", role: "assistant", content: "Hello  world\n" }),
    ];
    expect(wouldDedup(prev, "assistant", "Hello world")).toBe(true);
  });

  it("does not dedup when no assistant messages exist", () => {
    const prev = [
      makeMsg({ id: "user-1", role: "user", content: "Hello world" }),
    ];
    expect(wouldDedup(prev, "assistant", "Hello world")).toBe(false);
  });
});
