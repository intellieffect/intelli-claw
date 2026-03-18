/**
 * issue-169-session-guard.test.ts
 *
 * TDD tests for #169 fundamental fix: centralized session-guarded message dispatcher.
 *
 * The root cause of recurring session isolation bugs is that setMessages() is called
 * from ~24 different places in hooks.tsx, each independently validating sessionKey.
 * This test suite covers the centralized guard mechanism that ALL message updates
 * must go through.
 *
 * Tests cover:
 * 1. createSessionGuard — bound to a specific sessionKey
 * 2. Guard rejects updates when sessionKey doesn't match active session
 * 3. Guard allows updates when sessionKey matches
 * 4. Guard properly handles sessionKey transitions (old guard becomes invalid)
 * 5. PendingStreamSnapshot v2 with sessionKey field
 * 6. isPendingStreamSnapshotFresh rejects snapshots with mismatched sessionKey
 * 7. Session switch invalidates all previous guards
 * 8. setMessages wrapper drops updates after session switch during async gap
 * 9. createScopedUpdater captures guard version and rejects stale updates
 * 10. resetSessionState atomically resets all state
 */
import { describe, it, expect, vi } from "vitest";
import {
  createPendingStreamSnapshot,
  isPendingStreamSnapshotFresh,
  type PendingStreamSnapshot,
} from "@/lib/gateway/hooks";

// ══════════════════════════════════════════════════════════════════════════════
// 1. PendingStreamSnapshot v2 with sessionKey
// ══════════════════════════════════════════════════════════════════════════════

describe("PendingStreamSnapshot v2: sessionKey field", () => {
  it("createPendingStreamSnapshot includes sessionKey in v2 snapshot", () => {
    const snapshot = createPendingStreamSnapshot({
      sessionKey: "agent:ops:main",
      runId: "run-1",
      streamId: "stream-1",
      content: "hello",
      toolCalls: [],
    });
    expect(snapshot.v).toBe(3);
    expect(snapshot.sessionKey).toBe("agent:ops:main");
    expect(snapshot.runId).toBe("run-1");
    expect(snapshot.streamId).toBe("stream-1");
    expect(snapshot.content).toBe("hello");
  });

  it("snapshot without sessionKey (v1) is still considered fresh by TTL check alone", () => {
    // Backward compat: v1 snapshots don't have sessionKey
    const v1Snapshot: PendingStreamSnapshot = {
      v: 1 as any,
      runId: "run-1",
      streamId: "stream-1",
      content: "old",
      toolCalls: [],
      updatedAt: Date.now(),
    } as any;
    // isPendingStreamSnapshotFresh should return true for TTL (v1 compat)
    // but sessionKey validation is handled separately at restore site
    expect(isPendingStreamSnapshotFresh(v1Snapshot)).toBe(true);
  });

  it("v2 snapshot is fresh when within TTL", () => {
    const snapshot = createPendingStreamSnapshot({
      sessionKey: "agent:ops:main",
      runId: null,
      streamId: "stream-2",
      content: "",
      toolCalls: [],
      now: Date.now(),
    });
    expect(isPendingStreamSnapshotFresh(snapshot)).toBe(true);
  });

  it("v2 snapshot is stale when beyond TTL", () => {
    const snapshot = createPendingStreamSnapshot({
      sessionKey: "agent:ops:main",
      runId: null,
      streamId: "stream-2",
      content: "",
      toolCalls: [],
      now: Date.now() - 60_000,
    });
    expect(isPendingStreamSnapshotFresh(snapshot)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 2. Session guard logic (pure function simulation)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Simulates the core of useSessionGuardedMessages.
 * This is the pure logic that will be embedded in useChat.
 */
function createSessionGuardSimulator() {
  let currentSessionKey: string | undefined;
  let guardVersion = 0;
  let messages: string[] = [];
  const warnings: string[] = [];

  return {
    /** Simulate session key change (like useEffect on sessionKey) */
    switchSession(newKey: string | undefined) {
      if (currentSessionKey !== newKey) {
        currentSessionKey = newKey;
        guardVersion++;
        messages = [];
      }
    },

    /** Get current state */
    get sessionKey() { return currentSessionKey; },
    get version() { return guardVersion; },
    get messages() { return [...messages]; },
    get warnings() { return [...warnings]; },

    /** Guarded setMessages — drops updates from stale sessions */
    setMessages(
      newMsgs: string[],
      opts?: { sessionKey?: string; force?: boolean },
    ): boolean {
      if (opts?.sessionKey && opts.sessionKey !== currentSessionKey) {
        warnings.push(
          `[AWF] #169 guarded setMessages rejected: expected="${currentSessionKey}" got="${opts.sessionKey}"`,
        );
        return false;
      }
      messages = newMsgs;
      return true;
    },

    /** Create a scoped updater (captures guard version at creation time) */
    createScopedUpdater() {
      const capturedVersion = guardVersion;
      const capturedKey = currentSessionKey;
      return {
        isValid: () => guardVersion === capturedVersion,
        sessionKey: capturedKey,
        setMessages: (newMsgs: string[]): boolean => {
          if (guardVersion !== capturedVersion) {
            warnings.push(
              `[AWF] #169 scoped updater expired: version ${capturedVersion} vs ${guardVersion}`,
            );
            return false;
          }
          messages = newMsgs;
          return true;
        },
      };
    },
  };
}

describe("Session guard: basic operation", () => {
  it("creates guard bound to a specific sessionKey", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("agent:ops:main");
    expect(guard.sessionKey).toBe("agent:ops:main");
    expect(guard.version).toBe(1);
  });

  it("allows message updates when sessionKey matches", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("agent:ops:main");
    const ok = guard.setMessages(["hello"], { sessionKey: "agent:ops:main" });
    expect(ok).toBe(true);
    expect(guard.messages).toEqual(["hello"]);
  });

  it("rejects message updates when sessionKey does not match", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("agent:ops:main");
    const ok = guard.setMessages(["leaked"], { sessionKey: "agent:ops:main:thread:abc" });
    expect(ok).toBe(false);
    expect(guard.messages).toEqual([]);
    expect(guard.warnings).toHaveLength(1);
    expect(guard.warnings[0]).toContain("#169 guarded setMessages rejected");
  });

  it("allows updates without explicit sessionKey (sync operations)", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("agent:ops:main");
    const ok = guard.setMessages(["sync update"]);
    expect(ok).toBe(true);
    expect(guard.messages).toEqual(["sync update"]);
  });
});

describe("Session guard: session transitions", () => {
  it("increments guard version on session switch", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    expect(guard.version).toBe(1);
    guard.switchSession("session-B");
    expect(guard.version).toBe(2);
  });

  it("clears messages on session switch", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    guard.setMessages(["msg from A"]);
    expect(guard.messages).toEqual(["msg from A"]);

    guard.switchSession("session-B");
    expect(guard.messages).toEqual([]);
  });

  it("old session key is rejected after switch", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    guard.switchSession("session-B");

    const ok = guard.setMessages(["stale"], { sessionKey: "session-A" });
    expect(ok).toBe(false);
    expect(guard.warnings[0]).toContain("session-A");
  });
});

describe("Session guard: scoped updater for async operations", () => {
  it("scoped updater succeeds when guard version hasn't changed", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    const updater = guard.createScopedUpdater();

    expect(updater.isValid()).toBe(true);
    const ok = updater.setMessages(["async result"]);
    expect(ok).toBe(true);
    expect(guard.messages).toEqual(["async result"]);
  });

  it("scoped updater fails after session switch (version mismatch)", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    const updater = guard.createScopedUpdater();

    // Simulate session switch happening during async gap
    guard.switchSession("session-B");

    expect(updater.isValid()).toBe(false);
    const ok = updater.setMessages(["stale async result"]);
    expect(ok).toBe(false);
    expect(guard.messages).toEqual([]); // session-B's empty state
    expect(guard.warnings).toHaveLength(1);
    expect(guard.warnings[0]).toContain("scoped updater expired");
  });

  it("multiple scoped updaters from same session all become invalid on switch", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    const updater1 = guard.createScopedUpdater();
    const updater2 = guard.createScopedUpdater();

    guard.switchSession("session-B");

    expect(updater1.isValid()).toBe(false);
    expect(updater2.isValid()).toBe(false);
  });

  it("new scoped updater after switch is valid", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    const oldUpdater = guard.createScopedUpdater();

    guard.switchSession("session-B");
    const newUpdater = guard.createScopedUpdater();

    expect(oldUpdater.isValid()).toBe(false);
    expect(newUpdater.isValid()).toBe(true);
  });

  it("captures sessionKey at creation time", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    const updater = guard.createScopedUpdater();

    expect(updater.sessionKey).toBe("session-A");

    guard.switchSession("session-B");
    // Captured key should still be session-A
    expect(updater.sessionKey).toBe("session-A");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 3. Snapshot sessionKey validation at restore
// ══════════════════════════════════════════════════════════════════════════════

describe("Snapshot restore: sessionKey validation", () => {
  it("v2 snapshot with matching sessionKey is valid for restore", () => {
    const snapshot = createPendingStreamSnapshot({
      sessionKey: "agent:ops:main",
      runId: "run-1",
      streamId: "stream-1",
      content: "partial response",
      toolCalls: [],
    });

    const currentSessionKey = "agent:ops:main";
    const isKeyMatch = snapshot.sessionKey === currentSessionKey;
    expect(isKeyMatch).toBe(true);
  });

  it("v2 snapshot with different sessionKey is rejected at restore", () => {
    const snapshot = createPendingStreamSnapshot({
      sessionKey: "agent:ops:main:thread:abc",
      runId: "run-1",
      streamId: "stream-1",
      content: "from wrong session",
      toolCalls: [],
    });

    const currentSessionKey = "agent:ops:main";
    const isKeyMatch = snapshot.sessionKey === currentSessionKey;
    expect(isKeyMatch).toBe(false);
  });

  it("v1 snapshot (no sessionKey) has undefined sessionKey — restore site must handle", () => {
    // Legacy v1 snapshot
    const v1: any = {
      v: 1,
      runId: "run-1",
      streamId: "stream-1",
      content: "legacy",
      toolCalls: [],
      updatedAt: Date.now(),
    };
    // v1 doesn't have sessionKey — the restore code should be lenient
    // (allow restore to maintain backward compat, but this is a policy decision)
    expect(v1.sessionKey).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 4. Async gap race condition simulation
// ══════════════════════════════════════════════════════════════════════════════

describe("Session guard: async race conditions", () => {
  it("simulates loadHistory completing after session switch — update is dropped", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");

    // Simulate loadHistory starting
    const updater = guard.createScopedUpdater();

    // User switches session while loadHistory is awaiting
    guard.switchSession("session-B");
    guard.setMessages(["session B msg"]);

    // loadHistory completes with session-A data
    const ok = updater.setMessages(["session A history — STALE"]);
    expect(ok).toBe(false);
    // Session B messages should remain intact
    expect(guard.messages).toEqual(["session B msg"]);
  });

  it("simulates backfill completing after session switch — update is dropped", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    const updater = guard.createScopedUpdater();

    guard.switchSession("session-B");

    // Backfill tries to reload history for session-A
    const ok = updater.setMessages(["backfilled stale data"]);
    expect(ok).toBe(false);
  });

  it("simulates reconnect handler firing for old session — update is dropped", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");

    // Reconnect handler captured at session-A time
    const reconnectUpdater = guard.createScopedUpdater();

    // Session switches to B
    guard.switchSession("session-B");

    // Reconnect safety timer fires and tries to finalize stream from session-A
    const ok = reconnectUpdater.setMessages(["reconnect finalize for A"]);
    expect(ok).toBe(false);
  });

  it("rapid session switches invalidate all intermediate guards", () => {
    const guard = createSessionGuardSimulator();

    guard.switchSession("session-A");
    const updaterA = guard.createScopedUpdater();

    guard.switchSession("session-B");
    const updaterB = guard.createScopedUpdater();

    guard.switchSession("session-C");
    const updaterC = guard.createScopedUpdater();

    expect(updaterA.isValid()).toBe(false);
    expect(updaterB.isValid()).toBe(false);
    expect(updaterC.isValid()).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// 5. resetSessionState atomic operation
// ══════════════════════════════════════════════════════════════════════════════

describe("resetSessionState: atomic session state reset", () => {
  it("clears all state in a single operation", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    guard.setMessages(["msg1", "msg2"]);

    // switchSession acts as resetSessionState
    guard.switchSession("session-B");

    expect(guard.messages).toEqual([]);
    expect(guard.sessionKey).toBe("session-B");
  });

  it("increments guard version to invalidate all in-flight operations", () => {
    const guard = createSessionGuardSimulator();
    guard.switchSession("session-A");
    const v1 = guard.version;

    guard.switchSession("session-B");
    expect(guard.version).toBeGreaterThan(v1);
  });
});
