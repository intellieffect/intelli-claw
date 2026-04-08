
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useGateway, useChat, useAgents, useSessions } from "@/lib/gateway/hooks";
import { MessageList } from "./message-list";
import { ChatInput } from "./chat-input";
import { AvatarAgentSelector } from "./avatar-agent-selector";
import { AgentSelector } from "./agent-selector";
import { SessionSwitcher } from "./session-switcher";
import { AgentBrowser } from "./agent-browser";
import { DropZone, useFileAttachments, attachmentToPayload } from "./file-attachments";
import { parseSessionKey, sessionDisplayName, type GatewaySession, isTopicClosed, isClosableSession, CLOSED_PREFIX, getCleanLabel, dedupeChannelConversations, conversationBaseKey } from "@/lib/gateway/session-utils";
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
import { ToolSidebar } from "./tool-sidebar";
import type { ToolCall } from "@intelli-claw/shared";

// Auto-labeling removed (OpenClaw alignment): the gateway is the canonical
// source of session labels. Clients should only push a label when the user
// explicitly sets one (TopicNameDialog or slash command). The previous
// `maybeAutoLabelSession` / `shouldAutoLabel` / `AUTO_LABEL_PATTERN` flow
// was diverging from `~/.openclaw/workspace/openclaw-repo` (no auto-label
// logic exists there) and over-wrote labels other clients had observed as
// empty. See: docs/troubleshooting-electron-connection.md, issue triage
// 2026-04-07.

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
  // #232: Tool sidebar state
  const [sidebarTool, setSidebarTool] = useState<ToolCall | null>(null);

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
    setSidebarTool(null); // #232: Close sidebar on session switch
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

  const { messages, streaming, loading, agentStatus, sendMessage, sendCommand, addUserMessage, addLocalMessage, clearMessages, cancelQueued, abort, replyingTo, setReplyTo, clearReplyTo } = useChat(effectiveSessionKey);
  const { agents } = useAgents();
  const { sessions, loading: sessionsLoading, refresh: refreshSessions, patchSession, upsertSession } = useSessions();

  const { attachments, addFiles, removeAttachment, clearAttachments } = useFileAttachments();

  // Build ordered session list for current agent (matches header tab order: main first, then by updatedAt desc)
  // NOTE: Must be declared before swipe handlers to avoid TDZ in production builds
  const [hiddenVersion, setHiddenVersion] = useState(0);
  const agentSessions = useMemo(() => {
    const sorted = (sessions as GatewaySession[])
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
    // #321: dedupe channel-routed thread sessions so the Cmd+1~9 shortcuts
    // and swipe navigation match the chat-header tab order (one tab per
    // conversation, not per inbound message).
    return dedupeChannelConversations(sorted);
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
    (key: string) => {
      console.log("[AWF] handleCloseTopic invoked:", key);
      if (!client || !isConnected) {
        console.warn("[AWF] handleCloseTopic skipped — no client or not connected");
        return;
      }

      // #321: A single Telegram conversation generates one session per
      // inbound message (`agent:main:telegram:direct:{user}:thread:{user}:{msgId}`).
      // The user's mental model is "close this conversation", not "close one
      // of 64 sibling sessions for the same chat". Build the set of all
      // open siblings sharing the same conversation base key and patch them
      // all in parallel so the whole tab vanishes in one Cmd+D.
      const targetBase = conversationBaseKey(key);
      const allSessions = sessions as GatewaySession[];
      const siblings = allSessions.filter((s) => {
        if (s.key !== key && conversationBaseKey(s.key) !== targetBase) return false;
        // Skip already-closed sessions to avoid collision-error noise.
        if (isTopicClosed(s)) return false;
        return true;
      });
      // Always include the explicitly requested key, even if it isn't in
      // `sessions` yet (defensive — should normally be present).
      if (!siblings.some((s) => s.key === key)) {
        const fallback = allSessions.find((s) => s.key === key);
        if (fallback) siblings.push(fallback);
      }
      console.log(
        "[AWF] handleCloseTopic siblings:",
        siblings.length,
        siblings.map((s) => s.key),
      );

      // #322: Optimistic UI — mark every sibling [closed] in the LOCAL state
      // immediately so chat-header's filter (which hides [closed] tabs) drops
      // them on the next paint, ~16ms instead of waiting for the gateway
      // round-trip(s) + sessions.list refresh (~600ms+ on slow store).
      // The actual gateway patches and IndexedDB writes run in the background.
      const sidSuffix = (s: GatewaySession) => (s.sessionId || s.key).slice(-6);
      const buildClosedLabel = (s: GatewaySession) => {
        const currentLabel = s.label || sessionDisplayName({ key: s.key });
        const cleanLabel = isTopicClosed({ label: currentLabel })
          ? getCleanLabel({ label: currentLabel })
          : currentLabel;
        return `${CLOSED_PREFIX}${cleanLabel} #~${sidSuffix(s)}`;
      };
      for (const s of siblings) {
        const closedLabel = buildClosedLabel(s);
        patchSession(s.key, { label: closedLabel });
      }

      // Background work — DO NOT await: the user's UI is already updated.
      // ALWAYS use a unique suffix from the start. OpenClaw gateway enforces
      // unique labels (`openclaw/src/gateway/sessions-patch.ts:208`); the
      // `#~{sid6}` discriminator avoids collisions while staying idempotent
      // per session. `getCleanLabel` strips both prefix and suffix on reopen.
      void (async () => {
        const closeOne = async (s: GatewaySession) => {
          const closedLabel = buildClosedLabel(s);
          try {
            await client.request("sessions.patch", { key: s.key, label: closedLabel });
            try {
              const localMessages = await getLocalMessages(s.key);
              const summary = generateTopicSummary(localMessages);
              const sessionId = s.sessionId || s.key;
              await markSessionEnded(s.key, sessionId, {
                summary: summary || undefined,
                messageCount: localMessages.length,
              });
            } catch (summaryErr) {
              console.warn("[AWF] topic summary flush failed:", s.key, summaryErr);
            }
            return { ok: true, key: s.key };
          } catch (err) {
            console.error("[AWF] close topic error:", s.key, err);
            return { ok: false, key: s.key, err };
          }
        };
        const results = await Promise.all(siblings.map(closeOne));
        const okCount = results.filter((r) => r.ok).length;
        console.log(
          `[AWF] handleCloseTopic batch close: ${okCount}/${results.length} ok`,
        );
        // Reconcile with gateway truth in the background. If any patch
        // failed, the failed sibling reappears as open on the next refresh.
        refreshSessions();
      })();
    },
    [client, isConnected, sessions, refreshSessions, patchSession],
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
        console.log("[AWF] Cmd+D detected, effectiveSessionKey:", effectiveSessionKey, "isClosable:", effectiveSessionKey ? isClosableSession(effectiveSessionKey) : "no-key");
        // Use `isClosableSession` (type-aware) instead of the old
        // substring-based `isTopicSession` so channel-routed main sessions
        // (e.g. `agent:main:telegram:direct:{userId}`) are also closable.
        // Bug context (2026-04-07): Cmd+D silently no-op'd on Telegram
        // sessions because they have no `:thread:` / `:topic:` marker.
        if (effectiveSessionKey && isClosableSession(effectiveSessionKey)) {
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

  // Note: `summarizeLabelFromText` and `maybeAutoLabelSession` were removed
  // as part of the OpenClaw alignment cleanup. The reference Control UI
  // (~/.openclaw/workspace/openclaw-repo/ui/src/ui/controllers/sessions.ts)
  // never auto-labels — it only forwards explicit user input via
  // sessions.patch. Mirroring that here so labels stay in sync across
  // every OpenClaw client.

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
          "| `/new` | 세션 리셋 (현재 토픽 유지, 대화 초기화) |",
          "| `/reset` | 세션 리셋 (`/new`와 동일) |",
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

      // /new, /reset → gateway session reset command
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
        // Separate all PDFs — pass path hint for agent's `pdf` tool instead of client-side extraction
        const pdfPathHints: string[] = [];
        const webPdfs: typeof attachments = [];
        const nonPdfAttachments = attachments.filter((att) => {
          const isPdf = att.file.type === "application/pdf" || att.file.name.toLowerCase().endsWith(".pdf");
          if (!isPdf) return true;

          if (att.filePath) {
            // Electron: absolute path available
            pdfPathHints.push(`📎 [PDF: ${att.file.name}] ${att.filePath}\n💡 Use the \`pdf\` tool for native analysis.`);
          } else {
            // Web: upload separately, don't send via chat.send (gateway rejects non-image attachments)
            webPdfs.push(att);
          }
          return false; // exclude all PDFs from payload flow
        });

        // Upload web PDFs to server and add path hints
        if (platform.mediaUpload) {
          for (const att of webPdfs) {
            try {
              const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                  const dataUrl = reader.result as string;
                  resolve(dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl);
                };
                reader.onerror = () => reject(new Error("Failed to read PDF"));
                reader.readAsDataURL(att.file);
              });
              const { path: savedPath } = await platform.mediaUpload(base64, att.file.type || "application/pdf", att.file.name);
              pdfPathHints.push(`📎 [PDF: ${att.file.name}] ${savedPath}\n💡 Use the \`pdf\` tool for native analysis.`);
            } catch (err) {
              console.warn("[AWF] PDF upload failed:", err);
            }
          }
        }

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
        sendMessage(text);
      }
    },
    [attachments, client, isConnected, effectiveSessionKey, sessionKey, clearAttachments, sendMessage, sendCommand, addUserMessage, addLocalMessage, clearMessages, handleStatusCommand, patchSession, abort, refreshSessions, sessions]
  );

    const handleNewSession = () => {
    setTopicNameDialogOpen(true);
  };

  const createSessionForAgent = (selectedAgentId: string, topicName?: string | null) => {
    const topicId = topicName || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    const newKey = `agent:${selectedAgentId}:main:topic:${topicId}`;
    const label = topicName || makeDefaultThreadLabel(selectedAgentId);

    // Switch agent context if different
    if (selectedAgentId !== agentId) {
      setAgentId(selectedAgentId);
      if (typeof window !== "undefined") {
        localStorage.setItem(`${storagePrefix}agentId`, selectedAgentId);
      }
    }

    // #322: Optimistic UI — inject the new session into local state and switch
    // to it immediately so the new tab appears in <50ms instead of waiting for
    // sessions.patch (~150ms) + sessions.list (~300ms) round-trips.
    // #322: Tell loadHistory this is a brand-new empty topic so it skips the
    // chat.history RPC entirely (the topic has no history by definition).
    if (typeof window !== "undefined") {
      sessionStorage.setItem(`awf:skip-load:${newKey}`, "1");
    }
    upsertSession(newKey, {
      label,
      updatedAt: Date.now(),
    });
    setSessionKey(newKey);
    refocusPanel();

    // Fire-and-forget gateway patch — UI doesn't block on it. The next
    // sessions.list polling cycle reconciles state with gateway truth.
    if (client && isConnected) {
      client.request("sessions.patch", { key: newKey, label }).catch(() => {
        // ignore; auto-labeled on first message if rejected
      });
    }
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

      {/* Messages + Tool Sidebar */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <DropZone onDrop={addFiles}>
          <MessageList
            messages={messages}
            loading={loading}
            streaming={streaming}
            onCancelQueued={cancelQueued}
            agentId={currentAgentId}
            agentStatus={agentStatus}
            onOpenTopicHistory={() => setTopicHistoryOpen(true)}
            onReply={setReplyTo}
            onToolClick={setSidebarTool}
            onClearMessages={() => {
              if (window.confirm("채팅 내용을 모두 비우시겠습니까?")) {
                clearMessages();
              }
            }}
          />
        </DropZone>
        {/* #232: Tool output sidebar */}
        {sidebarTool && (
          <ToolSidebar
            toolCall={sidebarTool}
            onClose={() => setSidebarTool(null)}
            overlay={isMobile}
          />
        )}
      </div>

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
