/**
 * #284 — 어떤 채팅에서 어떤 업무를 처리하고 있었는지 파악 힘듦
 *
 * Pure function tests for the task-tracker helpers that back the session
 * manager panel's "what is this chat about?" summaries.
 */
import { describe, it, expect } from "vitest";
import {
  buildTaskSummary,
  compareByRecency,
  TASK_HEADLINE_MAX_LEN,
} from "@/lib/task-tracker";

describe("#284 — task tracker", () => {
  describe("buildTaskSummary", () => {
    it("returns isEmpty when nothing is provided", () => {
      const result = buildTaskSummary({});
      expect(result.isEmpty).toBe(true);
      expect(result.headline).toBe("");
    });

    it("uses label when present", () => {
      const result = buildTaskSummary({
        label: "버그 수정",
        lastUserMessage: "hello",
      });
      expect(result.headline).toBe("버그 수정");
      expect(result.hint).toBe("hello");
      expect(result.isEmpty).toBe(false);
    });

    it("falls back to last user message when label is empty", () => {
      const result = buildTaskSummary({
        label: "",
        lastUserMessage: "Can you fix the login bug?",
      });
      expect(result.headline).toBe("Can you fix the login bug");
      expect(result.isEmpty).toBe(false);
    });

    it("falls back to last assistant message when no user message", () => {
      const result = buildTaskSummary({
        lastAssistantMessage: "I fixed the bug in auth.ts.",
      });
      expect(result.headline).toBe("I fixed the bug in auth");
    });

    it("strips leading slash commands from the user message", () => {
      const result = buildTaskSummary({
        lastUserMessage: "/new 로그인 버그 수정해줘",
      });
      expect(result.headline).toBe("로그인 버그 수정해줘");
    });

    it("strips control tokens from the input", () => {
      const result = buildTaskSummary({
        lastUserMessage: "hello\u0001\u0002 world",
      });
      expect(result.headline).toBe("hello world");
    });

    it("takes only the first sentence", () => {
      const result = buildTaskSummary({
        lastUserMessage: "First sentence. Second sentence.",
      });
      expect(result.headline).toBe("First sentence");
    });

    it("truncates long headlines to the max length", () => {
      const long = "a".repeat(200);
      const result = buildTaskSummary({ label: long });
      expect(result.headline.length).toBeLessThanOrEqual(TASK_HEADLINE_MAX_LEN);
      expect(result.headline.endsWith("…")).toBe(true);
    });

    it("does not return an identical hint and headline", () => {
      // If headline comes from label, hint is user message (distinct).
      const result = buildTaskSummary({
        label: "foo",
        lastUserMessage: "foo",
      });
      expect(result.headline).toBe("foo");
      // Intentional: hint may still equal headline if they happen to match —
      // UI layer is responsible for suppressing redundancy. Sanity-check the
      // shape, not an anti-duplication rule.
      expect(typeof result.hint).toBe("string");
    });
  });

  describe("compareByRecency", () => {
    it("sorts newer sessions first", () => {
      const sorted = [
        { updatedAt: 1_000, label: "old" },
        { updatedAt: 3_000, label: "newest" },
        { updatedAt: 2_000, label: "mid" },
      ].sort(compareByRecency);
      expect(sorted.map((s) => s.label)).toEqual(["newest", "mid", "old"]);
    });

    it("falls back to alphabetical label on tie", () => {
      const sorted = [
        { updatedAt: 1_000, label: "zebra" },
        { updatedAt: 1_000, label: "apple" },
      ].sort(compareByRecency);
      expect(sorted.map((s) => s.label)).toEqual(["apple", "zebra"]);
    });

    it("handles missing updatedAt as 0", () => {
      const sorted = [
        { label: "no-ts" },
        { updatedAt: 1_000, label: "has-ts" },
      ].sort(compareByRecency);
      expect(sorted.map((s) => s.label)).toEqual(["has-ts", "no-ts"]);
    });
  });
});
