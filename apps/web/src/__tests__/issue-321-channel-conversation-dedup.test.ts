/**
 * Channel conversation dedup (#321)
 *
 * Symptom (2026-04-07): Cmd+D appeared "broken" on Telegram tabs.
 *   The store had 73 sessions for one Telegram conversation:
 *     - 1 channel main:   `agent:main:telegram:direct:8224611555`
 *     - 72 channel threads: `agent:main:telegram:direct:8224611555:thread:8224611555:{msgId}`
 *   Each thread session showed up as its own tab in chat-header. The user
 *   pressed Cmd+D, the patch succeeded, ONE tab vanished — but 71 sibling
 *   tabs remained for the same conversation, so it looked like nothing
 *   happened. Inspecting the store proved 9 sessions were correctly
 *   `[closed] ...` after multiple Cmd+D presses, but the visible tab
 *   count never dropped meaningfully.
 *
 * Root cause: Telegram channel adapter creates one thread per inbound
 *   message instead of grouping by chat. This is OpenClaw's session-key
 *   convention and unlikely to change. The intelli-claw fix is at the
 *   client: dedupe sibling threads to ONE tab per conversation, and have
 *   Cmd+D batch-close all siblings so the visible tab actually disappears.
 */
import { describe, it, expect } from "vitest";
import {
  conversationBaseKey,
  dedupeChannelConversations,
  parseSessionKey,
} from "@intelli-claw/shared";

describe("conversationBaseKey", () => {
  // Per-message dummy threads (Telegram et al.) — userId repeats after `:thread:`
  it("strips :thread:{userId}:{msgId} when userId matches parent (Telegram dummy)", () => {
    expect(
      conversationBaseKey(
        "agent:main:telegram:direct:8224611555:thread:8224611555:23787",
      ),
    ).toBe("agent:main:telegram:direct:8224611555");
  });

  it("strips :thread:{userId} (single seg) when userId matches parent (Signal-style dummy)", () => {
    // If a channel adapter encodes per-message threads as :thread:{sameId}
    // (one segment, equal to parent), still treat as dummy.
    expect(
      conversationBaseKey("agent:main:signal:direct:abc123:thread:abc123"),
    ).toBe("agent:main:signal:direct:abc123");
  });

  // Real conversation threads (Slack et al.) — thread_ts ≠ parent
  it("does NOT strip Slack thread (thread_ts ≠ parent channelId)", () => {
    // Slack threads are real conversations and must remain separate tabs.
    expect(
      conversationBaseKey(
        "agent:main:slack:channel:c0apg78a5v4:thread:1774935958.629449",
      ),
    ).toBe(
      "agent:main:slack:channel:c0apg78a5v4:thread:1774935958.629449",
    );
  });

  it("does NOT strip Discord thread", () => {
    expect(
      conversationBaseKey(
        "agent:main:discord:channel:998877:thread:t-456789",
      ),
    ).toBe("agent:main:discord:channel:998877:thread:t-456789");
  });

  it("returns a channel main key unchanged (already the conversation root)", () => {
    expect(conversationBaseKey("agent:main:telegram:direct:8224611555")).toBe(
      "agent:main:telegram:direct:8224611555",
    );
  });

  it("returns a plain main key unchanged (no channel)", () => {
    expect(conversationBaseKey("agent:main:main")).toBe("agent:main:main");
  });

  it("returns a user :topic: session unchanged (NOT channel-routed)", () => {
    expect(
      conversationBaseKey("agent:main:main:topic:user-created-topic-id"),
    ).toBe("agent:main:main:topic:user-created-topic-id");
  });

  it("returns a cron session unchanged", () => {
    expect(conversationBaseKey("agent:main:cron:nightly-build")).toBe(
      "agent:main:cron:nightly-build",
    );
  });
});

describe("dedupeChannelConversations", () => {
  // Mixed scenario: Telegram per-message dummies (collapse) + Slack real threads (keep).
  const sessions = [
    { key: "agent:main:main", updatedAt: 1000 }, // plain main — passthrough
    { key: "agent:main:cron:daily", updatedAt: 900 }, // cron — passthrough
    // Telegram conversation: channel main + 3 per-message dummy threads
    { key: "agent:main:telegram:direct:8224611555", updatedAt: 5000 },
    { key: "agent:main:telegram:direct:8224611555:thread:8224611555:23787", updatedAt: 8000 },
    { key: "agent:main:telegram:direct:8224611555:thread:8224611555:23646", updatedAt: 7000 },
    { key: "agent:main:telegram:direct:8224611555:thread:8224611555:19478", updatedAt: 6000 },
    // Slack channel: channel main + 2 REAL threads (different thread_ts each)
    { key: "agent:main:slack:channel:c0apg78a5v4", updatedAt: 4500 },
    { key: "agent:main:slack:channel:c0apg78a5v4:thread:1774935958.629449", updatedAt: 7800 },
    { key: "agent:main:slack:channel:c0apg78a5v4:thread:1774936306.291239", updatedAt: 7600 },
  ];

  it("collapses Telegram per-message dummies + channel main into 1 conversation tab", () => {
    // When sorted updatedAt-desc, the newest entry wins. The four sessions
    // (channel main + 3 dummy threads) all share the same base — only one
    // survives.
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    const result = dedupeChannelConversations(sorted);
    const tgKeys = result.filter((s) => s.key.includes("telegram")).map((s) => s.key);
    expect(tgKeys).toHaveLength(1);
    // Channel main has updatedAt 5000, newest dummy has 8000 → dummy wins.
    expect(tgKeys[0]).toBe(
      "agent:main:telegram:direct:8224611555:thread:8224611555:23787",
    );
  });

  it("KEEPS all Slack real threads as separate tabs (regression for over-aggressive dedup)", () => {
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    const result = dedupeChannelConversations(sorted);
    const slackKeys = result.filter((s) => s.key.includes("slack")).map((s) => s.key);
    // Channel main + 2 real threads = 3 separate tabs.
    expect(slackKeys).toHaveLength(3);
    expect(slackKeys).toContain("agent:main:slack:channel:c0apg78a5v4");
    expect(slackKeys).toContain(
      "agent:main:slack:channel:c0apg78a5v4:thread:1774935958.629449",
    );
    expect(slackKeys).toContain(
      "agent:main:slack:channel:c0apg78a5v4:thread:1774936306.291239",
    );
  });

  it("when Telegram channel main is encountered first, it wins as the base", () => {
    // Pre-sort with channel main ahead of dummies — main entry wins.
    const result = dedupeChannelConversations(sessions);
    const tgKey = result.find((s) => s.key.includes("telegram"))?.key;
    expect(tgKey).toBe("agent:main:telegram:direct:8224611555");
  });

  it("when sorted updatedAt-desc and Telegram main is missing, newest dummy wins", () => {
    const noMain = sessions.filter(
      (s) => s.key !== "agent:main:telegram:direct:8224611555",
    );
    const sorted = [...noMain].sort((a, b) => b.updatedAt - a.updatedAt);
    const result = dedupeChannelConversations(sorted);
    const tgKey = result.find((s) => s.key.includes("telegram"))?.key;
    expect(tgKey).toBe(
      "agent:main:telegram:direct:8224611555:thread:8224611555:23787",
    );
  });

  it("passes plain main and cron sessions through unchanged", () => {
    const result = dedupeChannelConversations(sessions);
    const keys = result.map((s) => s.key);
    expect(keys).toContain("agent:main:main");
    expect(keys).toContain("agent:main:cron:daily");
  });

  it("reduces a 73-session telegram conversation to a single tab", () => {
    const fakeStore = [
      { key: "agent:main:telegram:direct:8224611555", updatedAt: 1000 },
      ...Array.from({ length: 72 }, (_, i) => ({
        key: `agent:main:telegram:direct:8224611555:thread:8224611555:${20000 + i}`,
        updatedAt: 2000 + i,
      })),
    ];
    const sortedDesc = fakeStore.sort((a, b) => b.updatedAt - a.updatedAt);
    const result = dedupeChannelConversations(sortedDesc);
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe(
      "agent:main:telegram:direct:8224611555:thread:8224611555:20071",
    );
  });

  it("does not dedupe user-created :topic: sessions", () => {
    const items = [
      { key: "agent:main:main:topic:t-abc", updatedAt: 100 },
      { key: "agent:main:main:topic:t-def", updatedAt: 90 },
    ];
    const result = dedupeChannelConversations(items);
    expect(result).toHaveLength(2);
  });
});

describe("parseSessionKey sanity (channel-routed thread)", () => {
  // Pin the parser behavior the dedup helpers depend on. If parseSessionKey
  // ever changes how it labels channel-routed threads, the dedup helpers
  // need to be re-validated.
  it("recognizes Telegram channel thread as type=thread + channel=telegram", () => {
    const p = parseSessionKey(
      "agent:main:telegram:direct:8224611555:thread:8224611555:23787",
    );
    expect(p.type).toBe("thread");
    expect(p.channel).toBe("telegram");
  });

  it("recognizes Telegram channel main as type=main + channel=telegram", () => {
    const p = parseSessionKey("agent:main:telegram:direct:8224611555");
    expect(p.type).toBe("main");
    expect(p.channel).toBe("telegram");
  });
});
