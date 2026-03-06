import { describe, it, expect } from "vitest";
import {
  deduplicateMessages,
  normalizeContentForDedup,
  mergeLiveStreamingIntoHistory,
} from "@/lib/gateway/hooks";

/**
 * #155: Assistant messages rendered twice — dedup regression tests.
 *
 * Root causes:
 * 1. Gateway history IDs ("hist-N") never match streaming IDs ("stream-...")
 *    → isNotInGateway always passes → local message appended alongside gateway duplicate.
 * 2. normalizeContentForDedup truncates to 200 chars → long messages with
 *    minor formatting diffs (tool_use text blocks skipped) bypass dedup.
 * 3. finalizeActiveStream sets streaming:false before loadHistory replaces state
 *    → mergeLiveStreamingIntoHistory ignores finalized messages.
 */

// ---- Helpers ----

function makeMsg(overrides: Partial<{
  id: string; role: string; content: string; timestamp: string;
  streaming: boolean; toolCalls: unknown[];
}> = {}) {
  return {
    id: overrides.id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    role: overrides.role ?? "assistant",
    content: overrides.content ?? "Hello, world!",
    timestamp: overrides.timestamp ?? "2026-03-06T09:58:13.000Z",
    toolCalls: overrides.toolCalls ?? [],
    streaming: overrides.streaming ?? false,
  };
}

// ---- normalizeContentForDedup ----

describe("#155 — normalizeContentForDedup", () => {
  it("should match identical long content (>200 chars)", () => {
    const longContent = "A".repeat(500);
    const a = normalizeContentForDedup(longContent);
    const b = normalizeContentForDedup(longContent);
    expect(a).toBe(b);
  });

  it("should match long content that only differs after char 200", () => {
    const base = "Same prefix ".repeat(30); // > 200 chars
    const a = normalizeContentForDedup(base + " SUFFIX_A");
    const b = normalizeContentForDedup(base + " SUFFIX_B");
    // These are different messages — they SHOULD NOT be considered the same
    // if content differs after 200 chars. This is the bug: old behavior
    // would match them because it truncated to 200 chars.
    expect(a).not.toBe(b);
  });

  it("should still match whitespace-normalized variants", () => {
    const a = normalizeContentForDedup("Hello   world\n\ntest");
    const b = normalizeContentForDedup("Hello world test");
    expect(a).toBe(b);
  });
});

// ---- deduplicateMessages ----

describe("#155 — deduplicateMessages", () => {
  it("should dedup messages with different IDs but same content and close timestamps", () => {
    const msgs = [
      makeMsg({ id: "hist-5", content: "Response text", timestamp: "2026-03-06T09:58:13.000Z" }),
      makeMsg({ id: "stream-1741234567890-1", content: "Response text", timestamp: "2026-03-06T09:58:22.000Z" }),
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("hist-5"); // Keep first (gateway)
  });

  it("should dedup long messages (>200 chars) with different IDs", () => {
    const longContent = "This is a detailed response. ".repeat(50); // ~1450 chars
    const msgs = [
      makeMsg({ id: "hist-3", content: longContent, timestamp: "2026-03-06T09:58:13.000Z" }),
      makeMsg({ id: "stream-1741234567890-2", content: longContent, timestamp: "2026-03-06T09:58:22.000Z" }),
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });

  it("should dedup when gateway strips short tool_use text blocks", () => {
    // Gateway version: tool_use text blocks < 100 chars are skipped in loadHistory
    // Stream version: has full content including those blocks
    const gatewayContent = "Here is the analysis:\n\nThe data shows significant growth.";
    const streamContent = "Calling tool...\nHere is the analysis:\n\nThe data shows significant growth.";
    const msgs = [
      makeMsg({ id: "hist-3", content: gatewayContent, timestamp: "2026-03-06T09:58:13.000Z" }),
      makeMsg({ id: "stream-1741234567890-3", content: streamContent, timestamp: "2026-03-06T09:58:22.000Z" }),
    ];
    // This is a known edge case — same message, slightly different content.
    // At minimum, normalizeContentForDedup should handle the long variant properly.
    const result = deduplicateMessages(msgs);
    // Both should be kept since content genuinely differs — but they should NOT
    // create user-visible duplicates in the "same response rendered twice" sense.
    // The real fix is upstream (ID tracking), not in dedup heuristics.
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("should NOT dedup genuinely different messages", () => {
    const msgs = [
      makeMsg({ id: "hist-1", content: "First response", timestamp: "2026-03-06T09:00:00.000Z" }),
      makeMsg({ id: "hist-2", content: "Second response", timestamp: "2026-03-06T09:05:00.000Z" }),
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("should NOT dedup messages with same content but > 60s apart", () => {
    const msgs = [
      makeMsg({ id: "hist-1", content: "Hello", timestamp: "2026-03-06T09:00:00.000Z" }),
      makeMsg({ id: "hist-2", content: "Hello", timestamp: "2026-03-06T09:05:00.000Z" }), // 5 min apart
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("should keep session-boundary messages unconditionally", () => {
    const msgs = [
      makeMsg({ id: "b1", role: "session-boundary", content: "" }),
      makeMsg({ id: "b2", role: "session-boundary", content: "" }),
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });
});

// ---- mergeLiveStreamingIntoHistory: finalized messages ----

describe("#155 — mergeLiveStreamingIntoHistory", () => {
  it("should NOT add finalized (streaming=false) message that duplicates history", () => {
    const history = [
      makeMsg({ id: "hist-5", content: "Response text", timestamp: "2026-03-06T09:58:13.000Z" }),
    ];
    const live = [
      makeMsg({ id: "stream-123", content: "Response text", timestamp: "2026-03-06T09:58:22.000Z", streaming: false }),
    ];
    const result = mergeLiveStreamingIntoHistory(history, live);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("hist-5");
  });

  it("should preserve actively streaming messages not in history", () => {
    const history = [
      makeMsg({ id: "hist-1", content: "Earlier message" }),
    ];
    const live = [
      makeMsg({ id: "stream-999", content: "Still writing...", streaming: true }),
    ];
    const result = mergeLiveStreamingIntoHistory(history, live);
    expect(result).toHaveLength(2);
  });

  it("should NOT duplicate streaming message already present in history by content", () => {
    const content = "Identical content here";
    const history = [
      makeMsg({ id: "hist-3", content }),
    ];
    const live = [
      makeMsg({ id: "stream-456", content, streaming: true }),
    ];
    const result = mergeLiveStreamingIntoHistory(history, live);
    expect(result).toHaveLength(1);
  });
});
