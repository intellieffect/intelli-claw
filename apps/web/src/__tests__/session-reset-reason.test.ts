import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  inferResetReason,
  resetReasonLabel,
  type ResetReason,
  type ResetReasonContext,
} from "@/lib/gateway/reset-reason";

/**
 * #156: Session reset reason inference and display (TDD)
 *
 * Since the Gateway does not provide a `resetReason` field,
 * we infer it from available context (token usage, timing, user action).
 * When Gateway adds `resetReason` in the future, it takes precedence.
 */

describe("inferResetReason", () => {
  let realDate: typeof Date;

  beforeEach(() => {
    realDate = globalThis.Date;
  });

  afterEach(() => {
    globalThis.Date = realDate;
    vi.restoreAllMocks();
  });

  /**
   * Mock Date.now() and also replace globalThis.Date so that
   * `new Date(now).getHours()` returns the expected local hour.
   * This ensures tests pass regardless of the CI runner's timezone.
   */
  function mockNow(timestamp: number) {
    vi.spyOn(Date, "now").mockReturnValue(timestamp);
  }

  /**
   * Helper: compute a timestamp where `new Date(ts).getHours()` equals
   * the desired hour in the system's local timezone. This avoids
   * hardcoding +09:00 offsets that break on UTC CI runners.
   */
  function localTimestamp(year: number, month: number, day: number, hour: number, minute = 0): number {
    return new Date(year, month - 1, day, hour, minute).getTime();
  }

  it("returns 'context_overflow' when token usage is high (>= 80%)", () => {
    const ctx: ResetReasonContext = {
      totalTokens: 85000,
      contextTokens: 100000,
    };
    expect(inferResetReason(ctx)).toBe("context_overflow");
  });

  it("returns 'context_overflow' when percentUsed is >= 80", () => {
    const ctx: ResetReasonContext = {
      percentUsed: 82,
    };
    expect(inferResetReason(ctx)).toBe("context_overflow");
  });

  it("returns 'daily' when date has changed and token usage is low", () => {
    // Reset detected at 4:05 AM local — typical daily reset
    const resetAt = localTimestamp(2026, 3, 6, 4, 5);
    const lastActiveAt = localTimestamp(2026, 3, 5, 23, 30);
    mockNow(resetAt);

    const ctx: ResetReasonContext = {
      totalTokens: 5000,
      contextTokens: 100000,
      lastActiveAt,
    };
    expect(inferResetReason(ctx)).toBe("daily");
  });

  it("returns 'idle' when last activity was > 6 hours ago and token usage is low", () => {
    const now = localTimestamp(2026, 3, 6, 15, 0);
    const lastActiveAt = localTimestamp(2026, 3, 6, 2, 0); // 13h ago
    mockNow(now);

    const ctx: ResetReasonContext = {
      totalTokens: 3000,
      contextTokens: 100000,
      lastActiveAt,
    };
    expect(inferResetReason(ctx)).toBe("idle");
  });

  it("returns 'manual' when isManual flag is set", () => {
    const ctx: ResetReasonContext = {
      isManual: true,
    };
    expect(inferResetReason(ctx)).toBe("manual");
  });

  it("prefers gateway-provided reason over inference", () => {
    const ctx: ResetReasonContext = {
      gatewayReason: "daily",
      totalTokens: 95000,
      contextTokens: 100000, // would infer context_overflow
    };
    expect(inferResetReason(ctx)).toBe("daily");
  });

  it("returns 'unknown' when no heuristic matches", () => {
    // Mock time far from daily reset hour (4 AM) to avoid false 'daily' match
    mockNow(localTimestamp(2026, 3, 6, 12, 0));
    const ctx: ResetReasonContext = {};
    expect(inferResetReason(ctx)).toBe("unknown");
  });

  it("handles edge case: exactly 80% usage → context_overflow", () => {
    const ctx: ResetReasonContext = {
      totalTokens: 80000,
      contextTokens: 100000,
    };
    expect(inferResetReason(ctx)).toBe("context_overflow");
  });

  it("handles edge case: 79% usage → not context_overflow", () => {
    const now = localTimestamp(2026, 3, 6, 15, 0);
    mockNow(now);
    const ctx: ResetReasonContext = {
      totalTokens: 79000,
      contextTokens: 100000,
      lastActiveAt: now - 1000, // just active
    };
    expect(inferResetReason(ctx)).not.toBe("context_overflow");
  });

  it("returns 'daily' for same-day reset at daily reset hour (4 AM)", () => {
    // Reset at 4:01 AM local, last active at 3:55 AM same day — still daily
    const resetAt = localTimestamp(2026, 3, 6, 4, 1);
    const lastActiveAt = localTimestamp(2026, 3, 6, 3, 55);
    mockNow(resetAt);

    const ctx: ResetReasonContext = {
      totalTokens: 2000,
      contextTokens: 100000,
      lastActiveAt,
      dailyResetHour: 4,
    };
    expect(inferResetReason(ctx)).toBe("daily");
  });
});

describe("resetReasonLabel", () => {
  it("returns correct Korean label for context_overflow", () => {
    const label = resetReasonLabel("context_overflow");
    expect(label.icon).toBe("🔄");
    expect(label.text).toContain("컨텍스트");
  });

  it("returns correct Korean label for daily", () => {
    const label = resetReasonLabel("daily");
    expect(label.icon).toBe("🌅");
    expect(label.text).toContain("하루");
  });

  it("returns correct Korean label for idle", () => {
    const label = resetReasonLabel("idle");
    expect(label.icon).toBe("💤");
    expect(label.text).toContain("미활동");
  });

  it("returns correct Korean label for manual", () => {
    const label = resetReasonLabel("manual");
    expect(label.icon).toBe("🔄");
    expect(label.text).toContain("새 세션");
  });

  it("returns fallback label for unknown", () => {
    const label = resetReasonLabel("unknown");
    expect(label.icon).toBe("🔄");
    expect(label.text).toContain("세션 갱신");
  });

  it("accepts all ResetReason values without throwing", () => {
    const reasons: ResetReason[] = [
      "context_overflow", "daily", "idle", "manual", "unknown",
    ];
    for (const r of reasons) {
      expect(() => resetReasonLabel(r)).not.toThrow();
    }
  });
});
