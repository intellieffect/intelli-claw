/**
 * issue-189-assistant-msg-dedup.test.ts
 *
 * Tests for mergeConsecutiveAssistant() which combines consecutive assistant
 * messages from chat.history into a single message per turn.
 *
 * Gateway returns split assistant messages (text segments between tool_use blocks),
 * but streaming produces one merged message. This merge ensures history matches
 * streaming behavior, preventing N+1 duplicate display.
 */
import { describe, it, expect } from "vitest";
import {
  mergeConsecutiveAssistant,
  type DisplayMessage,
} from "@/lib/gateway/hooks";

const T1 = "2026-01-01T00:00:00Z";
const T2 = "2026-01-01T00:00:05Z";
const T3 = "2026-01-01T00:00:10Z";

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
// Basic merge behavior
// ---------------------------------------------------------------------------
describe("mergeConsecutiveAssistant — basic", () => {
  it("merges two consecutive assistant messages into one", () => {
    const msgs = [
      msg({ id: "hist-0", content: "First part", timestamp: T1 }),
      msg({ id: "hist-1", content: "Second part", timestamp: T2 }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("First part\n\nSecond part");
    expect(result[0].id).toBe("hist-0"); // keeps first id
  });

  it("merges three consecutive assistant messages", () => {
    const msgs = [
      msg({ id: "hist-0", content: "Part A", timestamp: T1 }),
      msg({ id: "hist-1", content: "Part B", timestamp: T2 }),
      msg({ id: "hist-2", content: "Part C", timestamp: T3 }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Part A\n\nPart B\n\nPart C");
  });

  it("does not merge non-consecutive assistant messages", () => {
    const msgs = [
      msg({ id: "hist-0", role: "assistant", content: "Response 1" }),
      msg({ id: "hist-1", role: "user", content: "Follow up" }),
      msg({ id: "hist-2", role: "assistant", content: "Response 2" }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("Response 1");
    expect(result[2].content).toBe("Response 2");
  });

  it("preserves single messages unchanged", () => {
    const msgs = [
      msg({ id: "hist-0", role: "user", content: "Hello" }),
      msg({ id: "hist-1", role: "assistant", content: "Hi there" }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(msgs[0]);
    expect(result[1]).toEqual(msgs[1]);
  });

  it("returns empty array for empty input", () => {
    expect(mergeConsecutiveAssistant([])).toEqual([]);
  });

  it("handles single message", () => {
    const msgs = [msg({ id: "hist-0", content: "Only one" })];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Only one");
  });
});

// ---------------------------------------------------------------------------
// Tool calls merging
// ---------------------------------------------------------------------------
describe("mergeConsecutiveAssistant — toolCalls", () => {
  it("merges toolCalls from consecutive assistant messages", () => {
    const msgs = [
      msg({
        id: "hist-0",
        content: "Let me search",
        toolCalls: [
          { callId: "tc-1", name: "search", args: "{}", status: "done", result: "found" },
        ],
      }),
      msg({
        id: "hist-1",
        content: "Here are the results",
        toolCalls: [
          { callId: "tc-2", name: "read", args: "{}", status: "done", result: "content" },
        ],
      }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].toolCalls).toHaveLength(2);
    expect(result[0].toolCalls[0].callId).toBe("tc-1");
    expect(result[0].toolCalls[1].callId).toBe("tc-2");
  });

  it("handles mix of messages with and without toolCalls", () => {
    const msgs = [
      msg({ id: "hist-0", content: "Thinking...", toolCalls: [] }),
      msg({
        id: "hist-1",
        content: "Found it",
        toolCalls: [
          { callId: "tc-1", name: "search", args: "{}", status: "done", result: "ok" },
        ],
      }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].toolCalls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Attachments merging
// ---------------------------------------------------------------------------
describe("mergeConsecutiveAssistant — attachments", () => {
  it("merges attachments from consecutive messages", () => {
    const msgs = [
      msg({
        id: "hist-0",
        content: "Image 1",
        attachments: [{ fileName: "a.png", mimeType: "image/png", dataUrl: "data:..." }],
      }),
      msg({
        id: "hist-1",
        content: "Image 2",
        attachments: [{ fileName: "b.png", mimeType: "image/png", dataUrl: "data:..." }],
      }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].attachments).toHaveLength(2);
  });

  it("preserves undefined attachments when none have them", () => {
    const msgs = [
      msg({ id: "hist-0", content: "Part A" }),
      msg({ id: "hist-1", content: "Part B" }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result[0].attachments).toBeUndefined();
  });

  it("handles one message with attachments and one without", () => {
    const msgs = [
      msg({ id: "hist-0", content: "Text only" }),
      msg({
        id: "hist-1",
        content: "With image",
        attachments: [{ fileName: "a.png", mimeType: "image/png", dataUrl: "data:..." }],
      }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].attachments).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Mixed roles — realistic scenario
// ---------------------------------------------------------------------------
describe("mergeConsecutiveAssistant — realistic scenarios", () => {
  it("handles user → assistant(split) → user → assistant pattern", () => {
    const msgs = [
      msg({ id: "hist-0", role: "user", content: "What is 2+2?" }),
      msg({ id: "hist-1", role: "assistant", content: "Let me calculate" }),
      msg({ id: "hist-2", role: "assistant", content: "The answer is 4" }),
      msg({ id: "hist-3", role: "user", content: "Thanks" }),
      msg({ id: "hist-4", role: "assistant", content: "You're welcome" }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    expect(result[1].content).toBe("Let me calculate\n\nThe answer is 4");
    expect(result[2].role).toBe("user");
    expect(result[3].role).toBe("assistant");
    expect(result[3].content).toBe("You're welcome");
  });

  it("preserves session-boundary messages", () => {
    const msgs: DisplayMessage[] = [
      msg({ id: "hist-0", role: "assistant", content: "Before boundary" }),
      {
        id: "boundary-1",
        role: "session-boundary",
        content: "",
        timestamp: T2,
        toolCalls: [],
      },
      msg({ id: "hist-2", role: "assistant", content: "After boundary" }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("Before boundary");
    expect(result[1].role).toBe("session-boundary");
    expect(result[2].content).toBe("After boundary");
  });

  it("skips empty content when merging", () => {
    const msgs = [
      msg({ id: "hist-0", content: "Real content" }),
      msg({ id: "hist-1", content: "" }),
      msg({ id: "hist-2", content: "More content" }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Real content\n\nMore content");
  });

  it("uses earliest timestamp from merged messages", () => {
    const msgs = [
      msg({ id: "hist-0", content: "First", timestamp: T2 }),
      msg({ id: "hist-1", content: "Second", timestamp: T1 }),
      msg({ id: "hist-2", content: "Third", timestamp: T3 }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    // keeps first message's timestamp
    expect(result[0].timestamp).toBe(T2);
  });
});

describe("mergeConsecutiveAssistant — #255 overlap detection", () => {
  it("deduplicates cumulative messages (A, A+B, A+B+C → A+B+C)", () => {
    const msgs = [
      msg({ id: "hist-0", content: "Hello" }),
      msg({ id: "hist-1", content: "Hello world" }),
      msg({ id: "hist-2", content: "Hello world. How are you?" }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Hello world. How are you?");
  });

  it("keeps accumulator when it's already a superset", () => {
    const msgs = [
      msg({ id: "hist-0", content: "Full response with details" }),
      msg({ id: "hist-1", content: "Full response" }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Full response with details");
  });

  it("joins truly separate messages normally", () => {
    const msgs = [
      msg({ id: "hist-0", content: "Part A" }),
      msg({ id: "hist-1", content: "Part B" }),
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Part A\n\nPart B");
  });

  it("handles mixed overlap and separate content", () => {
    const msgs = [
      msg({ id: "hist-0", content: "Hello" }),
      msg({ id: "hist-1", content: "Hello world" }),  // overlap with 0
      msg({ id: "hist-2", role: "user", content: "question" }),
      msg({ id: "hist-3", content: "Answer part 1" }),
      msg({ id: "hist-4", content: "Answer part 2" }),  // separate from 3
    ];
    const result = mergeConsecutiveAssistant(msgs);
    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("Hello world");
    expect(result[1].content).toBe("question");
    expect(result[2].content).toBe("Answer part 1\n\nAnswer part 2");
  });
});
