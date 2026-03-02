
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useGateway, useChat, useAgents, useSessions } from "@/lib/gateway/hooks";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { AvatarAgentSelector } from "./avatar-agent-selector";
import { AgentSelector } from "./agent-selector";
import { SessionSwitcher } from "./session-switcher";
import { AgentBrowser } from "./agent-browser";
import { DropZone, useFileAttachments, attachmentToPayload } from "./file-attachments";
import { parseSessionKey, sessionDisplayName, type GatewaySession } from "@/lib/gateway/session-utils";
import { isSessionHidden, hideSession } from "@/lib/gateway/hidden-sessions";
import { TaskMemo } from "./task-memo";
import { SessionSettings } from "@/components/settings/session-settings";
import { ChatHeader } from "./chat-header";
import { matchesShortcutId } from "@/lib/shortcuts";
import { windowStoragePrefix } from "@/lib/utils";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { useKeyboardHeight } from "@/lib/hooks/use-keyboard-height";
import { NewSessionPicker, AgentManager } from "@/components/settings/agent-manager";
import { SessionManagerPanel } from "./session-manager-panel";
import { TopicHistory } from "./topic-history";

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
  const isMobile = useIsMobile();
  const keyboardHeight = useKeyboardHeight();

  const storagePrefix = `awf:${windowStoragePrefix()}panel:${panelId}:`;

  const [sessionKey, setSessionKeyRaw] = useState<string | undefined>(undefined);
  const [agentId, setAgentId] = useState<string>(import.meta.env.VITE_DEFAULT_AGENT || "default");

  // Load persisted panel state on mount (client only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedSession = localStorage.getItem(`${storagePrefix}sessionKey`) || undefined;
    const savedAgent = localStorage.getItem(`${storagePrefix}agentId`) || import.meta.env.VITE_DEFAULT_AGENT || "default";
    setSessionKeyRaw(savedSession);
    setAgentId(savedAgent);
  }, [storagePrefix]);

  const setSessionKey = useCallback((key: string | undefined) => {
    setSessionKeyRaw(key);
    if (typeof window !== "undefined") {
      if (key) localStorage.setItem(`${storagePrefix}sessionKey`, key);
      else localStorage.removeItem(`${storagePrefix}sessionKey`);
    }
    // Sync agentId from session key
    if (key) {
      const parsed = parseSessionKey(key);
      if (parsed.agentId && parsed.agentId !== "unknown") {
        setAgentId(parsed.agentId);
        if (typeof window !== "undefined") {
          localStorage.setItem(`${storagePrefix}agentId`, parsed.agentId);
        }
      }
    }
  }, [storagePrefix]);

  const effectiveSessionKey =
    sessionKey || (agentId ? `agent:${agentId}:main` : mainSessionKey) || undefined;

  const { messages, streaming, loading, agentStatus, sendMessage, sendCommand, addUserMessage, addLocalMessage, cancelQueued, abort, sendContextBridge } = useChat(effectiveSessionKey);
  const { agents } = useAgents();
  const { sessions, loading: sessionsLoading, refresh: refreshSessions, patchSession } = useSessions();

  const { attachments, addFiles, removeAttachment, clearAttachments } = useFileAttachments();

  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const [agentBrowserOpen, setAgentBrowserOpen] = useState(false);
  const [newSessionPickerOpen, setNewSessionPickerOpen] = useState(false);
  const [agentManagerOpen, setAgentManagerOpen] = useState(false);
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false);
  const [topicHistoryOpen, setTopicHistoryOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Build ordered session list for current agent (matches header tab order: main first, then by updatedAt desc)
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const agentSessions = useMemo(() => {
    return (sessions as GatewaySession[])
      .filter((s) => {
        const p = parseSessionKey(s.key);
        if (p.agentId !== agentId) return false;
        if (p.type !== "main" && p.type !== "thread") return false;
        // Hide hidden sessions (main always visible)
        if (p.type !== "main" && isSessionHidden(s.key)) return false;
        return true;
      })
      .sort((a, b) => {
        const aType = parseSessionKey(a.key).type;
        const bType = parseSessionKey(b.key).type;
        if (aType === "main" && bType !== "main") return -1;
        if (bType === "main" && aType !== "main") return 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, agentId, hiddenVersion]);

  // Restore focus to this panel's textarea
  const refocusPanel = useCallback(() => {
    setTimeout(() => {
      const textarea = panelRef.current?.querySelector("textarea");
      textarea?.focus();
    }, 120);
  }, []);

  const isConnected = state === "connected";

  const handleDelete = useCallback(
    async (key: string) => {
      if (!client || !isConnected) return;
      try {
        await client.request("sessions.delete", { key });
        if (sessionKey === key) setSessionKey(undefined);
        await refreshSessions();
      } catch (err) {
        console.error("[AWF] sessions.delete error:", err);
      } finally {
        refocusPanel();
      }
    },
    [client, isConnected, sessionKey, setSessionKey, refreshSessions, refocusPanel]
  );

  // Shortcuts (active panel only)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isActive) return;
      if (matchesShortcutId(e, "session-switcher")) {
        e.preventDefault();
        setSessionSwitcherOpen((prev) => !prev);
      }
      if (matchesShortcutId(e, "new-session")) {
        e.preventDefault();
        setNewSessionPickerOpen(true);
      }
      if (matchesShortcutId(e, "agent-browser")) {
        e.preventDefault();
        setAgentBrowserOpen((prev) => !prev);
      }
      if (matchesShortcutId(e, "abort-stream") && streaming) {
        e.preventDefault();
        abort();
      }
      // Cmd+T: create new session tab
      if (matchesShortcutId(e, "new-tab")) {
        e.preventDefault();
        createSessionForAgent(agentId);
        return;
      }
      // Cmd+1~9: switch to specific tab (9 = last tab)
      if (e.key >= "1" && e.key <= "9" && matchesShortcutId(e, `switch-tab-${e.key}`)) {
        e.preventDefault();
        const idx = e.key === "9" ? agentSessions.length - 1 : parseInt(e.key) - 1;
        if (idx >= 0 && idx < agentSessions.length) {
          setSessionKey(agentSessions[idx].key);
        }
        return;
      }
      // '/' — focus chat input (only when not already in an input/textarea)
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA" && !(e.target as HTMLElement).isContentEditable) {
          e.preventDefault();
          const textarea = panelRef.current?.querySelector("textarea");
          textarea?.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);

    // Tab/Shift+Tab: capture phase to intercept before browser focus navigation
    function handleTab(e: KeyboardEvent) {
      if (!isActive) return;
      if (!(matchesShortcutId(e, "next-session") || matchesShortcutId(e, "prev-session"))) return;
      if (agentSessions.length <= 1) return;
      const target = e.target as HTMLElement;
      if (!target.closest("[data-chat-panel]")) return;
      e.preventDefault();
      e.stopPropagation();
      const currentIdx = agentSessions.findIndex((s) => s.key === effectiveSessionKey);
      const delta = matchesShortcutId(e, "prev-session") ? -1 : 1;
      const nextIdx = (currentIdx + delta + agentSessions.length) % agentSessions.length;
      setSessionKey(agentSessions[nextIdx].key);
    }
    document.addEventListener("keydown", handleTab, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("keydown", handleTab, true);
    };
  }, [isActive, agentId, setSessionKey, refreshSessions, agentSessions, effectiveSessionKey, streaming, abort, sessions, handleDelete]);

  // Focus textarea when panel becomes active
  useEffect(() => {
    if (isActive) refocusPanel();
  }, [isActive, refocusPanel]);

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
      .replace(/^\/(new|reset|status|help|reasoning|model\s+\S+|think\S*|verbose\S*)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!clean) return makeDefaultThreadLabel(agent);
    const snippet = clean.length > 40 ? `${clean.slice(0, 38)}…` : clean;
    return `${agent}/${snippet}`;
  }, [makeDefaultThreadLabel]);

  async function maybeAutoLabelSession(key: string | undefined, text: string) {
    if (!client || !isConnected || !key) return;
    const parsed = parseSessionKey(key);
    // Only auto-label main and thread sessions
    if (parsed.type !== "thread" && parsed.type !== "main") return;

    const session = (sessions as GatewaySession[]).find((s) => s.key === key);
    const currentLabel = (session?.label || "").trim();
    const isAutoOrEmpty =
      !currentLabel ||
      /스레드\s*#|thread\s*#|^thread[:\s-]|작업-\d{4}/i.test(currentLabel);

    if (!isAutoOrEmpty) return;

    // Skip slash commands
    const clean = text.replace(/^\/(new|reset|status|help|reasoning|model\s+\S+|think\S*|verbose\S*)\b/gi, "").trim();
    if (!clean) return;

    try {
      const label = summarizeLabelFromText(clean, parsed.agentId);
      await client.request("sessions.patch", { key, label });
      refreshSessions();
    } catch (err) {
      console.error("[AWF] auto-label session failed:", err);
    }
  }

  const handleStatusCommand = useCallback(async () => {
    if (!client || !isConnected) return;
    try {
      const res = await client.request<{
        sessions: {
          recent: Array<{
            key: string;
            agentId: string;
            model: string;
            inputTokens: number;
            outputTokens: number;
            totalTokens: number;
            contextTokens: number;
            percentUsed: number;
            updatedAt: number;
          }>;
        };
      }>("status");
      const s = res?.sessions?.recent?.find(
        (s) => s.key === effectiveSessionKey
      );
      if (!s) {
        addLocalMessage("⚠️ 세션 정보를 찾을 수 없습니다.", "system");
        return;
      }
      const agent = agents.find((a) => a.id === s.agentId);
      const name = agent?.name || s.agentId;
      const ver = client.serverVersion || "dev";
      const commit = client.serverCommit ? ` (${client.serverCommit.slice(0, 7)})` : "";
      const fmtTokens = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}m` : n >= 1_000 ? `${(n / 1_000).toFixed(0)}k` : String(n);
      const diff = Date.now() - s.updatedAt;
      const ago = diff < 60_000 ? "just now" : diff < 3_600_000 ? `${Math.floor(diff / 60_000)}m ago` : diff < 86_400_000 ? `${Math.floor(diff / 3_600_000)}h ago` : `${Math.floor(diff / 86_400_000)}d ago`;

      const lines = [
        `**${name}**`,
        ``,
        `🌱 OpenClaw ${ver}${commit}`,
        `🧠 Model: \`${s.model}\``,
        `🔢 Tokens: ${s.inputTokens} in / ${s.outputTokens} out`,
        `🧮 Context: ${fmtTokens(s.totalTokens)}/${fmtTokens(s.contextTokens)} (${s.percentUsed}%)`,
        `📋 Session: \`${s.key}\` · ${ago}`,
        `⚙️ Runtime: direct · Think: low`,
      ];
      addLocalMessage(lines.join("\n\n"), "assistant");
    } catch (err) {
      console.error("[intelli-claw] /status failed:", err);
      addLocalMessage("⚠️ 상태 조회에 실패했습니다.", "system");
    }
  }, [client, isConnected, effectiveSessionKey, agents, addLocalMessage]);

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim().toLowerCase();

      // /stop — abort streaming
      if (trimmed === "/stop" || trimmed === "stop" || trimmed === "esc" || trimmed === "abort") {
        abort();
        return;
      }

      // --- Group A: Local-only commands (no gateway call) ---

      // /status — show session status locally
      if (trimmed === "/status") {
        addLocalMessage(text, "user");
        handleStatusCommand();
        return;
      }

      // /help — show help table locally
      if (trimmed === "/help") {
        addLocalMessage(text, "user");
        const helpLines = [
          "**사용 가능한 명령어**",
          "",
          "| 명령어 | 설명 |",
          "|--------|------|",
          "| `/status` | 현재 세션 상태 표시 |",
          "| `/model` | 현재 모델 표시 |",
          "| `/model <name>` | 모델 변경 |",
          "| `/new` | 새 스레드 생성 |",
          "| `/reset` | 세션 초기화 |",
          "| `/reasoning <level>` | 추론 레벨 변경 |",
          "| `/stop` | 스트리밍 중단 |",
        ];
        addLocalMessage(helpLines.join("\n"), "assistant");
        return;
      }

      // /model (no args) — show current model locally
      if (trimmed === "/model") {
        addLocalMessage(text, "user");
        const sess = (sessions as GatewaySession[]).find((s) => s.key === effectiveSessionKey || s.key === sessionKey);
        const model = sess?.model || "unknown";
        addLocalMessage(`현재 모델: \`${model}\``, "assistant");
        return;
      }

      // --- Group B: Settings change (no streaming needed) ---

      // /model <name> — optimistic update via sessions.patch
      if (trimmed.startsWith("/model ")) {
        const modelArg = text.trim().slice(7).trim();
        addLocalMessage(text, "user");
        if (modelArg && client && isConnected) {
          if (effectiveSessionKey) {
            patchSession(effectiveSessionKey, { model: modelArg });
          }
          try {
            await client.request("sessions.patch", { key: effectiveSessionKey, model: modelArg });
            addLocalMessage(`모델을 \`${modelArg}\`(으)로 변경했습니다.`, "assistant");
          } catch (err) {
            console.error("[AWF] model patch error:", err);
            addLocalMessage("모델 변경에 실패했습니다.", "system");
          }
          refreshSessions();
        }
        return;
      }

      // --- Group C: Gateway commands (agent may or may not respond) ---
      // Use sendCommand instead of sendMessage to avoid force-setting streaming=true.
      // If gateway starts an agent run, event handlers set streaming naturally.

      // /new, /reset
      if (trimmed === "/new" || trimmed === "/reset" || trimmed.startsWith("/new ") || trimmed.startsWith("/reset ")) {
        addLocalMessage(text, "user");
        sendCommand(text);
        refreshSessions();
        return;
      }

      // /reasoning*, /think*, /verbose*
      if (/^\/(reasoning|think|verbose)\b/.test(trimmed)) {
        addLocalMessage(text, "user");
        sendCommand(text);
        setTimeout(() => refreshSessions(), 400);
        return;
      }

      if (attachments.length > 0) {
        await maybeAutoLabelSession(effectiveSessionKey, text);

        // Separate PDFs with absolute paths (send path to agent) from other attachments
        const pdfPathHints: string[] = [];
        const nonPdfAttachments = attachments.filter((att) => {
          if (att.filePath && (att.file.type === "application/pdf" || att.file.name.toLowerCase().endsWith(".pdf"))) {
            pdfPathHints.push(`📎 [PDF: ${att.file.name}] ${att.filePath}`);
            return false; // exclude from base64 payload
          }
          return true;
        });

        // Convert remaining attachments (images, etc.) to base64 payloads
        const results = await Promise.all(nonPdfAttachments.map(attachmentToPayload));
        const payloads = results.flatMap((r) => r.payloads);
        const pdfTexts = results.map((r) => r.prependText).filter(Boolean).join("\n\n");
        const pathHintText = pdfPathHints.join("\n");
        const userMsg = [text, pathHintText, pdfTexts].filter(Boolean).join("\n\n") || (payloads.length > 0 ? "(image)" : "");

        const displayAtts = await Promise.all(
          attachments.map(async (att) => {
            const ext = att.file.name.split(".").pop()?.toLowerCase();
            let textContent: string | undefined;
            if (ext === "md" || ext === "mdx") {
              try { textContent = await att.file.text(); } catch {}
            }
            return {
              fileName: att.file.name,
              mimeType: att.file.type || "application/octet-stream",
              dataUrl: att.preview || undefined,
              downloadUrl: att.filePath || undefined,
              textContent,
            };
          })
        );
        addUserMessage(text || "(첨부 파일)", displayAtts);
        if (client && isConnected) {
          // Send all attachments in a single request.
          // If the single request fails (e.g. payload too large), fall back to
          // sending each attachment individually with a descriptive message.
          try {
            await client.request("chat.send", {
              message: userMsg,
              idempotencyKey: `awf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              sessionKey: effectiveSessionKey,
              attachments: payloads,
            });
          } catch (bulkErr) {
            console.warn("[AWF] bulk chat.send failed, falling back to sequential:", bulkErr);
            try {
              for (let i = 0; i < payloads.length; i++) {
                await client.request("chat.send", {
                  message: i === 0 ? (userMsg || `(첨부 ${i + 1}/${payloads.length})`) : `(첨부 ${i + 1}/${payloads.length})`,
                  idempotencyKey: `awf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  sessionKey: effectiveSessionKey,
                  attachments: [payloads[i]],
                });
              }
            } catch (err) {
              console.error("[AWF] sequential send error:", err);
              abort();
            }
          }
        }
        clearAttachments();
      } else {
        await maybeAutoLabelSession(effectiveSessionKey, text);
        sendMessage(text);
      }
    },
    [attachments, client, isConnected, effectiveSessionKey, sessionKey, clearAttachments, sendMessage, sendCommand, addUserMessage, addLocalMessage, handleStatusCommand, patchSession, abort, refreshSessions, sessions, summarizeLabelFromText]
  );

  const handleAgentChange = (id: string | undefined) => {
    const newId = id || import.meta.env.VITE_DEFAULT_AGENT || "default";
    setAgentId(newId);
    if (typeof window !== "undefined") {
      localStorage.setItem(`${storagePrefix}agentId`, newId);
    }
    setSessionKey(undefined);
  };

    const handleNewSession = () => {
    createSessionForAgent(agentId);
  };

  const createSessionForAgent = async (selectedAgentId: string) => {
    const threadId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const newKey = `agent:${selectedAgentId}:main:thread:${threadId}`;

    // Switch agent context if different
    if (selectedAgentId !== agentId) {
      setAgentId(selectedAgentId);
      if (typeof window !== "undefined") {
        localStorage.setItem(`${storagePrefix}agentId`, selectedAgentId);
      }
    }

    setSessionKey(newKey);

    // Pre-label the thread
    if (client && isConnected) {
      try {
        await client.request("sessions.patch", {
          key: newKey,
          label: makeDefaultThreadLabel(selectedAgentId),
        });
      } catch {
        // ignore; auto-labeled on first message
      }
    }

    refreshSessions();
    refocusPanel();
  };

  const handleRename = useCallback(
    async (key: string, label: string) => {
      if (!client || !isConnected) return;
      try {
        await client.request("sessions.patch", { key, label });
        await refreshSessions();
      } catch (err) {
        console.error("[AWF] sessions.patch error:", err);
      } finally {
        refocusPanel();
      }
    },
    [client, isConnected, refreshSessions, refocusPanel]
  );

  const handleReset = useCallback(
    async (key: string) => {
      if (!client || !isConnected) return;
      try {
        await client.request("sessions.reset", { key });
        await refreshSessions();
      } catch (err) {
        console.error("[AWF] sessions.reset error:", err);
      } finally {
        refocusPanel();
      }
    },
    [client, isConnected, refreshSessions, refocusPanel]
  );

  const handleHide = useCallback(
    (_key: string) => {
      // Trigger re-render of agentSessions and refresh sessions list
      setHiddenVersion((v) => v + 1);
      refreshSessions();
    },
    [refreshSessions],
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
      data-chat-panel
      className="relative flex h-full flex-col bg-background"
      style={isMobile && keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : undefined}
      onClick={onFocus}
    >
      {/* Chat Header — agent name + topic */}
      {showHeader && effectiveSessionKey && (
        <ChatHeader
          sessionKey={effectiveSessionKey}
          agents={agents}
          sessions={sessions as unknown as Array<Record<string, unknown>>}
          messages={messages as unknown as Array<Record<string, unknown>>}
          agentStatus={agentStatus}
          onSelectSession={setSessionKey}
          onNewSession={handleNewSession}
          onDeleteSession={(key) => handleDelete(key)}
          onHideSession={handleHide}
          onRenameSession={(key, label) => handleRename(key, label)}
          onOpenSessionManager={() => setSessionManagerOpen(true)}
          onOpenTopicHistory={() => setTopicHistoryOpen(true)}
        />
      )}

      {/* Task Memo */}
      {effectiveSessionKey && (
        <TaskMemo key={effectiveSessionKey} sessionKey={effectiveSessionKey} messages={messages as unknown as Array<Record<string, unknown>>} />
      )}

      {/* Messages */}
      <DropZone onDrop={addFiles}>
        <MessageList
          messages={messages}
          loading={loading}
          streaming={streaming}
          onCancelQueued={cancelQueued}
          agentId={currentAgentId}
          agentStatus={agentStatus}
          onLoadPreviousContext={sendContextBridge}
          onOpenTopicHistory={() => setTopicHistoryOpen(true)}
        />
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
        toolbar={undefined}
        model={currentSession?.model ? String(currentSession.model) : undefined}
        tokenStr={tokenStr || undefined}
        tokenPercent={(currentSession as any)?.percentUsed as number | undefined}
      />

      {/* New Session Picker */}
      <NewSessionPicker
        open={newSessionPickerOpen}
        onClose={() => setNewSessionPickerOpen(false)}
        onSelect={createSessionForAgent}
        onManageAgents={() => setAgentManagerOpen(true)}
      />

      {/* Agent Manager */}
      <AgentManager
        open={agentManagerOpen}
        onClose={() => setAgentManagerOpen(false)}
      />

      {/* Session Manager Panel */}
      <SessionManagerPanel
        open={sessionManagerOpen}
        onClose={() => setSessionManagerOpen(false)}
        agents={agents}
        sessions={sessions as any}
        currentSessionKey={effectiveSessionKey}
        onSelectSession={(key) => { setSessionKey(key); setSessionManagerOpen(false); }}
        onDeleteSession={async (key) => { await handleDelete(key); }}
        onResetSession={async (key) => { await handleReset(key); }}
      />

      {/* Topic History Panel */}
      {effectiveSessionKey && (
        <TopicHistory
          sessionKey={effectiveSessionKey}
          open={topicHistoryOpen}
          onClose={() => setTopicHistoryOpen(false)}
          portalContainer={panelRef.current}
        />
      )}

      {/* Session Switcher (Cmd+K) */}
      {sessionSwitcherOpen && (
        <SessionSwitcher
          sessions={sessions}
          currentKey={effectiveSessionKey}
          onSelect={(key) => { setSessionKey(key); setSessionSwitcherOpen(false); }}
          onNew={handleNewSession}
          onRename={handleRename}
          onDelete={handleDelete}
          onReset={handleReset}
          onHide={handleHide}
          open={sessionSwitcherOpen}
          onOpenChange={setSessionSwitcherOpen}
          portalContainer={panelRef.current}
        />
      )}

      {/* Agent Browser (Cmd+O) */}
      {agentBrowserOpen && (
        <AgentBrowser
          sessions={sessions}
          currentKey={effectiveSessionKey}
          onSelect={(key) => { setSessionKey(key); setAgentBrowserOpen(false); }}
          open={agentBrowserOpen}
          onOpenChange={setAgentBrowserOpen}
          portalContainer={panelRef.current}
        />
      )}
    </div>
  );
}
