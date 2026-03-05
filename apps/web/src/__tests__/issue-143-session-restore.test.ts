/**
 * Issue #143 — Electron 새로고침 시 세션/에이전트가 default로 초기화됨
 *
 * 원인: SplitView 제거 리팩토링(cb7c44b)에서 chat-panel.tsx의 storagePrefix가
 *       "awf:{prefix}" 형식으로 변경되었으나, session-continuity.ts의 읽기 로직은
 *       "awf:{prefix}panel:{panelId}:" 형식을 계속 사용하여 저장/읽기 키 불일치 발생.
 *
 * 검증 항목:
 * 1. resolveInitialSessionState가 새 키 형식("awf:{prefix}sessionKey")으로 읽는다
 * 2. 레거시 키 형식("awf:panel:panel-1:sessionKey" 등)도 fallback으로 읽는다
 * 3. chat-panel의 저장 키와 읽기 키가 일치한다
 */
import { describe, it, expect } from "vitest";
import {
  resolveInitialSessionState,
  buildSessionContinuityKeys,
  getRememberedSessionForAgent,
} from "../lib/session-continuity";

// --- Helper: simulate localStorage ---
function mockStorage(entries: Record<string, string>) {
  return (key: string) => entries[key] ?? null;
}

// --- Simulate what chat-panel.tsx does ---
function simulateChatPanelStoragePrefix(windowPrefix: string): string {
  return `awf:${windowPrefix}`;
}

describe("Issue #143: session restore key consistency", () => {
  const DEFAULT_AGENT = "default";

  describe("1. New format keys — save/read round-trip", () => {
    it("should restore sessionKey saved by chat-panel (no window prefix)", () => {
      // chat-panel saves: `awf:sessionKey` = "agent:mybot:main"
      const prefix = simulateChatPanelStoragePrefix("");
      const savedKey = "agent:mybot:main";
      const storage = mockStorage({
        [`${prefix}sessionKey`]: savedKey,
        [`${prefix}agentId`]: "mybot",
      });

      const result = resolveInitialSessionState({
        windowPrefix: "",
        panelId: "main",
        defaultAgentId: DEFAULT_AGENT,
        getItem: storage,
      });

      expect(result.sessionKey).toBe(savedKey);
      expect(result.agentId).toBe("mybot");
    });

    it("should restore sessionKey saved by chat-panel (Electron window prefix)", () => {
      const prefix = simulateChatPanelStoragePrefix("w1:");
      const savedKey = "agent:assistant:main:thread:abc123";
      const storage = mockStorage({
        [`${prefix}sessionKey`]: savedKey,
        [`${prefix}agentId`]: "assistant",
      });

      const result = resolveInitialSessionState({
        windowPrefix: "w1:",
        panelId: "main",
        defaultAgentId: DEFAULT_AGENT,
        getItem: storage,
      });

      expect(result.sessionKey).toBe(savedKey);
      expect(result.agentId).toBe("assistant");
    });
  });

  describe("2. Legacy key fallback", () => {
    it("should fall back to legacy panel key (awf:panel:panel-1:sessionKey)", () => {
      const storage = mockStorage({
        "awf:panel:panel-1:sessionKey": "agent:old:main",
      });

      const result = resolveInitialSessionState({
        windowPrefix: "",
        panelId: "main",
        defaultAgentId: DEFAULT_AGENT,
        getItem: storage,
      });

      expect(result.sessionKey).toBe("agent:old:main");
    });

    it("should fall back to legacy global key (awf:sessionKey)", () => {
      const storage = mockStorage({
        "awf:sessionKey": "agent:legacy:main",
      });

      const result = resolveInitialSessionState({
        windowPrefix: "",
        panelId: "main",
        defaultAgentId: DEFAULT_AGENT,
        getItem: storage,
      });

      expect(result.sessionKey).toBe("agent:legacy:main");
    });

    it("should fall back to agent remembered key", () => {
      const storage = mockStorage({
        "awf:lastSessionKey:default": "agent:default:main:thread:xyz",
      });

      const result = resolveInitialSessionState({
        windowPrefix: "",
        panelId: "main",
        defaultAgentId: DEFAULT_AGENT,
        getItem: storage,
      });

      expect(result.sessionKey).toBe("agent:default:main:thread:xyz");
    });

    it("should prefer new format over legacy when both exist", () => {
      // Use a window prefix so scoped key differs from legacy global key
      const prefix = simulateChatPanelStoragePrefix("w1:");
      const storage = mockStorage({
        [`${prefix}sessionKey`]: "agent:new:main",
        "awf:panel:panel-1:sessionKey": "agent:old:main",
        "awf:sessionKey": "agent:oldest:main",
      });

      const result = resolveInitialSessionState({
        windowPrefix: "w1:",
        panelId: "main",
        defaultAgentId: DEFAULT_AGENT,
        getItem: storage,
      });

      expect(result.sessionKey).toBe("agent:new:main");
    });
  });

  describe("3. Default fallback when no keys exist", () => {
    it("should return default agentId and undefined sessionKey", () => {
      const storage = mockStorage({});

      const result = resolveInitialSessionState({
        windowPrefix: "",
        panelId: "main",
        defaultAgentId: DEFAULT_AGENT,
        getItem: storage,
      });

      expect(result.agentId).toBe(DEFAULT_AGENT);
      expect(result.sessionKey).toBeUndefined();
    });
  });

  describe("4. buildSessionContinuityKeys format", () => {
    it("should produce keys matching chat-panel storage prefix (no panel: segment)", () => {
      const keys = buildSessionContinuityKeys({
        windowPrefix: "",
        panelId: "main",
        agentId: "mybot",
      });

      // The scoped key MUST match what chat-panel saves: `awf:sessionKey`
      expect(keys.scopedSessionKey).toBe("awf:sessionKey");
      expect(keys.scopedAgentKey).toBe("awf:agentId");
    });

    it("should produce keys with window prefix matching chat-panel", () => {
      const keys = buildSessionContinuityKeys({
        windowPrefix: "w2:",
        panelId: "main",
        agentId: "mybot",
      });

      expect(keys.scopedSessionKey).toBe("awf:w2:sessionKey");
      expect(keys.scopedAgentKey).toBe("awf:w2:agentId");
    });
  });

  describe("5. getRememberedSessionForAgent", () => {
    it("should return remembered session key for given agent", () => {
      const storage = mockStorage({
        "awf:lastSessionKey:assistant": "agent:assistant:main:thread:t1",
      });

      const result = getRememberedSessionForAgent({
        agentId: "assistant",
        getItem: storage,
      });

      expect(result).toBe("agent:assistant:main:thread:t1");
    });
  });
});
