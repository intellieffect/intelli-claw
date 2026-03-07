import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getNextTopicIndex,
  getSwipeMode,
  setSwipeMode,
} from "@/lib/hooks/use-swipe-gesture";

// Mock localStorage
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { for (const k of Object.keys(store)) delete store[k]; }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

describe("Issue #173: 스와이프 모드 토글 — 에이전트 vs 토픽", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe("getNextTopicIndex — 토픽 순환 로직", () => {
    it("왼쪽 스와이프 → 다음 토픽", () => {
      expect(getNextTopicIndex(0, 3, "left")).toBe(1);
    });

    it("오른쪽 스와이프 → 이전 토픽", () => {
      expect(getNextTopicIndex(1, 3, "right")).toBe(0);
    });

    it("마지막에서 left → 첫 번째 (circular)", () => {
      expect(getNextTopicIndex(2, 3, "left")).toBe(0);
    });

    it("첫 번째에서 right → 마지막 (circular)", () => {
      expect(getNextTopicIndex(0, 3, "right")).toBe(2);
    });

    it("토픽 1개면 항상 0", () => {
      expect(getNextTopicIndex(0, 1, "left")).toBe(0);
      expect(getNextTopicIndex(0, 1, "right")).toBe(0);
    });
  });

  describe("getSwipeMode / setSwipeMode — localStorage 저장/로드", () => {
    it("기본값은 'agent'", () => {
      expect(getSwipeMode()).toBe("agent");
    });

    it("'topic' 저장 후 로드", () => {
      setSwipeMode("topic");
      expect(getSwipeMode()).toBe("topic");
      expect(localStorageMock.setItem).toHaveBeenCalledWith("awf:swipe-mode", "topic");
    });

    it("'agent' 저장 후 로드", () => {
      setSwipeMode("agent");
      expect(getSwipeMode()).toBe("agent");
    });

    it("저장값 변경 시 새 값 반영", () => {
      setSwipeMode("topic");
      expect(getSwipeMode()).toBe("topic");
      setSwipeMode("agent");
      expect(getSwipeMode()).toBe("agent");
    });
  });
});
