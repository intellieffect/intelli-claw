import { describe, it, expect } from "vitest";
import {
  parseSessionKey,
  sessionDisplayName,
  groupSessionsByAgent,
  type GatewaySession,
} from "@/lib/gateway/session-utils";

describe("parseSessionKey", () => {
  it("parses main session", () => {
    const result = parseSessionKey("agent:my-agent:main");
    expect(result).toEqual({ agentId: "my-agent", type: "main" });
  });

  it("parses thread session", () => {
    const result = parseSessionKey("agent:my-agent:main:thread:18833");
    expect(result).toEqual({ agentId: "my-agent", type: "thread", detail: "18833" });
  });

  it("parses cron session", () => {
    const result = parseSessionKey("agent:brxce:cron:daily-check");
    expect(result).toEqual({ agentId: "brxce", type: "cron", detail: "daily-check" });
  });

  it("parses subagent session", () => {
    const result = parseSessionKey("agent:my-agent:subagent:abc-123");
    expect(result).toEqual({ agentId: "my-agent", type: "subagent", detail: "abc-123" });
  });

  it("parses A2A session", () => {
    const result = parseSessionKey("agent:my-agent:agent:brxce:main");
    expect(result).toEqual({ agentId: "my-agent", type: "a2a", detail: "brxce" });
  });

  it("handles unknown format", () => {
    const result = parseSessionKey("something:else");
    expect(result.type).toBe("unknown");
  });
});

describe("sessionDisplayName", () => {
  it("uses label when available", () => {
    expect(sessionDisplayName({ key: "agent:my-agent:main", label: "My Chat" })).toBe("My Chat");
  });

  it("generates name from key for main session", () => {
    expect(sessionDisplayName({ key: "agent:my-agent:main" })).toBe("my-agent 메인");
  });

  it("generates name for thread session", () => {
    expect(sessionDisplayName({ key: "agent:my-agent:main:thread:18833" })).toBe(
      "my-agent 스레드 #18833"
    );
  });

  it("generates name for A2A session", () => {
    expect(sessionDisplayName({ key: "agent:my-agent:agent:brxce:main" })).toBe("my-agent → brxce");
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
      { key: "agent:my-agent:main", updatedAt: 100 },
      { key: "agent:brxce:main", updatedAt: 200 },
      { key: "agent:my-agent:main:thread:123", updatedAt: 300 },
    ];
    const groups = groupSessionsByAgent(sessions);
    expect(groups).toHaveLength(2);
    // my-agent group first (thread:123 has updatedAt 300)
    expect(groups[0].agentId).toBe("my-agent");
    expect(groups[0].sessions).toHaveLength(2);
    // brxce group second
    expect(groups[1].agentId).toBe("brxce");
    expect(groups[1].sessions).toHaveLength(1);
  });

  it("sorts sessions within group by updatedAt desc", () => {
    const sessions: GatewaySession[] = [
      { key: "agent:my-agent:main", updatedAt: 100 },
      { key: "agent:my-agent:main:thread:1", updatedAt: 300 },
      { key: "agent:my-agent:cron:daily", updatedAt: 200 },
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
