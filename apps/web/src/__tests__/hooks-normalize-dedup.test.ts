/**
 * hooks-normalize-dedup.test.ts — Deep tests for deduplicateMessages and normalization.
 *
 * Tests the actual exported deduplicateMessages function with various edge cases
 * including image placeholder equivalence, attachment fingerprinting, and
 * content normalization.
 */
import { describe, it, expect } from "vitest";
import {
  deduplicateMessages,
  normalizeContentForDedup,
  type DisplayMessage,
  type DisplayAttachment,
} from "@/lib/gateway/hooks";

const T1 = "2026-01-01T00:00:00Z";
const T2 = "2026-01-01T00:00:30Z"; // 30s later (within 60s window)
const T3 = "2026-01-01T00:02:00Z"; // 2min later (beyond 60s window)

function msg(
  overrides: Partial<DisplayMessage> & { id: string },
): DisplayMessage {
  return {
    role: "assistant",
    content: "test",
    timestamp: T1,
    toolCalls: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Basic dedup behavior
// ---------------------------------------------------------------------------
describe("deduplicateMessages — basic", () => {
  it("removes duplicate with same role + content within 60s", () => {
    const msgs = [
      msg({ id: "1", content: "Hello", timestamp: T1 }),
      msg({ id: "2", content: "Hello", timestamp: T2 }),
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("keeps messages with different roles", () => {
    const msgs = [
      msg({ id: "1", role: "user", content: "Hello", timestamp: T1 }),
      msg({ id: "2", role: "assistant", content: "Hello", timestamp: T2 }),
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(2);
  });

  it("keeps messages beyond 60s apart", () => {
    const msgs = [
      msg({ id: "1", content: "Hello", timestamp: T1 }),
      msg({ id: "2", content: "Hello", timestamp: T3 }),
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(2);
  });

  it("always preserves session-boundary", () => {
    const msgs = [
      msg({ id: "1", role: "session-boundary", content: "", timestamp: T1 }),
      msg({ id: "2", role: "session-boundary", content: "", timestamp: T2 }),
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(2);
  });

  it("handles empty array", () => {
    expect(deduplicateMessages([])).toEqual([]);
  });

  it("handles single message", () => {
    const msgs = [msg({ id: "1" })];
    expect(deduplicateMessages(msgs)).toHaveLength(1);
  });

  it("removes triple duplicate keeping first", () => {
    const msgs = [
      msg({ id: "1", content: "Same", timestamp: T1 }),
      msg({ id: "2", content: "Same", timestamp: T2 }),
      msg({ id: "3", content: "Same", timestamp: T2 }),
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });
});

// ---------------------------------------------------------------------------
// Image placeholder equivalence (#115)
// ---------------------------------------------------------------------------
describe("deduplicateMessages — image placeholders", () => {
  it("treats (image) and (첨부 파일) as equivalent", () => {
    const msgs = [
      msg({ id: "1", role: "user", content: "(image)", timestamp: T1 }),
      msg({ id: "2", role: "user", content: "(첨부 파일)", timestamp: T2 }),
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });

  it("treats (이미지) and (image) as equivalent", () => {
    const msgs = [
      msg({ id: "1", role: "user", content: "(이미지)", timestamp: T1 }),
      msg({ id: "2", role: "user", content: "(image)", timestamp: T2 }),
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(1);
  });

  it("treats empty content and (image) as equivalent", () => {
    const msgs = [
      msg({ id: "1", role: "user", content: "", timestamp: T1 }),
      msg({ id: "2", role: "user", content: "(image)", timestamp: T2 }),
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Attachment fingerprinting
// ---------------------------------------------------------------------------
describe("deduplicateMessages — attachments", () => {
  it("distinguishes messages with different attachments", () => {
    const att1: DisplayAttachment[] = [{ fileName: "a.png", mimeType: "image/png", dataUrl: "data:image/png;base64,AAA" }];
    const att2: DisplayAttachment[] = [{ fileName: "b.png", mimeType: "image/png", dataUrl: "data:image/png;base64,BBB" }];

    const msgs = [
      msg({ id: "1", content: "photo", timestamp: T1, attachments: att1 }),
      msg({ id: "2", content: "photo", timestamp: T2, attachments: att2 }),
    ];
    // Same content but different attachments → should be kept as separate
    expect(deduplicateMessages(msgs)).toHaveLength(2);
  });

  it("deduplicates when one side has no attachments (optimistic vs server echo)", () => {
    // Image placeholder with no attachment vs with attachment — for image placeholders,
    // skip attachment comparison if either side has none
    const att: DisplayAttachment[] = [{ fileName: "a.png", mimeType: "image/png", dataUrl: "data:..." }];

    const msgs = [
      msg({ id: "1", role: "user", content: "(image)", timestamp: T1, attachments: att }),
      msg({ id: "2", role: "user", content: "(image)", timestamp: T2 }),
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Whitespace & timestamp normalization
// ---------------------------------------------------------------------------
describe("deduplicateMessages — normalization", () => {
  it("normalizes extra whitespace before comparing", () => {
    const msgs = [
      msg({ id: "1", content: "hello   world", timestamp: T1 }),
      msg({ id: "2", content: "hello world", timestamp: T2 }),
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(1);
  });

  it("strips timestamp prefix before comparing", () => {
    const msgs = [
      msg({ id: "1", role: "user", content: "[2026-01-01 00:00:00+09:00] 질문", timestamp: T1 }),
      msg({ id: "2", role: "user", content: "질문", timestamp: T2 }),
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(1);
  });

  it("strips system wrapper before comparing", () => {
    const msgs = [
      msg({ id: "1", content: "[System] alert", timestamp: T1 }),
      msg({ id: "2", content: "alert", timestamp: T2 }),
    ];
    expect(deduplicateMessages(msgs)).toHaveLength(1);
  });
});
