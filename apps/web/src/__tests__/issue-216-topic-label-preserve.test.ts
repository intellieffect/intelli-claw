/**
 * #216 — 세션 갱신 시 토픽 주제가 의도치 않게 자동 업데이트되는 이슈
 *
 * 검증 대상:
 * 1. preservedLabelsRef — 세션 reset 감지 시 기존 label 캐싱
 * 2. sessions.patch 호출 — label 복원 요청
 * 3. UI에 preserved label 표시 — 서버가 빈 label 반환해도 클라이언트 유지
 * 4. 엣지 케이스 — label이 원래 없는 세션, 여러 세션 동시 reset
 */
import { describe, it, expect } from "vitest";

// --- Unit: label preservation logic (extracted from hooks.tsx useSessions) ---

interface SessionSnapshot {
  key: string;
  sessionId: string;
  label?: string;
}

/**
 * Simulates the #216 label preservation logic from useSessions fetchSessions.
 * Returns: { labelsToRestore, mappedLabels }
 */
function simulateLabelPreservation(
  previousSessions: SessionSnapshot[],
  currentSessions: SessionSnapshot[],
  preservedLabels: Map<string, string>,
) {
  const trackedSessionIds = new Map<string, string>();
  for (const s of previousSessions) {
    trackedSessionIds.set(s.key, s.sessionId);
    if (s.label) preservedLabels.set(s.key, s.label);
  }

  const labelsToRestore = new Map<string, string>();

  for (const s of currentSessions) {
    const oldSessionId = trackedSessionIds.get(s.key);
    if (s.label) preservedLabels.set(s.key, s.label);

    if (oldSessionId && oldSessionId !== s.sessionId) {
      // Reset detected
      const previousLabel = preservedLabels.get(s.key);
      if (previousLabel && !s.label) {
        labelsToRestore.set(s.key, previousLabel);
      }
    }
  }

  // Build effective labels (what UI should show)
  const mappedLabels = new Map<string, string | undefined>();
  for (const s of currentSessions) {
    const restoredLabel = labelsToRestore.get(s.key);
    mappedLabels.set(s.key, s.label || restoredLabel || undefined);
  }

  return { labelsToRestore, mappedLabels };
}

describe("#216 — 세션 reset 시 토픽 label 보존", () => {
  it("세션 reset 후 서버가 label을 비우면 이전 label을 복원한다", () => {
    const preserved = new Map<string, string>();
    const prev: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-001", label: "프로젝트 회의" },
    ];
    const curr: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-002", label: undefined },
    ];

    const { labelsToRestore, mappedLabels } = simulateLabelPreservation(prev, curr, preserved);

    expect(labelsToRestore.get("agent:main:main")).toBe("프로젝트 회의");
    expect(mappedLabels.get("agent:main:main")).toBe("프로젝트 회의");
  });

  it("세션 reset 후 서버가 새 label을 제공하면 새 label을 사용한다", () => {
    const preserved = new Map<string, string>();
    const prev: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-001", label: "이전 주제" },
    ];
    const curr: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-002", label: "새 주제" },
    ];

    const { labelsToRestore, mappedLabels } = simulateLabelPreservation(prev, curr, preserved);

    expect(labelsToRestore.size).toBe(0);
    expect(mappedLabels.get("agent:main:main")).toBe("새 주제");
  });

  it("세션 ID가 변경되지 않으면 복원하지 않는다", () => {
    const preserved = new Map<string, string>();
    const prev: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-001", label: "기존 주제" },
    ];
    const curr: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-001", label: "기존 주제" },
    ];

    const { labelsToRestore } = simulateLabelPreservation(prev, curr, preserved);
    expect(labelsToRestore.size).toBe(0);
  });

  it("label이 원래 없는 세션이 reset되면 복원 대상이 아니다", () => {
    const preserved = new Map<string, string>();
    const prev: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-001", label: undefined },
    ];
    const curr: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-002", label: undefined },
    ];

    const { labelsToRestore, mappedLabels } = simulateLabelPreservation(prev, curr, preserved);

    expect(labelsToRestore.size).toBe(0);
    expect(mappedLabels.get("agent:main:main")).toBeUndefined();
  });

  it("여러 세션이 동시에 reset되어도 각각 올바르게 복원한다", () => {
    const preserved = new Map<string, string>();
    const prev: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "s1", label: "메인 토픽" },
      { key: "agent:main:main:topic:t1", sessionId: "s2", label: "서브 토픽" },
      { key: "agent:main:main:topic:t2", sessionId: "s3", label: "세번째" },
    ];
    const curr: SessionSnapshot[] = [
      { key: "agent:main:main", sessionId: "s1-new", label: undefined },
      { key: "agent:main:main:topic:t1", sessionId: "s2-new", label: undefined },
      { key: "agent:main:main:topic:t2", sessionId: "s3", label: "세번째" }, // 이건 reset 안 됨
    ];

    const { labelsToRestore, mappedLabels } = simulateLabelPreservation(prev, curr, preserved);

    expect(labelsToRestore.get("agent:main:main")).toBe("메인 토픽");
    expect(labelsToRestore.get("agent:main:main:topic:t1")).toBe("서브 토픽");
    expect(labelsToRestore.has("agent:main:main:topic:t2")).toBe(false);
    expect(mappedLabels.get("agent:main:main:topic:t2")).toBe("세번째");
  });

  it("preservedLabels 캐시가 이전 폴링 주기에서 축적된 label을 유지한다", () => {
    const preserved = new Map<string, string>();

    // 1st poll: label 있음
    simulateLabelPreservation(
      [],
      [{ key: "agent:main:main", sessionId: "s1", label: "축적된 주제" }],
      preserved,
    );
    expect(preserved.get("agent:main:main")).toBe("축적된 주제");

    // 2nd poll: label 변경
    simulateLabelPreservation(
      [{ key: "agent:main:main", sessionId: "s1", label: "축적된 주제" }],
      [{ key: "agent:main:main", sessionId: "s1", label: "변경된 주제" }],
      preserved,
    );
    expect(preserved.get("agent:main:main")).toBe("변경된 주제");

    // 3rd poll: reset 발생, label 빈값
    const { labelsToRestore } = simulateLabelPreservation(
      [{ key: "agent:main:main", sessionId: "s1", label: "변경된 주제" }],
      [{ key: "agent:main:main", sessionId: "s2", label: undefined }],
      preserved,
    );
    expect(labelsToRestore.get("agent:main:main")).toBe("변경된 주제");
  });
});
