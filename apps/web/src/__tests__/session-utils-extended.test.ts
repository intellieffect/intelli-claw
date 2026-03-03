import { describe, it, expect } from "vitest";
import {
  parseSessionKey,
  sessionDisplayName,
  groupSessionsByAgent,
  type GatewaySession,
} from "@/lib/gateway/session-utils";

describe("parseSessionKey — channel-routed sessions", () => {
  it("parses channel-routed thread session", () => {
    const result = parseSessionKey(
      "agent:main:telegram:mybot:direct:123456789:thread:001",
    );
    expect(result).toEqual({
      agentId: "main",
      type: "thread",
      detail: "001",
      channel: "telegram",
    });
  });

  it("parses channel-routed main session (no thread)", () => {
    const result = parseSessionKey(
      "agent:main:telegram:mybot:direct:123456789",
    );
    expect(result).toEqual({
      agentId: "main",
      type: "main",
      channel: "telegram",
    });
  });
});

describe("parseSessionKey — edge cases", () => {
  it("handles empty string", () => {
    const result = parseSessionKey("");
    expect(result.type).toBe("unknown");
    expect(result.agentId).toBe("unknown");
  });

  it("handles single colon", () => {
    const result = parseSessionKey(":");
    expect(result.type).toBe("unknown");
  });

  it("handles 'agent:' with no id", () => {
    const result = parseSessionKey("agent:");
    expect(result.type).toBe("unknown");
  });

  it("handles 'agent:a' (only 2 parts)", () => {
    const result = parseSessionKey("agent:a");
    expect(result.type).toBe("unknown");
  });
});

describe("sessionDisplayName — channel display", () => {
  it("shows [텔레그램] prefix for telegram channel session", () => {
    const name = sessionDisplayName({
      key: "agent:main:telegram:mybot:direct:123456789",
    });
    expect(name).toContain("[텔레그램]");
    expect(name).toContain("main");
  });

  it("shows correct labels for all known channels", () => {
    const expectedLabels: Record<string, string> = {
      telegram: "텔레그램",
      signal: "시그널",
      whatsapp: "왓츠앱",
      discord: "디스코드",
      slack: "슬랙",
      webchat: "웹챗",
      imessage: "iMessage",
    };

    for (const [channel, label] of Object.entries(expectedLabels)) {
      const name = sessionDisplayName({
        key: `agent:myagent:${channel}:bot:direct:user1`,
      });
      expect(name).toContain(`[${label}]`);
    }
  });

  it("shows raw channel name for unknown channel", () => {
    const name = sessionDisplayName({
      key: "agent:myagent:matrix:bot:direct:user1",
    });
    expect(name).toContain("[matrix]");
  });
});

describe("groupSessionsByAgent — extended", () => {
  it("handles sessions with undefined updatedAt", () => {
    const sessions: GatewaySession[] = [
      { key: "agent:alpha:main" },
      { key: "agent:alpha:main:thread:1" },
    ];
    const groups = groupSessionsByAgent(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].agentId).toBe("alpha");
    expect(groups[0].sessions).toHaveLength(2);
  });

  it("single agent produces one group", () => {
    const sessions: GatewaySession[] = [
      { key: "agent:solo:main", updatedAt: 100 },
      { key: "agent:solo:cron:daily", updatedAt: 200 },
      { key: "agent:solo:subagent:abc-123", updatedAt: 50 },
    ];
    const groups = groupSessionsByAgent(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].agentId).toBe("solo");
    expect(groups[0].sessions).toHaveLength(3);
    // most recent first
    expect(groups[0].sessions[0].updatedAt).toBe(200);
  });
});

describe("GatewaySession interface compatibility", () => {
  it("accepts sessions with all optional fields", () => {
    const session: GatewaySession = {
      key: "agent:alpha:main",
      kind: "chat",
      label: "Test",
      displayName: "Test Session",
      channel: "telegram",
      updatedAt: Date.now(),
      totalTokens: 1500,
      model: "claude-sonnet-4-20250514",
      modelProvider: "anthropic",
      sessionId: "uuid-1234",
    };
    const groups = groupSessionsByAgent([session]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions[0].totalTokens).toBe(1500);
    expect(groups[0].sessions[0].model).toBe("claude-sonnet-4-20250514");
    expect(groups[0].sessions[0].sessionId).toBe("uuid-1234");
  });

  it("accepts sessions with only required key field", () => {
    const session: GatewaySession = { key: "agent:beta:main" };
    const groups = groupSessionsByAgent([session]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sessions[0].totalTokens).toBeUndefined();
    expect(groups[0].sessions[0].sessionId).toBeUndefined();
  });
});
