import { useEffect, useCallback, useRef } from "react";

export type SwipeDirection = "left" | "right";

/**
 * 스와이프 방향 감지 (순수 함수)
 * - 수평 이동이 수직 이동보다 클 때만 스와이프로 판단
 * - threshold 이상 이동했을 때만 방향 반환
 */
export function detectSwipeDirection(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  threshold: number,
): SwipeDirection | null {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);

  // 수직 이동이 수평보다 크면 스크롤로 간주
  if (absDeltaY >= absDeltaX) return null;

  // threshold 미달
  if (absDeltaX < threshold) return null;

  return deltaX > 0 ? "right" : "left";
}

/**
 * 에이전트 순환 인덱스 계산 (순수 함수)
 */
export function getNextAgentIndex(
  current: number,
  total: number,
  direction: SwipeDirection,
): number {
  if (total <= 1) return 0;
  const delta = direction === "right" ? 1 : -1;
  return (current + delta + total) % total;
}

/**
 * 에이전트별 입력 텍스트 캐시
 */
export function createInputCache() {
  const map = new Map<string, string>();
  return {
    get(agentId: string): string {
      return map.get(agentId) ?? "";
    },
    set(agentId: string, text: string): void {
      map.set(agentId, text);
    },
  };
}

export interface UseSwipeGestureOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  threshold?: number;
  enabled?: boolean;
}

/**
 * 스와이프 제스처 감지 커스텀 훅
 * - touchstart/touchmove/touchend 이벤트 사용
 * - 수직 스크롤과 구분
 * - threshold (기본 50px) 이상일 때만 콜백 호출
 */
export function useSwipeGesture(
  ref: React.RefObject<HTMLElement | null>,
  options: UseSwipeGestureOptions,
) {
  const { onSwipeLeft, onSwipeRight, threshold = 50, enabled = true } = options;

  const startRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      startRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, []);

  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      if (!startRef.current) return;
      const touch = e.changedTouches[0];
      if (!touch) return;

      const direction = detectSwipeDirection(
        startRef.current.x,
        startRef.current.y,
        touch.clientX,
        touch.clientY,
        threshold,
      );

      startRef.current = null;

      if (direction === "left") {
        onSwipeLeft?.();
      } else if (direction === "right") {
        onSwipeRight?.();
      }
    },
    [threshold, onSwipeLeft, onSwipeRight],
  );

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [ref, enabled, handleTouchStart, handleTouchEnd]);
}
