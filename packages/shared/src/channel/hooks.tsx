/**
 * ChannelProvider / useChannel — React context for the Channel client.
 *
 * Replaces GatewayProvider / useGateway. Same surface shape where possible so
 * migrating components is mostly a rename.
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
} from "./protocol";

export const CHANNEL_CONFIG_STORAGE_KEY = "intelli-claw:channel-config";
export const DEFAULT_CHANNEL_URL = "http://127.0.0.1:8790";

interface ChannelContextValue {
  client: ChannelClient | null;
  state: ConnectionState;
  error: Error | null;
  activeSessionId: string;
  messages: ChannelMsg[];
  send: (text: string, opts?: { sessionId?: string; file?: File }) => Promise<string>;
  clearMessages: () => void;
  updateConfig: (next: ChannelConfig) => void;
}

const ChannelContext = createContext<ChannelContextValue>({
  client: null,
  state: "disconnected",
  error: null,
  activeSessionId: "main",
  messages: [],
  send: async () => "",
  clearMessages: () => {},
  updateConfig: () => {},
});

export interface ChannelProviderProps {
  url: string;
  token?: string;
  onConfigChange?: (next: ChannelConfig) => void;
  children: ReactNode;
}

export function ChannelProvider({
  url,
  token,
  onConfigChange,
  children,
}: ChannelProviderProps) {
  const [client, setClient] = useState<ChannelClient | null>(null);
  const [state, setState] = useState<ConnectionState>("disconnected");
  const [error, setError] = useState<Error | null>(null);
  const [activeSessionId, setActiveSessionId] = useState("main");
  const [messages, setMessages] = useState<ChannelMsg[]>([]);
  const configRef = useRef<ChannelConfig>({ url, token });

  const handleMessage = useCallback<MessageHandler>((frame: ChannelWire) => {
    switch (frame.type) {
      case "msg":
        setMessages((prev) => [...prev, frame]);
        break;
      case "edit":
        setMessages((prev) =>
          prev.map((m) => (m.id === frame.id ? { ...m, text: frame.text } : m)),
        );
        break;
      case "session":
        setActiveSessionId(frame.sessionId);
        break;
    }
  }, []);

  useEffect(() => {
    const c = new ChannelClient(configRef.current);
    const unsubState = c.onStateChange((s, err) => {
      setState(s);
      setError(err ?? null);
    });
    const unsubMsg = c.onMessage(handleMessage);
    c.connect();
    setClient(c);

    void c
      .fetchInfo()
      .then((info) => setActiveSessionId(info.activeSessionId))
      .catch(() => {});

    return () => {
      unsubState();
      unsubMsg();
      c.disconnect();
      setClient(null);
    };
  }, [handleMessage]);

  const send = useCallback(
    async (text: string, opts?: { sessionId?: string; file?: File }) => {
      if (!client) throw new Error("channel client not ready");
      const id = nextClientId();
      const sessionId = opts?.sessionId ?? activeSessionId;
      // Optimistic local append.
      setMessages((prev) => [
        ...prev,
        {
          id,
          from: "user",
          text,
          ts: Date.now(),
          sessionId,
          file: opts?.file
            ? { url: URL.createObjectURL(opts.file), name: opts.file.name }
            : undefined,
        },
      ]);
      if (opts?.file) {
        await client.upload({ id, text, sessionId, file: opts.file });
      } else {
        await client.send({ id, text, sessionId });
      }
      return id;
    },
    [client, activeSessionId],
  );

  const clearMessages = useCallback(() => setMessages([]), []);

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
      send,
      clearMessages,
      updateConfig,
    }),
    [client, state, error, activeSessionId, messages, send, clearMessages, updateConfig],
  );

  return <ChannelContext.Provider value={value}>{children}</ChannelContext.Provider>;
}

export function useChannel(): ChannelContextValue {
  return useContext(ChannelContext);
}
