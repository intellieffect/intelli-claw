import { describe, it, expect } from "vitest";
import {
  parseSessionKey,
  sessionDisplayName,
  groupSessionsByAgent,
  type GatewaySession,
} from "@/lib/gateway/session-utils";

describe("Topic migration: :thread: and :topic: handled identically", () => {
  const threadKey = "agent:alpha:main:thread:abc123";
  const topicKey = "agent:alpha:main:topic:abc123";

  it("parseSessionKey returns same result for :thread: and :topic:", () => {
    const threadResult = parseSessionKey(threadKey);
    const topicResult = parseSessionKey(topicKey);

    expect(threadResult).toEqual(topicResult);
    expect(threadResult.type).toBe("thread");
    expect(threadResult.detail).toBe("abc123");
    expect(threadResult.agentId).toBe("alpha");
  });

  it("sessionDisplayName shows 토픽 label for both formats", () => {
    const threadName = sessionDisplayName({ key: threadKey });
    const topicName = sessionDisplayName({ key: topicKey });

    expect(threadName).toBe(topicName);
    expect(threadName).toContain("토픽");
    expect(threadName).not.toContain("스레드");
  });

  it("groupSessionsByAgent groups :thread: and :topic: sessions together", () => {
    const sessions: GatewaySession[] = [
      { key: "agent:alpha:main", updatedAt: 100 },
      { key: threadKey, updatedAt: 200 },
      { key: topicKey.replace("abc123", "def456"), updatedAt: 300 },
    ];
    const groups = groupSessionsByAgent(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0].agentId).toBe("alpha");
    expect(groups[0].sessions).toHaveLength(3);
  });
});

describe("Topic migration: backward compatibility", () => {
  it("existing :thread: keys still parse correctly", () => {
    const keys = [
      "agent:main:main:thread:18833",
      "agent:assistant:main:thread:xyz",
      "agent:beta:main:thread:001",
    ];
    for (const key of keys) {
      const result = parseSessionKey(key);
      expect(result.type).toBe("thread");
      expect(result.detail).toBeTruthy();
    }
  });

  it("new :topic: keys parse correctly", () => {
    const keys = [
      "agent:main:main:topic:18833",
      "agent:assistant:main:topic:xyz",
      "agent:beta:main:topic:001",
    ];
    for (const key of keys) {
      const result = parseSessionKey(key);
      expect(result.type).toBe("thread");
      expect(result.detail).toBeTruthy();
    }
  });

  it("channel-routed :topic: key parsed like channel-routed :thread:", () => {
    const threadResult = parseSessionKey(
      "agent:main:telegram:mybot:direct:123456789:thread:001"
    );
    const topicResult = parseSessionKey(
      "agent:main:telegram:mybot:direct:123456789:topic:001"
    );
    expect(threadResult.type).toBe("thread");
    expect(topicResult.type).toBe("thread");
    expect(threadResult.channel).toBe("telegram");
    expect(topicResult.channel).toBe("telegram");
    expect(threadResult.detail).toBe(topicResult.detail);
  });

  it("main, cron, subagent, a2a parsing is not affected", () => {
    expect(parseSessionKey("agent:alpha:main").type).toBe("main");
    expect(parseSessionKey("agent:alpha:cron:daily").type).toBe("cron");
    expect(parseSessionKey("agent:alpha:subagent:sub1").type).toBe("subagent");
    expect(parseSessionKey("agent:alpha:agent:beta:main").type).toBe("a2a");
  });
});

describe("Topic migration: backfill skip detection", () => {
  it(":thread: key is detected for backfill skip", () => {
    const key = "agent:alpha:main:thread:abc";
    expect(key.includes(":thread:") || key.includes(":topic:")).toBe(true);
  });

  it(":topic: key is detected for backfill skip", () => {
    const key = "agent:alpha:main:topic:abc";
    expect(key.includes(":thread:") || key.includes(":topic:")).toBe(true);
  });

  it("main key does not trigger backfill skip", () => {
    const key = "agent:alpha:main";
    expect(key.includes(":thread:") || key.includes(":topic:")).toBe(false);
  });
});
