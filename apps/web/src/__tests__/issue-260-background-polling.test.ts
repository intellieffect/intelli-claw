/**
 * #260 — 비활성 창(background) 폴링 타이머 중지 검증
 *
 * 검증 대상:
 * 1. usePageVisibility — visibilitychange 이벤트에 반응
 * 2. use-node-status.ts — 비활성 시 폴링 중지 코드 존재 확인
 * 3. hooks.tsx (useSessions) — 비활성 시 15초 interval 중지 코드 존재 확인
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePageVisibility } from "../lib/hooks/use-page-visibility";
import fs from "fs";
import path from "path";

// ─── usePageVisibility 테스트 ────────────────────────────────────

describe("#260 — usePageVisibility", () => {
  let originalVisibilityState: string;

  beforeEach(() => {
    originalVisibilityState = document.visibilityState;
  });

  afterEach(() => {
    // Restore
    Object.defineProperty(document, "visibilityState", {
      value: originalVisibilityState,
      writable: true,
      configurable: true,
    });
  });

  it("should return true when page is visible", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);
  });

  it("should return false when page becomes hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "visible",
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(true);

    // Simulate going to background
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "hidden",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe(false);
  });

  it("should return true when page becomes visible again", () => {
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      writable: true,
      configurable: true,
    });
    const { result } = renderHook(() => usePageVisibility());
    expect(result.current).toBe(false);

    // Simulate becoming visible
    act(() => {
      Object.defineProperty(document, "visibilityState", {
        value: "visible",
        writable: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(result.current).toBe(true);
  });

  it("should clean up event listener on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => usePageVisibility());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
    removeSpy.mockRestore();
  });
});

// ─── use-node-status.ts 통합 검증 (소스 코드 분석) ──────────────

describe("#260 — use-node-status.ts should pause polling when hidden", () => {
  const filePath = path.resolve(__dirname, "../lib/hooks/use-node-status.ts");
  const source = fs.readFileSync(filePath, "utf-8");

  it("should import usePageVisibility", () => {
    expect(source).toContain("usePageVisibility");
  });

  it("should reference visibility in the polling useEffect", () => {
    // The polling interval setup should depend on visibility
    const lines = source.split("\n");
    const intervalLine = lines.findIndex((l) => l.includes("setInterval") && l.includes("poll"));
    expect(intervalLine).toBeGreaterThan(-1);

    // Within 10 lines before the setInterval, there should be a visibility check
    const surroundingBlock = lines.slice(Math.max(0, intervalLine - 15), intervalLine + 5).join("\n");
    expect(surroundingBlock).toMatch(/visible|visibility|isVisible|pageVisible/i);
  });
});

// ─── hooks.tsx useSessions 통합 검증 (소스 코드 분석) ────────────

describe("#260 — hooks.tsx useSessions should pause refresh when hidden", () => {
  const filePath = path.resolve(__dirname, "../lib/gateway/hooks.tsx");
  const source = fs.readFileSync(filePath, "utf-8");

  it("should import usePageVisibility", () => {
    expect(source).toContain("usePageVisibility");
  });

  it("should reference visibility in the 15s interval useEffect", () => {
    const lines = source.split("\n");
    const intervalLine = lines.findIndex((l) => l.includes("15000") && l.includes("setInterval"));
    expect(intervalLine).toBeGreaterThan(-1);

    // The useEffect containing the 15s interval should have visibility in its dependency or guard
    const blockStart = Math.max(0, intervalLine - 15);
    const blockEnd = Math.min(lines.length, intervalLine + 5);
    const block = lines.slice(blockStart, blockEnd).join("\n");
    expect(block).toMatch(/visible|visibility|isVisible|pageVisible/i);
  });
});
