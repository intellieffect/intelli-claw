/**
 * session-isolation.test.ts — TDD tests for 3-layer session isolation (#121)
 *
 * Tests the defense-in-depth strategy to prevent cross-agent message leaks:
 *   Layer 1: pendingSend guard — only accept lifecycle:start if we sent a message
 *   Layer 2: agentId matching — extract agentId from sessionKey and reject mismatches
 *   Layer 3: IndexedDB save validation — verify saveKey before persisting
 *
 * These are pure-logic tests that replicate the isolation functions from hooks.tsx,
 * following the same pattern as hooks-chat-logic.test.ts.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Replicated pure functions (mirrors hooks.tsx internals for direct testing)
// ---------------------------------------------------------------------------

/**
 * Extract agentId from sessionKey format: 'agent:<agentId>:main[:thread:<id>]'
 * Returns undefined if sessionKey doesn't match the expected format.
 */
function extractAgentIdFromSessionKey(sessionKey: string): string | undefined {
  const parts = sessionKey.split(":");
  if (parts[0] === "agent" && parts.length >= 3) {
    return parts[1];
  }
  return undefined;
}

/**
 * Base session isolation check (existing #5536-v2 logic).
 * Returns true if the event should be accepted by this panel.
 */
function shouldAcceptEvent(
  evSessionKey: string | undefined,
  boundSessionKey: string | undefined,
  sessionKeyRefCurrent: string | undefined,
): boolean {
  // If event has sessionKey, it must match both bound and ref
  if (evSessionKey && evSessionKey !== boundSessionKey) return false;
  if (evSessionKey && evSessionKey !== sessionKeyRefCurrent) return false;
  // If event lacks sessionKey, reject when we have a session bound
  if (!evSessionKey && (boundSessionKey || sessionKeyRefCurrent)) return false;
  return true;
}

/**
 * Layer 1: pendingSend guard.
 * Only accept lifecycle:start if this panel has a pending send (awaitingResponse).
 * This prevents a panel from picking up lifecycle:start triggered by another panel.
 */
function shouldAcceptLifecycleStart(
  awaitingResponse: boolean,
  evSessionKey: string | undefined,
  boundSessionKey: string | undefined,
): boolean {
  // Must pass base isolation first
  if (!shouldAcceptEvent(evSessionKey, boundSessionKey, boundSessionKey)) return false;
  // When event has explicit matching sessionKey, trust gateway routing
  if (evSessionKey) return true;
  // No sessionKey in event — only accept if we have a pending send
  return awaitingResponse;
}

/**
 * Layer 2: agentId cross-validation.
 * Extracts agentId from the bound sessionKey and compares with the event's agentId.
 * Rejects events where the agentId doesn't match, even if sessionKey matches.
 */
function shouldAcceptByAgentId(
  evAgentId: string | undefined,
  boundSessionKey: string | undefined,
): boolean {
  if (!boundSessionKey) return true; // no bound session, can't validate
  const expectedAgentId = extractAgentIdFromSessionKey(boundSessionKey);
  if (!expectedAgentId) return true; // can't extract, skip check

  // If event has agentId, it must match the expected one
  if (evAgentId && evAgentId !== expectedAgentId) return false;

  return true;
}

/**
 * Layer 3: IndexedDB save validation.
 * Before persisting to IndexedDB, verify the saveKey matches the bound session.
 */
function isValidSaveKey(
  saveKey: string | undefined,
  boundSessionKey: string | undefined,
): boolean {
  if (!saveKey) return false;
  if (!boundSessionKey) return false;
  return saveKey === boundSessionKey;
}

/**
 * Full 3-layer event acceptance check.
 * Combines all layers for comprehensive isolation.
 */
function shouldAcceptAgentEvent(opts: {
  evSessionKey: string | undefined;
  evAgentId: string | undefined;
  boundSessionKey: string | undefined;
  sessionKeyRefCurrent: string | undefined;
  stream: string;
  awaitingResponse: boolean;
}): boolean {
  const { evSessionKey, evAgentId, boundSessionKey, sessionKeyRefCurrent, stream, awaitingResponse } = opts;

  // Base isolation (#5536-v2)
  if (!shouldAcceptEvent(evSessionKey, boundSessionKey, sessionKeyRefCurrent)) return false;

  // Layer 1: pendingSend guard for lifecycle:start
  if (stream === "lifecycle") {
    // When event has explicit matching sessionKey, trust gateway routing
    // When no sessionKey, only accept if we have a pending send
    if (!evSessionKey && !awaitingResponse) return false;
  }

  // Layer 2: agentId cross-validation
  if (!shouldAcceptByAgentId(evAgentId, boundSessionKey)) return false;

  return true;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractAgentIdFromSessionKey", () => {
  it("extracts agentId from 'agent:<id>:main' format", () => {
    expect(extractAgentIdFromSessionKey("agent:hongdon:main")).toBe("hongdon");
  });

  it("extracts agentId from 'agent:<id>:main:thread:<threadId>' format", () => {
    expect(extractAgentIdFromSessionKey("agent:intelliclaw:main:thread:abc123")).toBe("intelliclaw");
  });

  it("returns undefined for non-standard format", () => {
    expect(extractAgentIdFromSessionKey("random-key")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractAgentIdFromSessionKey("")).toBeUndefined();
  });

  it("handles agent with hyphens in id", () => {
    expect(extractAgentIdFromSessionKey("agent:my-agent-v2:main")).toBe("my-agent-v2");
  });
});

describe("Base session isolation (#5536-v2)", () => {
  it("rejects event when evSessionKey differs from boundSessionKey", () => {
    expect(shouldAcceptEvent("agent:hongdon:main", "agent:intelliclaw:main", "agent:intelliclaw:main")).toBe(false);
  });

  it("rejects event when evSessionKey differs from sessionKeyRef", () => {
    expect(shouldAcceptEvent("agent:hongdon:main", "agent:hongdon:main", "agent:intelliclaw:main")).toBe(false);
  });

  it("rejects event with no sessionKey when panel has a bound session", () => {
    expect(shouldAcceptEvent(undefined, "agent:intelliclaw:main", "agent:intelliclaw:main")).toBe(false);
  });

  it("accepts event when sessionKeys match", () => {
    expect(shouldAcceptEvent("agent:hongdon:main", "agent:hongdon:main", "agent:hongdon:main")).toBe(true);
  });

  it("accepts event when both are undefined", () => {
    expect(shouldAcceptEvent(undefined, undefined, undefined)).toBe(true);
  });
});

describe("Layer 1 — pendingSend guard (#121)", () => {
  it("accepts lifecycle:start when awaitingResponse is true and sessionKey matches", () => {
    expect(shouldAcceptLifecycleStart(true, "agent:hongdon:main", "agent:hongdon:main")).toBe(true);
  });

  it("rejects lifecycle:start when awaitingResponse is false (no pending send)", () => {
    // This panel didn't send a message, so it shouldn't accept lifecycle:start
    // even if sessionKeys match via undefined
    expect(shouldAcceptLifecycleStart(false, undefined, undefined)).toBe(false);
  });

  it("rejects lifecycle:start from wrong session even with awaitingResponse", () => {
    expect(shouldAcceptLifecycleStart(true, "agent:hongdon:main", "agent:intelliclaw:main")).toBe(false);
  });

  it("only the sending panel accepts lifecycle:start without sessionKey", () => {
    // Panel A sent a message (awaitingResponse = true)
    const panelA = shouldAcceptLifecycleStart(true, undefined, undefined);
    // Panel B did not send (awaitingResponse = false)
    const panelB = shouldAcceptLifecycleStart(false, undefined, undefined);
    expect(panelA).toBe(true);
    expect(panelB).toBe(false);
  });

  it("accepts lifecycle:start with matching sessionKey even if awaitingResponse is false", () => {
    // When event has explicit sessionKey matching our bound key, trust it
    expect(shouldAcceptLifecycleStart(false, "agent:hongdon:main", "agent:hongdon:main")).toBe(true);
  });
});

describe("Layer 2 — agentId matching (#121)", () => {
  it("rejects event with mismatched agentId", () => {
    // Event says agentId is 'hongdon' but our session is for 'intelliclaw'
    expect(shouldAcceptByAgentId("hongdon", "agent:intelliclaw:main")).toBe(false);
  });

  it("accepts event with matching agentId", () => {
    expect(shouldAcceptByAgentId("intelliclaw", "agent:intelliclaw:main")).toBe(true);
  });

  it("accepts event when no agentId in event (backwards compat)", () => {
    expect(shouldAcceptByAgentId(undefined, "agent:intelliclaw:main")).toBe(true);
  });

  it("accepts event when no boundSessionKey (no validation possible)", () => {
    expect(shouldAcceptByAgentId("hongdon", undefined)).toBe(true);
  });

  it("rejects cross-agent event even with thread session", () => {
    expect(shouldAcceptByAgentId("hongdon", "agent:intelliclaw:main:thread:abc")).toBe(false);
  });
});

describe("Layer 3 — IndexedDB save validation (#121)", () => {
  it("rejects save when saveKey is undefined", () => {
    expect(isValidSaveKey(undefined, "agent:hongdon:main")).toBe(false);
  });

  it("rejects save when boundSessionKey is undefined", () => {
    expect(isValidSaveKey("agent:hongdon:main", undefined)).toBe(false);
  });

  it("rejects save when keys don't match", () => {
    expect(isValidSaveKey("agent:hongdon:main", "agent:intelliclaw:main")).toBe(false);
  });

  it("accepts save when keys match", () => {
    expect(isValidSaveKey("agent:hongdon:main", "agent:hongdon:main")).toBe(true);
  });

  it("rejects save when saveKey comes from event with wrong sessionKey", () => {
    // Simulates the scenario where evSessionKey was used as saveKey
    // but doesn't match the panel's bound session
    const evSessionKey = "agent:hongdon:main";
    const boundSessionKey = "agent:intelliclaw:main";
    const saveKey = evSessionKey || boundSessionKey; // hooks.tsx: const saveKey = evSessionKey || boundSessionKey;
    expect(isValidSaveKey(saveKey, boundSessionKey)).toBe(false);
  });
});

describe("Full 3-layer integration (#121)", () => {
  it("Agent A event must NOT appear in Agent B panel", () => {
    const result = shouldAcceptAgentEvent({
      evSessionKey: "agent:hongdon:main",
      evAgentId: "hongdon",
      boundSessionKey: "agent:intelliclaw:main",
      sessionKeyRefCurrent: "agent:intelliclaw:main",
      stream: "assistant",
      awaitingResponse: false,
    });
    expect(result).toBe(false);
  });

  it("Events without sessionKey are rejected by panels with a bound session", () => {
    const result = shouldAcceptAgentEvent({
      evSessionKey: undefined,
      evAgentId: undefined,
      boundSessionKey: "agent:intelliclaw:main",
      sessionKeyRefCurrent: "agent:intelliclaw:main",
      stream: "assistant",
      awaitingResponse: false,
    });
    expect(result).toBe(false);
  });

  it("lifecycle:start without sessionKey is rejected when not awaiting response", () => {
    const result = shouldAcceptAgentEvent({
      evSessionKey: undefined,
      evAgentId: undefined,
      boundSessionKey: undefined,
      sessionKeyRefCurrent: undefined,
      stream: "lifecycle",
      awaitingResponse: false,
    });
    expect(result).toBe(false);
  });

  it("lifecycle:start without sessionKey is accepted when awaiting response", () => {
    const result = shouldAcceptAgentEvent({
      evSessionKey: undefined,
      evAgentId: undefined,
      boundSessionKey: undefined,
      sessionKeyRefCurrent: undefined,
      stream: "lifecycle",
      awaitingResponse: true,
    });
    expect(result).toBe(true);
  });

  it("concurrent panels: each only receives own session events", () => {
    const panelA_sessionKey = "agent:hongdon:main";
    const panelB_sessionKey = "agent:intelliclaw:main";

    // Event for hongdon
    const eventForHongdon = {
      evSessionKey: "agent:hongdon:main",
      evAgentId: "hongdon",
      stream: "assistant",
      awaitingResponse: true,
    };

    const panelA_accepts = shouldAcceptAgentEvent({
      ...eventForHongdon,
      boundSessionKey: panelA_sessionKey,
      sessionKeyRefCurrent: panelA_sessionKey,
    });
    const panelB_accepts = shouldAcceptAgentEvent({
      ...eventForHongdon,
      boundSessionKey: panelB_sessionKey,
      sessionKeyRefCurrent: panelB_sessionKey,
    });

    expect(panelA_accepts).toBe(true);
    expect(panelB_accepts).toBe(false);
  });

  it("rejects event with matching sessionKey but wrong agentId (Layer 2)", () => {
    // Gateway bug: sends correct sessionKey but wrong agentId in payload
    const result = shouldAcceptAgentEvent({
      evSessionKey: "agent:intelliclaw:main",
      evAgentId: "hongdon", // wrong!
      boundSessionKey: "agent:intelliclaw:main",
      sessionKeyRefCurrent: "agent:intelliclaw:main",
      stream: "assistant",
      awaitingResponse: true,
    });
    expect(result).toBe(false);
  });

  it("accepts event with matching sessionKey and no agentId (legacy)", () => {
    const result = shouldAcceptAgentEvent({
      evSessionKey: "agent:intelliclaw:main",
      evAgentId: undefined,
      boundSessionKey: "agent:intelliclaw:main",
      sessionKeyRefCurrent: "agent:intelliclaw:main",
      stream: "assistant",
      awaitingResponse: false,
    });
    expect(result).toBe(true);
  });

  it("lifecycle:start with matching sessionKey accepted even without pending send", () => {
    // When gateway properly includes sessionKey, we trust the session routing
    const result = shouldAcceptAgentEvent({
      evSessionKey: "agent:hongdon:main",
      evAgentId: "hongdon",
      boundSessionKey: "agent:hongdon:main",
      sessionKeyRefCurrent: "agent:hongdon:main",
      stream: "lifecycle",
      awaitingResponse: false,
    });
    expect(result).toBe(true);
  });

  it("thread sessions correctly isolate from main sessions", () => {
    const mainKey = "agent:hongdon:main";
    const threadKey = "agent:hongdon:main:thread:abc123";

    // Event for thread should not leak to main
    const threadEventAcceptedByMain = shouldAcceptAgentEvent({
      evSessionKey: threadKey,
      evAgentId: "hongdon",
      boundSessionKey: mainKey,
      sessionKeyRefCurrent: mainKey,
      stream: "assistant",
      awaitingResponse: false,
    });
    expect(threadEventAcceptedByMain).toBe(false);

    // Event for main should not leak to thread
    const mainEventAcceptedByThread = shouldAcceptAgentEvent({
      evSessionKey: mainKey,
      evAgentId: "hongdon",
      boundSessionKey: threadKey,
      sessionKeyRefCurrent: threadKey,
      stream: "assistant",
      awaitingResponse: false,
    });
    expect(mainEventAcceptedByThread).toBe(false);
  });
});

describe("IndexedDB save key validation in lifecycle:end (#121)", () => {
  it("prevents cross-session save when evSessionKey doesn't match bound", () => {
    const evSessionKey = "agent:hongdon:main";
    const boundSessionKey = "agent:intelliclaw:main";
    const saveKey = evSessionKey || boundSessionKey;
    expect(isValidSaveKey(saveKey, boundSessionKey)).toBe(false);
  });

  it("allows save when evSessionKey matches bound", () => {
    const evSessionKey = "agent:hongdon:main";
    const boundSessionKey = "agent:hongdon:main";
    const saveKey = evSessionKey || boundSessionKey;
    expect(isValidSaveKey(saveKey, boundSessionKey)).toBe(true);
  });

  it("allows save when using boundSessionKey as fallback", () => {
    const evSessionKey = undefined;
    const boundSessionKey = "agent:hongdon:main";
    const saveKey = evSessionKey || boundSessionKey;
    expect(isValidSaveKey(saveKey, boundSessionKey)).toBe(true);
  });
});
