
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import {
  Search,
  X,
  Bot,
  Hash,
  Timer,
  GitBranch,
  ArrowRight,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Command,
} from "lucide-react";
import {
  parseSessionKey,
  groupSessionsByAgent,
  sessionDisplayName,
  type GatewaySession,
  type SessionGroup,
} from "@/lib/gateway/session-utils";
import type { Session } from "@/lib/gateway/protocol";

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
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

// ---- Agent color ----

function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  const colors = [
    "border-blue-500/30 text-blue-400 bg-blue-500/10",
    "border-emerald-500/30 text-emerald-400 bg-emerald-500/10",
    "border-purple-500/30 text-purple-400 bg-purple-500/10",
    "border-amber-500/30 text-amber-400 bg-amber-500/10",
    "border-rose-500/30 text-rose-400 bg-rose-500/10",
    "border-cyan-500/30 text-cyan-400 bg-cyan-500/10",
    "border-orange-500/30 text-orange-400 bg-orange-500/10",
    "border-pink-500/30 text-pink-400 bg-pink-500/10",
  ];
  return colors[Math.abs(hash) % colors.length];
}

// ---- Props ----

interface AgentBrowserProps {
  sessions: (GatewaySession | Session)[];
  currentKey?: string;
  onSelect: (key: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  portalContainer?: HTMLElement | null;
}

export function AgentBrowser({
  sessions,
  currentKey,
  onSelect,
  open: controlledOpen,
  onOpenChange,
  portalContainer,
}: AgentBrowserProps) {
  const isMobile = useIsMobile();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      if (isControlled) {
        onOpenChange?.(v);
      } else {
        setInternalOpen(v);
      }
    },
    [isControlled, onOpenChange],
  );

  const [search, setSearch] = useState("");
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isKeyboardNav = useRef(false);

  // Convert to GatewaySession format
  const gwSessions = useMemo((): GatewaySession[] => {
    return sessions.map((s) => ({
      key: s.key,
      label: "label" in s ? (s as GatewaySession).label : "title" in s ? (s as Session).title : null,
      displayName: "displayName" in s ? (s as GatewaySession).displayName : "agentName" in s ? (s as Session).agentName : null,
      channel: "channel" in s ? (s as GatewaySession).channel : undefined,
      updatedAt: "updatedAt" in s
        ? typeof s.updatedAt === "number" ? s.updatedAt
        : typeof s.updatedAt === "string" ? new Date(s.updatedAt).getTime()
        : undefined : undefined,
    }));
  }, [sessions]);

  // Filter & group
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return gwSessions.filter((s) => {
      const parsed = parseSessionKey(s.key);
      // Hide cron/subagent
      if (parsed.type === "cron" || parsed.type === "subagent") return false;
      if (!q) return true;
      const name = sessionDisplayName(s).toLowerCase();
      return name.includes(q) || s.key.toLowerCase().includes(q) || parsed.agentId.toLowerCase().includes(q);
    });
  }, [gwSessions, search]);

  const groups = useMemo(() => groupSessionsByAgent(filtered), [filtered]);

  // Flat list of selectable items for keyboard nav
  const flatItems = useMemo(() => {
    const items: { type: "agent" | "session"; agentId: string; sessionKey?: string }[] = [];
    for (const group of groups) {
      items.push({ type: "agent", agentId: group.agentId });
      if (!collapsedAgents.has(group.agentId)) {
        for (const s of group.sessions) {
          items.push({ type: "session", agentId: group.agentId, sessionKey: s.key });
        }
      }
    }
    return items;
  }, [groups, collapsedAgents]);

  // Toggle agent collapse
  const toggleAgent = useCallback((agentId: string) => {
    setCollapsedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  // Reset on open — start with all groups collapsed
  useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedIndex(0);
      setCollapsedAgents(new Set(groups.map((g) => g.agentId)));
      setTimeout(() => searchRef.current?.focus(), 16);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset on open change
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, setOpen]);

  // Scroll selected into view
  useEffect(() => {
    if (!isKeyboardNav.current || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-browser-item]");
    const target = items[selectedIndex] as HTMLElement | undefined;
    target?.scrollIntoView({ block: "nearest" });
    requestAnimationFrame(() => { isKeyboardNav.current = false; });
  }, [selectedIndex]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const total = flatItems.length;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          isKeyboardNav.current = true;
          setSelectedIndex((i) => (i + 1) % total);
          break;
        case "ArrowUp":
          e.preventDefault();
          isKeyboardNav.current = true;
          setSelectedIndex((i) => (i - 1 + total) % total);
          break;
        case "Enter": {
          e.preventDefault();
          const item = flatItems[selectedIndex];
          if (!item) break;
          if (item.type === "agent") {
            toggleAgent(item.agentId);
          } else if (item.sessionKey) {
            onSelect(item.sessionKey);
            setOpen(false);
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          const item = flatItems[selectedIndex];
          if (item?.type === "agent" && !collapsedAgents.has(item.agentId)) {
            toggleAgent(item.agentId);
          }
          break;
        }
        case "ArrowRight": {
          e.preventDefault();
          const item = flatItems[selectedIndex];
          if (item?.type === "agent" && collapsedAgents.has(item.agentId)) {
            toggleAgent(item.agentId);
          }
          break;
        }
      }
    },
    [flatItems, selectedIndex, toggleAgent, collapsedAgents, onSelect, setOpen],
  );

  if (!open) return null;

  let itemIndex = -1;

  const content = (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]" onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className={`relative z-10 flex max-h-[70vh] w-full flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl ${
          isMobile ? "mx-3" : "max-w-lg"
        }`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            placeholder="에이전트 / 세션 검색..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setSelectedIndex(0); }}
          />
          <kbd className="hidden md:inline-flex items-center gap-0.5 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
            <Command size={10} />O
          </kbd>
          <button onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:text-foreground transition">
            <X size={16} />
          </button>
        </div>

        {/* List */}
        <div ref={listRef} className="flex-1 overflow-y-auto pt-2 pb-4" style={{ maxHeight: "calc(70vh - 60px)" }}>
          {groups.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              {search ? "검색 결과가 없습니다" : "세션이 없습니다"}
            </p>
          )}
          {groups.map((group) => {
            const isCollapsed = collapsedAgents.has(group.agentId);
            itemIndex++;
            const agentIdx = itemIndex;

            return (
              <div key={group.agentId}>
                {/* Agent header */}
                <button
                  data-browser-item
                  className={`mx-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                    selectedIndex === agentIdx
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => toggleAgent(group.agentId)}
                  onMouseEnter={() => { if (!isKeyboardNav.current) setSelectedIndex(agentIdx); }}
                >
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                  <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-none ${agentColor(group.agentId)}`}>
                    {group.agentId}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {group.sessions.length}개 세션
                  </span>
                </button>

                {/* Sessions */}
                {!isCollapsed && group.sessions.map((s) => {
                  itemIndex++;
                  const idx = itemIndex;
                  const parsed = parseSessionKey(s.key);
                  const isCurrent = s.key === currentKey;
                  const label = sessionDisplayName(s);

                  return (
                    <button
                      key={s.key}
                      data-browser-item
                      className={`mx-1 flex w-[calc(100%-8px)] items-center gap-3 rounded-lg px-3 py-2 pl-8 text-left transition-colors ${
                        isCurrent
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : selectedIndex === idx
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-muted/50"
                      }`}
                      onClick={() => { onSelect(s.key); setOpen(false); }}
                      onMouseEnter={() => { if (!isKeyboardNav.current) setSelectedIndex(idx); }}
                    >
                      <SessionTypeIcon type={parsed.type} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">{label}</p>
                        {s.updatedAt && (
                          <p className="text-[10px] text-muted-foreground">{relativeTime(s.updatedAt)}</p>
                        )}
                      </div>
                      {parsed.channel && (
                        <span className="text-[10px] text-muted-foreground rounded bg-muted px-1.5 py-0.5">
                          {parsed.channel}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  if (portalContainer) return createPortal(content, portalContainer);
  return content;
}
