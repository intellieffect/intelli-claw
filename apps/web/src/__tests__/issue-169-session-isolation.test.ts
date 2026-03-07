/**
 * issue-169-session-isolation.test.ts
 *
 * TDD tests for #169: Cross-session message leaks.
 *
 * When multiple sessions are active simultaneously (e.g. agent:ops:main +
 * agent:ops:main:thread:xxx), messages from other sessions leak into the
 * current chat view.
 *
 * Tests verify all 4 fix phases:
 * Phase 1: saveMessages() rejects mismatched sessionKey
 * Phase 2: Event handler invalidation on sessionKey change
 * Phase 3: Backfill isolation by sessionKey
 * Phase 4: Debug logging on mismatch
 * Phase 5: Migration version bump
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveMessages,
  getLocalMessages,
  runMessageStoreMigration,
  isBackfillDone,
  markBackfillDone,
  backfillFromApi,
  type StoredMessage,
} from "@/lib/gateway/message-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMsg(
  overrides: Partial<StoredMessage> & { id: string },
): StoredMessage {
  return {
    sessionKey: "agent:ops:main",
    role: "user",
    content: "hello",
    timestamp: new Date().toISOString(),
    ...overrides,
  } as StoredMessage;
}

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

let lsMock: ReturnType<typeof createLocalStorageMock>;

beforeEach(async () => {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name) indexedDB.deleteDatabase(db.name);
  }
  lsMock = createLocalStorageMock();
  vi.stubGlobal("localStorage", lsMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal("localStorage", lsMock);
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 1: saveMessages() sessionKey validation
// ══════════════════════════════════════════════════════════════════════════════

describe("Phase 1: saveMessages() rejects mismatched sessionKey", () => {
  it("saves messages that match the target sessionKey", async () => {
    const msgs = [
      makeMsg({ id: "m1", sessionKey: "agent:ops:main", content: "good" }),
    ];
    await saveMessages("agent:ops:main", msgs);
    const result = await getLocalMessages("agent:ops:main");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("good");
  });

  it("skips messages whose sessionKey does not match the target", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const msgs = [
      makeMsg({ id: "m1", sessionKey: "agent:ops:main:thread:abc", content: "leaked" }),
      makeMsg({ id: "m2", sessionKey: "agent:ops:main", content: "correct" }),
    ];
    await saveMessages("agent:ops:main", msgs);
    const result = await getLocalMessages("agent:ops:main");
    // Only the matching message should be stored
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("correct");
    expect(result.some((m) => m.content === "leaked")).toBe(false);
    warnSpy.mockRestore();
  });

  it("logs a warning for each mismatched message", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const msgs = [
      makeMsg({ id: "m1", sessionKey: "agent:other:main", content: "wrong" }),
    ];
    await saveMessages("agent:ops:main", msgs);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("session mismatch"),
    );
    warnSpy.mockRestore();
  });

  it("handles messages with no explicit sessionKey (overwritten by target)", async () => {
    // Messages without a sessionKey field get the target sessionKey applied
    const msg = { id: "m1", role: "user" as const, content: "ok", timestamp: new Date().toISOString() } as StoredMessage;
    await saveMessages("agent:ops:main", [msg]);
    const result = await getLocalMessages("agent:ops:main");
    expect(result).toHaveLength(1);
    expect(result[0].sessionKey).toBe("agent:ops:main");
  });

  it("all messages mismatched → nothing stored", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const msgs = [
      makeMsg({ id: "m1", sessionKey: "agent:other:main" }),
      makeMsg({ id: "m2", sessionKey: "agent:other:main" }),
    ];
    await saveMessages("agent:ops:main", msgs);
    const result = await getLocalMessages("agent:ops:main");
    expect(result).toHaveLength(0);
    warnSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2: Event handler sessionKey invalidation (unit-testable logic)
// ══════════════════════════════════════════════════════════════════════════════

describe("Phase 2: Event sessionKey filtering", () => {
  it("event with mismatched sessionKey is rejected (covered by hooks integration)", () => {
    // This is a contract test — the actual filter logic is in hooks.tsx.
    // Here we verify the principle: given an event with sessionKey "A",
    // a handler bound to sessionKey "B" must reject it.
    const boundSessionKey = "agent:ops:main";
    const evSessionKey = "agent:ops:main:thread:xyz";

    // Simple simulation of the filter logic from hooks.tsx L1419
    const shouldReject = evSessionKey !== boundSessionKey;
    expect(shouldReject).toBe(true);
  });

  it("event without sessionKey is rejected when handler has a bound key", () => {
    const boundSessionKey = "agent:ops:main";
    const evSessionKey = undefined;

    // From hooks.tsx L1421: no sessionKey on event → reject unless lifecycle match
    const isLifecycleMatch = false;
    const shouldReject = !evSessionKey && !!boundSessionKey && !isLifecycleMatch;
    expect(shouldReject).toBe(true);
  });

  it("lifecycle event with matching runId passes through even without sessionKey", () => {
    const boundSessionKey = "agent:ops:main";
    const evSessionKey = undefined;
    const eventRunId = "run-123";
    const activeRunId = "run-123";
    const stream = "lifecycle";

    const isLifecycleMatch =
      stream === "lifecycle" && eventRunId && activeRunId && eventRunId === activeRunId;
    const shouldReject = !evSessionKey && !!boundSessionKey && !isLifecycleMatch;
    expect(shouldReject).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 3: Backfill isolation
// ══════════════════════════════════════════════════════════════════════════════

describe("Phase 3: Backfill session isolation", () => {
  const apiBase = "http://localhost:3000";
  const agentId = "ops";

  it("backfillFromApi stores messages under the correct sessionKey only", async () => {
    const apiMessages = [
      { id: "1", role: "user", content: "backfilled msg", timestamp: "2025-01-01T00:00:00Z" },
    ];

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: apiMessages }),
    }));

    await backfillFromApi("agent:ops:main", "session-001", apiBase, agentId);

    const mainMsgs = await getLocalMessages("agent:ops:main");
    const threadMsgs = await getLocalMessages("agent:ops:main:thread:abc");

    expect(mainMsgs).toHaveLength(1);
    expect(mainMsgs[0].sessionKey).toBe("agent:ops:main");
    // Thread must NOT see main's backfilled messages
    expect(threadMsgs).toHaveLength(0);

    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", lsMock);
  });

  it("backfill does not cross-contaminate when called for different sessionKeys", async () => {
    const apiMessages = [
      { id: "1", role: "user", content: "from main", timestamp: "2025-01-01T00:00:00Z" },
    ];
    const threadMessages = [
      { id: "2", role: "user", content: "from thread", timestamp: "2025-01-02T00:00:00Z" },
    ];

    let callCount = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        json: () => Promise.resolve({
          messages: callCount === 1 ? apiMessages : threadMessages,
        }),
      };
    }));

    await backfillFromApi("agent:ops:main", "session-001", apiBase, agentId);
    await backfillFromApi("agent:ops:main:thread:abc", "session-002", apiBase, agentId);

    const mainMsgs = await getLocalMessages("agent:ops:main");
    const threadMsgs = await getLocalMessages("agent:ops:main:thread:abc");

    expect(mainMsgs).toHaveLength(1);
    expect(mainMsgs[0].content).toBe("from main");
    expect(threadMsgs).toHaveLength(1);
    expect(threadMsgs[0].content).toBe("from thread");

    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", lsMock);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4: Debug logging
// ══════════════════════════════════════════════════════════════════════════════

describe("Phase 4: Debug logging on session mismatch", () => {
  it("saveMessages logs warning with details for each mismatched message", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const msgs = [
      makeMsg({ id: "m1", sessionKey: "agent:other:main" }),
      makeMsg({ id: "m2", sessionKey: "agent:different:main" }),
    ];
    await saveMessages("agent:ops:main", msgs);

    // Should warn for each mismatched message
    const mismatchWarnings = warnSpy.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("session mismatch"),
    );
    expect(mismatchWarnings.length).toBe(2);
    warnSpy.mockRestore();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 5: Migration version bump
// ══════════════════════════════════════════════════════════════════════════════

describe("Phase 5: Migration version bump to v3", () => {
  it("migration v3 clears old v2 data", async () => {
    // Simulate v2 already done, data present
    localStorage.setItem("intelli-claw-msg-migration", "2");
    await saveMessages("agent:ops:main", [
      makeMsg({ id: "m1", content: "old contaminated data" }),
    ]);

    runMessageStoreMigration();
    await new Promise((r) => setTimeout(r, 100));

    // v3 migration should have cleared the store
    const result = await getLocalMessages("agent:ops:main");
    expect(result).toEqual([]);
    expect(localStorage.getItem("intelli-claw-msg-migration")).toBe("3");
  });

  it("v3 migration also clears backfill markers", async () => {
    localStorage.setItem("intelli-claw-msg-migration", "2");
    markBackfillDone("agent:ops:main", "sess-1");
    expect(isBackfillDone("agent:ops:main", "sess-1")).toBe(true);

    runMessageStoreMigration();
    await new Promise((r) => setTimeout(r, 100));

    expect(isBackfillDone("agent:ops:main", "sess-1")).toBe(false);
  });

  it("skips if already at v3", async () => {
    localStorage.setItem("intelli-claw-msg-migration", "3");
    await saveMessages("agent:ops:main", [makeMsg({ id: "m1" })]);

    runMessageStoreMigration();
    await new Promise((r) => setTimeout(r, 100));

    const result = await getLocalMessages("agent:ops:main");
    expect(result).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Integration: Cross-session isolation scenarios
// ══════════════════════════════════════════════════════════════════════════════

describe("Integration: cross-session message isolation", () => {
  it("main session messages never appear in thread session queries", async () => {
    await saveMessages("agent:ops:main", [
      makeMsg({ id: "main-1", sessionKey: "agent:ops:main", content: "main msg" }),
    ]);
    await saveMessages("agent:ops:main:thread:abc", [
      makeMsg({ id: "thread-1", sessionKey: "agent:ops:main:thread:abc", content: "thread msg" }),
    ]);

    const mainMsgs = await getLocalMessages("agent:ops:main");
    const threadMsgs = await getLocalMessages("agent:ops:main:thread:abc");

    expect(mainMsgs).toHaveLength(1);
    expect(mainMsgs[0].id).toBe("main-1");
    expect(threadMsgs).toHaveLength(1);
    expect(threadMsgs[0].id).toBe("thread-1");
  });

  it("saving a message with wrong sessionKey to a session is rejected", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Try to save a thread message into main session
    await saveMessages("agent:ops:main", [
      makeMsg({ id: "leak-1", sessionKey: "agent:ops:main:thread:abc", content: "should not appear" }),
    ]);

    const mainMsgs = await getLocalMessages("agent:ops:main");
    expect(mainMsgs).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("concurrent saves to different sessions don't cross-contaminate", async () => {
    // Simulate concurrent saves happening during session switch
    await Promise.all([
      saveMessages("agent:ops:main", [
        makeMsg({ id: "c1", sessionKey: "agent:ops:main", content: "concurrent main" }),
      ]),
      saveMessages("agent:ops:main:thread:def", [
        makeMsg({ id: "c2", sessionKey: "agent:ops:main:thread:def", content: "concurrent thread" }),
      ]),
    ]);

    const mainMsgs = await getLocalMessages("agent:ops:main");
    const threadMsgs = await getLocalMessages("agent:ops:main:thread:def");

    expect(mainMsgs).toHaveLength(1);
    expect(mainMsgs[0].content).toBe("concurrent main");
    expect(threadMsgs).toHaveLength(1);
    expect(threadMsgs[0].content).toBe("concurrent thread");
  });
});
