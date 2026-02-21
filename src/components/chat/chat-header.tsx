"use client";

import { useMemo, useRef, useEffect, useState, useCallback } from "react";
import {
  MessageSquare, Plus, X, Pin, Clock, Zap,
  MessageCircle, Bot, Settings, ChevronDown,
} from "lucide-react";
import { parseSessionKey } from "@/lib/gateway/session-utils";
import type { Agent, Session } from "@/lib/gateway/protocol";
import type { AgentStatus } from "@/lib/gateway/hooks";
import { getAgentAvatar } from "@/lib/agent-avatars";
import { cn } from "@/lib/utils";

// --- Types ---

interface SessionEntry extends Partial<Session> {
  [key: string]: unknown;
}

interface ChatHeaderProps {
  sessionKey?: string;
  agents: Agent[];
  sessions: SessionEntry[];
  messages: Array<Record<string, unknown>>;
  agentStatus?: AgentStatus;
  onSelectSession?: (key: string) => void;
  onNewSession?: () => void;
  onDeleteSession?: (key: string) => void;
  onRenameSession?: (key: string, label: string) => void;
  onOpenSessionManager?: () => void;
}

// --- Constants ---

const IDLE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

const TYPE_ICONS: Record<string, React.ReactNode> = {
  main: <Pin size={10} className="text-amber-400" />,
  thread: <MessageCircle size={10} className="text-blue-400" />,
  subagent: <Bot size={10} className="text-purple-400" />,
  cron: <Settings size={10} className="text-zinc-500" />,
  a2a: <Zap size={10} className="text-green-400" />,
};

// --- Helpers ---

/** Derive a short display label for a session tab — conversation content only. */
function sessionTabLabel(session: SessionEntry): string {
  // 1. User-set or auto-generated label
  if (session.label && typeof session.label === "string") {
    const label = session.label as string;
    const slashIdx = label.indexOf("/");
    const clean = slashIdx > 0 && slashIdx < 16 ? label.slice(slashIdx + 1) : label;
    return clean.length > 28 ? `${clean.slice(0, 26)}…` : clean;
  }

  // 3. Title
  if (session.title && typeof session.title === "string") {
    const t = session.title as string;
    return t.length > 28 ? `${t.slice(0, 26)}…` : t;
  }

  // 4. Last message snippet
  if (session.lastMessage && typeof session.lastMessage === "string") {
    const msg = (session.lastMessage as string).replace(/\s+/g, " ").trim();
    if (msg && !msg.startsWith("/")) {
      return msg.length > 28 ? `${msg.slice(0, 26)}…` : msg;
    }
  }

  // 5. Fallback by type
  const parsed = parseSessionKey(session.key || "");
  const CHAN: Record<string, string> = {
    telegram: "TG", signal: "SG", whatsapp: "WA",
    discord: "DC", slack: "SL", webchat: "Web", imessage: "iMsg",
  };
  const chanTag = parsed.channel ? `${CHAN[parsed.channel] || parsed.channel} · ` : "";
  if (parsed.type === "main") return `${chanTag}메인`;
  if (parsed.type === "thread") return `${chanTag}스레드 #${(parsed.detail || "").slice(0, 6)}`;
  if (parsed.type === "subagent") return `서브 #${(parsed.detail || "").slice(0, 6)}`;
  if (parsed.type === "cron") return `크론 ${parsed.detail || ""}`;
  return parsed.type;
}

/** Format token count */
function formatTokens(n?: number): string | null {
  if (!n || n === 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format relative time */
function relativeTime(ts?: number): string | null {
  if (!ts) return null;
  const diff = Date.now() - ts;
  if (diff < 60_000) return "방금";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}시간`;
  return `${Math.floor(diff / 86400_000)}일`;
}

/** Topic from current session messages */
function deriveTopic(
  session: SessionEntry | undefined,
  messages: Array<Record<string, unknown>>
): string | null {
  if (session?.label && typeof session.label === "string") {
    const label = session.label as string;
    const slashIdx = label.indexOf("/");
    if (slashIdx > 0 && slashIdx < 16) return label.slice(slashIdx + 1);
    return label;
  }
  if (session?.title) return session.title;
  const firstUser = messages.find(
    (m) => (m.role === "user" || m.sender === "user") && typeof m.body === "string" && (m.body as string).trim()
  );
  if (firstUser) {
    const text = (firstUser.body as string).replace(/\s+/g, " ").trim();
    if (text.startsWith("/")) return null;
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  }
  return null;
}

// --- Main Component ---

/** Format agent status for display */
function formatAgentStatus(status?: AgentStatus): { text: string; dotColor: string } | null {
  if (!status || status.phase === "idle") return null;
  switch (status.phase) {
    case "thinking":
      return { text: "생각 중…", dotColor: "bg-yellow-400" };
    case "writing":
      return { text: "작성 중…", dotColor: "bg-green-400" };
    case "tool":
      return { text: `${status.toolName}`, dotColor: "bg-blue-400" };
    case "waiting":
      return { text: "응답 대기 중", dotColor: "bg-zinc-500" };
    default:
      return null;
  }
}

export function ChatHeader({
  sessionKey,
  agents,
  sessions,
  messages,
  agentStatus,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  onRenameSession,
  onOpenSessionManager,
}: ChatHeaderProps) {
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [showIdle, setShowIdle] = useState(false);

  if (!sessionKey) return null;

  const parsed = parseSessionKey(sessionKey);
  const agent = agents.find((a) => a.id === parsed.agentId);
  const agentName = agent?.name || parsed.agentId;
  const session = sessions.find((s) => s.key === sessionKey);

  // Filter sessions for this agent (main + threads only in tabs)
  const allAgentSessions = useMemo(() => {
    return sessions
      .filter((s) => {
        if (!s.key) return false;
        const p = parseSessionKey(s.key as string);
        return p.agentId === parsed.agentId && (p.type === "main" || p.type === "thread");
      })
      .sort((a, b) => {
        // Main always first
        const aType = parseSessionKey((a.key || "") as string).type;
        const bType = parseSessionKey((b.key || "") as string).type;
        if (aType === "main" && bType !== "main") return -1;
        if (bType === "main" && aType !== "main") return 1;
        return ((b as any).updatedAt || 0) - ((a as any).updatedAt || 0);
      });
  }, [sessions, parsed.agentId]);

  // Split into active and idle
  const now = Date.now();
  const { activeSessions, idleSessions } = useMemo(() => {
    const active: SessionEntry[] = [];
    const idle: SessionEntry[] = [];
    for (const s of allAgentSessions) {
      const updatedAt = (s as any).updatedAt as number | undefined;
      const p = parseSessionKey((s.key || "") as string);
      // Main is always active
      if (p.type === "main" || !updatedAt || now - updatedAt < IDLE_THRESHOLD_MS) {
        active.push(s);
      } else {
        idle.push(s);
      }
    }
    return { activeSessions: active, idleSessions: idle };
  }, [allAgentSessions, now]);

  const sessionType = parsed.type === "main" ? "Main" : parsed.type === "thread" ? "Thread" : parsed.type === "subagent" ? "Sub-agent" : parsed.type === "cron" ? "Cron" : parsed.type === "a2a" ? "A2A" : "";

  const topic = useMemo(() => deriveTopic(session, messages), [session, messages]);

  // Auto-scroll active tab
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tabsRef.current) return;
    const active = tabsRef.current.querySelector("[data-active='true']");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [sessionKey]);

  // Commit inline rename
  const commitRename = useCallback(() => {
    if (editingKey && editLabel.trim() && onRenameSession) {
      onRenameSession(editingKey, editLabel.trim());
    }
    setEditingKey(null);
    setEditLabel("");
  }, [editingKey, editLabel, onRenameSession]);

  // Render a single session tab
  const renderTab = (s: SessionEntry, isIdle = false) => {
    const key = s.key as string;
    const isActive = key === sessionKey;
    const label = sessionTabLabel(s);
    const p = parseSessionKey(key);
    const isMain = p.type === "main";
    const isConfirming = confirmDeleteKey === key;
    const isEditing = editingKey === key;
    const tokens = formatTokens((s as any).totalTokens);
    const time = relativeTime((s as any).updatedAt);
    const icon = TYPE_ICONS[p.type] || TYPE_ICONS.thread;

    if (isConfirming) {
      return (
        <div key={key} className="flex items-center gap-1 rounded-md bg-red-900/40 border border-red-700/50 px-2 py-1 flex-shrink-0">
          <span className="text-[10px] text-red-300 mr-1">삭제?</span>
          <button onClick={() => { onDeleteSession?.(key); setConfirmDeleteKey(null); }}
            className="rounded px-1.5 py-0.5 text-[10px] bg-red-600/80 text-white hover:bg-red-600">확인</button>
          <button onClick={() => setConfirmDeleteKey(null)}
            className="rounded px-1.5 py-0.5 text-[10px] bg-zinc-700 text-zinc-300 hover:bg-zinc-600">취소</button>
        </div>
      );
    }

    if (isEditing) {
      return (
        <div key={key} className="flex items-center gap-1 flex-shrink-0">
          <input
            autoFocus
            value={editLabel}
            onChange={(e) => setEditLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") { setEditingKey(null); setEditLabel(""); }
            }}
            onBlur={commitRename}
            className="w-[140px] rounded-md border border-zinc-600 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-amber-500"
          />
        </div>
      );
    }

    return (
      <div key={key} className="group relative flex-shrink-0">
        <button
          data-active={isActive}
          onClick={() => onSelectSession?.(key)}
          onDoubleClick={() => {
            if (!isMain) {
              setEditingKey(key);
              setEditLabel(label);
            }
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-all max-w-[220px]",
            isIdle && "opacity-50",
            isActive
              ? "bg-amber-600/80 text-white shadow-sm"
              : "bg-zinc-800/70 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          )}
          title={`${label}${tokens ? ` · ${tokens} tokens` : ""}${time ? ` · ${time} 전` : ""}`}
        >
          {/* Type icon */}
          <span className="flex-shrink-0">{icon}</span>

          {/* Label */}
          <span className="truncate">{label}</span>

          {/* Token or time badge */}
          {(tokens || time) && (
            <span className={cn(
              "flex-shrink-0 text-[9px] ml-0.5",
              isActive ? "text-white/60" : "text-zinc-600"
            )}>
              {tokens || time}
            </span>
          )}

          {/* Close button (not for main, visible on hover) */}
          {!isMain && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); setConfirmDeleteKey(key); }}
              className={cn(
                "flex-shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity",
                isActive
                  ? "hover:bg-amber-700/80 text-white/70 hover:text-white"
                  : "hover:bg-zinc-600 text-zinc-500 hover:text-zinc-200"
              )}
            >
              <X size={10} />
            </span>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="flex-shrink-0 border-b border-zinc-700/50 bg-zinc-900/90">
      {/* Agent name row */}
      <div className="flex items-center gap-3 px-5 pt-3.5 pb-2">
        {(() => {
          const av = getAgentAvatar(parsed.agentId);
          return av.imageUrl ? (
            <img src={av.imageUrl} alt={agentName} className="size-9 rounded-full object-cover flex-shrink-0" />
          ) : (
            <Bot size={28} className="text-amber-500 flex-shrink-0" />
          );
        })()}
        <span className="text-xl font-extrabold text-white truncate tracking-tight leading-tight">
          {agentName}
        </span>
        {onOpenSessionManager && (
          <button
            onClick={onOpenSessionManager}
            className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400 transition"
            title="세션 관리"
          >
            <Settings size={12} />
          </button>
        )}
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
          {sessionType}
        </span>
        {(() => {
          const status = formatAgentStatus(agentStatus);
          if (!status) return null;
          const isAnimating = agentStatus?.phase !== "waiting";
          return (
            <span className="flex items-center gap-1.5 ml-1">
              <span className="relative flex h-2 w-2">
                {isAnimating && (
                  <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", status.dotColor)} />
                )}
                <span className={cn("relative inline-flex h-2 w-2 rounded-full", status.dotColor)} />
              </span>
              <span className={cn(
                "text-[11px] font-medium",
                agentStatus?.phase === "waiting" ? "text-zinc-500" : "text-zinc-300"
              )}>
                {status.text}
              </span>
            </span>
          );
        })()}
      </div>

      {/* Session tabs */}
      {activeSessions.length > 0 && (
        <div ref={tabsRef} className="flex items-center gap-1 overflow-x-auto px-4 pb-2.5 scrollbar-none">
          {/* Active sessions */}
          {activeSessions.map((s) => renderTab(s))}

          {/* Idle sessions toggle */}
          {idleSessions.length > 0 && (
            <button
              onClick={() => setShowIdle(!showIdle)}
              className="flex-shrink-0 flex items-center gap-1 rounded-md bg-zinc-800/40 px-2 py-1.5 text-[10px] text-zinc-600 hover:bg-zinc-700 hover:text-zinc-400 transition"
              title={`${idleSessions.length}개 비활성 세션`}
            >
              <Clock size={10} />
              <span>+{idleSessions.length}</span>
              <ChevronDown size={10} className={cn("transition-transform", showIdle && "rotate-180")} />
            </button>
          )}

          {/* Idle sessions (expanded) */}
          {showIdle && idleSessions.map((s) => renderTab(s, true))}

          {/* New session button */}
          {onNewSession && (
            <button
              onClick={onNewSession}
              className="flex-shrink-0 flex items-center justify-center rounded-md bg-zinc-800/40 px-2 py-1.5 text-zinc-600 hover:bg-zinc-700 hover:text-zinc-300 transition"
              title="새 세션"
            >
              <Plus size={13} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
