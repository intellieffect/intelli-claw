"use client";

import { useMemo, useRef, useEffect, useState } from "react";
import { Bot, MessageSquare, Plus, X } from "lucide-react";
import { parseSessionKey } from "@/lib/gateway/session-utils";
import type { Agent, Session } from "@/lib/gateway/protocol";
import { cn } from "@/lib/utils";

interface ChatHeaderProps {
  sessionKey?: string;
  agents: Agent[];
  sessions: Array<Partial<Session> & Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  onSelectSession?: (key: string) => void;
  onNewSession?: () => void;
  onDeleteSession?: (key: string) => void;
}

/**
 * Derive a short display label for a session tab.
 */
function sessionTabLabel(session: Partial<Session> & Record<string, unknown>): string {
  // 1. Use label if set
  if (session.label && typeof session.label === "string") {
    const label = session.label as string;
    // Strip agent prefix like "main/..."
    const slashIdx = label.indexOf("/");
    if (slashIdx > 0 && slashIdx < 16) {
      const rest = label.slice(slashIdx + 1);
      return rest.length > 24 ? `${rest.slice(0, 22)}…` : rest;
    }
    return label.length > 24 ? `${label.slice(0, 22)}…` : label;
  }

  // 2. Title
  if (session.title && typeof session.title === "string") {
    const t = session.title as string;
    return t.length > 24 ? `${t.slice(0, 22)}…` : t;
  }

  // 3. Last message snippet
  if (session.lastMessage && typeof session.lastMessage === "string") {
    const msg = (session.lastMessage as string).replace(/\s+/g, " ").trim();
    if (msg && !msg.startsWith("/")) {
      return msg.length > 24 ? `${msg.slice(0, 22)}…` : msg;
    }
  }

  // 4. Fallback: session type
  const parsed = parseSessionKey(session.key || "");
  if (parsed.type === "main") return "메인";
  if (parsed.type === "thread") return `스레드 #${(parsed.detail || "").slice(0, 6)}`;
  return parsed.type;
}

/**
 * Derive a topic summary from session metadata or first user message.
 */
function deriveTopic(
  session: (Partial<Session> & Record<string, unknown>) | undefined,
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

export function ChatHeader({ sessionKey, agents, sessions, messages, onSelectSession, onNewSession, onDeleteSession }: ChatHeaderProps) {
  const [confirmDeleteKey, setConfirmDeleteKey] = useState<string | null>(null);
  if (!sessionKey) return null;

  const parsed = parseSessionKey(sessionKey);
  const agent = agents.find((a) => a.id === parsed.agentId);
  const agentName = agent?.name || parsed.agentId;

  const session = sessions.find((s) => s.key === sessionKey);

  // Filter sessions belonging to the same agent (main + threads only, skip cron/subagent)
  const agentSessions = useMemo(() => {
    return sessions
      .filter((s) => {
        if (!s.key) return false;
        const p = parseSessionKey(s.key as string);
        return p.agentId === parsed.agentId && (p.type === "main" || p.type === "thread");
      })
      .sort((a, b) => ((b as any).updatedAt || 0) - ((a as any).updatedAt || 0));
  }, [sessions, parsed.agentId]);

  const sessionType = parsed.type === "main"
    ? "Main Session"
    : parsed.type === "thread"
      ? "Thread"
      : parsed.type === "subagent"
        ? "Sub-agent"
        : parsed.type === "cron"
          ? "Cron"
          : parsed.type === "a2a"
            ? "A2A"
            : "";

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const topic = useMemo(() => deriveTopic(session, messages), [session, messages]);

  // Auto-scroll active tab into view
  const tabsRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!tabsRef.current) return;
    const active = tabsRef.current.querySelector("[data-active='true']");
    if (active) active.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [sessionKey]);

  return (
    <div className="flex-shrink-0 border-b border-zinc-700/50 bg-zinc-900/90">
      {/* Agent name row */}
      <div className="flex items-center gap-3 px-5 pt-3.5 pb-2">
        <Bot size={22} className="text-amber-500 flex-shrink-0" />
        <span className="text-lg font-extrabold text-white truncate tracking-tight leading-tight">
          {agentName}
        </span>
        <span className="rounded-md bg-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
          {sessionType}
        </span>
      </div>

      {/* Topic */}
      {topic && (
        <div className="flex items-center gap-2 px-5 pb-2 pl-[54px]">
          <MessageSquare size={12} className="text-zinc-600 flex-shrink-0" />
          <span className="text-[13px] text-zinc-400 truncate">{topic}</span>
        </div>
      )}

      {/* Session tabs */}
      {agentSessions.length > 0 && (
        <div
          ref={tabsRef}
          className="flex items-center gap-1 overflow-x-auto px-4 pb-2.5 scrollbar-none"
        >
          {agentSessions.map((s) => {
            const key = s.key as string;
            const isActive = key === sessionKey;
            const label = sessionTabLabel(s);
            const isConfirming = confirmDeleteKey === key;

            return (
              <div key={key} className="group relative flex-shrink-0">
                {isConfirming ? (
                  /* Delete confirmation inline */
                  <div className="flex items-center gap-1 rounded-md bg-red-900/40 border border-red-700/50 px-2 py-1">
                    <span className="text-[10px] text-red-300 mr-1">삭제?</span>
                    <button
                      onClick={() => {
                        onDeleteSession?.(key);
                        setConfirmDeleteKey(null);
                      }}
                      className="rounded px-1.5 py-0.5 text-[10px] bg-red-600/80 text-white hover:bg-red-600"
                    >
                      확인
                    </button>
                    <button
                      onClick={() => setConfirmDeleteKey(null)}
                      className="rounded px-1.5 py-0.5 text-[10px] bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    data-active={isActive}
                    onClick={() => onSelectSession?.(key)}
                    className={cn(
                      "flex items-center gap-1.5 flex-shrink-0 rounded-md px-3 py-1.5 text-[11px] font-medium transition-all max-w-[200px]",
                      isActive
                        ? "bg-amber-600/80 text-white shadow-sm"
                        : "bg-zinc-800/70 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    )}
                    title={label}
                  >
                    <span className="truncate">{label}</span>
                    {/* Close button — visible on hover */}
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteKey(key);
                      }}
                      className={cn(
                        "flex-shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 transition-opacity",
                        isActive
                          ? "hover:bg-amber-700/80 text-white/70 hover:text-white"
                          : "hover:bg-zinc-600 text-zinc-500 hover:text-zinc-200"
                      )}
                    >
                      <X size={10} />
                    </span>
                  </button>
                )}
              </div>
            );
          })}
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
