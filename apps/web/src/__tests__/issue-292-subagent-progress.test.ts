/**
 * #292 — 백그라운드 서브에이전트 진행상황 proactive 업데이트
 *
 * The existing SubagentCard updates its `elapsed` display only on each
 * incoming gateway event. When a sub-agent is thinking for 30+ seconds with
 * no deltas, the elapsed counter freezes and the user assumes it's stuck.
 *
 * This PR extracts the elapsed formatting + a "stalled?" predicate as pure
 * functions so we can test them without mounting the card, and wires a
 * 1-second tick interval in the component so elapsed advances proactively.
 */
import { describe, it, expect } from "vitest";
import {
  formatElapsed,
  isSubagentStalled,
  SUBAGENT_STALL_THRESHOLD_MS,
} from "@/components/chat/subagent-card";

describe("#292 — subagent progress helpers", () => {
  describe("formatElapsed", () => {
    it("formats sub-minute durations as seconds", () => {
      expect(formatElapsed(0)).toBe("0s");
      expect(formatElapsed(5_000)).toBe("5s");
      expect(formatElapsed(59_999)).toBe("59s");
    });

    it("formats minute+ durations as 'Nm Ss'", () => {
      expect(formatElapsed(60_000)).toBe("1m 0s");
      expect(formatElapsed(90_000)).toBe("1m 30s");
      expect(formatElapsed(3_600_000)).toBe("60m 0s");
    });

    it("handles negative / malformed input gracefully", () => {
      expect(formatElapsed(-100)).toBe("0s");
      expect(formatElapsed(NaN)).toBe("0s");
    });
  });

  describe("isSubagentStalled", () => {
    const now = Date.now();

    it("returns false when the sub-agent is done", () => {
      expect(
        isSubagentStalled({
          phase: "done",
          updatedAt: now - 10 * SUBAGENT_STALL_THRESHOLD_MS,
          now,
        }),
      ).toBe(false);
    });

    it("returns false when events arrived recently", () => {
      expect(
        isSubagentStalled({
          phase: "running",
          updatedAt: now - 1_000,
          now,
        }),
      ).toBe(false);
    });

    it("returns true when running and idle beyond the stall threshold", () => {
      expect(
        isSubagentStalled({
          phase: "running",
          updatedAt: now - SUBAGENT_STALL_THRESHOLD_MS - 1,
          now,
        }),
      ).toBe(true);
    });

    it("never marks a pending sub-agent as stalled (it hasn't started)", () => {
      expect(
        isSubagentStalled({
          phase: "pending",
          updatedAt: now - 10 * SUBAGENT_STALL_THRESHOLD_MS,
          now,
        }),
      ).toBe(false);
    });
  });

  describe("SUBAGENT_STALL_THRESHOLD_MS", () => {
    it("is a sensible default (>= 15s, <= 120s)", () => {
      expect(SUBAGENT_STALL_THRESHOLD_MS).toBeGreaterThanOrEqual(15_000);
      expect(SUBAGENT_STALL_THRESHOLD_MS).toBeLessThanOrEqual(120_000);
    });
  });
});
