/**
 * useClaudeCode — React hook for Claude Code webchat channel.
 *
 * Connects to the webchat channel plugin's WebSocket,
 * receives replies from a live Claude Code session.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ClaudeCodeClient, type BridgeStatus, type WebChatEvent } from "./client";
import type { DisplayMessage, AgentStatus } from "@intelli-claw/shared";

interface UseClaudeCodeOptions {
  wsUrl?: string;
  autoConnect?: boolean;
}

interface UseClaudeCodeReturn {
  messages: DisplayMessage[];
  status: BridgeStatus;
  streaming: boolean;
  agentStatus: AgentStatus;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (text: string) => void;
  clearMessages: () => void;
}

function getDefaultWsUrl(): string {
  const port = import.meta.env.VITE_WEBCHAT_PORT || "4003";

  // Electron: file:// protocol, no host — connect directly to plugin
  if ("electronAPI" in window || window.location.protocol === "file:") {
    return `ws://127.0.0.1:${port}`;
  }

  // Web: use Vite proxy to avoid HTTPS/ws mixed content
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/claude-code`;
}

export function useClaudeCode(options: UseClaudeCodeOptions = {}): UseClaudeCodeReturn {
  const { wsUrl, autoConnect = false } = options;

  const clientRef = useRef<ClaudeCodeClient | null>(null);
  const messagesRef = useRef<DisplayMessage[]>([]);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [status, setStatus] = useState<BridgeStatus>("disconnected");
  const [streaming, setStreaming] = useState(false);

  const handleEvent = useCallback((event: WebChatEvent) => {
    if (event.type === "assistant" && event.content) {
      // Claude replied via the `reply` MCP tool
      const msg: DisplayMessage = {
        id: event.id || `cc-${Date.now()}`,
        role: "assistant",
        content: event.content,
        timestamp: event.timestamp || new Date().toISOString(),
        toolCalls: [],
      };
      messagesRef.current = [...messagesRef.current, msg];
      setMessages(messagesRef.current);
      setStreaming(false);
    }
  }, []);

  const connect = useCallback(() => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }

    const url = wsUrl || getDefaultWsUrl();
    const client = new ClaudeCodeClient(url);

    client.onEvent(handleEvent);
    client.onStatusChange((s) => setStatus(s));

    client.connect();
    clientRef.current = client;
  }, [wsUrl, handleEvent]);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current = null;
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return;

    // Add user message to display
    const userMsg: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      toolCalls: [],
    };
    messagesRef.current = [...messagesRef.current, userMsg];
    setMessages(messagesRef.current);
    setStreaming(true);

    clientRef.current?.sendMessage(text);
  }, []);

  const clearMessages = useCallback(() => {
    messagesRef.current = [];
    setMessages([]);
    setStreaming(false);
  }, []);

  useEffect(() => {
    if (autoConnect) connect();
    return () => disconnect();
  }, [autoConnect, connect, disconnect]);

  return {
    messages,
    status,
    streaming,
    agentStatus: streaming ? { phase: "writing" } : { phase: "idle" },
    connect,
    disconnect,
    sendMessage,
    clearMessages,
  };
}
