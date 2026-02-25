import { describe, it, expect } from "vitest";
import {
  parseSessionKey,
  groupSessionsByAgent,
  sessionDisplayName,
  type GatewaySession,
} from "@/lib/gateway/session-utils";

// ============================================================
// Agent Browser (#26) — TDD tests
// Tests for grouping, filtering, and display logic
// ============================================================

function makeSession(key: string, opts: Partial<GatewaySession> = {}): GatewaySession {
  return {
    key,
    updatedAt: Date.now(),
    ...opts,
  };
}

describe("groupSessionsByAgent — 에이전트별 세션 그룹화", () => {
  it("에이전트별로 세션을 그룹화", () => {
    const sessions = [
      makeSession("agent:main:main"),
      makeSession("agent:main:main:thread:abc"),
      makeSession("agent:murim:main"),
      makeSession("agent:mobidic:main"),
      makeSession("agent:mobidic:main:thread:xyz"),
    ];
    const groups = groupSessionsByAgent(sessions);

    expect(groups).toHaveLength(3);
    const agentIds = groups.map((g) => g.agentId);
    expect(agentIds).toContain("main");
    expect(agentIds).toContain("murim");
    expect(agentIds).toContain("mobidic");
  });

  it("각 그룹 내 세션이 updatedAt 내림차순 정렬", () => {
    const sessions = [
      makeSession("agent:main:main", { updatedAt: 1000 }),
      makeSession("agent:main:main:thread:a", { updatedAt: 3000 }),
      makeSession("agent:main:main:thread:b", { updatedAt: 2000 }),
    ];
    const groups = groupSessionsByAgent(sessions);
    const mainGroup = groups.find((g) => g.agentId === "main")!;

    expect(mainGroup.sessions[0].updatedAt).toBe(3000);
    expect(mainGroup.sessions[1].updatedAt).toBe(2000);
    expect(mainGroup.sessions[2].updatedAt).toBe(1000);
  });

  it("그룹 자체도 최신 세션 기준 내림차순 정렬", () => {
    const sessions = [
      makeSession("agent:alpha:main", { updatedAt: 1000 }),
      makeSession("agent:beta:main", { updatedAt: 3000 }),
      makeSession("agent:gamma:main", { updatedAt: 2000 }),
    ];
    const groups = groupSessionsByAgent(sessions);

    expect(groups[0].agentId).toBe("beta");
    expect(groups[1].agentId).toBe("gamma");
    expect(groups[2].agentId).toBe("alpha");
  });

  it("빈 세션 배열 → 빈 그룹", () => {
    expect(groupSessionsByAgent([])).toHaveLength(0);
  });

  it("cron/subagent 세션도 올바르게 그룹화", () => {
    const sessions = [
      makeSession("agent:main:main"),
      makeSession("agent:main:cron:daily-check"),
      makeSession("agent:main:subagent:task-123"),
    ];
    const groups = groupSessionsByAgent(sessions);
    const mainGroup = groups.find((g) => g.agentId === "main")!;

    expect(mainGroup.sessions).toHaveLength(3);
  });
});

describe("에이전트 브라우저 필터링 로직", () => {
  /**
   * Replica of filtering logic for agent browser:
   * - Hide cron/subagent by default
   * - Filter by search query (agent name, session label, key)
   */
  function filterSessionsForBrowser(
    sessions: GatewaySession[],
    search: string,
    showSystem = false,
  ): GatewaySession[] {
    const q = search.toLowerCase().trim();
    return sessions.filter((s) => {
      const parsed = parseSessionKey(s.key);

      // Hide cron/subagent unless explicitly searched or showSystem
      if (!showSystem && (parsed.type === "cron" || parsed.type === "subagent")) {
        return false;
      }

      // No search → show all remaining
      if (!q) return true;

      // Match against agent, label, key
      const name = sessionDisplayName(s).toLowerCase();
      return (
        name.includes(q) ||
        s.key.toLowerCase().includes(q) ||
        parsed.agentId.toLowerCase().includes(q)
      );
    });
  }

  it("기본적으로 cron/subagent 세션 숨김", () => {
    const sessions = [
      makeSession("agent:main:main"),
      makeSession("agent:main:cron:daily"),
      makeSession("agent:main:subagent:task-1"),
      makeSession("agent:main:main:thread:abc"),
    ];
    const filtered = filterSessionsForBrowser(sessions, "");

    expect(filtered).toHaveLength(2);
    expect(filtered.every((s) => !s.key.includes("cron") && !s.key.includes("subagent"))).toBe(true);
  });

  it("showSystem=true이면 cron/subagent도 표시", () => {
    const sessions = [
      makeSession("agent:main:main"),
      makeSession("agent:main:cron:daily"),
      makeSession("agent:main:subagent:task-1"),
    ];
    const filtered = filterSessionsForBrowser(sessions, "", true);

    expect(filtered).toHaveLength(3);
  });

  it("검색어로 에이전트 이름 필터링", () => {
    const sessions = [
      makeSession("agent:main:main"),
      makeSession("agent:murim:main"),
      makeSession("agent:mobidic:main"),
    ];
    const filtered = filterSessionsForBrowser(sessions, "murim");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].key).toBe("agent:murim:main");
  });

  it("검색어로 라벨 필터링", () => {
    const sessions = [
      makeSession("agent:main:main:thread:a", { label: "프로젝트 미팅" }),
      makeSession("agent:main:main:thread:b", { label: "코드 리뷰" }),
    ];
    const filtered = filterSessionsForBrowser(sessions, "미팅");

    expect(filtered).toHaveLength(1);
    expect(filtered[0].label).toBe("프로젝트 미팅");
  });

  it("빈 검색어 → 전체 표시 (cron/subagent 제외)", () => {
    const sessions = [
      makeSession("agent:main:main"),
      makeSession("agent:murim:main"),
    ];
    const filtered = filterSessionsForBrowser(sessions, "");

    expect(filtered).toHaveLength(2);
  });
});

describe("parseSessionKey — 에이전트 브라우저용 파싱", () => {
  it("main 세션 파싱", () => {
    const parsed = parseSessionKey("agent:main:main");
    expect(parsed.agentId).toBe("main");
    expect(parsed.type).toBe("main");
  });

  it("thread 세션 파싱", () => {
    const parsed = parseSessionKey("agent:main:main:thread:abc123");
    expect(parsed.agentId).toBe("main");
    expect(parsed.type).toBe("thread");
    expect(parsed.detail).toBe("abc123");
  });

  it("channel 세션 파싱", () => {
    const parsed = parseSessionKey("agent:main:telegram:mybot:direct:123456789:thread:001");
    expect(parsed.agentId).toBe("main");
    expect(parsed.channel).toBe("telegram");
  });
});

describe("Cmd+O 단축키 매칭", () => {
  // Since matchesShortcut is already tested in shortcuts,
  // we verify the shortcut ID exists and is correctly defined
  it("agent-browser 단축키 ID가 shortcuts에 정의됨", async () => {
    const { DEFAULT_SHORTCUTS } = await import("@/lib/shortcuts");
    const agentBrowser = DEFAULT_SHORTCUTS.find((s) => s.id === "agent-browser");

    expect(agentBrowser).toBeDefined();
    expect(agentBrowser!.keys).toMatch(/Cmd\+O|Ctrl\+O/);
    expect(agentBrowser!.scope).toBe("panel");
  });
});
