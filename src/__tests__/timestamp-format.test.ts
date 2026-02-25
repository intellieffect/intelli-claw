import { describe, it, expect } from "vitest";
import { formatTime } from "../lib/utils/format-time";

describe("formatTime", () => {
  it("returns null for undefined input", () => {
    expect(formatTime(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(formatTime("")).toBeNull();
  });

  it("returns null for invalid date string", () => {
    expect(formatTime("not-a-date")).toBeNull();
  });

  it("formats ISO timestamp as MM-DD-YYYY HH:MM:SS in KST", () => {
    // 2026-02-25T02:30:45Z = 2026-02-25 11:30:45 KST
    const result = formatTime("2026-02-25T02:30:45Z");
    expect(result).toBe("02-25-2026 11:30:45");
  });

  it("handles midnight KST correctly", () => {
    // 2026-01-01T15:00:00Z = 2026-01-02 00:00:00 KST
    const result = formatTime("2026-01-01T15:00:00Z");
    expect(result).toBe("01-02-2026 00:00:00");
  });

  it("handles single-digit seconds with zero padding", () => {
    // 2026-07-15T10:05:03Z = 2026-07-15 19:05:03 KST
    const result = formatTime("2026-07-15T10:05:03Z");
    expect(result).toBe("07-15-2026 19:05:03");
  });

  it("handles date near year boundary", () => {
    // 2025-12-31T15:30:00Z = 2026-01-01 00:30:00 KST
    const result = formatTime("2025-12-31T15:30:00Z");
    expect(result).toBe("01-01-2026 00:30:00");
  });
});
