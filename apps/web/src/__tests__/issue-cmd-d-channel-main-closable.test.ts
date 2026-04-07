/**
 * Cmd+D close-topic — channel-routed main sessions
 *
 * Symptom (2026-04-07): Cmd+D appeared to silently fail on Telegram /
 * Slack / etc. session tabs even though they were visible in the chat
 * header tab bar. The previous gate used `isTopicSession()`, which only
 * matches sessionKeys containing `:thread:` or `:topic:` substrings.
 *
 * Channel-routed sessions like `agent:main:telegram:direct:{userId}` have
 * neither marker — `parseSessionKey` reports `type: "main", channel: "telegram"`.
 * The chat-header tab bar filter accepted them (`type === "main"`) so the
 * user *saw* them as tabs, but the close-topic shortcut dropped them.
 *
 * Fix: replace the gate with `isClosableSession()` (type-aware) which
 * accepts:
 *   1. `thread` sessions
 *   2. `main` sessions that have a `channel` field (channel-routed)
 *
 * Plain `agent:{id}:main` (no channel) stays non-closable so the canonical
 * per-agent main session can't be accidentally closed.
 */
import { describe, it, expect } from "vitest";
import {
  isClosableSession,
  isTopicSession,
  parseSessionKey,
} from "@intelli-claw/shared";

describe("isClosableSession (Cmd+D gate)", () => {
  describe("closable sessions", () => {
    it("thread sessions (legacy `:thread:` form)", () => {
      const key = "agent:iclaw:main:thread:abc123";
      expect(parseSessionKey(key).type).toBe("thread");
      expect(isClosableSession(key)).toBe(true);
    });

    it("topic sessions (preferred `:topic:` form)", () => {
      const key = "agent:iclaw:main:topic:xyz789";
      expect(parseSessionKey(key).type).toBe("thread"); // mapped to "thread"
      expect(isClosableSession(key)).toBe(true);
    });

    it("Telegram channel main session", () => {
      const key = "agent:main:telegram:direct:8224611555";
      const parsed = parseSessionKey(key);
      expect(parsed.type).toBe("main");
      expect(parsed.channel).toBe("telegram");
      expect(isClosableSession(key)).toBe(true);
    });

    it("Slack channel main session", () => {
      const key = "agent:main:slack:channel:c0apg78a5v4";
      const parsed = parseSessionKey(key);
      expect(parsed.type).toBe("main");
      expect(parsed.channel).toBe("slack");
      expect(isClosableSession(key)).toBe(true);
    });

    it("channel thread (channel-routed with explicit topic suffix)", () => {
      const key = "agent:main:telegram:mybot:direct:123:thread:topic1";
      const parsed = parseSessionKey(key);
      expect(parsed.type).toBe("thread");
      expect(parsed.channel).toBe("telegram");
      expect(isClosableSession(key)).toBe(true);
    });
  });

  describe("non-closable sessions", () => {
    it("plain main session (no channel) — canonical agent main", () => {
      const key = "agent:iclaw:main";
      const parsed = parseSessionKey(key);
      expect(parsed.type).toBe("main");
      expect(parsed.channel).toBeUndefined();
      expect(isClosableSession(key)).toBe(false);
    });

    it("cron sessions", () => {
      const key = "agent:iclaw:cron:nightly-sweep";
      expect(parseSessionKey(key).type).toBe("cron");
      expect(isClosableSession(key)).toBe(false);
    });

    it("subagent sessions", () => {
      const key = "agent:iclaw:subagent:abcdef";
      expect(parseSessionKey(key).type).toBe("subagent");
      expect(isClosableSession(key)).toBe(false);
    });

    it("a2a sessions", () => {
      const key = "agent:iclaw:agent:bigno:main";
      expect(parseSessionKey(key).type).toBe("a2a");
      expect(isClosableSession(key)).toBe(false);
    });

    it("malformed keys", () => {
      expect(isClosableSession("")).toBe(false);
      expect(isClosableSession("not-an-agent-key")).toBe(false);
      expect(isClosableSession("agent")).toBe(false);
    });
  });

  describe("regression: isTopicSession is too narrow", () => {
    it("isTopicSession misses channel-routed main sessions (this was the bug)", () => {
      const key = "agent:main:telegram:direct:8224611555";
      // Old gate: substring match — fails
      expect(isTopicSession(key)).toBe(false);
      // New gate: type-aware — passes
      expect(isClosableSession(key)).toBe(true);
    });
  });
});

// ─── Source-text guard so the new gate doesn't get reverted ──────────────
import fs from "fs";
import path from "path";

describe("chat-panel close-topic gate uses isClosableSession", () => {
  const CHAT_PANEL = fs.readFileSync(
    path.resolve(__dirname, "../components/chat/chat-panel.tsx"),
    "utf-8",
  );

  it("imports isClosableSession", () => {
    expect(CHAT_PANEL).toContain("isClosableSession");
  });

  it("close-topic shortcut handler uses isClosableSession (not isTopicSession)", () => {
    // Find the close-topic block — generous span so we capture the gate.
    const closeTopicBlock = CHAT_PANEL.match(
      /matchesShortcutId\(e,\s*["']close-topic["']\)[\s\S]{0,1500}/,
    );
    expect(closeTopicBlock).not.toBeNull();
    expect(closeTopicBlock![0]).toContain("isClosableSession(effectiveSessionKey)");
    expect(closeTopicBlock![0]).not.toContain("isTopicSession(effectiveSessionKey)");
  });
});
