/**
 * optimistic-dedup.test.ts — #115 이미지 포함 메시지 중복 렌더링 수정
 *
 * TDD: 옵티미스틱 UI에서 추가한 사용자 메시지와 서버에서 반환한 히스토리 메시지가
 * 중복되지 않도록 dedup 로직을 검증한다.
 */
import { describe, it, expect } from "vitest";

const IMAGE_PLACEHOLDERS = new Set(["(image)", "(첨부 파일)", "(이미지)", ""]);

function normalizeContentForDedup(content: string): string {
  const trimmed = content.replace(/\s+/g, " ").trim();
  if (IMAGE_PLACEHOLDERS.has(trimmed)) return "(image)";
  return trimmed.slice(0, 200);
}

function deduplicateMessages<
  T extends { id: string; role: string; content: string; timestamp: string },
>(msgs: T[]): T[] {
  const seen: Array<{ role: string; contentKey: string; ts: number }> = [];
  return msgs.filter((m) => {
    if (m.role === "session-boundary") return true;
    const contentKey = normalizeContentForDedup(m.content);
    const ts = new Date(m.timestamp).getTime();
    const isDup = seen.some(
      (s) =>
        s.role === m.role &&
        s.contentKey === contentKey &&
        Math.abs(s.ts - ts) < 60_000,
    );
    if (isDup) return false;
    seen.push({ role: m.role, contentKey, ts });
    return true;
  });
}

describe("#115 — optimistic UI dedup for image messages", () => {
  const now = new Date("2025-03-03T10:00:00Z");

  it("deduplicates (첨부 파일) and (image) as equivalent", () => {
    const msgs = [
      { id: "hist-0", role: "user", content: "(image)", timestamp: now.toISOString() },
      { id: "user-abc", role: "user", content: "(첨부 파일)", timestamp: new Date(now.getTime() + 500).toISOString() },
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("hist-0");
  });

  it("deduplicates empty content user messages with close timestamps", () => {
    const msgs = [
      { id: "hist-1", role: "user", content: "", timestamp: now.toISOString() },
      { id: "user-xyz", role: "user", content: "(image)", timestamp: new Date(now.getTime() + 1000).toISOString() },
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });

  it("deduplicates (이미지) and (image) as equivalent", () => {
    const msgs = [
      { id: "hist-0", role: "user", content: "(image)", timestamp: now.toISOString() },
      { id: "user-kor", role: "user", content: "(이미지)", timestamp: new Date(now.getTime() + 200).toISOString() },
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });

  it("does NOT dedup messages with different text content", () => {
    const msgs = [
      { id: "hist-0", role: "user", content: "이 사진 분석해줘", timestamp: now.toISOString() },
      { id: "user-abc", role: "user", content: "다른 질문", timestamp: new Date(now.getTime() + 500).toISOString() },
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("deduplicates same text user messages within 60s window", () => {
    const msgs = [
      { id: "hist-0", role: "user", content: "이 사진 분석해줘", timestamp: now.toISOString() },
      { id: "user-abc", role: "user", content: "이 사진 분석해줘", timestamp: new Date(now.getTime() + 3000).toISOString() },
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("hist-0");
  });

  it("does NOT dedup messages more than 60s apart", () => {
    const msgs = [
      { id: "hist-0", role: "user", content: "(image)", timestamp: now.toISOString() },
      { id: "user-abc", role: "user", content: "(첨부 파일)", timestamp: new Date(now.getTime() + 90_000).toISOString() },
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("keeps session-boundary messages untouched", () => {
    const msgs = [
      { id: "boundary-1", role: "session-boundary", content: "", timestamp: now.toISOString() },
      { id: "boundary-2", role: "session-boundary", content: "", timestamp: new Date(now.getTime() + 100).toISOString() },
    ];
    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("normalizeContentForDedup treats all image placeholders as (image)", () => {
    expect(normalizeContentForDedup("(image)")).toBe("(image)");
    expect(normalizeContentForDedup("(첨부 파일)")).toBe("(image)");
    expect(normalizeContentForDedup("(이미지)")).toBe("(image)");
    expect(normalizeContentForDedup("")).toBe("(image)");
    expect(normalizeContentForDedup("  ")).toBe("(image)");
    expect(normalizeContentForDedup("hello world")).toBe("hello world");
  });
});
