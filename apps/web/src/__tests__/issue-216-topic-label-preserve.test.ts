/**
 * #216 — 세션 갱신 시 토픽 주제가 의도치 않게 자동 업데이트되는 이슈
 *
 * 검증 대상:
 * 1. detectLabelsToRestore — 세션 reset 감지 시 기존 label 복원 판단
 * 2. preservedLabels 캐시 축적 및 유지
 * 3. 엣지 케이스 — label이 원래 없는 세션, 여러 세션 동시 reset
 */
import { describe, it, expect } from "vitest";
import {
  detectLabelsToRestore,
  type SessionLabelSnapshot,
} from "@/lib/gateway/hooks";

describe("#216 — 세션 reset 시 토픽 label 보존", () => {
  it("세션 reset 후 서버가 label을 비우면 이전 label을 복원한다", () => {
    const tracked = new Map([["agent:main:main", "sess-001"]]);
    const preserved = new Map([["agent:main:main", "프로젝트 회의"]]);
    const sessions: SessionLabelSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-002", label: undefined },
    ];

    const result = detectLabelsToRestore(tracked, preserved, sessions);
    expect(result.get("agent:main:main")).toBe("프로젝트 회의");
  });

  it("세션 reset 후 서버가 새 label을 제공하면 복원하지 않는다", () => {
    const tracked = new Map([["agent:main:main", "sess-001"]]);
    const preserved = new Map([["agent:main:main", "이전 주제"]]);
    const sessions: SessionLabelSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-002", label: "새 주제" },
    ];

    const result = detectLabelsToRestore(tracked, preserved, sessions);
    expect(result.size).toBe(0);
    // preserved should be updated to new label
    expect(preserved.get("agent:main:main")).toBe("새 주제");
  });

  it("세션 ID가 변경되지 않으면 복원하지 않는다", () => {
    const tracked = new Map([["agent:main:main", "sess-001"]]);
    const preserved = new Map([["agent:main:main", "기존 주제"]]);
    const sessions: SessionLabelSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-001", label: "기존 주제" },
    ];

    const result = detectLabelsToRestore(tracked, preserved, sessions);
    expect(result.size).toBe(0);
  });

  it("label이 원래 없는 세션이 reset되면 복원 대상이 아니다", () => {
    const tracked = new Map([["agent:main:main", "sess-001"]]);
    const preserved = new Map<string, string>();
    const sessions: SessionLabelSnapshot[] = [
      { key: "agent:main:main", sessionId: "sess-002", label: undefined },
    ];

    const result = detectLabelsToRestore(tracked, preserved, sessions);
    expect(result.size).toBe(0);
  });

  it("여러 세션이 동시에 reset되어도 각각 올바르게 복원한다", () => {
    const tracked = new Map([
      ["agent:main:main", "s1"],
      ["agent:main:main:topic:t1", "s2"],
      ["agent:main:main:topic:t2", "s3"],
    ]);
    const preserved = new Map([
      ["agent:main:main", "메인 토픽"],
      ["agent:main:main:topic:t1", "서브 토픽"],
      ["agent:main:main:topic:t2", "세번째"],
    ]);
    const sessions: SessionLabelSnapshot[] = [
      { key: "agent:main:main", sessionId: "s1-new", label: undefined },
      { key: "agent:main:main:topic:t1", sessionId: "s2-new", label: undefined },
      { key: "agent:main:main:topic:t2", sessionId: "s3", label: "세번째" }, // not reset
    ];

    const result = detectLabelsToRestore(tracked, preserved, sessions);
    expect(result.get("agent:main:main")).toBe("메인 토픽");
    expect(result.get("agent:main:main:topic:t1")).toBe("서브 토픽");
    expect(result.has("agent:main:main:topic:t2")).toBe(false);
  });

  it("preservedLabels 캐시가 폴링 주기에서 축적된 label을 유지한다", () => {
    const preserved = new Map<string, string>();

    // 1st poll: label 있음
    detectLabelsToRestore(
      new Map(),
      preserved,
      [{ key: "agent:main:main", sessionId: "s1", label: "축적된 주제" }],
    );
    expect(preserved.get("agent:main:main")).toBe("축적된 주제");

    // 2nd poll: label 변경
    detectLabelsToRestore(
      new Map([["agent:main:main", "s1"]]),
      preserved,
      [{ key: "agent:main:main", sessionId: "s1", label: "변경된 주제" }],
    );
    expect(preserved.get("agent:main:main")).toBe("변경된 주제");

    // 3rd poll: reset 발생, label 빈값
    const result = detectLabelsToRestore(
      new Map([["agent:main:main", "s1"]]),
      preserved,
      [{ key: "agent:main:main", sessionId: "s2", label: undefined }],
    );
    expect(result.get("agent:main:main")).toBe("변경된 주제");
  });

  it("trackedSessionIds에 없는 세션은 reset으로 간주하지 않는다", () => {
    const tracked = new Map<string, string>(); // empty — first poll
    const preserved = new Map<string, string>();
    const sessions: SessionLabelSnapshot[] = [
      { key: "agent:main:main", sessionId: "s1", label: "첫 label" },
    ];

    const result = detectLabelsToRestore(tracked, preserved, sessions);
    expect(result.size).toBe(0);
    expect(preserved.get("agent:main:main")).toBe("첫 label");
  });
});
