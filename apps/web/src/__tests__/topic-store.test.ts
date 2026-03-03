import { describe, it, expect, beforeEach } from "vitest";
import {
  getTopicHistory,
  trackSessionId,
  markSessionEnded,
  getCurrentSessionId,
  getTopicCount,
} from "@/lib/gateway/topic-store";

/**
 * Helper: delete the IndexedDB database between tests to ensure isolation.
 */
function deleteDB(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase("intelli-claw-topics");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Small delay helper to ensure distinct Date.now() values */
const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

describe("topic-store", () => {
  beforeEach(async () => {
    await deleteDB();
  });

  // 1. trackSessionId — basic save + meta (label)
  it("trackSessionId stores an entry and getTopicHistory returns it", async () => {
    await trackSessionId("agent:a", "s1");
    const history = await getTopicHistory("agent:a");
    expect(history).toHaveLength(1);
    expect(history[0].sessionKey).toBe("agent:a");
    expect(history[0].sessionId).toBe("s1");
    expect(history[0].startedAt).toBeTypeOf("number");
    expect(history[0].endedAt).toBeUndefined();
  });

  it("trackSessionId stores meta (label)", async () => {
    await trackSessionId("agent:a", "s1", { label: "My Topic" });
    const [entry] = await getTopicHistory("agent:a");
    expect(entry.label).toBe("My Topic");
  });

  // 2. getTopicHistory — sorted by startedAt desc
  it("getTopicHistory returns entries sorted by startedAt desc", async () => {
    await trackSessionId("k", "s1", { startedAt: 100 });
    await trackSessionId("k", "s2", { startedAt: 300 });
    await trackSessionId("k", "s3", { startedAt: 200 });

    const history = await getTopicHistory("k");
    expect(history.map((e) => e.sessionId)).toEqual(["s2", "s3", "s1"]);
  });

  // 3. Session isolation — agent A topics not visible to agent B
  it("sessions are isolated by sessionKey", async () => {
    await trackSessionId("agentA", "s1");
    await trackSessionId("agentB", "s2");

    const historyA = await getTopicHistory("agentA");
    const historyB = await getTopicHistory("agentB");

    expect(historyA).toHaveLength(1);
    expect(historyA[0].sessionId).toBe("s1");
    expect(historyB).toHaveLength(1);
    expect(historyB[0].sessionId).toBe("s2");
  });

  // 4. markSessionEnded — sets endedAt + optional summary/messageCount/totalTokens
  it("markSessionEnded sets endedAt and updates extra fields", async () => {
    await trackSessionId("k", "s1");
    await markSessionEnded("k", "s1", {
      summary: "Great chat",
      messageCount: 42,
      totalTokens: 9000,
    });

    const [entry] = await getTopicHistory("k");
    expect(entry.endedAt).toBeTypeOf("number");
    expect(entry.summary).toBe("Great chat");
    expect(entry.messageCount).toBe(42);
    expect(entry.totalTokens).toBe(9000);
  });

  it("markSessionEnded sets endedAt without extra fields", async () => {
    await trackSessionId("k", "s1");
    await markSessionEnded("k", "s1");

    const [entry] = await getTopicHistory("k");
    expect(entry.endedAt).toBeTypeOf("number");
    expect(entry.summary).toBeUndefined();
  });

  // 5. markSessionEnded for non-existent session — no error
  it("markSessionEnded on non-existent session resolves without error", async () => {
    await expect(
      markSessionEnded("k", "nonexistent"),
    ).resolves.toBeUndefined();
  });

  // 6. getCurrentSessionId — returns most recent entry without endedAt
  it("getCurrentSessionId returns sessionId of most recent open entry", async () => {
    await trackSessionId("k", "s1", { startedAt: 100 });
    await trackSessionId("k", "s2", { startedAt: 200 });
    // end s2 so s1 (older, still open) should be current? No — s1 is also open.
    // Both open → most recent by startedAt desc → s2 (since find() picks first match)
    const current = await getCurrentSessionId("k");
    expect(current).toBe("s2");
  });

  it("getCurrentSessionId skips ended entries and returns open one", async () => {
    await trackSessionId("k", "s1", { startedAt: 100 });
    await trackSessionId("k", "s2", { startedAt: 200 });
    await markSessionEnded("k", "s2");

    const current = await getCurrentSessionId("k");
    expect(current).toBe("s1");
  });

  // 7. getCurrentSessionId when none exist — returns null
  it("getCurrentSessionId returns null when no entries", async () => {
    const current = await getCurrentSessionId("k");
    expect(current).toBeNull();
  });

  it("getCurrentSessionId returns null when all entries ended", async () => {
    await trackSessionId("k", "s1");
    await markSessionEnded("k", "s1");

    const current = await getCurrentSessionId("k");
    expect(current).toBeNull();
  });

  // 8. getTopicCount — accurate count
  it("getTopicCount returns correct count", async () => {
    expect(await getTopicCount("k")).toBe(0);

    await trackSessionId("k", "s1");
    expect(await getTopicCount("k")).toBe(1);

    await trackSessionId("k", "s2");
    expect(await getTopicCount("k")).toBe(2);
  });

  // 9. Upsert — same sessionKey + sessionId doesn't duplicate
  it("trackSessionId upserts on same key pair without duplicating", async () => {
    await trackSessionId("k", "s1", { label: "v1" });
    await trackSessionId("k", "s1", { label: "v2" });

    const history = await getTopicHistory("k");
    expect(history).toHaveLength(1);
    expect(history[0].label).toBe("v2");
  });

  // 10. Empty sessionKey handling
  it("handles empty sessionKey", async () => {
    await trackSessionId("", "s1");
    const history = await getTopicHistory("");
    expect(history).toHaveLength(1);
    expect(history[0].sessionKey).toBe("");

    const count = await getTopicCount("");
    expect(count).toBe(1);
  });

  // 11. Multi-session scenario: track → end → track new → getCurrentSessionId returns new
  it("full lifecycle: track → end → track new → getCurrentSessionId returns new", async () => {
    await trackSessionId("k", "s1", { startedAt: 100 });
    await markSessionEnded("k", "s1", { summary: "done" });

    await trackSessionId("k", "s2", { startedAt: 200 });

    const current = await getCurrentSessionId("k");
    expect(current).toBe("s2");

    const history = await getTopicHistory("k");
    expect(history).toHaveLength(2);
    // desc order: s2 (200), s1 (100)
    expect(history[0].sessionId).toBe("s2");
    expect(history[0].endedAt).toBeUndefined();
    expect(history[1].sessionId).toBe("s1");
    expect(history[1].endedAt).toBeTypeOf("number");
    expect(history[1].summary).toBe("done");
  });
});
