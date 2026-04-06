/**
 * #298 — Queue에 메세지 여러개 추가하면 하나로 합쳐지도록
 *
 * When a user rapidly types multiple messages while the agent is still
 * streaming, consecutive queue appends within a small time window should
 * merge into a single entry instead of creating multiple queued messages.
 *
 * This prevents the annoying UX where 3 quick taps produce 3 separate
 * agent responses. Instead, the 3 texts get concatenated with a blank
 * line and sent as one message.
 *
 * Tests exercise the pure `mergeIntoQueue` helper so we don't need to
 * spin up the whole React tree / gateway provider.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mergeIntoQueue, QUEUE_MERGE_WINDOW_MS, type QueueEntry } from "@/lib/gateway/hooks";

describe("#298 — queue merge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-06T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports a sane merge window (>= 1s, <= 10s)", () => {
    expect(QUEUE_MERGE_WINDOW_MS).toBeGreaterThanOrEqual(1_000);
    expect(QUEUE_MERGE_WINDOW_MS).toBeLessThanOrEqual(10_000);
  });

  it("pushes as a new entry when queue is empty", () => {
    const queue: QueueEntry[] = [];
    const result = mergeIntoQueue(queue, {
      id: "msg-1",
      text: "first",
      timestamp: Date.now(),
    });
    expect(result.merged).toBe(false);
    expect(queue).toHaveLength(1);
    expect(queue[0].text).toBe("first");
  });

  it("merges into the tail when the tail is within the merge window", () => {
    const now = Date.now();
    const queue: QueueEntry[] = [
      { id: "msg-1", text: "hello", timestamp: now },
    ];
    const result = mergeIntoQueue(queue, {
      id: "msg-2",
      text: "world",
      timestamp: now + 500, // 500ms later — within 2s window
    });
    expect(result.merged).toBe(true);
    expect(result.mergedIntoId).toBe("msg-1");
    expect(queue).toHaveLength(1);
    expect(queue[0].text).toBe("hello\n\nworld");
    // Timestamp should update to the latest so chained merges stay possible
    expect(queue[0].timestamp).toBe(now + 500);
  });

  it("does NOT merge when the tail is older than the window", () => {
    const now = Date.now();
    const queue: QueueEntry[] = [
      { id: "msg-1", text: "hello", timestamp: now - QUEUE_MERGE_WINDOW_MS - 1 },
    ];
    const result = mergeIntoQueue(queue, {
      id: "msg-2",
      text: "world",
      timestamp: now,
    });
    expect(result.merged).toBe(false);
    expect(queue).toHaveLength(2);
    expect(queue[1].text).toBe("world");
  });

  it("merges a chain of 3 rapid messages into 1 entry", () => {
    const t0 = Date.now();
    const queue: QueueEntry[] = [];
    mergeIntoQueue(queue, { id: "a", text: "one", timestamp: t0 });
    mergeIntoQueue(queue, { id: "b", text: "two", timestamp: t0 + 200 });
    mergeIntoQueue(queue, { id: "c", text: "three", timestamp: t0 + 400 });
    expect(queue).toHaveLength(1);
    expect(queue[0].text).toBe("one\n\ntwo\n\nthree");
  });

  it("does NOT merge when the incoming message has a replyTo target", () => {
    const now = Date.now();
    const queue: QueueEntry[] = [
      { id: "msg-1", text: "hello", timestamp: now },
    ];
    const result = mergeIntoQueue(queue, {
      id: "msg-2",
      text: "re:",
      timestamp: now + 100,
      replyTo: { id: "old-msg", excerpt: "old" },
    });
    expect(result.merged).toBe(false);
    expect(queue).toHaveLength(2);
  });

  it("does NOT merge when the tail entry has attachments", () => {
    const now = Date.now();
    const queue: QueueEntry[] = [
      {
        id: "msg-1",
        text: "hello",
        timestamp: now,
        attachments: [{ id: "a1", type: "image", url: "foo", mime: "image/png" }],
      },
    ];
    const result = mergeIntoQueue(queue, {
      id: "msg-2",
      text: "world",
      timestamp: now + 100,
    });
    expect(result.merged).toBe(false);
    expect(queue).toHaveLength(2);
  });

  it("does NOT merge when the new message has attachments", () => {
    const now = Date.now();
    const queue: QueueEntry[] = [
      { id: "msg-1", text: "hello", timestamp: now },
    ];
    const result = mergeIntoQueue(queue, {
      id: "msg-2",
      text: "world",
      timestamp: now + 100,
      attachments: [{ id: "a1", type: "image", url: "foo", mime: "image/png" }],
    });
    expect(result.merged).toBe(false);
    expect(queue).toHaveLength(2);
  });

  it("respects a custom window override", () => {
    const now = Date.now();
    const queue: QueueEntry[] = [
      { id: "msg-1", text: "hello", timestamp: now - 500 },
    ];
    // Custom window of 100ms — the 500ms gap exceeds it
    const result = mergeIntoQueue(
      queue,
      { id: "msg-2", text: "world", timestamp: now },
      { windowMs: 100 },
    );
    expect(result.merged).toBe(false);
    expect(queue).toHaveLength(2);
  });
});
