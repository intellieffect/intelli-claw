/**
 * React context that owns the singleton ChatStateManager and binds it
 * to the current GatewayClient connection.
 */
import React, { createContext, useContext, useEffect, useRef } from "react";
import { useGateway } from "@intelli-claw/shared";
import { ChatStateManager } from "./chatStateManager";

const ChatStateContext = createContext<ChatStateManager>(null!);

export function ChatStateProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const manager = useRef(new ChatStateManager()).current;
  const { client, state } = useGateway();

  useEffect(() => {
    if (client && state === "connected") {
      manager.bind(client);
      return () => manager.unbind();
    }
  }, [client, state, manager]);

  return (
    <ChatStateContext.Provider value={manager}>
      {children}
    </ChatStateContext.Provider>
  );
}

export function useChatStateManager(): ChatStateManager {
  return useContext(ChatStateContext);
}
