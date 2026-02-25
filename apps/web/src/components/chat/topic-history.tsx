/**
 * Topic History Panel
 *
 * Shows the timeline of session resets for a given session key,
 * allowing users to browse previous sessions within the same topic.
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  X, Clock, MessageSquare, Zap, History, Pin,
} from "lucide-react";
import { getTopicHistory, type TopicEntry } from "@/lib/gateway/topic-store";
import { cn } from "@/lib/utils";

// --- Helpers ---

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
  return `${Math.floor(diff / 86_400_000)}일 전`;
}

function formatTokens(n?: number): string | null {
  if (!n || n === 0) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const tz = { timeZone: "Asia/Seoul" as const };
  return d.toLocaleDateString("ko-KR", { ...tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

// --- Component ---

interface TopicHistoryProps {
  sessionKey: string;
  open: boolean;
  onClose: () => void;
  portalContainer?: HTMLElement | null;
}

export function TopicHistory({ sessionKey, open, onClose, portalContainer }: TopicHistoryProps) {
  const [entries, setEntries] = useState<TopicEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const history = await getTopicHistory(sessionKey);
      setEntries(history);
    } catch (err) {
      console.error("[AWF] Failed to load topic history:", err);
    } finally {
      setLoading(false);
    }
  }, [sessionKey]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onClose]);

  if (!open) return null;

  const content = (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[8vh]" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative z-10 flex max-h-[75vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <History size={16} className="text-amber-400" />
          <span className="text-sm font-semibold text-foreground">세션 이력</span>
          <span className="text-xs text-muted-foreground ml-1">({entries.length}개)</span>
          <div className="flex-1" />
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:text-foreground transition">
            <X size={16} />
          </button>
        </div>

        {/* Timeline */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <p className="text-center text-sm text-muted-foreground py-8">불러오는 중...</p>
          )}
          {!loading && entries.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-8">이전 세션 이력이 없습니다</p>
          )}
          {!loading && entries.length > 0 && (
            <div className="space-y-3">
              {entries.map((entry, idx) => {
                const isCurrent = !entry.endedAt;
                const tokens = formatTokens(entry.totalTokens);

                return (
                  <div key={`${entry.sessionId}-${idx}`}>
                    {/* Divider between entries */}
                    {idx > 0 && (
                      <div className="flex items-center gap-2 py-2">
                        <div className="flex-1 border-t border-dashed border-zinc-700/50" />
                        <span className="text-[10px] text-amber-500/60 font-medium">세션 갱신</span>
                        <div className="flex-1 border-t border-dashed border-zinc-700/50" />
                      </div>
                    )}

                    <div
                      className={cn(
                        "rounded-lg border p-3 transition",
                        isCurrent
                          ? "border-amber-500/30 bg-amber-900/10"
                          : "border-zinc-700/50 bg-zinc-800/30"
                      )}
                    >
                      {/* Header */}
                      <div className="flex items-center gap-2 mb-1.5">
                        {isCurrent ? (
                          <Pin size={12} className="text-amber-400" />
                        ) : (
                          <MessageSquare size={12} className="text-zinc-500" />
                        )}
                        <span className={cn(
                          "text-xs font-medium",
                          isCurrent ? "text-amber-300" : "text-zinc-400"
                        )}>
                          {isCurrent ? "현재 세션" : `이전 세션 #${entries.length - idx}`}
                        </span>
                        <div className="flex-1" />
                        <span className="text-[10px] text-muted-foreground">
                          {relativeTime(entry.startedAt)}
                        </span>
                      </div>

                      {/* Details */}
                      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock size={10} />
                          {formatDate(entry.startedAt)}
                        </span>
                        {tokens && (
                          <span className="flex items-center gap-1">
                            <Zap size={10} />
                            {tokens} tokens
                          </span>
                        )}
                        {entry.messageCount != null && (
                          <span className="flex items-center gap-1">
                            <MessageSquare size={10} />
                            {entry.messageCount}개
                          </span>
                        )}
                      </div>

                      {/* Label */}
                      {entry.label && (
                        <p className="mt-1.5 text-xs text-zinc-400 truncate" title={entry.label}>
                          {entry.label}
                        </p>
                      )}

                      {/* Summary */}
                      {entry.summary && (
                        <p className="mt-1 text-[11px] text-zinc-500 line-clamp-2">
                          {entry.summary}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (portalContainer) return createPortal(content, portalContainer);
  return content;
}
