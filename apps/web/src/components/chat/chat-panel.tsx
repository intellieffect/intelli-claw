
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useGateway, useChat, useAgents, useSessions } from "@/lib/gateway/hooks";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { AvatarAgentSelector } from "./avatar-agent-selector";
import { AgentSelector } from "./agent-selector";
import { SessionSwitcher } from "./session-switcher";
import { AgentBrowser } from "./agent-browser";
import { DropZone, useFileAttachments, attachmentToPayload } from "./file-attachments";
import { parseSessionKey, sessionDisplayName, type GatewaySession, isTopicClosed, isTopicSession, CLOSED_PREFIX, getCleanLabel } from "@/lib/gateway/session-utils";
import { getTopicCount } from "@/lib/gateway/topic-store";
import { isSessionHidden, hideSession, unhideSession, getHiddenSessions } from "@/lib/gateway/hidden-sessions";
import { getLocalMessages } from "@/lib/gateway/message-store";
import { generateTopicSummary } from "@/lib/gateway/topic-summary";
import { markSessionEnded } from "@/lib/gateway/topic-store";

import { SessionSettings } from "@/components/settings/session-settings";
import { ChatHeader } from "./chat-header";
import { matchesShortcutId } from "@/lib/shortcuts";
import { windowStoragePrefix } from "@/lib/utils";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { useKeyboardHeight } from "@/lib/hooks/use-keyboard-height";
import { useSwipeGesture, getNextAgentIndex, getNextTopicIndex, useSwipeMode } from "@/lib/hooks/use-swipe-gesture";
import { NewSessionPicker, AgentManager } from "@/components/settings/agent-manager";
import { SessionManagerPanel } from "./session-manager-panel";
import { TopicHistory } from "./topic-history";
import { TopicNameDialog } from "./topic-name-dialog";
import { resolveInitialSessionState, getRememberedSessionForAgent } from "@/lib/session-continuity";
import { platform } from "@/lib/platform";

export interface ChatPanelProps {
  /** Show header controls (agent selector, session switcher) */
  showHeader?: boolean;
}

export function ChatPanel({ showHeader = true }: ChatPanelProps) {
  const { client, state, mainSessionKey } = useGateway();
  const isMobile = useIsMobile();
  const keyboardHeight = useKeyboardHeight();

  const storagePrefix = `awf:${windowStoragePrefix()}`;

  const [sessionKey, setSessionKeyRaw] = useState<string | undefined>(undefined);
  const [agentId, setAgentId] = useState<string>(import.meta.env.VITE_DEFAULT_AGENT || "default");

  // Load persisted state on mount (client only)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const initial = resolveInitialSessionState({
      windowPrefix: windowStoragePrefix(),
      defaultAgentId: import.meta.env.VITE_DEFAULT_AGENT || "default",
      getItem: (k) => localStorage.getItem(k),
      urlSearch: window.location.search,
    });
    setSessionKeyRaw(initial.sessionKey);
    setAgentId(initial.agentId);
  }, []);

  const setSessionKey = useCallback((key: string | undefined) => {
    setSessionKeyRaw(key);
    if (typeof window !== "undefined") {
      if (key) {
        localStorage.setItem(`${storagePrefix}sessionKey`, key);
        const parsed = parseSessionKey(key);
        if (parsed.agentId && parsed.agentId !== "unknown") {
          localStorage.setItem(`awf:lastSessionKey:${parsed.agentId}`, key);
        }
      } else {
        localStorage.removeItem(`${storagePrefix}sessionKey`);
      }
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

  // Report active session to Electron main process for Cmd+N duplication (#170)
  useEffect(() => {
    if (typeof window === "undefined" || !effectiveSessionKey) return;
    const api = (window as Record<string, unknown>).electronAPI as
      | { updateSessionKey?: (key: string) => void }
      | undefined;
    api?.updateSessionKey?.(effectiveSessionKey);
  }, [effectiveSessionKey]);

  const { messages, streaming, loading, agentStatus, sendMessage, sendCommand, addUserMessage, addLocalMessage, clearMessages, cancelQueued, abort, sendContextBridge, replyingTo, setReplyTo, clearReplyTo } = useChat(effectiveSessionKey);
  const { agents } = useAgents();
  const { sessions, loading: sessionsLoading, refresh: refreshSessions, patchSession } = useSessions();

  const { attachments, addFiles, removeAttachment, clearAttachments } = useFileAttachments();

  // Build ordered session list for current agent (matches header tab order: main first, then by updatedAt desc)
  // NOTE: Must be declared before swipe handlers to avoid TDZ in production builds
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const agentSessions = useMemo(() => {
    return (sessions as GatewaySession[])
      .filter((s) => {
        const p = parseSessionKey(s.key);
        if (p.agentId !== agentId) return false;
        if (p.type !== "main" && p.type !== "thread") return false;
        // Hide hidden sessions (main always visible)
        if (p.type !== "main" && isSessionHidden(s.key)) return false;
        // Hide closed topics from tab bar
        if (isTopicClosed(s)) return false;
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

  const handleAgentChange = useCallback((id: string | undefined) => {
    const newId = id || import.meta.env.VITE_DEFAULT_AGENT || "default";
    setAgentId(newId);
    if (typeof window !== "undefined") {
      localStorage.setItem(`${storagePrefix}agentId`, newId);
      const remembered = getRememberedSessionForAgent({
        agentId: newId,
        getItem: (k) => localStorage.getItem(k),
      });
      setSessionKey(remembered || undefined);
      return;
    }
    setSessionKey(undefined);
  }, [storagePrefix, setSessionKey]);

  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const [agentBrowserOpen, setAgentBrowserOpen] = useState(false);
  const [newSessionPickerOpen, setNewSessionPickerOpen] = useState(false);
  const [agentManagerOpen, setAgentManagerOpen] = useState(false);
  const [sessionManagerOpen, setSessionManagerOpen] = useState(false);
  const [topicHistoryOpen, setTopicHistoryOpen] = useState(false);
  const [topicNameDialogOpen, setTopicNameDialogOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Swipe mode: agent vs topic
  const [swipeMode, setSwipeModeValue] = useSwipeMode(agents.length);

  // Swipe gesture for mobile agent/topic switching
  const handleSwipeLeft = useCallback(() => {
    if (swipeMode === "topic") {
      // 토픽 간 전환
      if (agentSessions.length <= 1) return;
      const currentIdx = agentSessions.findIndex((s) => s.key === effectiveSessionKey);
      const nextIdx = getNextTopicIndex(
        currentIdx === -1 ? 0 : currentIdx,
        agentSessions.length,
        "left",
      );
      if (agentSessions[nextIdx]) setSessionKey(agentSessions[nextIdx].key);
    } else {
      // 에이전트 간 전환
      if (agents.length <= 1) return;
      const currentIdx = agents.findIndex((a) => a.id === agentId);
      const nextIdx = getNextAgentIndex(
        currentIdx === -1 ? 0 : currentIdx,
        agents.length,
        "left",
      );
      const nextAgent = agents[nextIdx];
      if (nextAgent) handleAgentChange(nextAgent.id);
    }
  }, [swipeMode, agents, agentId, agentSessions, effectiveSessionKey, setSessionKey]);

  const handleSwipeRight = useCallback(() => {
    if (swipeMode === "topic") {
      // 토픽 간 전환
      if (agentSessions.length <= 1) return;
      const currentIdx = agentSessions.findIndex((s) => s.key === effectiveSessionKey);
      const nextIdx = getNextTopicIndex(
        currentIdx === -1 ? 0 : currentIdx,
        agentSessions.length,
        "right",
      );
      if (agentSessions[nextIdx]) setSessionKey(agentSessions[nextIdx].key);
    } else {
      // 에이전트 간 전환
      if (agents.length <= 1) return;
      const currentIdx = agents.findIndex((a) => a.id === agentId);
      const nextIdx = getNextAgentIndex(
        currentIdx === -1 ? 0 : currentIdx,
        agents.length,
        "right",
      );
      const nextAgent = agents[nextIdx];
      if (nextAgent) handleAgentChange(nextAgent.id);
    }
  }, [swipeMode, agents, agentId, agentSessions, effectiveSessionKey, setSessionKey]);

  useSwipeGesture(panelRef, {
    onSwipeLeft: handleSwipeLeft,
    onSwipeRight: handleSwipeRight,
    threshold: 50,
    enabled: isMobile,
  });

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

  const handleCloseTopic = useCallback(
    async (key: string) => {
      if (!client || !isConnected) return;
      const session = (sessions as GatewaySession[]).find((s) => s.key === key);
      const currentLabel = session?.label || sessionDisplayName({ key });
      const cleanLabel = isTopicClosed(session || { label: currentLabel })
        ? getCleanLabel(session || { label: currentLabel })
        : currentLabel;
      try {
        await client.request("sessions.patch", { key, label: CLOSED_PREFIX + cleanLabel });

        // Phase 3: flush topic summary to memory
        try {
          const localMessages = await getLocalMessages(key);
          const summary = generateTopicSummary(localMessages);
          const sessionId = session?.sessionId || key;
          await markSessionEnded(key, sessionId, {
            summary: summary || undefined,
            messageCount: localMessages.length,
          });
        } catch (summaryErr) {
          console.warn("[AWF] topic summary flush failed:", summaryErr);
        }

        await refreshSessions();
      } catch (err) {
        console.error("[AWF] close topic error:", err);
      }
    },
    [client, isConnected, sessions, refreshSessions],
  );

  const handleReopenTopic = useCallback(
    async (key: string) => {
      if (!client || !isConnected) return;
      const session = (sessions as GatewaySession[]).find((s) => s.key === key);
      if (!session) return;
      const cleanLabel = getCleanLabel(session);
      try {
        await client.request("sessions.patch", { key, label: cleanLabel });
        await refreshSessions();
      } catch (err) {
        console.error("[AWF] reopen topic error:", err);
      }
    },
    [client, isConnected, sessions, refreshSessions],
  );

  // Shortcuts (active panel only)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Single panel — always active
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
      // Cmd+T: open topic name dialog
      if (matchesShortcutId(e, "new-tab")) {
        e.preventDefault();
        setTopicNameDialogOpen(true);
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
      // Cmd+[ / Cmd+] → previous/next session
      if (matchesShortcutId(e, "prev-session-bracket") || matchesShortcutId(e, "next-session-bracket")) {
        if (agentSessions.length <= 1) return;
        e.preventDefault();
        const currentIdx = agentSessions.findIndex((s) => s.key === effectiveSessionKey);
        const delta = matchesShortcutId(e, "prev-session-bracket") ? -1 : 1;
        const nextIdx = (currentIdx + delta + agentSessions.length) % agentSessions.length;
        setSessionKey(agentSessions[nextIdx].key);
        return;
      }
      // Cmd+W: close (hide) current tab
      if (matchesShortcutId(e, "close-tab")) {
        if (effectiveSessionKey) {
          const p = parseSessionKey(effectiveSessionKey);
          if (p.type !== "main") {
            e.preventDefault();
            hideSession(effectiveSessionKey);
            handleHide(effectiveSessionKey);
            // Switch to previous tab
            const currentIdx = agentSessions.findIndex((s) => s.key === effectiveSessionKey);
            const nextIdx = currentIdx > 0 ? currentIdx - 1 : 0;
            if (agentSessions[nextIdx]) {
              setSessionKey(agentSessions[nextIdx].key);
            } else {
              setSessionKey(undefined);
            }
            return;
          }
        }
        // Don't preventDefault for main — let Electron close the window
        return;
      }
      // Cmd+D: close topic (label prefix)
      if (matchesShortcutId(e, "close-topic")) {
        if (effectiveSessionKey && isTopicSession(effectiveSessionKey)) {
          e.preventDefault();
          handleCloseTopic(effectiveSessionKey);
          // Switch to previous tab
          const currentIdx = agentSessions.findIndex((s) => s.key === effectiveSessionKey);
          const nextIdx = currentIdx > 0 ? currentIdx - 1 : 0;
          if (agentSessions[nextIdx]) {
            setSessionKey(agentSessions[nextIdx].key);
          } else {
            setSessionKey(undefined);
          }
        }
        return;
      }
      // Cmd+Shift+T: reopen last closed topic, then fall back to hidden sessions
      if (matchesShortcutId(e, "reopen-tab")) {
        e.preventDefault();
        // First: try reopening closed topics (label prefix)
        const closedTopics = (sessions as GatewaySession[])
          .filter((s) => {
            const p = parseSessionKey(s.key);
            return p.agentId === agentId && isTopicClosed(s);
          })
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        if (closedTopics.length > 0) {
          handleReopenTopic(closedTopics[0].key);
          setSessionKey(closedTopics[0].key);
          return;
        }
        // Fallback: hidden sessions (legacy)
        const hidden = getHiddenSessions();
        const hiddenForAgent = agentSessions.length > 0
          ? Array.from(hidden).filter((k) => parseSessionKey(k).agentId === agentId)
          : Array.from(hidden);
        const lastHidden = hiddenForAgent[hiddenForAgent.length - 1];
        if (lastHidden) {
          unhideSession(lastHidden);
          setHiddenVersion((v) => v + 1);
          setSessionKey(lastHidden);
          refreshSessions();
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

    // Tab/Shift+Tab 세션 전환 제거 — Cmd+[/] 사용

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [agentId, setSessionKey, refreshSessions, agentSessions, effectiveSessionKey, streaming, abort, sessions, handleDelete, handleCloseTopic, handleReopenTopic]);

  // Focus textarea on mount
  useEffect(() => {
    refocusPanel();
  }, [refocusPanel]);

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
      /스레드\s*#|토픽\s*#|thread\s*#|topic\s*#|^thread[:\s-]|^topic[:\s-]|작업-\d{4}/i.test(currentLabel);

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

      // /clear — clear chat display (keep server history)
      if (trimmed === "/clear") {
        clearMessages();
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
          "| `/clear` | 채팅 표시 비우기 |",
          "| `/new` | 새 토픽 생성 |",
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

      // /new → open topic name dialog; /reset → gateway command
      if (trimmed === "/new") {
        setTopicNameDialogOpen(true);
        return;
      }
      if (trimmed === "/reset" || trimmed.startsWith("/new ") || trimmed.startsWith("/reset ")) {
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
            pdfPathHints.push(`📎 [PDF: ${att.file.name}] ${att.filePath}\n💡 Use the \`pdf\` tool for native analysis.`);
            return false; // exclude from base64 payload
          }
          return true;
        });

        // Convert remaining attachments (images, etc.) to base64 payloads
        const results = await Promise.all(nonPdfAttachments.map(attachmentToPayload));
        const payloads = results.flatMap((r) => r.payloads);
        const pdfTexts = results.map((r) => r.prependText).filter(Boolean).join("\n\n");
        const pathHintText = pdfPathHints.join("\n");

        // Upload files to server for permanent storage (#110, #157)
        const mediaLines: string[] = [];
        const filePathLines: string[] = [];
        if (platform.mediaUpload) {
          for (const p of payloads) {
            if (p.content) {
              try {
                const { path: savedPath } = await platform.mediaUpload(p.content, p.mimeType, p.fileName);
                if (p.mimeType?.startsWith("image/")) {
                  mediaLines.push(`MEDIA:${savedPath}`);
                } else {
                  // Non-image files: provide path so agent can read via `read` tool
                  filePathLines.push(`📎 [${p.fileName}] ${savedPath}`);
                }
              } catch (err) {
                console.warn("[AWF] File upload failed, sending inline:", err);
              }
            }
          }
        }

        const userMsg = [text, pathHintText, pdfTexts, ...mediaLines, ...filePathLines].filter(Boolean).join("\n\n") || (payloads.length > 0 ? "(첨부 파일)" : "");

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
    [attachments, client, isConnected, effectiveSessionKey, sessionKey, clearAttachments, sendMessage, sendCommand, addUserMessage, addLocalMessage, clearMessages, handleStatusCommand, patchSession, abort, refreshSessions, sessions, summarizeLabelFromText]
  );

    const handleNewSession = () => {
    setTopicNameDialogOpen(true);
  };

  const createSessionForAgent = async (selectedAgentId: string, topicName?: string | null) => {
    const topicId = topicName || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const newKey = `agent:${selectedAgentId}:main:topic:${topicId}`;

    // Switch agent context if different
    if (selectedAgentId !== agentId) {
      setAgentId(selectedAgentId);
      if (typeof window !== "undefined") {
        localStorage.setItem(`${storagePrefix}agentId`, selectedAgentId);
      }
    }

    setSessionKey(newKey);

    // Pre-label the thread
    const label = topicName || makeDefaultThreadLabel(selectedAgentId);
    if (client && isConnected) {
      try {
        await client.request("sessions.patch", {
          key: newKey,
          label,
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

  // Session type label for input bar meta
  const sessionType = !parsedSession ? "" : parsedSession.type === "main" ? "Main" : parsedSession.type === "thread" ? "Thread" : parsedSession.type === "subagent" ? "Sub-agent" : parsedSession.type === "cron" ? "Cron" : parsedSession.type === "a2a" ? "A2A" : "";

  // Topic count for input bar meta
  const [topicCount, setTopicCount] = useState(0);
  useEffect(() => {
    if (!effectiveSessionKey) { setTopicCount(0); return; }
    getTopicCount(effectiveSessionKey).then(setTopicCount).catch(() => setTopicCount(0));
  }, [effectiveSessionKey]);

  return (
    <div
      ref={panelRef}
      data-chat-panel
      className="relative flex h-full flex-col bg-background"
      style={isMobile && keyboardHeight > 0 ? { paddingBottom: keyboardHeight } : undefined}
      onClick={undefined}
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
        />
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
          onReply={setReplyTo}
          onClearMessages={() => {
            if (window.confirm("채팅 내용을 모두 비우시겠습니까?")) {
              clearMessages();
            }
          }}
        />
      </DropZone>

      {/* Input with integrated toolbar */}
      <ChatInput
        onSend={handleSend}
        onAbort={abort}
        streaming={streaming}
        disabled={!isConnected || (currentSession ? isTopicClosed(currentSession) : false)}
        attachments={attachments}
        onAttachFiles={addFiles}
        onRemoveAttachment={removeAttachment}
        panelId="main"
        toolbar={undefined}
        model={currentSession?.model ? String(currentSession.model) : undefined}
        tokenStr={tokenStr || undefined}
        tokenPercent={(currentSession as any)?.percentUsed as number | undefined}
        replyingTo={replyingTo}
        onClearReply={clearReplyTo}
        sessionType={sessionType || undefined}
        topicCount={topicCount}
        agentStatus={agentStatus}
        onOpenTopicHistory={() => setTopicHistoryOpen(true)}
        onClearMessages={() => {
          if (window.confirm("채팅 내용을 모두 비우시겠습니까?")) {
            clearMessages();
          }
        }}
        sessionKey={effectiveSessionKey}
      />

      {/* Topic Name Dialog */}
      <TopicNameDialog
        open={topicNameDialogOpen}
        onConfirm={(name) => {
          setTopicNameDialogOpen(false);
          createSessionForAgent(agentId, name);
        }}
        onCancel={() => setTopicNameDialogOpen(false)}
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
        swipeMode={swipeMode}
        onSwipeModeChange={setSwipeModeValue}
        isMobile={isMobile}
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
          onCloseTopic={handleCloseTopic}
          onReopenTopic={handleReopenTopic}
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
