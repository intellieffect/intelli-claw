import { describe, it, expect } from "vitest";
import { groupMessages, type MessageGroup } from "@intelli-claw/shared";

/** Helper to create a minimal DisplayMessage-compatible object */
function msg(
  overrides: Partial<{
    id: string;
    role: "user" | "assistant" | "system" | "session-boundary";
    content: string;
    timestamp: string;
    toolCalls: { callId: string; name: string; status: string }[];
    streaming: boolean;
  }> = {},
) {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    role: overrides.role ?? "assistant",
    content: overrides.content ?? "hello",
    timestamp: overrides.timestamp ?? "2025-01-01T00:00:00Z",
    toolCalls: (overrides.toolCalls as any[]) ?? [],
    streaming: overrides.streaming,
  };
}

describe("groupMessages", () => {
  // ── Edge cases ──

  it("returns empty array for empty input", () => {
    expect(groupMessages([])).toEqual([]);
  });

  it("wraps a single message in a group", () => {
    const m = msg({ id: "1", role: "user" });
    const groups = groupMessages([m]);
    expect(groups).toHaveLength(1);
    expect(groups[0].role).toBe("user");
    expect(groups[0].messages).toHaveLength(1);
    expect(groups[0].firstMessageId).toBe("1");
    expect(groups[0].lastTimestamp).toBe(m.timestamp);
  });

  // ── Basic grouping ──

  it("groups consecutive messages with the same role", () => {
    const m1 = msg({ id: "1", role: "assistant", timestamp: "2025-01-01T00:00:00Z" });
    const m2 = msg({ id: "2", role: "assistant", timestamp: "2025-01-01T00:01:00Z" });
    const m3 = msg({ id: "3", role: "assistant", timestamp: "2025-01-01T00:02:00Z" });

    const groups = groupMessages([m1, m2, m3]);
    expect(groups).toHaveLength(1);
    expect(groups[0].role).toBe("assistant");
    expect(groups[0].messages).toHaveLength(3);
    expect(groups[0].firstMessageId).toBe("1");
    expect(groups[0].lastTimestamp).toBe("2025-01-01T00:02:00Z");
  });

  it("groups consecutive user messages together", () => {
    const m1 = msg({ id: "1", role: "user" });
    const m2 = msg({ id: "2", role: "user" });
    const groups = groupMessages([m1, m2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].role).toBe("user");
    expect(groups[0].messages).toHaveLength(2);
  });

  // ── Role change splits groups ──

  it("splits groups on role change", () => {
    const m1 = msg({ id: "1", role: "user" });
    const m2 = msg({ id: "2", role: "assistant" });
    const m3 = msg({ id: "3", role: "user" });

    const groups = groupMessages([m1, m2, m3]);
    expect(groups).toHaveLength(3);
    expect(groups[0].role).toBe("user");
    expect(groups[1].role).toBe("assistant");
    expect(groups[2].role).toBe("user");
  });

  // ── System / session-boundary messages are standalone ──

  it("system messages always form their own group", () => {
    const m1 = msg({ id: "1", role: "assistant" });
    const m2 = msg({ id: "2", role: "system", content: "[System] compaction" });
    const m3 = msg({ id: "3", role: "assistant" });

    const groups = groupMessages([m1, m2, m3]);
    expect(groups).toHaveLength(3);
    expect(groups[0].role).toBe("assistant");
    expect(groups[1].role).toBe("system");
    expect(groups[1].messages).toHaveLength(1);
    expect(groups[2].role).toBe("assistant");
  });

  it("session-boundary messages always form their own group", () => {
    const m1 = msg({ id: "1", role: "assistant" });
    const m2 = msg({ id: "2", role: "session-boundary" as any });
    const m3 = msg({ id: "3", role: "assistant" });

    const groups = groupMessages([m1, m2, m3]);
    expect(groups).toHaveLength(3);
    expect(groups[1].role).toBe("session-boundary");
  });

  // ── Tool calls break grouping ──

  it("messages with tool calls form their own group", () => {
    const m1 = msg({ id: "1", role: "assistant" });
    const m2 = msg({
      id: "2",
      role: "assistant",
      toolCalls: [{ callId: "tc-1", name: "search", status: "done" }],
    });
    const m3 = msg({ id: "3", role: "assistant" });

    const groups = groupMessages([m1, m2, m3]);
    expect(groups).toHaveLength(3);
    expect(groups[0].messages).toHaveLength(1);
    expect(groups[1].messages).toHaveLength(1); // tool call message standalone
    expect(groups[2].messages).toHaveLength(1);
  });

  // ── 5-minute time gap ──

  it("splits groups when time gap exceeds 5 minutes", () => {
    const t1 = "2025-01-01T00:00:00Z";
    const t2 = "2025-01-01T00:02:00Z"; // 2 min later
    const t3 = "2025-01-01T00:08:00Z"; // 6 min after t2

    const m1 = msg({ id: "1", role: "assistant", timestamp: t1 });
    const m2 = msg({ id: "2", role: "assistant", timestamp: t2 });
    const m3 = msg({ id: "3", role: "assistant", timestamp: t3 });

    const groups = groupMessages([m1, m2, m3]);
    expect(groups).toHaveLength(2);
    expect(groups[0].messages).toHaveLength(2);
    expect(groups[0].lastTimestamp).toBe(t2);
    expect(groups[1].messages).toHaveLength(1);
    expect(groups[1].firstMessageId).toBe("3");
  });

  it("does not split groups at exactly 5 minutes", () => {
    const t1 = "2025-01-01T00:00:00Z";
    const t2 = "2025-01-01T00:05:00Z"; // exactly 5 min

    const m1 = msg({ id: "1", role: "assistant", timestamp: t1 });
    const m2 = msg({ id: "2", role: "assistant", timestamp: t2 });

    const groups = groupMessages([m1, m2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].messages).toHaveLength(2);
  });

  // ── Complex scenario ──

  it("handles a realistic conversation with mixed roles and tool calls", () => {
    const messages = [
      msg({ id: "1", role: "user", timestamp: "2025-01-01T00:00:00Z" }),
      msg({ id: "2", role: "assistant", timestamp: "2025-01-01T00:00:10Z" }),
      msg({ id: "3", role: "assistant", timestamp: "2025-01-01T00:00:20Z" }),
      msg({
        id: "4",
        role: "assistant",
        timestamp: "2025-01-01T00:00:30Z",
        toolCalls: [{ callId: "tc-1", name: "web_search", status: "done" }],
      }),
      msg({ id: "5", role: "assistant", timestamp: "2025-01-01T00:00:40Z" }),
      msg({ id: "6", role: "assistant", timestamp: "2025-01-01T00:00:50Z" }),
      msg({ id: "7", role: "user", timestamp: "2025-01-01T00:01:00Z" }),
      msg({ id: "8", role: "assistant", timestamp: "2025-01-01T00:01:10Z" }),
    ];

    const groups = groupMessages(messages);
    // user(1), assistant(2,3), assistant+tool(4), assistant(5,6), user(7), assistant(8)
    expect(groups).toHaveLength(6);
    expect(groups[0]).toMatchObject({ role: "user", firstMessageId: "1" });
    expect(groups[1]).toMatchObject({ role: "assistant", firstMessageId: "2" });
    expect(groups[1].messages).toHaveLength(2);
    expect(groups[2]).toMatchObject({ role: "assistant", firstMessageId: "4" });
    expect(groups[2].messages).toHaveLength(1); // tool call standalone
    expect(groups[3]).toMatchObject({ role: "assistant", firstMessageId: "5" });
    expect(groups[3].messages).toHaveLength(2);
    expect(groups[4]).toMatchObject({ role: "user", firstMessageId: "7" });
    expect(groups[5]).toMatchObject({ role: "assistant", firstMessageId: "8" });
  });

  // ── Streaming messages should not break grouping ──

  it("groups streaming messages with same role normally", () => {
    const m1 = msg({ id: "1", role: "assistant", streaming: false });
    const m2 = msg({ id: "2", role: "assistant", streaming: true });

    const groups = groupMessages([m1, m2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].messages).toHaveLength(2);
  });

  // ── Consecutive tool-call messages are each standalone ──

  it("consecutive tool-call messages form separate groups", () => {
    const m1 = msg({
      id: "1",
      role: "assistant",
      toolCalls: [{ callId: "tc-1", name: "search", status: "done" }],
      timestamp: "2025-01-01T00:00:00Z",
    });
    const m2 = msg({
      id: "2",
      role: "assistant",
      toolCalls: [{ callId: "tc-2", name: "fetch", status: "done" }],
      timestamp: "2025-01-01T00:00:05Z",
    });

    const groups = groupMessages([m1, m2]);
    expect(groups).toHaveLength(2);
    expect(groups[0].messages).toHaveLength(1);
    expect(groups[0].firstMessageId).toBe("1");
    expect(groups[1].messages).toHaveLength(1);
    expect(groups[1].firstMessageId).toBe("2");
  });

  // ── Reverse timestamps ──

  it("reverse timestamps (t2 < t1) do not trigger time gap split", () => {
    const t1 = "2025-01-01T00:10:00Z";
    const t2 = "2025-01-01T00:05:00Z"; // earlier than t1

    const m1 = msg({ id: "1", role: "assistant", timestamp: t1 });
    const m2 = msg({ id: "2", role: "assistant", timestamp: t2 });

    const groups = groupMessages([m1, m2]);
    // Negative difference (-5 min) is not > 5 min, so they should stay grouped
    expect(groups).toHaveLength(1);
    expect(groups[0].messages).toHaveLength(2);
  });

  // ── Messages with missing/invalid timestamps ──

  it("handles messages without timestamps gracefully", () => {
    const m1 = msg({ id: "1", role: "assistant", timestamp: "" });
    const m2 = msg({ id: "2", role: "assistant", timestamp: "" });

    const groups = groupMessages([m1, m2]);
    // Without valid timestamps, cannot determine gap → keep grouped
    expect(groups).toHaveLength(1);
    expect(groups[0].messages).toHaveLength(2);
  });
});
