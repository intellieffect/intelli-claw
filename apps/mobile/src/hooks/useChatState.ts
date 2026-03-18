/**
 * Thin subscription hook — connects a React component to a single session
 * inside the central ChatStateManager via useSyncExternalStore.
 */
import { useEffect, useSyncExternalStore } from "react";
import { useGateway, createToolStreamRefs } from "@intelli-claw/shared";
import { useChatStateManager } from "../stores/ChatStateProvider";
import type { ChatState } from "../stores/chatStateManager";

const DEFAULT_STATE: ChatState = {
  messages: [],
  streaming: false,
  agentStatus: { phase: "idle" },
  loading: false,
  streamRefs: createToolStreamRefs(),
  runId: null,
  historyLoaded: false,
  lastAccessedAt: 0,
};

const NOOP = () => () => {};

export function useChatState(sessionKey?: string): ChatState {
  const manager = useChatStateManager();
  const { client, state: gwState } = useGateway();

  const chatState = useSyncExternalStore(
    (onStoreChange) =>
      sessionKey ? manager.subscribe(sessionKey, onStoreChange) : NOOP(),
    () => (sessionKey ? manager.getState(sessionKey) : DEFAULT_STATE),
  );

  // Lazy history load — runs once per session when connected
  useEffect(() => {
    if (sessionKey && client && gwState === "connected") {
      manager.loadHistory(client, sessionKey);
    }
  }, [sessionKey, client, gwState, manager]);

  return chatState;
}
