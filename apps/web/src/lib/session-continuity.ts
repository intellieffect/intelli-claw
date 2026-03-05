export interface SessionContinuityKeys {
  scopedSessionKey: string;
  scopedAgentKey: string;
  agentRememberedSessionKey: string;
  legacyPanelSessionKey: string;
  legacyGlobalSessionKey: string;
}

export function buildSessionContinuityKeys(params: {
  windowPrefix: string;
  agentId: string;
}): SessionContinuityKeys {
  const { windowPrefix, agentId } = params;
  // Post SplitView removal: scoped prefix matches chat-panel's `awf:${windowStoragePrefix()}`
  const scopedPrefix = `awf:${windowPrefix}`;
  return {
    scopedSessionKey: `${scopedPrefix}sessionKey`,
    scopedAgentKey: `${scopedPrefix}agentId`,
    agentRememberedSessionKey: `awf:lastSessionKey:${agentId}`,
    // Legacy keys for backward-compat with pre-refactor data
    legacyPanelSessionKey: `awf:panel:panel-1:sessionKey`,
    legacyGlobalSessionKey: "awf:sessionKey",
  };
}

export function resolveInitialSessionState(params: {
  windowPrefix: string;
  defaultAgentId: string;
  getItem: (key: string) => string | null;
}): { agentId: string; sessionKey?: string } {
  const { windowPrefix, defaultAgentId, getItem } = params;

  // Post SplitView removal: scoped prefix matches chat-panel's storagePrefix
  const scopedPrefix = `awf:${windowPrefix}`;
  const scopedAgent = getItem(`${scopedPrefix}agentId`);
  const agentId = scopedAgent || defaultAgentId;

  const keys = buildSessionContinuityKeys({ windowPrefix, agentId });

  const sessionKey =
    getItem(keys.scopedSessionKey) ||
    getItem(keys.agentRememberedSessionKey) ||
    getItem(keys.legacyPanelSessionKey) ||
    getItem(keys.legacyGlobalSessionKey) ||
    undefined;

  return { agentId, sessionKey };
}

export function getRememberedSessionForAgent(params: {
  agentId: string;
  getItem: (key: string) => string | null;
}): string | null {
  const { agentId, getItem } = params;
  return getItem(`awf:lastSessionKey:${agentId}`);
}
