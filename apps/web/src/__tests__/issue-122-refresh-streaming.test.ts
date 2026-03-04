import { describe, expect, it } from "vitest";
import {
  mergeLiveStreamingIntoHistory,
  shouldDeferHistoryReload,
  shouldSuppressStreamingPreview,
  type DisplayMessage,
} from "@/lib/gateway/hooks";

function msg(partial: Partial<DisplayMessage>): DisplayMessage {
  return {
    id: partial.id || "m-1",
    role: partial.role || "assistant",
    content: partial.content || "",
    timestamp: partial.timestamp || "2026-03-03T07:00:00.000Z",
    toolCalls: partial.toolCalls || [],
    attachments: partial.attachments,
    streaming: partial.streaming,
  };
}

describe("#122 — refresh during streaming", () => {
  it("keeps in-flight streaming message when history does not contain it", () => {
    const history = [msg({ id: "hist-1", role: "user", content: "hello" })];
    const live = [msg({ id: "stream-1", content: "typing...", streaming: true })];

    const merged = mergeLiveStreamingIntoHistory(history, live);
    expect(merged.map((m) => m.id)).toEqual(["hist-1", "stream-1"]);
    expect(merged[1].streaming).toBe(true);
  });

  it("drops stream-* message when equivalent history message already exists", () => {
    const history = [msg({ id: "hist-1", content: "최종 답변입니다" })];
    const live = [msg({ id: "stream-1", content: "최종 답변입니다", streaming: true })];

    const merged = mergeLiveStreamingIntoHistory(history, live);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("hist-1");
  });

  it("defers history reload when reconnect happens during streaming", () => {
    expect(shouldDeferHistoryReload(true)).toBe(true);
    expect(shouldDeferHistoryReload(false)).toBe(false);
  });

  it("suppresses hidden/control token previews while streaming", () => {
    expect(shouldSuppressStreamingPreview("N")).toBe(true);
    expect(shouldSuppressStreamingPreview("NO")).toBe(true);
    expect(shouldSuppressStreamingPreview("NO_REPLY")).toBe(true);
    expect(shouldSuppressStreamingPreview("HEARTBEAT_OK")).toBe(true);
    expect(shouldSuppressStreamingPreview("REPLY_SKIP")).toBe(true);
    expect(shouldSuppressStreamingPreview("REPLY_")).toBe(true);
    expect(shouldSuppressStreamingPreview("NO problem")).toBe(false);
    expect(shouldSuppressStreamingPreview("Normal content")).toBe(false);
    expect(shouldSuppressStreamingPreview("REPLY to this")).toBe(false);
  });
});
