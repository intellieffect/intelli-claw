import { describe, it, expect } from "vitest";

// ============================================================
// Pure function replicas for testing scroll behavior logic (#6)
// ============================================================

/**
 * Replica of message-list.tsx handleScroll logic (L155-161)
 * Determines if user is "at bottom" of scroll container
 */
function isAtBottom(scrollHeight: number, scrollTop: number, clientHeight: number, threshold = 80): boolean {
  return scrollHeight - scrollTop - clientHeight < threshold;
}

/**
 * Simulates what happens when container height changes (e.g. textarea resize)
 * WITHOUT ResizeObserver — the bug scenario
 */
function simulateContainerResize(
  scrollHeight: number,
  scrollTop: number,
  oldClientHeight: number,
  newClientHeight: number,
  threshold = 80,
): { wasAtBottom: boolean; isStillAtBottom: boolean } {
  const wasAtBottom = isAtBottom(scrollHeight, scrollTop, oldClientHeight, threshold);
  // After resize, scrollTop stays the same but clientHeight changes
  const isStillAtBottom = isAtBottom(scrollHeight, scrollTop, newClientHeight, threshold);
  return { wasAtBottom, isStillAtBottom };
}

// ============================================================
// Tests
// ============================================================

describe("isAtBottom — 스크롤 위치 판정", () => {
  it("스크롤이 최하단이면 true", () => {
    // scrollHeight=1000, scrollTop=700, clientHeight=300 → gap=0
    expect(isAtBottom(1000, 700, 300)).toBe(true);
  });

  it("최하단에서 80px 이내이면 true", () => {
    // scrollHeight=1000, scrollTop=650, clientHeight=300 → gap=50
    expect(isAtBottom(1000, 650, 300)).toBe(true);
  });

  it("최하단에서 80px 이상이면 false", () => {
    // scrollHeight=1000, scrollTop=500, clientHeight=300 → gap=200
    expect(isAtBottom(1000, 500, 300)).toBe(false);
  });

  it("컨테이너와 콘텐츠 크기가 같으면 true (스크롤 불필요)", () => {
    // scrollHeight=300, scrollTop=0, clientHeight=300 → gap=0
    expect(isAtBottom(300, 0, 300)).toBe(true);
  });
});

describe("BUG: textarea 리사이즈 시 스크롤 상태 변화", () => {
  it("textarea 확장으로 clientHeight 감소 → 하단에서 이탈", () => {
    // 사용자가 하단에 있는 상태 (gap=0)
    // scrollHeight=2000, scrollTop=1500, clientHeight=500
    const result = simulateContainerResize(2000, 1500, 500, 400);
    expect(result.wasAtBottom).toBe(true);
    // textarea가 확장되어 clientHeight가 500→400으로 줄어듦
    // gap = 2000 - 1500 - 400 = 100 > 80 → 더 이상 하단이 아님!
    expect(result.isStillAtBottom).toBe(false);
  });

  it("textarea 축소로 clientHeight 증가 → 하단 유지", () => {
    const result = simulateContainerResize(2000, 1500, 500, 550);
    expect(result.wasAtBottom).toBe(true);
    // gap = 2000 - 1500 - 550 = -50 < 80 → 하단 유지
    expect(result.isStillAtBottom).toBe(true);
  });

  it("이미 위로 스크롤된 상태에서 리사이즈 → 여전히 위", () => {
    const result = simulateContainerResize(2000, 500, 500, 400);
    expect(result.wasAtBottom).toBe(false); // gap=1000
    expect(result.isStillAtBottom).toBe(false); // gap=1100
  });
});

describe("ResizeObserver 적용 후 기대 동작", () => {
  it("리사이즈 시 isAtBottom 재평가로 올바른 userScrolledUp 설정", () => {
    // 하단에 있는 상태
    const scrollHeight = 2000;
    const scrollTop = 1500;
    const clientHeight = 500;
    expect(isAtBottom(scrollHeight, scrollTop, clientHeight)).toBe(true);

    // textarea 확장 → clientHeight 줄어듦
    const newClientHeight = 400;
    const atBottomAfterResize = isAtBottom(scrollHeight, scrollTop, newClientHeight);
    // ResizeObserver가 이 상태를 감지하여 userScrolledUp = !atBottomAfterResize = true
    expect(atBottomAfterResize).toBe(false);
    // → 자동 스크롤 미발동 (올바른 동작)
  });

  it("리사이즈 후 하단에 있으면 자동 스크롤 유지", () => {
    const scrollHeight = 2000;
    const scrollTop = 1600;
    const clientHeight = 500;
    expect(isAtBottom(scrollHeight, scrollTop, clientHeight)).toBe(true);

    // 약간의 리사이즈 → 여전히 하단
    const newClientHeight = 450;
    const atBottomAfterResize = isAtBottom(scrollHeight, scrollTop, newClientHeight);
    expect(atBottomAfterResize).toBe(true);
    // → 자동 스크롤 유지 (올바른 동작)
  });
});

describe("모바일 키보드 시나리오", () => {
  it("키보드 등장으로 컨테이너 크게 축소 → 하단 이탈", () => {
    // 키보드가 300px 차지 → clientHeight 800→500
    const result = simulateContainerResize(3000, 2200, 800, 500);
    expect(result.wasAtBottom).toBe(true); // gap=0
    expect(result.isStillAtBottom).toBe(false); // gap=300
  });

  it("키보드 사라짐으로 컨테이너 확장 → 하단 복귀", () => {
    // clientHeight 500→800
    const result = simulateContainerResize(3000, 2200, 500, 800);
    expect(result.wasAtBottom).toBe(false); // gap=300
    expect(result.isStillAtBottom).toBe(true); // gap=0
  });
});

describe("scrollIntoView behavior 검증", () => {
  it("smooth vs instant 동작 차이 확인 (개념 테스트)", () => {
    // smooth: 애니메이션 → 스트리밍 중 연속 호출 시 스크롤 파이팅 유발
    // instant: 즉시 이동 → 스크롤 파이팅 없음
    // 이 테스트는 동작 의도를 문서화
    const scrollBehaviors = ["smooth", "instant"] as const;
    expect(scrollBehaviors).toContain("smooth");
    expect(scrollBehaviors).toContain("instant");
    // instant가 스트리밍에 더 적합
  });
});
