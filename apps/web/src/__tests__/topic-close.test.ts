import { describe, it, expect } from "vitest";
import {
  parseSessionKey,
  type GatewaySession,
} from "@/lib/gateway/session-utils";

// Import the topic-close helpers (to be created)
import {
  CLOSED_PREFIX,
  isTopicClosed,
  getCleanLabel,
  isTopicSession,
} from "@intelli-claw/shared/gateway/session-utils";

describe("Topic Close — label prefix convention", () => {
  describe("CLOSED_PREFIX", () => {
    it("is '[closed] '", () => {
      expect(CLOSED_PREFIX).toBe("[closed] ");
    });
  });

  describe("isTopicClosed", () => {
    it("returns true when label starts with [closed] prefix", () => {
      const session: GatewaySession = { key: "agent:alpha:main:topic:abc", label: "[closed] My topic" };
      expect(isTopicClosed(session)).toBe(true);
    });

    it("returns false when label does not start with prefix", () => {
      const session: GatewaySession = { key: "agent:alpha:main:topic:abc", label: "My topic" };
      expect(isTopicClosed(session)).toBe(false);
    });

    it("returns false when label is null", () => {
      const session: GatewaySession = { key: "agent:alpha:main:topic:abc", label: null };
      expect(isTopicClosed(session)).toBe(false);
    });

    it("returns false when label is undefined", () => {
      const session: GatewaySession = { key: "agent:alpha:main:topic:abc" };
      expect(isTopicClosed(session)).toBe(false);
    });

    it("returns false when label contains [closed] but not at start", () => {
      const session: GatewaySession = { key: "agent:alpha:main:topic:abc", label: "topic [closed] test" };
      expect(isTopicClosed(session)).toBe(false);
    });
  });

  describe("getCleanLabel", () => {
    it("strips [closed] prefix from label", () => {
      const session: GatewaySession = { key: "agent:alpha:main:topic:abc", label: "[closed] My topic" };
      expect(getCleanLabel(session)).toBe("My topic");
    });

    it("returns label unchanged when no prefix", () => {
      const session: GatewaySession = { key: "agent:alpha:main:topic:abc", label: "My topic" };
      expect(getCleanLabel(session)).toBe("My topic");
    });

    it("returns empty string when label is null", () => {
      const session: GatewaySession = { key: "agent:alpha:main:topic:abc", label: null };
      expect(getCleanLabel(session)).toBe("");
    });

    it("returns empty string when label is undefined", () => {
      const session: GatewaySession = { key: "agent:alpha:main:topic:abc" };
      expect(getCleanLabel(session)).toBe("");
    });
  });

  describe("isTopicSession", () => {
    it("returns true for :thread: key", () => {
      expect(isTopicSession("agent:alpha:main:thread:123")).toBe(true);
    });

    it("returns true for :topic: key", () => {
      expect(isTopicSession("agent:alpha:main:topic:abc")).toBe(true);
    });

    it("returns false for main key", () => {
      expect(isTopicSession("agent:alpha:main")).toBe(false);
    });

    it("returns false for cron key", () => {
      expect(isTopicSession("agent:alpha:cron:daily")).toBe(false);
    });

    it("returns false for subagent key", () => {
      expect(isTopicSession("agent:alpha:subagent:sub1")).toBe(false);
    });
  });

  describe("label prefix round-trip", () => {
    it("close then reopen preserves original label", () => {
      const originalLabel = "alpha/작업-0307-1200";
      // Close: add prefix
      const closedLabel = CLOSED_PREFIX + originalLabel;
      expect(closedLabel).toBe("[closed] alpha/작업-0307-1200");

      // Check closed
      const closedSession: GatewaySession = { key: "agent:alpha:main:topic:abc", label: closedLabel };
      expect(isTopicClosed(closedSession)).toBe(true);

      // Reopen: strip prefix
      const reopenedLabel = getCleanLabel(closedSession);
      expect(reopenedLabel).toBe(originalLabel);
    });

    it("handles label with special characters", () => {
      const originalLabel = "alpha/질문: [React] hooks 패턴?";
      const closedLabel = CLOSED_PREFIX + originalLabel;
      const session: GatewaySession = { key: "agent:alpha:main:topic:xyz", label: closedLabel };
      expect(isTopicClosed(session)).toBe(true);
      expect(getCleanLabel(session)).toBe(originalLabel);
    });
  });

  describe("Cmd+D scope check", () => {
    it("topic session (thread) should be closeable", () => {
      const key = "agent:alpha:main:thread:abc";
      const parsed = parseSessionKey(key);
      expect(parsed.type).toBe("thread");
      expect(isTopicSession(key)).toBe(true);
    });

    it("topic session (topic) should be closeable", () => {
      const key = "agent:alpha:main:topic:abc";
      const parsed = parseSessionKey(key);
      expect(parsed.type).toBe("thread"); // parsed as "thread" type
      expect(isTopicSession(key)).toBe(true);
    });

    it("main session should NOT be closeable", () => {
      const key = "agent:alpha:main";
      const parsed = parseSessionKey(key);
      expect(parsed.type).toBe("main");
      expect(isTopicSession(key)).toBe(false);
    });
  });
});
