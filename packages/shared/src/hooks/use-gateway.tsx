
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { GatewayClient, type ConnectionState } from "../gateway/client";
import type {
  EventFrame,
  ErrorShape,
  Agent,
} from "../gateway/protocol";

// --- Gateway Config ---

export const GATEWAY_CONFIG_STORAGE_KEY = "awf:gateway-config";
export const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

export interface GatewayConfig {
  url: string;
  token: string;
}

// --- Gateway Context ---

interface GatewayContextValue {
  client: GatewayClient | null;
  state: ConnectionState;
  error: ErrorShape | null;
  updateConfig: (url: string, token: string) => void;
}

const GatewayContext = createContext<GatewayContextValue>({
  client: null,
  state: "disconnected",
  error: null,
  updateConfig: () => {},
});

// --- Gateway Provider ---

export interface GatewayProviderProps {
  /** Initial gateway URL */
  url: string;
  /** Initial auth token */
  token: string;
  /** Called when config changes at runtime (for persistence by the app) */
  onConfigChange?: (url: string, token: string) => void;
  children: ReactNode;
}

export function GatewayProvider({ url, token, onConfigChange, children }: GatewayProviderProps) {
  const [client, setClient] = useState<GatewayClient | null>(null);
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<ErrorShape | null>(null);
  const configRef = useRef<GatewayConfig>({ url, token });

  const createAndConnect = useCallback((config: GatewayConfig) => {
    const c = new GatewayClient(config.url, config.token);
    setClient(c);
    setError(null);

    const unsub = c.onStateChange((s, err) => {
      setState(s);
      setError(err ?? null);
    });
    c.connect();

    return () => {
      unsub();
      c.disconnect();
    };
  }, []);

  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    cleanupRef.current = createAndConnect(configRef.current);
    return () => cleanupRef.current?.();
  }, [createAndConnect]);

  const updateConfig = useCallback((newUrl: string, newToken: string) => {
    const newConfig = { url: newUrl, token: newToken };
    configRef.current = newConfig;
    onConfigChange?.(newUrl, newToken);
    // Disconnect existing and reconnect
    cleanupRef.current?.();
    cleanupRef.current = createAndConnect(newConfig);
  }, [createAndConnect, onConfigChange]);

  return (
    <GatewayContext.Provider value={{ client, state, error, updateConfig }}>
      {children}
    </GatewayContext.Provider>
  );
}

// --- useGateway ---

export function useGateway() {
  const ctx = useContext(GatewayContext);
  return {
    ...ctx,
    mainSessionKey: ctx.client?.mainSessionKey || "",
    serverVersion: ctx.client?.serverVersion || "",
    serverCommit: ctx.client?.serverCommit || "",
    gatewayUrl: ctx.client?.getUrl() || "",
  };
}

// --- useAgents ---

export function useAgents() {
  const { client, state } = useGateway();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAgents = useCallback(async () => {
    if (!client || state !== "connected") return;
    setLoading(true);
    try {
      const res = await client.request<{ defaultId: string; agents: Agent[] }>("agents.list");
      setAgents(res?.agents || []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [client, state]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return { agents, loading, refresh: fetchAgents };
}

// --- Session reset event ---

export interface SessionResetEvent {
  key: string;
  oldSessionId: string;
  newSessionId: string;
}

type SessionResetListener = (event: SessionResetEvent) => void;
const sessionResetListeners = new Set<SessionResetListener>();

export function onSessionReset(listener: SessionResetListener): () => void {
  sessionResetListeners.add(listener);
  return () => { sessionResetListeners.delete(listener); };
}

export function emitSessionReset(event: SessionResetEvent) {
  for (const l of sessionResetListeners) {
    try { l(event); } catch (e) { console.error("[AWF] session reset listener error:", e); }
  }
}
