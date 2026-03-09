/**
 * #170 — Cmd+N 새 창에서 현재 세션 복제
 *
 * 검증 대상:
 * 1. resolveInitialSessionState — ?session= query param이 최우선
 * 2. urlSearch 없을 때 기존 동작 유지
 * 3. malformed urlSearch 무시
 */
import { describe, it, expect } from "vitest";
import { resolveInitialSessionState } from "@/lib/session-continuity";

describe("#170 — Cmd+N session duplication via URL query param", () => {
  const defaultAgentId = "ops";
  const emptyGetItem = () => null;

  it("should use ?session= query param as highest priority", () => {
    const result = resolveInitialSessionState({
      windowPrefix: "",
      defaultAgentId,
      getItem: emptyGetItem,
      urlSearch: "?session=agent%3Aops%3Amain",
    });

    expect(result.sessionKey).toBe("agent:ops:main");
    expect(result.agentId).toBe(defaultAgentId);
  });

  it("should prefer ?session= over localStorage values", () => {
    const storage: Record<string, string> = {
      "awf:sessionKey": "agent:ops:old-session",
      "awf:lastSessionKey:ops": "agent:ops:remembered",
    };

    const result = resolveInitialSessionState({
      windowPrefix: "",
      defaultAgentId,
      getItem: (k) => storage[k] ?? null,
      urlSearch: "?session=agent%3Aops%3Atopic%3A123",
    });

    expect(result.sessionKey).toBe("agent:ops:topic:123");
  });

  it("should fall back to localStorage when no ?session= param", () => {
    const storage: Record<string, string> = {
      "awf:sessionKey": "agent:ops:main",
    };

    const result = resolveInitialSessionState({
      windowPrefix: "",
      defaultAgentId,
      getItem: (k) => storage[k] ?? null,
      urlSearch: "",
    });

    expect(result.sessionKey).toBe("agent:ops:main");
  });

  it("should fall back to localStorage when urlSearch is undefined", () => {
    const storage: Record<string, string> = {
      "awf:sessionKey": "agent:ops:main",
    };

    const result = resolveInitialSessionState({
      windowPrefix: "",
      defaultAgentId,
      getItem: (k) => storage[k] ?? null,
    });

    expect(result.sessionKey).toBe("agent:ops:main");
  });

  it("should handle ?session= with special characters", () => {
    const result = resolveInitialSessionState({
      windowPrefix: "",
      defaultAgentId,
      getItem: emptyGetItem,
      urlSearch: "?session=agent%3Aops%3Asubagent%3Aabc-123",
    });

    expect(result.sessionKey).toBe("agent:ops:subagent:abc-123");
  });

  it("should ignore malformed urlSearch gracefully", () => {
    // resolveInitialSessionState should not throw
    const result = resolveInitialSessionState({
      windowPrefix: "",
      defaultAgentId,
      getItem: emptyGetItem,
      urlSearch: "not-a-valid-search",
    });

    // No session= param found, falls through to undefined
    expect(result.sessionKey).toBeUndefined();
  });

  it("should work with window prefix for multi-window isolation", () => {
    const storage: Record<string, string> = {
      "awf:w1:sessionKey": "agent:ops:window-1-session",
    };

    const result = resolveInitialSessionState({
      windowPrefix: "w1:",
      defaultAgentId,
      getItem: (k) => storage[k] ?? null,
      urlSearch: "?session=agent%3Aops%3Aduplicated",
    });

    // URL param still wins over window-scoped storage
    expect(result.sessionKey).toBe("agent:ops:duplicated");
  });

  it("should handle empty ?session= value", () => {
    const result = resolveInitialSessionState({
      windowPrefix: "",
      defaultAgentId,
      getItem: emptyGetItem,
      urlSearch: "?session=",
    });

    // Empty string is falsy, should fall through
    expect(result.sessionKey).toBeUndefined();
  });
});
