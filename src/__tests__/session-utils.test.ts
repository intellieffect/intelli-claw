import { describe, it, expect } from "vitest";
import {
  parseSessionKey,
  sessionDisplayName,
  groupSessionsByAgent,
  type GatewaySession,
} from "@/lib/gateway/session-utils";

describe("parseSessionKey", () => {
  it("parses main session", () => {
    const result = parseSessionKey("agent:karajan:main");
    expect(result).toEqual({ agentId: "karajan", type: "main" });
  });

  it("parses thread session", () => {
    const result = parseSessionKey("agent:karajan:main:thread:18833");
    expect(result).toEqual({ agentId: "karajan", type: "thread", detail: "18833" });
  });

  it("parses cron session", () => {
    const result = parseSessionKey("agent:brxce:cron:daily-check");
    expect(result).toEqual({ agentId: "brxce", type: "cron", detail: "daily-check" });
  });

  it("parses subagent session", () => {
    const result = parseSessionKey("agent:karajan:subagent:abc-123");
    expect(result).toEqual({ agentId: "karajan", type: "subagent", detail: "abc-123" });
  });

  it("parses A2A session", () => {
    const result = parseSessionKey("agent:karajan:agent:brxce:main");
    expect(result).toEqual({ agentId: "karajan", type: "a2a", detail: "brxce" });
  });

  it("handles unknown format", () => {
    const result = parseSessionKey("something:else");
    expect(result.type).toBe("unknown");
  });
});

describe("sessionDisplayName", () => {
  it("uses label when available", () => {
    expect(sessionDisplayName({ key: "agent:karajan:main", label: "My Chat" })).toBe("My Chat");
  });

  it("generates name from key for main session", () => {
    expect(sessionDisplayName({ key: "agent:karajan:main" })).toBe("karajan 메인");
  });

  it("generates name for thread session", () => {
    expect(sessionDisplayName({ key: "agent:karajan:main:thread:18833" })).toBe(
      "karajan 스레드 #18833"
    );
  });

  it("generates name for A2A session", () => {
    expect(sessionDisplayName({ key: "agent:karajan:agent:brxce:main" })).toBe("karajan → brxce");
  });

  it("falls back to displayName", () => {
    expect(
      sessionDisplayName({ key: "weird:key", displayName: "Fallback Name" })
    ).toBe("Fallback Name");
  });
});

describe("groupSessionsByAgent", () => {
  it("groups sessions by agent", () => {
    const sessions: GatewaySession[] = [
      { key: "agent:karajan:main", updatedAt: 100 },
      { key: "agent:brxce:main", updatedAt: 200 },
      { key: "agent:karajan:main:thread:123", updatedAt: 300 },
    ];
    const groups = groupSessionsByAgent(sessions);
    expect(groups).toHaveLength(2);
    // karajan group first (thread:123 has updatedAt 300)
    expect(groups[0].agentId).toBe("karajan");
    expect(groups[0].sessions).toHaveLength(2);
    // brxce group second
    expect(groups[1].agentId).toBe("brxce");
    expect(groups[1].sessions).toHaveLength(1);
  });

  it("sorts sessions within group by updatedAt desc", () => {
    const sessions: GatewaySession[] = [
      { key: "agent:karajan:main", updatedAt: 100 },
      { key: "agent:karajan:main:thread:1", updatedAt: 300 },
      { key: "agent:karajan:cron:daily", updatedAt: 200 },
    ];
    const groups = groupSessionsByAgent(sessions);
    expect(groups[0].sessions[0].updatedAt).toBe(300);
    expect(groups[0].sessions[1].updatedAt).toBe(200);
    expect(groups[0].sessions[2].updatedAt).toBe(100);
  });

  it("returns empty array for no sessions", () => {
    expect(groupSessionsByAgent([])).toEqual([]);
  });
});
