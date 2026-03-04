import { describe, it, expect } from "vitest";
import {
  buildSessionContinuityKeys,
  resolveInitialSessionState,
  getRememberedSessionForAgent,
} from "@/lib/session-continuity";

describe("session continuity (#49)", () => {
  it("builds scoped + fallback keys", () => {
    const keys = buildSessionContinuityKeys({
      windowPrefix: "w2:",
      panelId: "panel-1",
      agentId: "iclaw",
    });

    expect(keys.scopedSessionKey).toBe("awf:w2:panel:panel-1:sessionKey");
    expect(keys.scopedAgentKey).toBe("awf:w2:panel:panel-1:agentId");
    expect(keys.agentRememberedSessionKey).toBe("awf:lastSessionKey:iclaw");
    expect(keys.legacyPanelSessionKey).toBe("awf:panel:panel-1:sessionKey");
    expect(keys.legacyGlobalSessionKey).toBe("awf:sessionKey");
  });

  it("prefers scoped session key when available", () => {
    const store = new Map<string, string>([
      ["awf:w1:panel:main:sessionKey", "agent:iclaw:main:thread:scoped"],
      ["awf:lastSessionKey:iclaw", "agent:iclaw:main:thread:remembered"],
    ]);

    const state = resolveInitialSessionState({
      windowPrefix: "w1:",
      panelId: "main",
      defaultAgentId: "iclaw",
      getItem: (k) => store.get(k) ?? null,
    });

    expect(state.agentId).toBe("iclaw");
    expect(state.sessionKey).toBe("agent:iclaw:main:thread:scoped");
  });

  it("falls back to remembered agent session when scoped key missing", () => {
    const store = new Map<string, string>([
      ["awf:w1:panel:main:agentId", "iclaw"],
      ["awf:lastSessionKey:iclaw", "agent:iclaw:main:thread:last"],
    ]);

    const state = resolveInitialSessionState({
      windowPrefix: "w1:",
      panelId: "main",
      defaultAgentId: "default",
      getItem: (k) => store.get(k) ?? null,
    });

    expect(state.agentId).toBe("iclaw");
    expect(state.sessionKey).toBe("agent:iclaw:main:thread:last");
  });

  it("falls back to legacy keys when remembered key missing", () => {
    const store = new Map<string, string>([
      ["awf:panel:main:sessionKey", "agent:iclaw:main:thread:legacy-panel"],
    ]);

    const state = resolveInitialSessionState({
      windowPrefix: "w9:",
      panelId: "main",
      defaultAgentId: "iclaw",
      getItem: (k) => store.get(k) ?? null,
    });

    expect(state.sessionKey).toBe("agent:iclaw:main:thread:legacy-panel");
  });

  it("getRememberedSessionForAgent returns null when absent", () => {
    const remembered = getRememberedSessionForAgent({
      agentId: "main",
      getItem: () => null,
    });
    expect(remembered).toBeNull();
  });
});
