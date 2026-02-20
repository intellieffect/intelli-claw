"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Bot, Pin, MessageCircle, Settings, Zap, Clock,
  Trash2, RotateCcw, X, ChevronDown, ChevronRight,
} from "lucide-react";
import { parseSessionKey, type GatewaySession } from "@/lib/gateway/session-utils";
import type { Agent } from "@/lib/gateway/protocol";
import { getAgentAvatar } from "@/lib/agent-avatars";
import { cn } from "@/lib/utils";

interface SessionManagerPanelProps {
  open: boolean;
  onClose: () => void;
  agents: Agent[];
  sessions: GatewaySession[];
  currentSessionKey?: string;
  onSelectSession: (key: string) => void;
  onDeleteSession: (key: string) => Promise<void>;
  onResetSession: (key: string) => Promise<void>;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  main: <Pin size={12} className="text-amber-400" />,
  thread: <MessageCircle size={12} className="text-blue-400" />,
  subagent: <Bot size={12} className="text-purple-400" />,
  cron: <Settings size={12} className="text-zinc-500" />,
  a2a: <Zap size={12} className="text-green-400" />,
  unknown: <MessageCircle size={12} className="text-zinc-600" />,
};

const TYPE_LABELS: Record<string, string> = {
  main: "메인",
  thread: "스레드",
  subagent: "서브에이전트",
  cron: "크론",
  a2a: "A2A",
  unknown: "기타",
};

function formatTokens(n?: number): string | null {
  if (!n || n === 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function relativeTime(ts?: number): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "방금";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  return `${Math.floor(diff / 86400_000)}일 전`;
}

interface AgentGroup {
  agentId: string;
  agent?: Agent;
  sessions: (GatewaySession & { parsed: ReturnType<typeof parseSessionKey> })[];
}

export function SessionManagerPanel({
  open,
  onClose,
  agents,
  sessions,
  currentSessionKey,
  onSelectSession,
  onDeleteSession,
  onResetSession,
}: SessionManagerPanelProps) {
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{ key: string; action: "delete" | "reset" } | null>(null);
  const [loading, setLoading] = useState(false);

  // Group sessions by agent
  const groups = useMemo(() => {
    const map = new Map<string, AgentGroup>();
    for (const s of sessions) {
      const parsed = parseSessionKey(s.key);
      const agentId = parsed.agentId;
      if (!map.has(agentId)) {
        map.set(agentId, {
          agentId,
          agent: agents.find((a) => a.id === agentId),
          sessions: [],
        });
      }
      map.get(agentId)!.sessions.push({ ...s, parsed });
    }

    // Sort sessions within each group: main first, then by updatedAt
    for (const group of map.values()) {
      group.sessions.sort((a, b) => {
        if (a.parsed.type === "main" && b.parsed.type !== "main") return -1;
        if (b.parsed.type === "main" && a.parsed.type !== "main") return 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    }

    // Sort groups by most recent session
    return Array.from(map.values()).sort((a, b) => {
      const aTime = a.sessions[0]?.updatedAt || 0;
      const bTime = b.sessions[0]?.updatedAt || 0;
      return bTime - aTime;
    });
  }, [sessions, agents]);

  // Auto-expand current agent
  const currentParsed = currentSessionKey ? parseSessionKey(currentSessionKey) : null;
  const effectiveExpanded = useMemo(() => {
    const set = new Set(expandedAgents);
    if (currentParsed) set.add(currentParsed.agentId);
    return set;
  }, [expandedAgents, currentParsed]);

  const toggleAgent = useCallback((agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const handleAction = useCallback(async () => {
    if (!confirmAction) return;
    setLoading(true);
    try {
      if (confirmAction.action === "delete") await onDeleteSession(confirmAction.key);
      else await onResetSession(confirmAction.key);
    } finally {
      setLoading(false);
      setConfirmAction(null);
    }
  }, [confirmAction, onDeleteSession, onResetSession]);

  const bulkDeleteIdle = useCallback(async (agentId: string) => {
    const group = groups.find((g) => g.agentId === agentId);
    if (!group) return;
    const now = Date.now();
    const idleSessions = group.sessions.filter(
      (s) => s.parsed.type !== "main" && s.updatedAt && now - s.updatedAt > 24 * 60 * 60 * 1000
    );
    setLoading(true);
    try {
      for (const s of idleSessions) {
        await onDeleteSession(s.key);
      }
    } finally {
      setLoading(false);
    }
  }, [groups, onDeleteSession]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[170]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-[min(92vw,420px)] border-l border-zinc-700 bg-zinc-900 shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">세션 관리</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 border-b border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">
          <span>{groups.length}개 에이전트</span>
          <span>{sessions.length}개 세션</span>
        </div>

        {/* Agent groups */}
        <div className="flex-1 overflow-y-auto">
          {groups.map((group) => {
            const isExpanded = effectiveExpanded.has(group.agentId);
            const av = getAgentAvatar(group.agentId);
            const totalTokens = group.sessions.reduce((sum, s) => sum + (s.totalTokens || 0), 0);
            const idleCount = group.sessions.filter(
              (s) => s.parsed.type !== "main" && s.updatedAt && Date.now() - s.updatedAt > 24 * 60 * 60 * 1000
            ).length;

            return (
              <div key={group.agentId} className="border-b border-zinc-800/50">
                {/* Agent header */}
                <button
                  onClick={() => toggleAgent(group.agentId)}
                  className="flex w-full items-center gap-2.5 px-4 py-2.5 hover:bg-zinc-800/30 transition"
                >
                  {isExpanded ? <ChevronDown size={12} className="text-zinc-500" /> : <ChevronRight size={12} className="text-zinc-500" />}
                  <div className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs", av.color)}>
                    {av.emoji}
                  </div>
                  <span className="text-sm font-medium text-zinc-200 flex-1 text-left truncate">
                    {group.agent?.name || group.agentId}
                  </span>
                  <span className="text-[10px] text-zinc-600">
                    {group.sessions.length}개{formatTokens(totalTokens) ? ` · ${formatTokens(totalTokens)}` : ""}
                  </span>
                </button>

                {/* Sessions list */}
                {isExpanded && (
                  <div className="pb-1">
                    {group.sessions.map((s) => {
                      const isCurrent = s.key === currentSessionKey;
                      const isMain = s.parsed.type === "main";
                      const isConfirming = confirmAction?.key === s.key;
                      const label = s.label || s.displayName || (isMain ? "메인 세션" : `${TYPE_LABELS[s.parsed.type] || "세션"} #${(s.parsed.detail || "").slice(0, 8)}`);
                      const tokens = formatTokens(s.totalTokens);
                      const time = relativeTime(s.updatedAt);

                      return (
                        <div
                          key={s.key}
                          className={cn(
                            "flex items-center gap-2 px-4 pl-10 py-2 hover:bg-zinc-800/30 transition group",
                            isCurrent && "bg-zinc-800/50"
                          )}
                        >
                          {/* Type icon */}
                          <span className="flex-shrink-0">{TYPE_ICONS[s.parsed.type] || TYPE_ICONS.unknown}</span>

                          {/* Label + meta */}
                          <button
                            onClick={() => { onSelectSession(s.key); onClose(); }}
                            className="flex-1 min-w-0 text-left"
                          >
                            <div className={cn("text-[12px] truncate", isCurrent ? "text-amber-400 font-medium" : "text-zinc-300")}>
                              {label}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-zinc-600">
                              {tokens && <span>{tokens} tok</span>}
                              <span>{time}</span>
                              {s.model && <span className="truncate max-w-[100px]">{s.model.split("/").pop()}</span>}
                            </div>
                          </button>

                          {/* Actions */}
                          {isConfirming ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={handleAction}
                                disabled={loading}
                                className="rounded px-1.5 py-0.5 text-[10px] bg-red-600/80 text-white hover:bg-red-600"
                              >
                                확인
                              </button>
                              <button
                                onClick={() => setConfirmAction(null)}
                                className="rounded px-1.5 py-0.5 text-[10px] bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                              >
                                취소
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => setConfirmAction({ key: s.key, action: "reset" })}
                                className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                                title="리셋"
                              >
                                <RotateCcw size={11} />
                              </button>
                              {!isMain && (
                                <button
                                  onClick={() => setConfirmAction({ key: s.key, action: "delete" })}
                                  className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-red-400"
                                  title="삭제"
                                >
                                  <Trash2 size={11} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Bulk cleanup */}
                    {idleCount > 0 && (
                      <button
                        onClick={() => bulkDeleteIdle(group.agentId)}
                        disabled={loading}
                        className="mx-4 mb-2 mt-1 flex w-[calc(100%-2rem)] items-center justify-center gap-1.5 rounded-md bg-zinc-800/50 py-1.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition"
                      >
                        <Clock size={10} />
                        비활성 세션 {idleCount}개 정리
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {groups.length === 0 && (
            <div className="py-12 text-center text-sm text-zinc-500">세션 없음</div>
          )}
        </div>
      </div>
    </div>
  );
}
