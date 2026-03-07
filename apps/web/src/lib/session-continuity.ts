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
  /** URL search string (e.g. window.location.search) for ?session= override (#170) */
  urlSearch?: string;
}): { agentId: string; sessionKey?: string } {
  const { windowPrefix, defaultAgentId, getItem, urlSearch } = params;

  // #170: URL query param takes highest priority (Cmd+N session duplication)
  let urlSessionKey: string | undefined;
  if (urlSearch) {
    try {
      const qp = new URLSearchParams(urlSearch);
      const s = qp.get("session");
      if (s) urlSessionKey = s;
    } catch {
      // ignore malformed search string
    }
  }

  // Post SplitView removal: scoped prefix matches chat-panel's storagePrefix
  const scopedPrefix = `awf:${windowPrefix}`;
  const scopedAgent = getItem(`${scopedPrefix}agentId`);
  // #142: Fall back to legacy no-prefix key for users upgrading from single-tab era
  const legacyAgent = windowPrefix ? getItem("awf:agentId") : null;
  const agentId = scopedAgent || legacyAgent || defaultAgentId;

  const keys = buildSessionContinuityKeys({ windowPrefix, agentId });

  const sessionKey =
    urlSessionKey ||
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
