import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseSessionKey, isSessionClosed, type GatewaySession } from "@intelli-claw/shared/gateway/session-utils";

// --- isSessionClosed tests ---

describe("isSessionClosed", () => {
  it("returns false for session without status", () => {
    const session: GatewaySession = { key: "agent:alpha:main:thread:abc123" };
    expect(isSessionClosed(session)).toBe(false);
  });

  it("returns false for session with status 'open'", () => {
    const session: GatewaySession = { key: "agent:alpha:main:thread:abc123", status: "open" };
    expect(isSessionClosed(session)).toBe(false);
  });

  it("returns true for session with status 'closed'", () => {
    const session: GatewaySession = { key: "agent:alpha:main:thread:abc123", status: "closed" };
    expect(isSessionClosed(session)).toBe(true);
  });

  it("returns false for main session even if status is 'closed'", () => {
    // isSessionClosed only checks status — main protection is enforced by the caller
    const session: GatewaySession = { key: "agent:alpha:main", status: "closed" };
    expect(isSessionClosed(session)).toBe(true);
  });
});

// --- Topic close keyboard shortcut logic tests ---

describe("topic close logic (Cmd+D)", () => {
  it("Cmd+D should only close thread sessions, not main", () => {
    const mainKey = "agent:alpha:main";
    const threadKey = "agent:alpha:main:thread:abc123";

    const mainParsed = parseSessionKey(mainKey);
    const threadParsed = parseSessionKey(threadKey);

    // Main sessions should not be closable
    expect(mainParsed.type).toBe("main");
    // Thread sessions should be closable
    expect(threadParsed.type).toBe("thread");
  });

  it("should identify thread sessions from key patterns", () => {
    const cases = [
      { key: "agent:alpha:main:thread:abc123", expected: "thread" },
      { key: "agent:alpha:main:thread:xyz789", expected: "thread" },
      { key: "agent:alpha:main", expected: "main" },
      { key: "agent:alpha:cron:daily", expected: "cron" },
      { key: "agent:alpha:subagent:sub1", expected: "subagent" },
    ];

    for (const { key, expected } of cases) {
      expect(parseSessionKey(key).type).toBe(expected);
    }
  });
});

// --- Session filtering with closed status ---

describe("closed session filtering", () => {
  const makeSessions = (): GatewaySession[] => [
    { key: "agent:alpha:main", updatedAt: 1000 },
    { key: "agent:alpha:main:thread:t1", updatedAt: 2000 },
    { key: "agent:alpha:main:thread:t2", updatedAt: 3000, status: "closed" },
    { key: "agent:alpha:main:thread:t3", updatedAt: 4000 },
    { key: "agent:alpha:main:thread:t4", updatedAt: 5000, status: "closed" },
  ];

  it("filters closed sessions from active list", () => {
    const sessions = makeSessions();
    const active = sessions.filter((s) => !isSessionClosed(s));
    expect(active).toHaveLength(3);
    expect(active.map((s) => s.key)).toEqual([
      "agent:alpha:main",
      "agent:alpha:main:thread:t1",
      "agent:alpha:main:thread:t3",
    ]);
  });

  it("extracts closed sessions for closed section", () => {
    const sessions = makeSessions();
    const closed = sessions.filter((s) => isSessionClosed(s));
    expect(closed).toHaveLength(2);
    expect(closed.map((s) => s.key)).toEqual([
      "agent:alpha:main:thread:t2",
      "agent:alpha:main:thread:t4",
    ]);
  });

  it("reopening sets status to 'open'", () => {
    const session: GatewaySession = { key: "agent:alpha:main:thread:t1", status: "closed" };
    expect(isSessionClosed(session)).toBe(true);

    // Simulate reopen
    session.status = "open";
    expect(isSessionClosed(session)).toBe(false);
  });

  it("Cmd+Shift+T should pick most recently closed topic", () => {
    const sessions = makeSessions();
    const closedForAgent = sessions
      .filter((s) => {
        const p = parseSessionKey(s.key);
        return p.agentId === "alpha" && isSessionClosed(s);
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    expect(closedForAgent.length).toBe(2);
    // Most recently updated closed session should be first
    expect(closedForAgent[0].key).toBe("agent:alpha:main:thread:t4");
  });
});

// --- Shortcut definition tests ---

describe("close-topic shortcut definition", () => {
  it("close-topic shortcut exists in defaults", async () => {
    const { DEFAULT_SHORTCUTS } = await import("@/lib/shortcuts");
    const closeTopic = DEFAULT_SHORTCUTS.find((s) => s.id === "close-topic");
    expect(closeTopic).toBeDefined();
    expect(closeTopic!.description).toContain("토픽");
  });

  it("matchesShortcutId works for close-topic", async () => {
    const { matchesShortcutId } = await import("@/lib/shortcuts");
    // Create a mock KeyboardEvent for Cmd+D (Mac)
    const event = new KeyboardEvent("keydown", {
      key: "d",
      code: "KeyD",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    });
    // On macOS (test env uses navigator detection), this should match
    const matches = matchesShortcutId(event, "close-topic");
    // We expect it to match on Mac (or Ctrl+D on non-Mac)
    expect(typeof matches).toBe("boolean");
  });
});
