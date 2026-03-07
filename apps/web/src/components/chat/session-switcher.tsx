
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import {
  MessageSquare,
  Plus,
  Search,
  Pencil,
  Trash2,
  RotateCcw,
  X,
  Clock,
  Bot,
  Hash,
  Timer,
  GitBranch,
  ArrowRight,
  Check,
  Command,
  EyeOff,
  Eye,
} from "lucide-react";
import {
  parseSessionKey,
  sessionDisplayName,
  type GatewaySession,
  isTopicClosed,
  getCleanLabel,
  isTopicSession,
} from "@/lib/gateway/session-utils";
import {
  isSessionHidden,
  hideSession,
  unhideSession,
  getHiddenSessions,
} from "@/lib/gateway/hidden-sessions";
import { getTopicHistory, type TopicEntry } from "@/lib/gateway/topic-store";
import type { Session } from "@/lib/gateway/protocol";
import {
  computeVisualRange,
  getSelectedKeysFromRange,
} from "@/lib/visual-select";

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

// ---- Agent color helper (hash-based) ----

const AGENT_COLORS = [
  "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  "bg-blue-500/20 text-primary border-blue-500/30",
  "bg-purple-500/20 text-purple-400 border-purple-500/30",
  "bg-amber-500/20 text-amber-400 border-amber-500/30",
  "bg-rose-500/20 text-rose-400 border-rose-500/30",
  "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  "bg-pink-500/20 text-pink-400 border-pink-500/30",
  "bg-lime-500/20 text-lime-400 border-lime-500/30",
];

function agentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  }
  return AGENT_COLORS[Math.abs(hash) % AGENT_COLORS.length];
}

function AgentBadge({ agentId }: { agentId: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium leading-none ${agentColor(agentId)}`}
    >
      {agentId}
    </span>
  );
}

// ---- Props ----

export interface SessionSwitcherProps {
  sessions: (Session | GatewaySession)[];
  currentKey?: string;
  onSelect: (key: string) => void;
  onNew: () => void;
  onRename?: (key: string, label: string) => Promise<void>;
  onDelete?: (key: string) => Promise<void>;
  onReset?: (key: string) => Promise<void>;
  onHide?: (key: string) => void;
  onCloseTopic?: (key: string) => Promise<void>;
  onReopenTopic?: (key: string) => Promise<void>;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Portal target — palette centers inside this element instead of viewport */
  portalContainer?: HTMLElement | null;
}

export function SessionSwitcher({
  sessions,
  currentKey,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onReset,
  onHide,
  onCloseTopic,
  onReopenTopic,
  open: controlledOpen,
  onOpenChange,
  portalContainer,
}: SessionSwitcherProps) {
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
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showHidden, setShowHidden] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(40);
  const [topicSummaries, setTopicSummaries] = useState<Record<string, string>>({});

  // Vim visual select mode
  const [visualMode, setVisualMode] = useState(false);
  const [visualAnchor, setVisualAnchor] = useState<number | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const isKeyboardNav = useRef(false);

  // Convert to GatewaySession format
  const gwSessions = useMemo((): GatewaySession[] => {
    return sessions.map((s) => ({
      key: s.key,
      label:
        "label" in s
          ? (s as GatewaySession).label
          : "title" in s
            ? (s as Session).title
            : null,
      displayName:
        "displayName" in s
          ? (s as GatewaySession).displayName
          : "agentName" in s
            ? (s as Session).agentName
            : null,
      channel: "channel" in s ? (s as GatewaySession).channel : undefined,
      updatedAt:
        "updatedAt" in s
          ? typeof s.updatedAt === "number"
            ? s.updatedAt
            : typeof s.updatedAt === "string"
              ? new Date(s.updatedAt).getTime()
              : undefined
          : undefined,
      totalTokens:
        "totalTokens" in s ? (s as GatewaySession).totalTokens : undefined,
      model: "model" in s ? (s as GatewaySession).model : undefined,
    }));
  }, [sessions]);

  // Sort by updatedAt desc (flat list, no grouping)
  const sorted = useMemo(() => {
    return [...gwSessions].sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    );
  }, [gwSessions]);

  // Filter
  const hiddenSet = useMemo(() => getHiddenSessions(), [sorted, showHidden]);
  const hiddenCount = useMemo(() => {
    return sorted.filter((s) => hiddenSet.has(s.key)).length;
  }, [sorted, hiddenSet]);

  // Separate closed topics
  const closedTopics = useMemo(() => {
    return sorted.filter((s) => isTopicClosed(s));
  }, [sorted]);

  const filtered = useMemo(() => {
    // Hide cron and subagent sessions from the list (unless explicitly searched)
    const isSystemSearch = search.toLowerCase().includes("cron") || search.toLowerCase().includes("subagent");
    const visible = sorted.filter((s) => {
      const parsed = parseSessionKey(s.key);
      if (!isSystemSearch && (parsed.type === "cron" || parsed.type === "subagent")) return false;
      // Hide hidden sessions unless showHidden is on
      if (!showHidden && hiddenSet.has(s.key)) return false;
      // Hide closed topics from the main list
      if (isTopicClosed(s)) return false;
      return true;
    });
    if (!search.trim()) return visible;
    const q = search.toLowerCase();
    return visible.filter((s) => {
      const name = sessionDisplayName(s).toLowerCase();
      const key = s.key.toLowerCase();
      const parsed = parseSessionKey(s.key);
      const agent = parsed.agentId.toLowerCase();
      return name.includes(q) || key.includes(q) || agent.includes(q);
    });
  }, [sorted, search, showHidden, hiddenSet]);

  const displayed = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

  // Reset selection when search changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  // Ensure selected row is rendered (keyboard nav)
  useEffect(() => {
    if (selectedIndex >= visibleCount - 1) {
      setVisibleCount((v) => Math.min(filtered.length, v + 40));
    }
  }, [selectedIndex, visibleCount, filtered.length]);

  // Focus search on open, reset on close
  useEffect(() => {
    if (open) {
      setSearch("");
      setEditingKey(null);
      setSelectedIndex(0);
      setVisibleCount(40); // progressive render for performance
      setVisualMode(false);
      setVisualAnchor(null);
      setSelectedKeys(new Set());
      setTimeout(() => searchRef.current?.focus(), 16);
      // warm up list after first paint
      setTimeout(() => setVisibleCount(120), 60);

      // Load topic summaries for closed topics
      (async () => {
        const summaryMap: Record<string, string> = {};
        for (const s of closedTopics) {
          try {
            const entries = await getTopicHistory(s.key);
            const withSummary = entries.find((e: TopicEntry) => e.summary);
            if (withSummary?.summary) {
              summaryMap[s.key] = withSummary.summary;
            }
          } catch { /* ignore */ }
        }
        if (Object.keys(summaryMap).length > 0) {
          setTopicSummaries(summaryMap);
        }
      })();
    }
  }, [open, closedTopics]);

  // Global Escape key listener (works even when palette div has no focus)
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

  // Scroll selected item into view (only on keyboard nav)
  useEffect(() => {
    if (!isKeyboardNav.current || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-session-item]");
    const target = items[selectedIndex] as HTMLElement | undefined;
    target?.scrollIntoView({ block: "nearest" });
    // Reset after scroll completes to avoid mouse-hover interference
    requestAnimationFrame(() => {
      isKeyboardNav.current = false;
    });
  }, [selectedIndex]);

  // Update visual selection when cursor moves in visual mode
  const updateVisualSelection = useCallback(
    (newIndex: number) => {
      if (visualAnchor === null) return;
      const { start, end } = computeVisualRange(visualAnchor, newIndex);
      setSelectedKeys(getSelectedKeysFromRange(filtered, start, end));
    },
    [visualAnchor, filtered],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (editingKey) return; // let inline edit handle keys

      // Don't handle vim keys when search input is focused (except Escape)
      const isSearchFocused = searchRef.current === document.activeElement;

      // +1 for "new conversation" item at the end
      const totalItems = filtered.length + 1;

      const moveDown = () => {
        isKeyboardNav.current = true;
        setSelectedIndex((prev) => {
          const next = (prev + 1) % totalItems;
          if (visualMode && visualAnchor !== null) {
            const { start, end } = computeVisualRange(visualAnchor, next);
            setSelectedKeys(getSelectedKeysFromRange(filtered, start, end));
          }
          return next;
        });
      };

      const moveUp = () => {
        isKeyboardNav.current = true;
        setSelectedIndex((prev) => {
          const next = (prev - 1 + totalItems) % totalItems;
          if (visualMode && visualAnchor !== null) {
            const { start, end } = computeVisualRange(visualAnchor, next);
            setSelectedKeys(getSelectedKeysFromRange(filtered, start, end));
          }
          return next;
        });
      };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveDown();
          break;
        case "ArrowUp":
          e.preventDefault();
          moveUp();
          break;
        case "j":
          if (isSearchFocused) return;
          e.preventDefault();
          moveDown();
          break;
        case "k":
          if (isSearchFocused) return;
          e.preventDefault();
          moveUp();
          break;
        case "v":
          if (isSearchFocused) return;
          e.preventDefault();
          if (!visualMode) {
            // Enter visual mode
            setVisualMode(true);
            setVisualAnchor(selectedIndex);
            if (selectedIndex < filtered.length) {
              setSelectedKeys(new Set([filtered[selectedIndex].key]));
            }
          } else {
            // Exit visual mode, keep selection
            setVisualMode(false);
            setVisualAnchor(null);
          }
          break;
        case "d":
          if (isSearchFocused) return;
          if (selectedKeys.size > 0 && onDelete) {
            e.preventDefault();
            const keysToDelete = [...selectedKeys];
            const count = keysToDelete.length;
            if (!confirm(`${count}개 세션을 삭제하시겠습니까?`)) return;
            setVisualMode(false);
            setVisualAnchor(null);
            setSelectedKeys(new Set());
            (async () => {
              for (const key of keysToDelete) {
                await onDelete(key);
              }
            })();
          }
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex < filtered.length) {
            onSelect(filtered[selectedIndex].key);
            setOpen(false);
          } else {
            onNew();
            setOpen(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          if (visualMode) {
            // Exit visual mode + clear selection
            setVisualMode(false);
            setVisualAnchor(null);
            setSelectedKeys(new Set());
          } else {
            setOpen(false);
          }
          break;
      }
    },
    [editingKey, filtered, selectedIndex, onSelect, onNew, setOpen, visualMode, visualAnchor, onDelete, updateVisualSelection],
  );

  // Actions
  const handleRename = useCallback(
    async (key: string) => {
      if (!onRename || !editLabel.trim() || actionBusy) return;
      setActionBusy(true);
      try {
        await onRename(key, editLabel.trim());
      } finally {
        setActionBusy(false);
        setEditingKey(null);
      }
    },
    [onRename, editLabel, actionBusy],
  );

  const handleDelete = useCallback(
    async (key: string) => {
      if (!onDelete || actionBusy) return;
      if (!confirm(`세션을 삭제하시겠습니까?\n${key}`)) return;
      setActionBusy(true);
      try {
        await onDelete(key);
      } finally {
        setActionBusy(false);
      }
    },
    [onDelete, actionBusy],
  );

  const handleReset = useCallback(
    async (key: string) => {
      if (!onReset || actionBusy) return;
      if (
        !confirm(`세션을 리셋하시겠습니까? 모든 메시지가 초기화됩니다.\n${key}`)
      )
        return;
      setActionBusy(true);
      try {
        await onReset(key);
      } finally {
        setActionBusy(false);
      }
    },
    [onReset, actionBusy],
  );

  const current = gwSessions.find((s) => s.key === currentKey);
  const currentParsed = currentKey ? parseSessionKey(currentKey) : null;

  return (
    <>
      {/* Trigger — Option D: Minimal Dot + Inline */}
      <button
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition hover:bg-muted"
      >
        <span className="size-2 shrink-0 rounded-full bg-emerald-500" />
        <span className="min-w-0 flex-1 truncate text-left text-foreground">
          {current ? (
            current.label ? (
              <>
                <strong className="font-semibold">{currentParsed?.agentId || "agent"}</strong>
                <span className="text-muted-foreground"> / </span>
                {current.label.replace(new RegExp(`^${currentParsed?.agentId || ""}/`), "")}
              </>
            ) : sessionDisplayName(current)
          ) : currentParsed ? (
            <>
              <strong className="font-semibold">{currentParsed.agentId}</strong>
              {currentParsed.type === "thread" && (
                <span className="text-muted-foreground"> / 새 토픽</span>
              )}
            </>
          ) : "세션 선택"}
        </span>
      </button>

      {/* Command palette modal — portal to panel container or body */}
      {open && createPortal(
        <div
          className={`${portalContainer ? "absolute" : "fixed"} inset-0 z-[9999] flex ${isMobile ? "items-end" : "items-start justify-center pt-[15vh]"} animate-in fade-in duration-150`}
          onKeyDown={handleKeyDown}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Palette */}
          <div className={`relative w-full bg-card shadow-2xl shadow-black/50 animate-in duration-200 ${
            isMobile
              ? "max-h-[85vh] rounded-t-2xl slide-in-from-bottom-4 fade-in safe-bottom"
              : "max-w-lg rounded-xl border border-border slide-in-from-top-4 fade-in"
          }`}>
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-border/50 px-4 py-3">
              <Search size={16} className="shrink-0 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="세션 검색... (이름, 에이전트, 키)"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={14} />
                </button>
              )}
              <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                ESC
              </kbd>
            </div>

            {/* Session count + hidden toggle */}
            <div className="flex items-center justify-between border-b border-border px-4 py-1.5 text-xs text-muted-foreground">
              <span>
                {filtered.length}개 세션{" "}
                {search && `(${gwSessions.length}개 중)`}
              </span>
              {hiddenCount > 0 && (
                <button
                  onClick={() => setShowHidden((v) => !v)}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 transition ${
                    showHidden
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {showHidden ? <Eye size={12} /> : <EyeOff size={12} />}
                  <span>숨김 {hiddenCount}개</span>
                </button>
              )}
            </div>

            {/* Session list */}
            <div
              ref={listRef}
              className={`${isMobile ? "max-h-[60vh]" : "max-h-80"} overflow-y-auto py-1`}
              style={{ WebkitOverflowScrolling: "touch" }}
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) {
                  setVisibleCount((v) => Math.min(filtered.length, v + 40));
                }
              }}
            >
              {filtered.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                  검색 결과 없음
                </div>
              )}

              {displayed.map((session, index) => {
                const parsed = parseSessionKey(session.key);
                const isEditing = editingKey === session.key;
                const isCurrent = currentKey === session.key;
                const isSelected = selectedIndex === index;
                const isHidden = hiddenSet.has(session.key);
                const isMain = parsed.type === "main";
                const isVisualSelected = selectedKeys.has(session.key);

                return (
                  <div
                    key={session.key}
                    data-session-item
                    className={`group mx-1 flex items-center gap-3 rounded-lg px-3 py-2.5 min-h-[44px] transition-colors ${
                      isVisualSelected
                        ? "bg-primary/15 ring-1 ring-primary/30"
                        : isSelected
                          ? "bg-muted/70"
                          : "hover:bg-muted"
                    } ${isHidden ? "opacity-50" : ""}`}
                    onMouseMove={() => {
                      if (!isKeyboardNav.current && selectedIndex !== index) setSelectedIndex(index);
                    }}
                  >
                    {/* Click to select */}
                    <button
                      onClick={() => {
                        if (!isEditing) {
                          onSelect(session.key);
                          setOpen(false);
                        }
                      }}
                      className="flex flex-1 items-center gap-3 text-left min-w-0"
                    >
                      <SessionTypeIcon type={parsed.type} />

                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") handleRename(session.key);
                              if (e.key === "Escape") setEditingKey(null);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full rounded border border-border bg-muted px-2 py-1 text-sm text-foreground outline-none focus:border-ring"
                            autoFocus
                          />
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="truncate text-sm text-foreground">
                                {sessionDisplayName(session)}
                              </span>
                              <AgentBadge agentId={parsed.agentId} />
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              {session.channel && (
                                <span>{session.channel}</span>
                              )}
                              {session.updatedAt && (
                                <span className="flex items-center gap-0.5">
                                  <Clock size={10} />
                                  {relativeTime(session.updatedAt)}
                                </span>
                              )}
                              {session.totalTokens != null &&
                                session.totalTokens > 0 && (
                                  <span>
                                    {(session.totalTokens / 1000).toFixed(0)}k
                                    tok
                                  </span>
                                )}
                            </div>
                          </>
                        )}
                      </div>

                      {isHidden && !isEditing && (
                        <EyeOff
                          size={12}
                          className="shrink-0 text-muted-foreground"
                        />
                      )}
                      {isCurrent && !isEditing && (
                        <Check
                          size={14}
                          className="shrink-0 text-emerald-400"
                        />
                      )}
                    </button>

                    {/* Action buttons - show on hover or when selected */}
                    {!isEditing && (
                      <div
                        className={`shrink-0 items-center gap-0.5 ${
                          isSelected ? "flex" : "hidden group-hover:flex"
                        }`}
                      >
                        {/* Close topic button (for topic sessions only) */}
                        {!isMain && onCloseTopic && isTopicSession(session.key) && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onCloseTopic(session.key);
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="토픽 닫기"
                          >
                            <EyeOff size={12} />
                          </button>
                        )}
                        {/* Hide / Unhide button (not for main sessions, not for topics with close) */}
                        {!isMain && onHide && !(onCloseTopic && isTopicSession(session.key)) && (
                          isHidden ? (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                unhideSession(session.key);
                                onHide(session.key);
                              }}
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="숨김 해제"
                            >
                              <Eye size={12} />
                            </button>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                hideSession(session.key);
                                onHide(session.key);
                              }}
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                              title="숨기기"
                            >
                              <EyeOff size={12} />
                            </button>
                          )
                        )}
                        {onRename && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditLabel(
                                session.label || sessionDisplayName(session),
                              );
                              setEditingKey(session.key);
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="이름 변경"
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        {onReset && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReset(session.key);
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            title="리셋"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(session.key);
                            }}
                            className="rounded p-1 text-muted-foreground hover:bg-red-900/50 hover:text-destructive"
                            title="삭제"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    )}

                    {/* Edit confirm/cancel */}
                    {isEditing && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRename(session.key);
                          }}
                          disabled={actionBusy}
                          className="rounded p-1 text-emerald-400 hover:bg-accent"
                          title="저장"
                        >
                          <Check size={12} />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingKey(null);
                          }}
                          className="rounded p-1 text-muted-foreground hover:bg-accent"
                          title="취소"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* New conversation item */}
              <div
                data-session-item
                className={`mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  selectedIndex === filtered.length
                    ? "bg-muted/70"
                    : "hover:bg-muted"
                }`}
                onMouseMove={() => {
                  if (!isKeyboardNav.current && selectedIndex !== filtered.length) setSelectedIndex(filtered.length);
                }}
                onClick={() => {
                  onNew();
                  setOpen(false);
                }}
              >
                <Plus size={14} className="text-primary" />
                <span className="text-sm text-primary">새 대화 시작</span>
                <kbd className="ml-auto rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  ↵
                </kbd>
              </div>

              {/* Closed topics section */}
              {closedTopics.length > 0 && onReopenTopic && (
                <>
                  <div className="mx-4 mt-3 mb-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <EyeOff size={12} />
                    <span>닫힌 토픽 ({closedTopics.length})</span>
                  </div>
                  {closedTopics.map((session) => {
                    const parsed = parseSessionKey(session.key);
                    const cleanLabel = getCleanLabel(session) || sessionDisplayName(session);
                    const summary = topicSummaries[session.key];
                    return (
                      <div
                        key={`closed-${session.key}`}
                        className="group mx-1 flex items-center gap-3 rounded-lg px-3 py-2 opacity-60 hover:opacity-100 transition-opacity"
                      >
                        <SessionTypeIcon type={parsed.type} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm text-foreground">{cleanLabel}</span>
                            <span className="rounded-md bg-red-900/30 border border-red-700/40 px-1.5 py-0.5 text-[9px] font-medium text-red-400">
                              닫힘
                            </span>
                          </div>
                          {summary && (
                            <div className="mt-0.5 truncate text-xs text-muted-foreground/70 italic">
                              {summary}
                            </div>
                          )}
                          {session.updatedAt && (
                            <div className="mt-0.5 text-xs text-muted-foreground flex items-center gap-0.5">
                              <Clock size={10} />
                              {relativeTime(session.updatedAt)}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onReopenTopic(session.key);
                          }}
                          className="shrink-0 rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700 hover:text-white transition opacity-0 group-hover:opacity-100"
                        >
                          다시 열기
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>

            {/* Footer hint (desktop only) */}
            {!isMobile && (
              <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                {visualMode ? (
                  <>
                    <span className="rounded bg-primary/20 px-1.5 py-0.5 font-medium text-primary">
                      VISUAL
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border px-1">j/k</kbd>
                      범위 선택
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border px-1">d</kbd>
                      삭제 ({selectedKeys.size})
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border px-1">v</kbd>
                      확정
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border px-1">esc</kbd>
                      취소
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border px-1">j/k</kbd>
                      이동
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border px-1">↵</kbd>
                      선택
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border px-1">v</kbd>
                      비주얼
                    </span>
                    <span className="flex items-center gap-1">
                      <kbd className="rounded border border-border px-1">esc</kbd>
                      닫기
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>,
        portalContainer || document.body
      )}
    </>
  );
}
