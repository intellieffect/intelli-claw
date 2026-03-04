export interface SessionContinuityKeys {
  scopedSessionKey: string;
  scopedAgentKey: string;
  agentRememberedSessionKey: string;
  legacyPanelSessionKey: string;
  legacyGlobalSessionKey: string;
}

export function buildSessionContinuityKeys(params: {
  windowPrefix: string;
  panelId: string;
  agentId: string;
}): SessionContinuityKeys {
  const { windowPrefix, panelId, agentId } = params;
  const scopedPrefix = `awf:${windowPrefix}panel:${panelId}:`;
  return {
    scopedSessionKey: `${scopedPrefix}sessionKey`,
    scopedAgentKey: `${scopedPrefix}agentId`,
    agentRememberedSessionKey: `awf:lastSessionKey:${agentId}`,
    legacyPanelSessionKey: `awf:panel:${panelId}:sessionKey`,
    legacyGlobalSessionKey: "awf:sessionKey",
  };
}

export function resolveInitialSessionState(params: {
  windowPrefix: string;
  panelId: string;
  defaultAgentId: string;
  getItem: (key: string) => string | null;
}): { agentId: string; sessionKey?: string } {
  const { windowPrefix, panelId, defaultAgentId, getItem } = params;

  const scopedPrefix = `awf:${windowPrefix}panel:${panelId}:`;
  const scopedAgent = getItem(`${scopedPrefix}agentId`);
  const agentId = scopedAgent || defaultAgentId;

  const keys = buildSessionContinuityKeys({ windowPrefix, panelId, agentId });

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
