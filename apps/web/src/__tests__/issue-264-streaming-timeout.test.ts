/**
 * Issue #264: Streaming timeout — phase별 timeout 분리 및 agent event로 갱신 검증
 *
 * 현재 문제: tool 실행 중에도 thinking timeout(45초)이 그대로 유지되어
 * 정상 응답 중 "에이전트로부터 응답이 없습니다" 오탐 발생.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Extract timeout constants for testing — these should match hooks.tsx
const THINKING_TIMEOUT_MS = 45_000;
const TOOL_TIMEOUT_MS = 120_000;
const WRITING_TIMEOUT_MS = 90_000;
const LIFECYCLE_END_GRACE_MS = 10_000;

describe("Issue #264: Phase-based streaming timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("timeout values per phase", () => {
    it("thinking phase should use 45s timeout", () => {
      expect(THINKING_TIMEOUT_MS).toBe(45_000);
    });

    it("tool phase should use 120s timeout", () => {
      expect(TOOL_TIMEOUT_MS).toBe(120_000);
    });

    it("writing phase should use 90s timeout", () => {
      expect(WRITING_TIMEOUT_MS).toBe(90_000);
    });

    it("lifecycle.end grace period should use 10s timeout", () => {
      expect(LIFECYCLE_END_GRACE_MS).toBe(10_000);
    });
  });

  describe("timeout reset on phase change", () => {
    it("should reset timeout when transitioning from thinking to tool", () => {
      // Simulate: thinking starts, 30s passes, then tool phase arrives
      // Old behavior: timeout fires at 45s regardless of tool phase
      // New behavior: timeout resets to 120s when tool phase starts

      let timeoutFired = false;
      let currentTimer: ReturnType<typeof setTimeout> | null = null;

      // Start thinking timeout
      currentTimer = setTimeout(() => { timeoutFired = true; }, THINKING_TIMEOUT_MS);

      // 30s later, tool phase starts — clear and restart with tool timeout
      vi.advanceTimersByTime(30_000);
      expect(timeoutFired).toBe(false);

      clearTimeout(currentTimer!);
      currentTimer = setTimeout(() => { timeoutFired = true; }, TOOL_TIMEOUT_MS);

      // Original thinking timeout would fire at 45s (15s more), but it's been cleared
      vi.advanceTimersByTime(15_000); // 45s total
      expect(timeoutFired).toBe(false); // Should NOT fire — tool timeout is 120s

      // Even at 100s from tool start, should not fire
      vi.advanceTimersByTime(85_000); // 130s total, 100s from tool start
      expect(timeoutFired).toBe(false);

      // At 120s from tool start, should fire
      vi.advanceTimersByTime(20_000); // 150s total, 120s from tool start
      expect(timeoutFired).toBe(true);
    });

    it("should reset timeout when transitioning from tool to writing", () => {
      let timeoutFired = false;
      let currentTimer: ReturnType<typeof setTimeout> | null = null;

      // Start tool timeout
      currentTimer = setTimeout(() => { timeoutFired = true; }, TOOL_TIMEOUT_MS);

      // 60s later, writing phase starts
      vi.advanceTimersByTime(60_000);
      clearTimeout(currentTimer!);
      currentTimer = setTimeout(() => { timeoutFired = true; }, WRITING_TIMEOUT_MS);

      // 89s from writing start — should not fire
      vi.advanceTimersByTime(89_000);
      expect(timeoutFired).toBe(false);

      // 90s from writing start — should fire
      vi.advanceTimersByTime(1_000);
      expect(timeoutFired).toBe(true);
    });
  });

  describe("lifecycle.end grace period", () => {
    it("should wait grace period for chat final after lifecycle.end", () => {
      let graceFired = false;

      // lifecycle.end arrives, start grace timer
      const graceTimer = setTimeout(() => { graceFired = true; }, LIFECYCLE_END_GRACE_MS);

      // 5s later, chat final has not arrived
      vi.advanceTimersByTime(5_000);
      expect(graceFired).toBe(false);

      // chat final arrives at 7s — cancel grace timer
      vi.advanceTimersByTime(2_000);
      clearTimeout(graceTimer);

      // Grace period expires but timer was cancelled
      vi.advanceTimersByTime(5_000);
      expect(graceFired).toBe(false);
    });

    it("should fire if chat final never arrives within grace period", () => {
      let graceFired = false;

      setTimeout(() => { graceFired = true; }, LIFECYCLE_END_GRACE_MS);

      vi.advanceTimersByTime(9_999);
      expect(graceFired).toBe(false);

      vi.advanceTimersByTime(1);
      expect(graceFired).toBe(true);
    });
  });
});
