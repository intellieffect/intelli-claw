"use client";

import { useMemo } from "react";
import { Bot, MessageSquare } from "lucide-react";
import { parseSessionKey } from "@/lib/gateway/session-utils";
import type { Agent, Session } from "@/lib/gateway/protocol";

interface ChatHeaderProps {
  sessionKey?: string;
  agents: Agent[];
  sessions: Array<Partial<Session> & Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
}

/**
 * Derive a topic summary from session metadata or first user message.
 */
function deriveTopic(
  session: (Partial<Session> & Record<string, unknown>) | undefined,
  messages: Array<Record<string, unknown>>
): string | null {
  // 1. Session label (if manually set or auto-generated)
  if (session?.label && typeof session.label === "string") {
    // Strip agent prefix like "main/..." for cleaner display
    const label = session.label as string;
    const slashIdx = label.indexOf("/");
    if (slashIdx > 0 && slashIdx < 16) return label.slice(slashIdx + 1);
    return label;
  }

  // 2. Session title if available
  if (session?.title) return session.title;

  // 3. First user message — summarize (truncate)
  const firstUser = messages.find(
    (m) => (m.role === "user" || m.sender === "user") && typeof m.body === "string" && (m.body as string).trim()
  );
  if (firstUser) {
    const text = (firstUser.body as string).replace(/\s+/g, " ").trim();
    if (text.startsWith("/")) return null; // slash command, not a real topic
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  }

  return null;
}

export function ChatHeader({ sessionKey, agents, sessions, messages }: ChatHeaderProps) {
  if (!sessionKey) return null;

  const parsed = parseSessionKey(sessionKey);
  const agent = agents.find((a) => a.id === parsed.agentId);
  const agentName = agent?.name || parsed.agentId;

  const session = sessions.find((s) => s.key === sessionKey);

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

  return (
    <div className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
      {/* Agent name + session type */}
      <div className="flex items-center gap-2">
        <Bot size={16} className="text-amber-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-zinc-100 truncate">
          {agentName}
        </span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          {sessionType}
        </span>
      </div>

      {/* Topic / first message summary */}
      {topic && (
        <div className="mt-1 flex items-center gap-1.5">
          <MessageSquare size={11} className="text-zinc-500 flex-shrink-0" />
          <span className="text-xs text-zinc-400 truncate">{topic}</span>
        </div>
      )}
    </div>
  );
}
