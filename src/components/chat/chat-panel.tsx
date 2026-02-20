"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useGateway, useChat, useAgents, useSessions } from "@/lib/gateway/hooks";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { AvatarAgentSelector } from "./avatar-agent-selector";
import { AgentSelector } from "./agent-selector";
import { SessionSwitcher } from "./session-switcher";
import { DropZone, useFileAttachments, attachmentToPayload } from "./file-attachments";
import { parseSessionKey, sessionDisplayName, type GatewaySession } from "@/lib/gateway/session-utils";
import { TaskMemo } from "./task-memo";
import { SessionSettings } from "@/components/settings/session-settings";

export interface ChatPanelProps {
  /** Panel id for focus management */
  panelId: string;
  /** Whether this panel is the active/focused one */
  isActive: boolean;
  /** Called when this panel gains focus */
  onFocus: () => void;
  /** Show header controls (agent selector, session switcher) */
  showHeader?: boolean;
}

export function ChatPanel({ panelId, isActive, onFocus, showHeader = true }: ChatPanelProps) {
  const { client, state, mainSessionKey } = useGateway();

  const storagePrefix = `awf:panel:${panelId}:`;

  const [sessionKey, setSessionKeyRaw] = useState<string | undefined>(undefined);
  const [agentId, setAgentId] = useState<string>(process.env.NEXT_PUBLIC_DEFAULT_AGENT || "default");

  // Load persisted panel state on mount (client only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedSession = localStorage.getItem(`${storagePrefix}sessionKey`) || undefined;
    const savedAgent = localStorage.getItem(`${storagePrefix}agentId`) || process.env.NEXT_PUBLIC_DEFAULT_AGENT || "default";
    setSessionKeyRaw(savedSession);
    setAgentId(savedAgent);
  }, [storagePrefix]);

  const setSessionKey = useCallback((key: string | undefined) => {
    setSessionKeyRaw(key);
    if (typeof window !== "undefined") {
      if (key) localStorage.setItem(`${storagePrefix}sessionKey`, key);
      else localStorage.removeItem(`${storagePrefix}sessionKey`);
    }
  }, [storagePrefix]);

  const effectiveSessionKey =
    sessionKey || (agentId ? `agent:${agentId}:main` : mainSessionKey) || undefined;

  const { messages, streaming, loading, sendMessage, addUserMessage, cancelQueued, abort } = useChat(effectiveSessionKey);
  const { agents } = useAgents();
  const { sessions, loading: sessionsLoading, refresh: refreshSessions } = useSessions();

  const { attachments, addFiles, removeAttachment, clearAttachments } = useFileAttachments();

  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Shortcuts (active panel only)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isActive) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSessionSwitcherOpen((prev) => !prev);
      }
      // Ctrl+N: new session(thread)
      if (e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        const threadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const newKey = `agent:${agentId}:main:thread:${threadId}`;
        setSessionKey(newKey);
        refreshSessions();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isActive, agentId, setSessionKey, refreshSessions]);

  // Focus textarea when panel becomes active
  useEffect(() => {
    if (isActive) {
      setTimeout(() => {
        const textarea = panelRef.current?.querySelector("textarea");
        textarea?.focus();
      }, 50);
    }
  }, [isActive]);

  const isConnected = state === "connected";

  const makeDefaultThreadLabel = useCallback((agent: string) => {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const hh = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    return `${agent}/작업-${mm}${dd}-${hh}${min}`;
  }, []);

  const summarizeLabelFromText = useCallback((text: string, agent: string) => {
    const clean = text
      .replace(/^\/(new|reset|status|help|reasoning|model\s+\S+)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return makeDefaultThreadLabel(agent);
    const snippet = clean.length > 28 ? `${clean.slice(0, 28)}…` : clean;
    return `${agent}/${snippet}`;
  }, [makeDefaultThreadLabel]);

  async function maybeAutoRenameThread(key: string | undefined, text: string) {
    if (!client || !isConnected || !key) return;
    const parsed = parseSessionKey(key);
    if (parsed.type !== "thread") return;

    const session = (sessions as GatewaySession[]).find((s) => s.key === key);
    const currentLabel = (session?.label || "").trim();
    const isAutoOrEmpty =
      !currentLabel ||
      /스레드\s*#|thread\s*#|^thread[:\s-]/i.test(currentLabel);

    if (!isAutoOrEmpty) return;

    try {
      const label = summarizeLabelFromText(text, parsed.agentId);
      await client.request("sessions.patch", { key, label });
      refreshSessions();
    } catch (err) {
      console.error("[AWF] auto-rename thread failed:", err);
    }
  }

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim().toLowerCase();

      // /stop — abort streaming
      if (trimmed === "/stop" || trimmed === "stop" || trimmed === "esc" || trimmed === "abort") {
        abort();
        return;
      }

      // /new, /reset — send to gateway, then refresh sessions
      if (trimmed === "/new" || trimmed === "/reset" || trimmed.startsWith("/new ") || trimmed.startsWith("/reset ")) {
        sendMessage(text);
        refreshSessions();
        return;
      }

      // /status, /reasoning, /model, /help — pass to gateway as chat.send
      if (trimmed === "/status" || trimmed === "/reasoning" || trimmed === "/help" ||
          trimmed.startsWith("/model ") || trimmed === "/model") {
        sendMessage(text);
        // Force quick metadata refresh for header badge (model/tokens)
        setTimeout(() => refreshSessions(), 400);
        setTimeout(() => refreshSessions(), 1200);
        return;
      }

      if (attachments.length > 0) {
        await maybeAutoRenameThread(effectiveSessionKey, text);
        const payloads = await Promise.all(attachments.map(attachmentToPayload));
        const userMsg = text || "";
        const displayAtts = attachments.map((att) => ({
          fileName: att.file.name,
          mimeType: att.file.type || "application/octet-stream",
          dataUrl: att.preview || undefined,
        }));
        addUserMessage(userMsg || "(첨부 파일)", displayAtts);
        if (client && isConnected) {
          try {
            await client.request("chat.send", {
              message: userMsg,
              idempotencyKey: `awf-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              sessionKey: effectiveSessionKey,
              attachments: payloads,
            });
          } catch (err) {
            console.error("[AWF] chat.send with attachments error:", err);
          }
        }
        clearAttachments();
      } else {
        await maybeAutoRenameThread(effectiveSessionKey, text);
        sendMessage(text);
      }
    },
    [attachments, client, isConnected, effectiveSessionKey, clearAttachments, sendMessage, addUserMessage, abort, refreshSessions, sessions, summarizeLabelFromText]
  );

  const handleAgentChange = (id: string | undefined) => {
    const newId = id || process.env.NEXT_PUBLIC_DEFAULT_AGENT || "default";
    setAgentId(newId);
    if (typeof window !== "undefined") {
      localStorage.setItem(`${storagePrefix}agentId`, newId);
    }
    setSessionKey(undefined);
  };

  const handleNewSession = async () => {
    // Generate a new thread session key
    const threadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const newKey = `agent:${agentId}:main:thread:${threadId}`;
    setSessionKey(newKey);

    // Pre-label the thread so it doesn't stay as #id
    if (client && isConnected) {
      try {
        await client.request("sessions.patch", {
          key: newKey,
          label: makeDefaultThreadLabel(agentId),
        });
      } catch {
        // ignore; it can still be auto-labeled on first message
      }
    }

    refreshSessions();
  };

  const handleRename = useCallback(
    async (key: string, label: string) => {
      if (!client || !isConnected) return;
      try {
        await client.request("sessions.patch", { key, label });
        await refreshSessions();
      } catch (err) {
        console.error("[AWF] sessions.patch error:", err);
      }
    },
    [client, isConnected, refreshSessions]
  );

  const handleDelete = useCallback(
    async (key: string) => {
      if (!client || !isConnected) return;
      try {
        await client.request("sessions.delete", { key });
        if (sessionKey === key) setSessionKey(undefined);
        await refreshSessions();
      } catch (err) {
        console.error("[AWF] sessions.delete error:", err);
      }
    },
    [client, isConnected, sessionKey, setSessionKey, refreshSessions]
  );

  const handleReset = useCallback(
    async (key: string) => {
      if (!client || !isConnected) return;
      try {
        await client.request("sessions.reset", { key });
        await refreshSessions();
      } catch (err) {
        console.error("[AWF] sessions.reset error:", err);
      }
    },
    [client, isConnected, refreshSessions]
  );

  // Derive agent from session key
  const parsedSession = effectiveSessionKey ? parseSessionKey(effectiveSessionKey) : null;
  const currentAgentId = parsedSession?.agentId || agentId;

  // Find current session metadata
  const currentSession = (sessions as GatewaySession[]).find(
    (s) => s.key === effectiveSessionKey || s.key === sessionKey
  );
  const tokenCount = currentSession?.totalTokens;
  const tokenStr = tokenCount != null && tokenCount > 0
    ? tokenCount >= 1_000_000
      ? `${(tokenCount / 1_000_000).toFixed(1)}M`
      : tokenCount >= 1_000
        ? `${(tokenCount / 1_000).toFixed(0)}k`
        : `${tokenCount}`
    : null;

  return (
    <div
      ref={panelRef}
      className="relative flex h-full flex-col bg-background"
      onClick={onFocus}
    >
      {/* Task Memo */}
      {effectiveSessionKey && (
        <TaskMemo key={effectiveSessionKey} sessionKey={effectiveSessionKey} messages={messages as unknown as Array<Record<string, unknown>>} />
      )}

      {/* Messages */}
      <DropZone onDrop={addFiles}>
        <MessageList messages={messages} loading={loading} streaming={streaming} onCancelQueued={cancelQueued} />
      </DropZone>

      {/* Input with integrated toolbar */}
      <ChatInput
        onSend={handleSend}
        onAbort={abort}
        streaming={streaming}
        disabled={!isConnected}
        attachments={attachments}
        onAttachFiles={addFiles}
        onRemoveAttachment={removeAttachment}
        panelId={panelId}
        toolbar={showHeader ? (
          <>
            <AvatarAgentSelector
              agents={agents}
              selectedId={currentAgentId}
              onSelect={handleAgentChange}
            />
            <SessionSettings
              sessionKey={effectiveSessionKey}
              onDelete={() => setSessionKey(undefined)}
              onReset={() => {
                refreshSessions();
              }}
            />
            <SessionSwitcher
              sessions={sessions as GatewaySession[]}
              currentKey={sessionKey}
              onSelect={setSessionKey}
              onNew={handleNewSession}
              onRename={handleRename}
              onDelete={handleDelete}
              onReset={handleReset}
              open={sessionSwitcherOpen}
              onOpenChange={setSessionSwitcherOpen}
              portalContainer={panelRef.current}
            />
            <div className="ml-auto flex items-center gap-2">
              {currentSession?.model && (
                <span className="text-[10px] text-muted-foreground" title={currentSession.model}>
                  {currentSession.model.split("/").pop()}
                </span>
              )}
              {tokenStr && (
                <span className="text-[10px] text-muted-foreground">{tokenStr} tokens</span>
              )}
            </div>
          </>
        ) : undefined}
      />
    </div>
  );
}
