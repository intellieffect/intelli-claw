/**
 * TDD tests for Issue #115: 이미지 포함 메시지 중복 렌더링
 *
 * Problems:
 * 1. deduplicateMessages() doesn't consider attachments — two different image
 *    messages with empty/same placeholder content get incorrectly deduped.
 * 2. Optimistic user messages with images aren't properly matched with
 *    server echoes when content is a generic placeholder.
 * 3. Queued flag on optimistic messages not cleared after streaming ends.
 */
import { describe, it, expect } from "vitest";
import { deduplicateMessages } from "@/lib/gateway/hooks";
import type { DisplayMessage, DisplayAttachment } from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(
  overrides: Partial<DisplayMessage> & { id: string; role: DisplayMessage["role"] },
): DisplayMessage {
  return {
    content: "",
    timestamp: new Date().toISOString(),
    toolCalls: [],
    ...overrides,
  };
}

function makeAttachment(dataUrl: string): DisplayAttachment {
  return { fileName: "image.png", mimeType: "image/png", dataUrl };
}

const NOW = "2026-03-03T01:00:00.000Z";
const NOW_PLUS_5S = "2026-03-03T01:00:05.000Z";
const NOW_PLUS_30S = "2026-03-03T01:00:30.000Z";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Issue #115: deduplicateMessages with image attachments", () => {
  it("should dedup identical image messages (same content + same attachments)", () => {
    const att = [makeAttachment("data:image/png;base64,AAA")];
    const msgs: DisplayMessage[] = [
      makeMsg({ id: "opt-1", role: "user", content: "(image)", timestamp: NOW, attachments: att }),
      makeMsg({ id: "srv-1", role: "user", content: "(image)", timestamp: NOW_PLUS_5S, attachments: att }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("opt-1"); // keeps first (optimistic)
  });

  it("should NOT dedup different image messages with same placeholder content but different attachments", () => {
    const att1 = [makeAttachment("data:image/png;base64,AAA")];
    const att2 = [makeAttachment("data:image/png;base64,BBB")];
    const msgs: DisplayMessage[] = [
      makeMsg({ id: "msg-1", role: "user", content: "(image)", timestamp: NOW, attachments: att1 }),
      makeMsg({ id: "msg-2", role: "user", content: "(image)", timestamp: NOW_PLUS_30S, attachments: att2 }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("should NOT dedup messages with same content but one has attachments and the other doesn't", () => {
    const att = [makeAttachment("data:image/png;base64,AAA")];
    const msgs: DisplayMessage[] = [
      makeMsg({ id: "msg-1", role: "user", content: "hello", timestamp: NOW }),
      makeMsg({ id: "msg-2", role: "user", content: "hello", timestamp: NOW_PLUS_5S, attachments: att }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("should dedup text-only messages exactly as before (no regression)", () => {
    const msgs: DisplayMessage[] = [
      makeMsg({ id: "msg-1", role: "user", content: "hello world", timestamp: NOW }),
      makeMsg({ id: "msg-2", role: "user", content: "hello world", timestamp: NOW_PLUS_5S }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });

  it("should dedup optimistic + server echo for image message with identical attachments", () => {
    const att = [makeAttachment("data:image/png;base64,IMGDATA")];
    const msgs: DisplayMessage[] = [
      makeMsg({
        id: "user-1709420400000-abc",
        role: "user",
        content: "",
        timestamp: NOW,
        attachments: att,
        queued: true,
      }),
      makeMsg({
        id: "hist-5",
        role: "user",
        content: "",
        timestamp: NOW_PLUS_5S,
        attachments: att,
      }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });

  it("should handle empty content + no attachments as duplicates (existing behavior)", () => {
    const msgs: DisplayMessage[] = [
      makeMsg({ id: "msg-1", role: "user", content: "", timestamp: NOW }),
      makeMsg({ id: "msg-2", role: "user", content: "", timestamp: NOW_PLUS_5S }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });

  it("should NOT dedup messages with different attachment counts", () => {
    const att1 = [makeAttachment("data:image/png;base64,AAA")];
    const att2 = [
      makeAttachment("data:image/png;base64,AAA"),
      makeAttachment("data:image/png;base64,BBB"),
    ];
    const msgs: DisplayMessage[] = [
      makeMsg({ id: "msg-1", role: "user", content: "", timestamp: NOW, attachments: att1 }),
      makeMsg({ id: "msg-2", role: "user", content: "", timestamp: NOW_PLUS_5S, attachments: att2 }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("should always keep session-boundary messages", () => {
    const msgs: DisplayMessage[] = [
      makeMsg({ id: "sb-1", role: "session-boundary" as any, content: "", timestamp: NOW }),
      makeMsg({ id: "sb-2", role: "session-boundary" as any, content: "", timestamp: NOW_PLUS_5S }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(2);
  });

  it("should handle mixed text + image messages without false dedup", () => {
    const att = [makeAttachment("data:image/png;base64,AAA")];
    const msgs: DisplayMessage[] = [
      makeMsg({ id: "msg-1", role: "user", content: "check this image", timestamp: NOW, attachments: att }),
      makeMsg({ id: "msg-2", role: "assistant", content: "I see the image", timestamp: NOW_PLUS_5S }),
      makeMsg({ id: "msg-3", role: "user", content: "check this image", timestamp: NOW_PLUS_30S }),
    ];

    const result = deduplicateMessages(msgs);
    // msg-3 has same content as msg-1 but no attachments — should NOT be deduped
    expect(result).toHaveLength(3);
  });

  it("should dedup system bridge variants like [System] vs (System)", () => {
    const msgs: DisplayMessage[] = [
      makeMsg({
        id: "sys-1",
        role: "assistant",
        content: "[System] 이전 세션이 컨텍스트 한도로 갱신되었습니다. 아래는 최근 대화 요약입니다.",
        timestamp: NOW,
      }),
      makeMsg({
        id: "sys-2",
        role: "assistant",
        content: "(System) 이전 세션이 컨텍스트 한도로 갱신되었습니다. 아래는 최근 대화 요약입니다.",
        timestamp: NOW_PLUS_5S,
      }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });

  it("should dedup user text with gateway timestamp prefix vs clean text", () => {
    const msgs: DisplayMessage[] = [
      makeMsg({
        id: "u-1",
        role: "user",
        content: "[2026-03-03 15:10:00+09:00] 나와 우리 회사의 재정상황에 대해 파악해봐",
        timestamp: NOW,
      }),
      makeMsg({
        id: "u-2",
        role: "user",
        content: "나와 우리 회사의 재정상황에 대해 파악해봐",
        timestamp: NOW_PLUS_5S,
      }),
    ];

    const result = deduplicateMessages(msgs);
    expect(result).toHaveLength(1);
  });
});
