import { describe, it, expect } from "vitest";
import {
  detectSwipeDirection,
  getNextAgentIndex,
  createInputCache,
} from "@/lib/hooks/use-swipe-gesture";

describe("Issue #113: 모바일 스와이프로 모델 간 전환", () => {
  describe("detectSwipeDirection", () => {
    const threshold = 50;

    it("오른쪽 스와이프 → 'right' 반환", () => {
      // startX=0, startY=100, endX=100, endY=100 (오른쪽으로 100px)
      expect(detectSwipeDirection(0, 100, 100, 100, threshold)).toBe("right");
    });

    it("왼쪽 스와이프 → 'left' 반환", () => {
      // startX=200, startY=100, endX=50, endY=100 (왼쪽으로 150px)
      expect(detectSwipeDirection(200, 100, 50, 100, threshold)).toBe("left");
    });

    it("threshold 미달 → null 반환", () => {
      // 30px 이동 — threshold(50) 미달
      expect(detectSwipeDirection(0, 100, 30, 100, threshold)).toBeNull();
    });

    it("수직 스와이프 → null 반환 (채팅 스크롤과 충돌 방지)", () => {
      // 수직 이동이 수평 이동보다 큰 경우
      expect(detectSwipeDirection(100, 0, 110, 200, threshold)).toBeNull();
    });

    it("대각선 스와이프 — 수평이 우세하면 방향 반환", () => {
      // deltaX=100, deltaY=30 → 수평 우세
      expect(detectSwipeDirection(0, 100, 100, 130, threshold)).toBe("right");
    });

    it("대각선 스와이프 — 수직이 우세하면 null", () => {
      // deltaX=60, deltaY=80 → 수직 우세
      expect(detectSwipeDirection(0, 0, 60, 80, threshold)).toBeNull();
    });
  });

  describe("getNextAgentIndex — 순환 로직", () => {
    it("오른쪽 스와이프 → 다음 에이전트", () => {
      expect(getNextAgentIndex(0, 3, "right")).toBe(1);
    });

    it("왼쪽 스와이프 → 이전 에이전트", () => {
      expect(getNextAgentIndex(1, 3, "left")).toBe(0);
    });

    it("마지막에서 right → 첫 번째 (circular)", () => {
      expect(getNextAgentIndex(2, 3, "right")).toBe(0);
    });

    it("첫 번째에서 left → 마지막 (circular)", () => {
      expect(getNextAgentIndex(0, 3, "left")).toBe(2);
    });

    it("에이전트가 1개면 항상 0", () => {
      expect(getNextAgentIndex(0, 1, "right")).toBe(0);
      expect(getNextAgentIndex(0, 1, "left")).toBe(0);
    });
  });

  describe("createInputCache — 에이전트별 입력 상태 캐시", () => {
    it("저장 후 복원", () => {
      const cache = createInputCache();
      cache.set("agent-1", "Hello");
      expect(cache.get("agent-1")).toBe("Hello");
    });

    it("없는 키는 빈 문자열 반환", () => {
      const cache = createInputCache();
      expect(cache.get("nonexistent")).toBe("");
    });

    it("덮어쓰기", () => {
      const cache = createInputCache();
      cache.set("agent-1", "First");
      cache.set("agent-1", "Second");
      expect(cache.get("agent-1")).toBe("Second");
    });

    it("여러 에이전트 독립 저장", () => {
      const cache = createInputCache();
      cache.set("agent-1", "Text A");
      cache.set("agent-2", "Text B");
      expect(cache.get("agent-1")).toBe("Text A");
      expect(cache.get("agent-2")).toBe("Text B");
    });
  });
});
