import { describe, expect, it } from "vitest";
import {
  createPendingStreamSnapshot,
  isPendingStreamSnapshotFresh,
  mergeLiveStreamingIntoHistory,
  shouldDeferHistoryReload,
  finalEventKey,
  type DisplayMessage,
} from "@/lib/gateway/hooks";

describe("refresh/reconnect streaming stability", () => {
  it("keeps in-flight assistant bubble when history reloads mid-stream", () => {
    const history: DisplayMessage[] = [
      {
        id: "hist-1",
        role: "user",
        content: "질문",
        timestamp: "2026-03-03T07:00:00.000Z",
        toolCalls: [],
      },
    ];

    const live: DisplayMessage[] = [
      {
        id: "stream-1",
        role: "assistant",
        content: "답변 작성중...",
        timestamp: "2026-03-03T07:00:01.000Z",
        toolCalls: [],
        streaming: true,
      },
    ];

    const merged = mergeLiveStreamingIntoHistory(history, live);
    expect(merged).toHaveLength(2);
    expect(merged[1].id).toBe("stream-1");
    expect(merged[1].streaming).toBe(true);
  });

  it("does not duplicate final message when history already has same semantic content", () => {
    const history: DisplayMessage[] = [
      {
        id: "hist-final",
        role: "assistant",
        content: "최종 답변",
        timestamp: "2026-03-03T07:00:03.000Z",
        toolCalls: [],
      },
    ];

    const live: DisplayMessage[] = [
      {
        id: "stream-1",
        role: "assistant",
        content: "최종   답변",
        timestamp: "2026-03-03T07:00:03.500Z",
        toolCalls: [],
        streaming: true,
      },
    ];

    const merged = mergeLiveStreamingIntoHistory(history, live);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("hist-final");
  });

  it("defers reconnect history reload while streaming is active", () => {
    expect(shouldDeferHistoryReload(true)).toBe(true);
    expect(shouldDeferHistoryReload(false)).toBe(false);
  });

  it("restores only fresh pending stream snapshots (short TTL)", () => {
    const now = 1_700_000_000_000;
    const fresh = createPendingStreamSnapshot({
      runId: "run-1",
      streamId: "stream-1",
      content: "partial",
      toolCalls: [],
      now: now - 10_000,
    });

    const stale = createPendingStreamSnapshot({
      runId: "run-1",
      streamId: "stream-1",
      content: "partial",
      toolCalls: [],
      now: now - 60_000,
    });

    expect(isPendingStreamSnapshotFresh(fresh, now)).toBe(true);
    expect(isPendingStreamSnapshotFresh(stale, now)).toBe(false);
  });

  it("treats duplicate final events for the same runId as idempotent", () => {
    const seen = new Set<string>();
    const key = finalEventKey("run-xyz");
    expect(key).toBe("run:run-xyz");

    if (key) seen.add(key);
    const duplicate = key ? seen.has(key) : false;
    expect(duplicate).toBe(true);

    expect(finalEventKey(null)).toBeNull();
  });
});
