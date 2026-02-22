"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import {
  Search,
  X,
  Clock,
  Bot,
  Hash,
  Timer,
  GitBranch,
  ArrowRight,
  MessageSquare,
  Check,
  ChevronRight,
  Plus,
} from "lucide-react";
import {
  parseSessionKey,
  sessionDisplayName,
  type GatewaySession,
} from "@/lib/gateway/session-utils";
import type { Agent } from "@/lib/gateway/protocol";
import { getAgentAvatar } from "@/lib/agent-avatars";
import { cn } from "@/lib/utils";

// ---- Type icon per session type ----

const TYPE_ICONS: Record<string, typeof Bot> = {
  main: Bot,
  thread: Hash,
  cron: Timer,
  subagent: GitBranch,
  a2a: ArrowRight,
};

function SessionTypeIcon({ type, size = 14 }: { type: string; size?: number }) {
  const Icon = TYPE_ICONS[type] || MessageSquare;
  return <Icon size={size} className="shrink-0 text-muted-foreground" />;
}

// ---- Relative time helper ----

function relativeTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "방금";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}시간 전`;
  return `${Math.floor(diff / 86400_000)}일 전`;
}

// ---- Props ----

export interface AgentSessionBrowserProps {
  sessions: GatewaySession[];
  agents: Agent[];
  currentKey?: string;
  currentAgentId?: string;
  onSelect: (key: string) => void;
  onAgentChange: (agentId: string) => void;
  onNewSession: (agentId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
}

export function AgentSessionBrowser({
  sessions,
  agents,
  currentKey,
  currentAgentId,
  onSelect,
  onAgentChange,
  onNewSession,
  open,
  onOpenChange,
  portalContainer,
}: AgentSessionBrowserProps) {
  const isMobile = useIsMobile();
  const [search, setSearch] = useState("");
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const setOpen = useCallback(
    (v: boolean) => onOpenChange(v),
    [onOpenChange],
  );

  // Build agent list with session counts
  const agentData = useMemo(() => {
    const sessMap = new Map<string, GatewaySession[]>();

    // Init all agents (even those with no sessions)
    for (const a of agents) {
      sessMap.set(a.id, []);
    }

    // Assign sessions to agents
    for (const s of sessions) {
      const parsed = parseSessionKey(s.key);
      // Hide cron/subagent
      if (parsed.type === "cron" || parsed.type === "subagent") continue;
      const existing = sessMap.get(parsed.agentId) || [];
      existing.push(s);
      sessMap.set(parsed.agentId, existing);
    }

    // Sort sessions within each agent by updatedAt desc
    for (const [, sess] of sessMap) {
      sess.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }

    // Build final list
    const result = Array.from(sessMap.entries()).map(([agentId, sess]) => {
      const agent = agents.find((a) => a.id === agentId);
      const lastActive = sess[0]?.updatedAt;
      return {
        agentId,
        name: agent?.name || agentId,
        sessions: sess,
        lastActive,
      };
    });

    // Sort: current agent first, then by last active
    result.sort((a, b) => {
      if (a.agentId === currentAgentId) return -1;
      if (b.agentId === currentAgentId) return 1;
      return (b.lastActive || 0) - (a.lastActive || 0);
    });

    return result;
  }, [agents, sessions, currentAgentId]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search.trim()) return agentData;
    const q = search.toLowerCase();
    return agentData.filter((a) => {
      if (a.agentId.toLowerCase().includes(q)) return true;
      if (a.name.toLowerCase().includes(q)) return true;
      return a.sessions.some((s) =>
        sessionDisplayName(s).toLowerCase().includes(q) ||
        s.key.toLowerCase().includes(q)
      );
    });
  }, [agentData, search]);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const isKeyboardNav = useRef(false);

  // Build flat navigation items: agents + their sessions when expanded
  type NavItem = { type: "agent"; agentId: string } | { type: "session"; agentId: string; sessionKey: string } | { type: "new-session"; agentId: string };
  const navItems = useMemo(() => {
    const items: NavItem[] = [];
    for (const item of filtered) {
      items.push({ type: "agent", agentId: item.agentId });
      if (expandedAgent === item.agentId) {
        items.push({ type: "new-session", agentId: item.agentId });
        for (const s of item.sessions) {
          items.push({ type: "session", agentId: item.agentId, sessionKey: s.key });
        }
      }
    }
    return items;
  }, [filtered, expandedAgent]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setSearch("");
      setExpandedAgent(null);
      setSelectedIndex(0);
      setTimeout(() => searchRef.current?.focus(), 16);
    }
  }, [open]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Scroll selected into view
  useEffect(() => {
    if (!isKeyboardNav.current || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-nav-item]");
    const target = items[selectedIndex] as HTMLElement | undefined;
    target?.scrollIntoView({ block: "nearest" });
    requestAnimationFrame(() => { isKeyboardNav.current = false; });
  }, [selectedIndex]);

  // Global Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (expandedAgent) {
          setExpandedAgent(null);
        } else {
          setOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, setOpen, expandedAgent]);

  const handleAgentClick = useCallback((agentId: string) => {
    if (expandedAgent === agentId) {
      onAgentChange(agentId);
      setOpen(false);
    } else {
      setExpandedAgent(agentId);
    }
  }, [expandedAgent, onAgentChange, setOpen]);

  const handleSessionClick = useCallback((key: string) => {
    onSelect(key);
    setOpen(false);
  }, [onSelect, setOpen]);

  const handleNewSession = useCallback((agentId: string) => {
    onNewSession(agentId);
    setOpen(false);
  }, [onNewSession, setOpen]);

  // Keyboard handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const total = navItems.length;
    if (total === 0) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        isKeyboardNav.current = true;
        setSelectedIndex((i) => Math.min(i + 1, total - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        isKeyboardNav.current = true;
        setSelectedIndex((i) => Math.max(i - 1, 0));
        break;
      case "ArrowRight": {
        e.preventDefault();
        const item = navItems[selectedIndex];
        if (item?.type === "agent" && expandedAgent !== item.agentId) {
          setExpandedAgent(item.agentId);
        }
        break;
      }
      case "ArrowLeft":
        e.preventDefault();
        if (expandedAgent) {
          // Move selection back to the agent row
          const agentIdx = navItems.findIndex((n) => n.type === "agent" && n.agentId === expandedAgent);
          if (agentIdx >= 0) setSelectedIndex(agentIdx);
          setExpandedAgent(null);
        }
        break;
      case "Enter": {
        e.preventDefault();
        const item = navItems[selectedIndex];
        if (!item) break;
        if (item.type === "agent") handleAgentClick(item.agentId);
        else if (item.type === "session") handleSessionClick(item.sessionKey);
        else if (item.type === "new-session") handleNewSession(item.agentId);
        break;
      }
    }
  }, [navItems, selectedIndex, expandedAgent, handleAgentClick, handleSessionClick, handleNewSession]);

  if (!open) return null;

  return createPortal(
    <div
      className={`${portalContainer ? "absolute" : "fixed"} inset-0 z-[9999] flex ${isMobile ? "items-end" : "items-start justify-center pt-[12vh]"} animate-in fade-in duration-150`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Panel */}
      <div
        onKeyDown={handleKeyDown}
        className={`relative w-full bg-card shadow-2xl shadow-black/50 animate-in duration-200 ${
          isMobile
            ? "max-h-[85vh] rounded-t-2xl slide-in-from-bottom-4 safe-bottom"
            : "max-w-md rounded-xl border border-border slide-in-from-top-4"
        }`}
      >
        {/* Search */}
        <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="에이전트 검색..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground">
              <X size={14} />
            </button>
          )}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">ESC</kbd>
        </div>

        {/* Agent list */}
        <div
          ref={listRef}
          className={`${isMobile ? "max-h-[65vh]" : "max-h-[60vh]"} overflow-y-auto py-2`}
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              에이전트를 찾을 수 없습니다
            </div>
          )}

          {filtered.map((item) => {
            const avatar = getAgentAvatar(item.agentId);
            const isCurrent = item.agentId === currentAgentId;
            const isExpanded = expandedAgent === item.agentId;
            const sessionCount = item.sessions.length;
            const agentNavIdx = navItems.findIndex((n) => n.type === "agent" && n.agentId === item.agentId);
            const isAgentSelected = selectedIndex === agentNavIdx;

            return (
              <div key={item.agentId}>
                {/* Agent row */}
                <button
                  data-nav-item
                  onClick={() => handleAgentClick(item.agentId)}
                  onMouseMove={() => {
                    if (!isKeyboardNav.current && selectedIndex !== agentNavIdx) setSelectedIndex(agentNavIdx);
                  }}
                  className={cn(
                    "mx-2 flex w-[calc(100%-1rem)] items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors",
                    isCurrent && !isAgentSelected ? "bg-primary/10" : "",
                    isAgentSelected ? "bg-muted/70 ring-1 ring-primary/30" : "hover:bg-muted",
                    isExpanded && !isAgentSelected && "bg-muted/50"
                  )}
                >
                  {/* Avatar */}
                  <div className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full text-lg",
                    avatar.color
                  )}>
                    {avatar.emoji}
                  </div>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-foreground truncate">
                        {item.name}
                      </span>
                      {isCurrent && (
                        <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-400 font-medium">
                          현재
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{item.agentId}</span>
                      {sessionCount > 0 && (
                        <>
                          <span>·</span>
                          <span>{sessionCount}개 세션</span>
                        </>
                      )}
                      {item.lastActive && (
                        <>
                          <span>·</span>
                          <span>{relativeTime(item.lastActive)}</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Expand indicator */}
                  {sessionCount > 0 && (
                    <ChevronRight
                      size={16}
                      className={cn(
                        "shrink-0 text-muted-foreground transition-transform",
                        isExpanded && "rotate-90"
                      )}
                    />
                  )}
                </button>

                {/* Expanded: session list */}
                {isExpanded && (
                  <div className="mx-2 mb-1 ml-8 border-l border-border/50 pl-4">
                    {/* Main session shortcut */}
                    {(() => {
                      const newNavIdx = navItems.findIndex((n) => n.type === "new-session" && n.agentId === item.agentId);
                      return (
                        <button
                          data-nav-item
                          onClick={() => handleNewSession(item.agentId)}
                          onMouseMove={() => {
                            if (!isKeyboardNav.current && selectedIndex !== newNavIdx) setSelectedIndex(newNavIdx);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                            selectedIndex === newNavIdx ? "bg-muted/70" : "hover:bg-muted"
                          )}
                        >
                          <Plus size={14} className="text-primary" />
                          <span className="text-primary">새 대화 시작</span>
                        </button>
                      );
                    })()}

                    {/* Sessions */}
                    {item.sessions.map((session) => {
                      const parsed = parseSessionKey(session.key);
                      const isCurrentSession = currentKey === session.key;
                      const sessNavIdx = navItems.findIndex((n) => n.type === "session" && "sessionKey" in n && n.sessionKey === session.key);
                      const isSessSelected = selectedIndex === sessNavIdx;

                      return (
                        <button
                          data-nav-item
                          key={session.key}
                          onClick={() => handleSessionClick(session.key)}
                          onMouseMove={() => {
                            if (!isKeyboardNav.current && selectedIndex !== sessNavIdx) setSelectedIndex(sessNavIdx);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                            isSessSelected ? "bg-muted/70" : isCurrentSession ? "bg-primary/10" : "hover:bg-muted"
                          )}
                        >
                          <SessionTypeIcon type={parsed.type} size={12} />
                          <span className="flex-1 truncate text-foreground">
                            {session.label || sessionDisplayName(session)}
                          </span>
                          {session.updatedAt && (
                            <span className="shrink-0 text-[10px] text-muted-foreground flex items-center gap-0.5">
                              <Clock size={10} />
                              {relativeTime(session.updatedAt)}
                            </span>
                          )}
                          {isCurrentSession && (
                            <Check size={12} className="shrink-0 text-emerald-400" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {!isMobile && (
          <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1">↑↓</kbd>
              이동
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1">→</kbd>
              펼치기
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1">←</kbd>
              접기
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1">↵</kbd>
              선택
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded border border-border px-1">esc</kbd>
              닫기
            </span>
          </div>
        )}
      </div>
    </div>,
    portalContainer || document.body,
  );
}
