import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  saveMessages,
  getLocalMessages,
  clearMessages,
  runMessageStoreMigration,
  isBackfillDone,
  markBackfillDone,
  backfillFromApi,
  type StoredMessage,
} from "@/lib/gateway/message-store";

function makeMsg(
  overrides: Partial<StoredMessage> & { id: string },
): StoredMessage {
  return {
    sessionKey: "agent-a",
    role: "user",
    content: "hello",
    timestamp: new Date().toISOString(),
    ...overrides,
  } as StoredMessage;
}

// vitest jsdom provides localStorage as a bare object without Storage methods.
// Stub it with a proper implementation.
function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
  };
}

let lsMock: ReturnType<typeof createLocalStorageMock>;

beforeEach(async () => {
  // Fresh IndexedDB
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name) indexedDB.deleteDatabase(db.name);
  }
  // Fresh localStorage
  lsMock = createLocalStorageMock();
  vi.stubGlobal("localStorage", lsMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  // Re-stub localStorage since restoreAllMocks may unstub it
  vi.stubGlobal("localStorage", lsMock);
});

// ──────────────────────────────────────────────
// 1. saveMessages + getLocalMessages basic
// ──────────────────────────────────────────────
describe("saveMessages + getLocalMessages", () => {
  it("saves and retrieves messages", async () => {
    const msgs = [
      makeMsg({ id: "m1", content: "first" }),
      makeMsg({ id: "m2", content: "second" }),
    ];
    await saveMessages("agent-a", msgs);
    const result = await getLocalMessages("agent-a");
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("first");
    expect(result[1].content).toBe("second");
  });
});

// ──────────────────────────────────────────────
// 2. Session isolation (#5536)
// ──────────────────────────────────────────────
describe("session isolation", () => {
  it("agent A messages do not appear in agent B query", async () => {
    await saveMessages("agent-a", [
      makeMsg({ id: "a1", sessionKey: "agent-a" }),
    ]);
    await saveMessages("agent-b", [
      makeMsg({ id: "b1", sessionKey: "agent-b" }),
    ]);

    const aMessages = await getLocalMessages("agent-a");
    const bMessages = await getLocalMessages("agent-b");

    expect(aMessages).toHaveLength(1);
    expect(aMessages[0].id).toBe("a1");
    expect(bMessages).toHaveLength(1);
    expect(bMessages[0].id).toBe("b1");
  });
});

// ──────────────────────────────────────────────
// 3. Empty sessionKey guard (#121)
// ──────────────────────────────────────────────
describe("empty sessionKey guard", () => {
  it('getLocalMessages("") returns []', async () => {
    await saveMessages("agent-a", [makeMsg({ id: "m1" })]);
    const result = await getLocalMessages("");
    expect(result).toEqual([]);
  });

  it('saveMessages("", msgs) is a no-op', async () => {
    await saveMessages("", [makeMsg({ id: "m1" })]);
    // Nothing should be stored for any key
    const result = await getLocalMessages("agent-a");
    expect(result).toEqual([]);
  });

  it("saveMessages with empty array is a no-op", async () => {
    await saveMessages("agent-a", []);
    const result = await getLocalMessages("agent-a");
    expect(result).toEqual([]);
  });
});

// ──────────────────────────────────────────────
// 4. Dedup / upsert behavior
// ──────────────────────────────────────────────
describe("dedup (upsert)", () => {
  it("upserting same id does not create duplicates", async () => {
    const msg = makeMsg({ id: "m1", content: "v1" });
    await saveMessages("agent-a", [msg]);
    await saveMessages("agent-a", [{ ...msg, content: "v2" }]);

    const result = await getLocalMessages("agent-a");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("v2");
  });
});

// ──────────────────────────────────────────────
// 5. Timestamp sorting
// ──────────────────────────────────────────────
describe("timestamp sorting", () => {
  it("returns messages sorted by timestamp ascending", async () => {
    const msgs = [
      makeMsg({ id: "m3", timestamp: "2025-01-03T00:00:00Z" }),
      makeMsg({ id: "m1", timestamp: "2025-01-01T00:00:00Z" }),
      makeMsg({ id: "m2", timestamp: "2025-01-02T00:00:00Z" }),
    ];
    await saveMessages("agent-a", msgs);
    const result = await getLocalMessages("agent-a");
    expect(result.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });
});

// ──────────────────────────────────────────────
// 6. clearMessages
// ──────────────────────────────────────────────
describe("clearMessages", () => {
  it("clears only the target session, leaves others intact", async () => {
    await saveMessages("agent-a", [
      makeMsg({ id: "a1", sessionKey: "agent-a" }),
    ]);
    await saveMessages("agent-b", [
      makeMsg({ id: "b1", sessionKey: "agent-b" }),
    ]);

    await clearMessages("agent-a");

    expect(await getLocalMessages("agent-a")).toEqual([]);
    expect(await getLocalMessages("agent-b")).toHaveLength(1);
  });
});

// ──────────────────────────────────────────────
// 7. runMessageStoreMigration
// ──────────────────────────────────────────────
describe("runMessageStoreMigration", () => {
  it("clears store on first run and sets migration marker", async () => {
    await saveMessages("agent-a", [makeMsg({ id: "m1" })]);

    runMessageStoreMigration();
    await new Promise((r) => setTimeout(r, 100));

    expect(localStorage.getItem("intelli-claw-msg-migration")).toBe("2");
    const result = await getLocalMessages("agent-a");
    expect(result).toEqual([]);
  });

  it("is a no-op on subsequent runs (marker already set)", async () => {
    localStorage.setItem("intelli-claw-msg-migration", "2");
    await saveMessages("agent-a", [makeMsg({ id: "m1" })]);

    runMessageStoreMigration();
    await new Promise((r) => setTimeout(r, 100));

    const result = await getLocalMessages("agent-a");
    expect(result).toHaveLength(1);
  });

  it("clears backfill markers during migration", async () => {
    markBackfillDone("agent-a", "sess-1");
    expect(isBackfillDone("agent-a", "sess-1")).toBe(true);

    runMessageStoreMigration();
    await new Promise((r) => setTimeout(r, 100));

    expect(isBackfillDone("agent-a", "sess-1")).toBe(false);
  });
});

// ──────────────────────────────────────────────
// 8. Migration version check
// ──────────────────────────────────────────────
describe("migration version", () => {
  it("skips migration if stored version >= MIGRATION_VERSION", async () => {
    localStorage.setItem("intelli-claw-msg-migration", "3");
    await saveMessages("agent-a", [makeMsg({ id: "m1" })]);

    runMessageStoreMigration();
    await new Promise((r) => setTimeout(r, 100));

    const result = await getLocalMessages("agent-a");
    expect(result).toHaveLength(1);
  });

  it("runs migration if stored version < MIGRATION_VERSION", async () => {
    localStorage.setItem("intelli-claw-msg-migration", "1");
    await saveMessages("agent-a", [makeMsg({ id: "m1" })]);

    runMessageStoreMigration();
    await new Promise((r) => setTimeout(r, 100));

    const result = await getLocalMessages("agent-a");
    expect(result).toEqual([]);
    expect(localStorage.getItem("intelli-claw-msg-migration")).toBe("2");
  });
});

// ──────────────────────────────────────────────
// 9. isBackfillDone / markBackfillDone
// ──────────────────────────────────────────────
describe("isBackfillDone / markBackfillDone", () => {
  it("returns false when not marked", () => {
    expect(isBackfillDone("agent-a", "sess-1")).toBe(false);
  });

  it("returns true after marking", () => {
    markBackfillDone("agent-a", "sess-1");
    expect(isBackfillDone("agent-a", "sess-1")).toBe(true);
  });

  it("is scoped to sessionKey + sessionId", () => {
    markBackfillDone("agent-a", "sess-1");
    expect(isBackfillDone("agent-a", "sess-2")).toBe(false);
    expect(isBackfillDone("agent-b", "sess-1")).toBe(false);
  });

  it("handles corrupted localStorage gracefully", () => {
    localStorage.setItem("intelli-claw-backfill-done", "not-json");
    expect(isBackfillDone("agent-a", "sess-1")).toBe(false);
  });
});

// ──────────────────────────────────────────────
// 10. backfillFromApi
// ──────────────────────────────────────────────
describe("backfillFromApi", () => {
  const sessionKey = "agent-a";
  const sessionId = "abcdef1234567890";
  const apiBase = "http://localhost:3000";
  const agentId = "test-agent";

  it("returns [] if backfill already done", async () => {
    markBackfillDone(sessionKey, sessionId);
    const result = await backfillFromApi(
      sessionKey,
      sessionId,
      apiBase,
      agentId,
    );
    expect(result).toEqual([]);
  });

  it("fetches from API, saves messages, and marks done", async () => {
    const apiMessages = [
      {
        id: "1",
        role: "user",
        content: "hi",
        timestamp: "2025-01-01T00:00:00Z",
      },
      {
        id: "2",
        role: "assistant",
        content: "hello",
        timestamp: "2025-01-01T00:01:00Z",
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ messages: apiMessages }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await backfillFromApi(
      sessionKey,
      sessionId,
      apiBase,
      agentId,
    );

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(`log-${sessionId.slice(0, 8)}-1`);
    expect(result[1].id).toBe(`log-${sessionId.slice(0, 8)}-2`);
    expect(result[0].sessionKey).toBe(sessionKey);

    const stored = await getLocalMessages(sessionKey);
    expect(stored).toHaveLength(2);

    expect(isBackfillDone(sessionKey, sessionId)).toBe(true);

    // Verify fetch URL
    expect(fetchMock).toHaveBeenCalledWith(
      `${apiBase}/api/session-history/${encodeURIComponent(agentId)}?sessionId=${encodeURIComponent(sessionId)}`,
    );
  });

  it("returns [] on API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );

    const result = await backfillFromApi(
      sessionKey,
      sessionId,
      apiBase,
      agentId,
    );
    expect(result).toEqual([]);
    expect(isBackfillDone(sessionKey, sessionId)).toBe(false);
  });

  it("returns [] on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );

    const result = await backfillFromApi(
      sessionKey,
      sessionId,
      apiBase,
      agentId,
    );
    expect(result).toEqual([]);
  });

  it("handles empty messages array from API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: [] }),
      }),
    );

    const result = await backfillFromApi(
      sessionKey,
      sessionId,
      apiBase,
      agentId,
    );
    expect(result).toEqual([]);
    expect(isBackfillDone(sessionKey, sessionId)).toBe(true);
  });

  it("preserves attachments from API", async () => {
    const apiMessages = [
      {
        id: "1",
        role: "user",
        content: "photo",
        timestamp: "2025-01-01T00:00:00Z",
        attachments: [{ type: "image", url: "https://example.com/img.png" }],
      },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ messages: apiMessages }),
      }),
    );

    const result = await backfillFromApi(
      sessionKey,
      sessionId,
      apiBase,
      agentId,
    );
    expect(result[0].attachments).toEqual([
      { type: "image", url: "https://example.com/img.png" },
    ]);
  });
});

// ──────────────────────────────────────────────
// 11. Bulk messages (100+)
// ──────────────────────────────────────────────
describe("bulk messages", () => {
  it("handles 200+ messages save and load", async () => {
    const msgs: StoredMessage[] = Array.from({ length: 200 }, (_, i) =>
      makeMsg({
        id: `bulk-${i}`,
        content: `message ${i}`,
        timestamp: new Date(2025, 0, 1, 0, 0, i).toISOString(),
      }),
    );

    await saveMessages("agent-a", msgs);
    const result = await getLocalMessages("agent-a");
    expect(result).toHaveLength(200);
    expect(result[0].id).toBe("bulk-0");
    expect(result[199].id).toBe("bulk-199");
  });
});

// ──────────────────────────────────────────────
// 12. Attachments field
// ──────────────────────────────────────────────
describe("attachments", () => {
  it("saves and loads messages with attachments", async () => {
    const msg = makeMsg({
      id: "att-1",
      attachments: [
        { type: "image", url: "https://example.com/img.png" },
        { type: "file", url: "https://example.com/doc.pdf" },
      ],
    });
    await saveMessages("agent-a", [msg]);
    const result = await getLocalMessages("agent-a");
    expect(result[0].attachments).toHaveLength(2);
    expect(result[0].attachments![0]).toEqual({
      type: "image",
      url: "https://example.com/img.png",
    });
  });
});

// ──────────────────────────────────────────────
// 13. session-boundary role
// ──────────────────────────────────────────────
describe("session-boundary messages", () => {
  it("saves and loads session-boundary role correctly", async () => {
    const msg = makeMsg({
      id: "sb-1",
      role: "session-boundary",
      content: "",
      oldSessionId: "old-sess",
      newSessionId: "new-sess",
    });
    await saveMessages("agent-a", [msg]);
    const result = await getLocalMessages("agent-a");
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("session-boundary");
    expect(result[0].oldSessionId).toBe("old-sess");
    expect(result[0].newSessionId).toBe("new-sess");
  });
});
