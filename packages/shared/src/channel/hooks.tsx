/**
 * ChannelProvider / useChannel — React context for the Channel client.
 *
 * Responsibilities beyond the raw ChannelClient:
 * - localStorage persistence (messages + active session) so a page reload
 *   does not lose history until the user clears it.
 * - Permission-relay state (pending tool-approval requests from Claude Code
 *   v2.1.81+ experimental `claude/channel/permission` capability).
 * - Slash commands (`/clear`, `/session <id>`) parsed client-side before send.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ChannelClient, type MessageHandler } from "./client";
import {
  nextClientId,
  type ChannelConfig,
  type ChannelMsg,
  type ChannelWire,
  type ConnectionState,
  type PermissionRequest,
} from "./protocol";

export const CHANNEL_CONFIG_STORAGE_KEY = "intelli-claw:channel-config";
export const CHANNEL_MESSAGES_STORAGE_KEY = "intelli-claw:channel-messages";
export const CHANNEL_SESSION_STORAGE_KEY = "intelli-claw:channel-active-session";
export const DEFAULT_CHANNEL_URL = "http://127.0.0.1:8790";

const MAX_PERSISTED_MESSAGES = 200;

/**
 * Minimal key-value store contract used for message / session persistence.
 * Synchronous to match the browser's `localStorage`; React Native callers
 * pass a wrapper (e.g. backed by MMKV) with the same shape.
 */
export interface ChannelStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

function defaultStorage(): ChannelStorage | null {
  // `typeof` guard so the module is safe to import in React Native / SSR.
  if (typeof localStorage === "undefined") return null;
  return {
    getItem: (k) => localStorage.getItem(k),
    setItem: (k, v) => localStorage.setItem(k, v),
    removeItem: (k) => localStorage.removeItem(k),
  };
}

function loadPersistedMessages(storage: ChannelStorage | null): ChannelMsg[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(CHANNEL_MESSAGES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChannelMsg[];
    return Array.isArray(parsed) ? parsed.slice(-MAX_PERSISTED_MESSAGES) : [];
  } catch {
    return [];
  }
}

function persistMessages(
  storage: ChannelStorage | null,
  messages: ChannelMsg[],
): void {
  if (!storage) return;
  try {
    const tail = messages.slice(-MAX_PERSISTED_MESSAGES);
    storage.setItem(CHANNEL_MESSAGES_STORAGE_KEY, JSON.stringify(tail));
  } catch {
    // Out of quota or unavailable — silent, the UI stays functional.
  }
}

function loadPersistedSession(
  storage: ChannelStorage | null,
  fallback = "main",
): string {
  if (!storage) return fallback;
  try {
    return storage.getItem(CHANNEL_SESSION_STORAGE_KEY) || fallback;
  } catch {
    return fallback;
  }
}

function persistSession(storage: ChannelStorage | null, id: string): void {
  if (!storage) return;
  try {
    storage.setItem(CHANNEL_SESSION_STORAGE_KEY, id);
  } catch {
    // Silent.
  }
}

interface ChannelContextValue {
  client: ChannelClient | null;
  state: ConnectionState;
  error: Error | null;
  activeSessionId: string;
  messages: ChannelMsg[];
  pendingPermissions: PermissionRequest[];
  send: (text: string, opts?: { sessionId?: string; file?: File }) => Promise<string>;
  clearMessages: () => void;
  setActiveSessionId: (id: string) => void;
  resolvePermission: (request_id: string, behavior: "allow" | "deny") => void;
  updateConfig: (next: ChannelConfig) => void;
}

const ChannelContext = createContext<ChannelContextValue>({
  client: null,
  state: "disconnected",
  error: null,
  activeSessionId: "main",
  messages: [],
  pendingPermissions: [],
  send: async () => "",
  clearMessages: () => {},
  setActiveSessionId: () => {},
  resolvePermission: () => {},
  updateConfig: () => {},
});

export interface ChannelProviderProps {
  url: string;
  token?: string;
  onConfigChange?: (next: ChannelConfig) => void;
  /** Override the storage backend (React Native passes an MMKV-backed wrapper). */
  storage?: ChannelStorage | null;
  /**
   * Seed the message list on mount. Electron passes Claude Code transcript
   * history for the resumed session here; the provider will merge in any
   * persisted entries that don't conflict so the channel stream stays
   * continuous after a resume.
   */
  initialMessages?: ChannelMsg[];
  children: ReactNode;
}

export function ChannelProvider({
  url,
  token,
  onConfigChange,
  storage,
  initialMessages,
  children,
}: ChannelProviderProps) {
  const storageRef = useRef<ChannelStorage | null>(
    storage === undefined ? defaultStorage() : storage,
  );
  const [client, setClient] = useState<ChannelClient | null>(null);
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<Error | null>(null);
  const [activeSessionId, setActiveSessionIdState] = useState(() =>
    loadPersistedSession(storageRef.current),
  );
  const [messages, setMessages] = useState<ChannelMsg[]>(() => {
    // Seed from props first (the Electron resume path), then from persisted
    // storage, then empty. Provider is keyed on channel URL by the shell so
    // initialMessages only fires on a genuine session switch.
    if (initialMessages && initialMessages.length > 0) {
      persistMessages(storageRef.current, initialMessages);
      return initialMessages;
    }
    return loadPersistedMessages(storageRef.current);
  });
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const configRef = useRef<ChannelConfig>({ url, token });

  const setActiveSessionId = useCallback((id: string) => {
    setActiveSessionIdState(id);
    persistSession(storageRef.current, id);
  }, []);

  const handleMessage = useCallback<MessageHandler>((frame: ChannelWire) => {
    switch (frame.type) {
      case "msg":
        setMessages((prev) => {
          const next = [...prev, frame];
          persistMessages(storageRef.current, next);
          return next;
        });
        break;
      case "edit":
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === frame.id ? { ...m, text: frame.text } : m,
          );
          persistMessages(storageRef.current, next);
          return next;
        });
        break;
      case "session":
        setActiveSessionIdState(frame.sessionId);
        persistSession(storageRef.current, frame.sessionId);
        break;
      case "permission_request":
        setPendingPermissions((prev) => [
          ...prev.filter((p) => p.request_id !== frame.request_id),
          {
            request_id: frame.request_id,
            tool_name: frame.tool_name,
            description: frame.description,
            input_preview: frame.input_preview,
          },
        ]);
        break;
      case "permission_verdict":
        setPendingPermissions((prev) =>
          prev.filter((p) => p.request_id !== frame.request_id),
        );
        break;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const c = new ChannelClient(configRef.current);
    const unsubState = c.onStateChange((s, err) => {
      if (cancelled) return;
      setState(s);
      setError(err ?? null);
    });
    const unsubMsg = c.onMessage(handleMessage);
    c.connect();
    setClient(c);

    void c
      .fetchInfo()
      .then(async (info) => {
        if (cancelled) return;
        // Only adopt the plugin-reported active session if we have no local
        // preference yet. Saved sessions win to avoid surprising the user on
        // reload.
        if (!storageRef.current?.getItem(CHANNEL_SESSION_STORAGE_KEY)) {
          setActiveSessionIdState(info.activeSessionId);
        }
        // Load session history from JSONL (source of truth)
        const activeUuid = info.activeSessionId;
        if (activeUuid) {
          try {
            const history = await c.loadSessionHistory(activeUuid);
            if (cancelled) return;
            if (history.messages.length > 0) {
              const restored: ChannelMsg[] = history.messages.map((m) => ({
                id: m.id,
                from: m.from,
                text: m.text,
                ts: m.ts,
                sessionId: m.sessionId,
              }));
              setMessages((prev) => {
                // Merge: JSONL history is source of truth, append any newer WS messages
                const historyIds = new Set(restored.map((m) => m.id));
                const newer = prev.filter(
                  (m) =>
                    !historyIds.has(m.id) &&
                    m.ts > (restored[restored.length - 1]?.ts ?? 0),
                );
                const merged = [...restored, ...newer];
                persistMessages(storageRef.current, merged);
                return merged;
              });
            }
          } catch {
            // History API unavailable — fall back to localStorage (already loaded)
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unsubState();
      unsubMsg();
      c.disconnect();
      setClient(null);
    };
  }, [handleMessage]);

  const resolvePermission = useCallback(
    (request_id: string, behavior: "allow" | "deny") => {
      if (!client) return;
      const reply = `${behavior === "allow" ? "yes" : "no"} ${request_id}`;
      setPendingPermissions((prev) => prev.filter((p) => p.request_id !== request_id));
      void client.send({ id: nextClientId(), text: reply }).catch(() => {});
    },
    [client],
  );

  const send = useCallback(
    async (text: string, opts?: { sessionId?: string; file?: File }) => {
      const trimmed = text.trim();
      const sessionId = opts?.sessionId ?? activeSessionId;

      // Client-only slash commands — never hit the channel.
      if (!opts?.file && trimmed.startsWith("/")) {
        const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
        if (cmd === "clear") {
          setMessages([]);
          persistMessages(storageRef.current, []);
          return "";
        }
        if (cmd === "session" && rest[0]) {
          setActiveSessionId(rest[0]);
          return "";
        }
      }

      if (!client) throw new Error("channel client not ready");
      const id = nextClientId();

      // Optimistic local append.
      setMessages((prev) => {
        const next: ChannelMsg[] = [
          ...prev,
          {
            id,
            from: "user",
            text: trimmed,
            ts: Date.now(),
            sessionId,
            file: opts?.file
              ? { url: URL.createObjectURL(opts.file), name: opts.file.name }
              : undefined,
          },
        ];
        persistMessages(storageRef.current, next);
        return next;
      });

      if (opts?.file) {
        await client.upload({ id, text: trimmed, sessionId, file: opts.file });
      } else {
        await client.send({ id, text: trimmed, sessionId });
      }
      return id;
    },
    [client, activeSessionId, setActiveSessionId],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    persistMessages(storageRef.current, []);
  }, []);

  const updateConfig = useCallback(
    (next: ChannelConfig) => {
      configRef.current = { ...next };
      onConfigChange?.(next);
      client?.updateConfig(next);
    },
    [client, onConfigChange],
  );

  const value = useMemo<ChannelContextValue>(
    () => ({
      client,
      state,
      error,
      activeSessionId,
      messages,
      pendingPermissions,
      send,
      clearMessages,
      setActiveSessionId,
      resolvePermission,
      updateConfig,
    }),
    [
      client,
      state,
      error,
      activeSessionId,
      messages,
      pendingPermissions,
      send,
      clearMessages,
      setActiveSessionId,
      resolvePermission,
      updateConfig,
    ],
  );

  return <ChannelContext.Provider value={value}>{children}</ChannelContext.Provider>;
}

export function useChannel(): ChannelContextValue {
  return useContext(ChannelContext);
}
