
import React, { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  User, Bot, Clock, X, Copy, Check, ArrowDown, Download,
  FileText, Music, Video, File, Image as ImageIcon,
  FileSpreadsheet, FileCode, FileArchive, FileAudio, FileVideo,
  RefreshCw, History, Loader2, Reply,
} from "lucide-react";
import { MarkdownRenderer, MarkdownFilePreview } from "./markdown-renderer";
import { ToolCallCard } from "./tool-call-card";
import { HIDDEN_REPLY_RE, canBeReplyTarget, type DisplayMessage, type DisplayAttachment, type AgentStatus } from "@/lib/gateway/hooks";
import { AgentAvatar } from "@/components/ui/agent-avatar";

import { blobDownload, forceDownloadUrl } from "@/lib/utils/download";
import { formatTime } from "@/lib/utils/format-time";
import { resetReasonLabel, type ResetReason } from "@/lib/gateway/reset-reason";

/** Get file extension from filename */
export function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Render file icon by MIME type */
export function renderFileIcon(mime: string, ext: string, size: number) {
  if (mime.startsWith("image/")) return <ImageIcon size={size} />;
  if (mime.startsWith("video/")) return <FileVideo size={size} />;
  if (mime.startsWith("audio/")) return <FileAudio size={size} />;
  if (mime.includes("pdf")) return <FileText size={size} />;
  if (["xls", "xlsx", "csv"].includes(ext)) return <FileSpreadsheet size={size} />;
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return <FileArchive size={size} />;
  if (["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "sh", "html", "css"].includes(ext)) return <FileCode size={size} />;
  if (["doc", "docx", "txt", "md", "json", "yaml", "yml"].includes(ext)) return <FileText size={size} />;
  return <File size={size} />;
}

/** Get accent color by file type */
export function getFileAccent(mime: string, ext: string): string {
  if (mime.includes("pdf")) return "bg-red-500/20 text-red-400";
  if (mime.startsWith("image/")) return "bg-blue-500/20 text-blue-400";
  if (mime.startsWith("video/")) return "bg-purple-500/20 text-purple-400";
  if (mime.startsWith("audio/")) return "bg-green-500/20 text-green-400";
  if (["xls", "xlsx", "csv"].includes(ext)) return "bg-emerald-500/20 text-emerald-400";
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return "bg-yellow-500/20 text-yellow-400";
  if (["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "sh", "html", "css"].includes(ext)) return "bg-cyan-500/20 text-cyan-400";
  return "bg-zinc-500/20 text-zinc-400";
}

/** Render file icon inline — avoids dynamic component creation */
function FileIconDisplay({ mime, ext, size }: { mime: string; ext: string; size: number }) {
  return renderFileIcon(mime, ext, size);
}

/** Vertical file attachment card */
function FileAttachmentCard({ att, onDownload }: { att: DisplayAttachment; onDownload: () => void }) {
  const ext = getExt(att.fileName);
  const accent = getFileAccent(att.mimeType, ext);
  // Truncate filename but always show extension
  const maxNameLen = 18;
  const nameWithoutExt = att.fileName.slice(0, att.fileName.length - (ext ? ext.length + 1 : 0));
  const displayName = nameWithoutExt.length > maxNameLen
    ? nameWithoutExt.slice(0, maxNameLen) + "…"
    : nameWithoutExt;

  return (
    <button
      onClick={onDownload}
      className="flex w-44 flex-col items-center gap-2 rounded-xl border border-zinc-700/80 bg-zinc-800/60 p-4 transition hover:bg-zinc-700/60 hover:border-zinc-600 cursor-pointer group"
    >
      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${accent}`}>
        <FileIconDisplay mime={att.mimeType} ext={ext} size={24} />
      </div>
      <div className="w-full text-center min-w-0">
        <div className="text-xs font-medium text-zinc-200 truncate" title={att.fileName}>
          {displayName}
        </div>
        {ext && (
          <div className="text-[10px] text-zinc-500 uppercase mt-0.5">.{ext}</div>
        )}
      </div>
      <Download size={14} className="text-zinc-500 group-hover:text-zinc-300 transition" />
    </button>
  );
}

/** Assistant image with error fallback */
function AssistantImage({ src, fileName }: { src: string; fileName: string }) {
  const [error, setError] = useState(false);
  if (error) {
    return (
      <div className="flex h-48 w-48 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-800/50 text-xs text-zinc-500">
        <span>⚠️ {fileName}</span>
      </div>
    );
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block">
      <img
        src={src}
        alt={fileName}
        className="max-h-80 max-w-full md:max-w-md rounded-lg border border-zinc-700 object-contain hover:opacity-90 transition"
        onError={() => setError(true)}
      />
    </a>
  );
}

/** Strip task-memo HTML comments from display text */
const TASK_MEMO_STRIP_RE = /\s*<!--\s*task-memo:\s*\{[\s\S]*?\}\s*-->\s*/g;
export function stripTaskMemo(text: string): string {
  return text.replace(TASK_MEMO_STRIP_RE, "").trimEnd();
}

export function MessageList({
  messages,
  loading,
  streaming,
  onCancelQueued,
  agentId,
  agentStatus,
  onLoadPreviousContext,
  onOpenTopicHistory,
  onReply,
}: {
  messages: DisplayMessage[];
  loading: boolean;
  streaming: boolean;
  onCancelQueued?: (id: string) => void;
  agentId?: string;
  agentStatus?: AgentStatus;
  onLoadPreviousContext?: () => void;
  onOpenTopicHistory?: () => void;
  onReply?: (msg: DisplayMessage) => void;
}) {
  const PAGE_SIZE = 50;
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);

  // Vim normal-mode: focused message index (null = no focus)
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const bubbleRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Reset visible count when messages are replaced (e.g. session switch)
  const msgIdsKey = messages.length > 0 ? messages[0].id : "";
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [msgIdsKey]);

  // Filter messages for display, then paginate
  const displayMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (msg.content && HIDDEN_REPLY_RE.test(msg.content.trim())) return false;
      return msg.role === "session-boundary" || msg.content || msg.toolCalls.length > 0 || msg.streaming || (msg.attachments && msg.attachments.length > 0);
    });
  }, [messages]);

  const hasMore = displayMessages.length > visibleCount;
  const visibleMessages = hasMore
    ? displayMessages.slice(displayMessages.length - visibleCount)
    : displayMessages;

  // Load more when scrolling to top
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    const el = containerRef.current;
    const prevScrollHeight = el?.scrollHeight ?? 0;
    // Use rAF to batch the state update and scroll restoration
    setVisibleCount((prev) => prev + PAGE_SIZE);
    requestAnimationFrame(() => {
      if (el) {
        // Restore scroll position so content doesn't jump
        const newScrollHeight = el.scrollHeight;
        el.scrollTop = newScrollHeight - prevScrollHeight;
      }
      setLoadingMore(false);
    });
  }, [hasMore, loadingMore]);

  // Detect if user has scrolled up from bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // Consider "at bottom" if within 80px of the bottom
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setUserScrolledUp(!atBottom);

    // Load more messages when scrolled to top
    if (el.scrollTop < 100 && hasMore && !loadingMore) {
      loadMore();
    }
  }, [hasMore, loadingMore, loadMore]);

  // Re-evaluate scroll position when container is resized
  // (e.g. textarea height change, mobile keyboard appear/disappear)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      setUserScrolledUp(!atBottom);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Auto-scroll only when user is at the bottom
  // Track message count, streaming state, AND content length so scroll follows during streaming
  const msgCount = messages.length;
  const lastMsg = messages[messages.length - 1];
  const lastStreaming = lastMsg?.streaming;
  const lastContentLen = lastMsg?.content?.length ?? 0;
  useEffect(() => {
    if (!userScrolledUp) {
      const el = containerRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgCount, lastStreaming, lastContentLen, userScrolledUp]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUserScrolledUp(false);
  }, []);

  const scrollToTop = useCallback(() => {
    const el = containerRef.current;
    if (el) el.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Vim-style navigation: j/k (focus), G (bottom), gg (top), y (copy), i (insert mode)
  const lastGPressRef = useRef(0);

  // Navigable message indices (skip session-boundary)
  const navigableIndices = useMemo(
    () => visibleMessages.map((m, i) => ({ i, role: m.role })).filter((x) => x.role !== "session-boundary").map((x) => x.i),
    [visibleMessages]
  );

  // Auto-scroll focused bubble into view
  useEffect(() => {
    if (focusedIdx === null) return;
    const el = bubbleRefs.current.get(focusedIdx);
    if (el) el.scrollIntoView({ behavior: "instant", block: "nearest" });
  }, [focusedIdx]);

  // Clear focus when input gets focused (entering insert mode)
  useEffect(() => {
    const handler = () => { setFocusedIdx(null); setSelectedIndices(new Set()); };
    document.addEventListener("focus-chat-input", handler);
    return () => document.removeEventListener("focus-chat-input", handler);
  }, []);

  // On Esc from input (enter normal mode), focus last message
  useEffect(() => {
    const handler = () => {
      if (navigableIndices.length > 0) {
        const last = navigableIndices[navigableIndices.length - 1];
        setFocusedIdx(last);
      }
    };
    document.addEventListener("enter-normal-mode", handler);
    return () => document.removeEventListener("enter-normal-mode", handler);
  }, [navigableIndices]);

  useEffect(() => {
    // Map physical key codes to vim keys (handles Korean IME where e.key is hangul)
    const codeToKey: Record<string, string> = {
      KeyJ: "j", KeyK: "k", KeyH: "h", KeyL: "l",
      KeyG: "g", KeyI: "i", KeyY: "y", KeyD: "d", KeyU: "u",
      KeyV: "v", KeyO: "o", Space: " ",
    };

    const normalizeKey = (e: KeyboardEvent): string => {
      // If key is already ASCII, use it directly
      if (/^[a-zA-Z ]$/.test(e.key)) return e.key;
      // Korean IME: fallback to physical key code
      return codeToKey[e.code] || e.key;
    };

    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement).isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = normalizeKey(e);

      // Shift+G → scroll to bottom + focus last message
      if ((key === "G" || (key === "g" && e.shiftKey))) {
        e.preventDefault();
        scrollToBottom();
        if (navigableIndices.length > 0) {
          const last = navigableIndices[navigableIndices.length - 1];
          setFocusedIdx(last);
        }
        return;
      }

      // gg → scroll to top + focus first message (double 'g' within 500ms)
      if (key === "g" && !e.shiftKey) {
        const now = Date.now();
        if (now - lastGPressRef.current < 500) {
          e.preventDefault();
          scrollToTop();
          if (navigableIndices.length > 0) {
            setFocusedIdx(navigableIndices[0]);
          }
          lastGPressRef.current = 0;
        } else {
          lastGPressRef.current = now;
        }
        return;
      }

      // Shift+J → select + move down
      if ((key === "J" || (key === "j" && e.shiftKey))) {
        e.preventDefault();
        if (navigableIndices.length === 0) return;
        setFocusedIdx((prev) => {
          const cur = prev ?? navigableIndices[navigableIndices.length - 1];
          setSelectedIndices((s) => { const n = new Set(s); n.add(cur); return n; });
          const curPos = navigableIndices.indexOf(cur);
          const nextIdx = navigableIndices[Math.min(curPos + 1, navigableIndices.length - 1)];
          setSelectedIndices((s) => { const n = new Set(s); n.add(nextIdx); return n; });
          return nextIdx;
        });
        return;
      }

      // Shift+K → select + move up
      if ((key === "K" || (key === "k" && e.shiftKey))) {
        e.preventDefault();
        if (navigableIndices.length === 0) return;
        setFocusedIdx((prev) => {
          const cur = prev ?? navigableIndices[navigableIndices.length - 1];
          setSelectedIndices((s) => { const n = new Set(s); n.add(cur); return n; });
          const curPos = navigableIndices.indexOf(cur);
          const nextIdx = navigableIndices[Math.max(curPos - 1, 0)];
          setSelectedIndices((s) => { const n = new Set(s); n.add(nextIdx); return n; });
          return nextIdx;
        });
        return;
      }

      // Space → toggle select on focused message
      if (key === " " && focusedIdx !== null) {
        e.preventDefault();
        setSelectedIndices((s) => {
          const n = new Set(s);
          if (n.has(focusedIdx)) n.delete(focusedIdx); else n.add(focusedIdx);
          return n;
        });
        return;
      }

      // v → enter visual select mode (toggle select on focused message)
      if (e.key === "v" && !e.shiftKey && focusedIdx !== null) {
        e.preventDefault();
        setSelectedIndices((s) => {
          const n = new Set(s);
          if (n.has(focusedIdx)) n.delete(focusedIdx); else n.add(focusedIdx);
          return n;
        });
        return;
      }

      // j → next message
      if (key === "j" && !e.shiftKey) {
        e.preventDefault();
        if (navigableIndices.length === 0) return;
        setFocusedIdx((prev) => {
          if (prev === null) return navigableIndices[navigableIndices.length - 1];
          const curPos = navigableIndices.indexOf(prev);
          const nextPos = Math.min(curPos + 1, navigableIndices.length - 1);
          return navigableIndices[nextPos];
        });
        return;
      }

      // k → previous message
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        if (navigableIndices.length === 0) return;
        setFocusedIdx((prev) => {
          if (prev === null) return navigableIndices[navigableIndices.length - 1];
          const curPos = navigableIndices.indexOf(prev);
          const nextPos = Math.max(curPos - 1, 0);
          return navigableIndices[nextPos];
        });
        return;
      }

      // y → copy selected or focused message content
      if (key === "y" && !e.shiftKey) {
        e.preventDefault();
        const indices = selectedIndices.size > 0 ? [...selectedIndices].sort((a, b) => a - b) : (focusedIdx !== null ? [focusedIdx] : []);
        if (indices.length === 0) return;
        const text = indices.map((i) => {
          const msg = visibleMessages[i];
          if (!msg?.content) return "";
          const prefix = msg.role === "user" ? "You" : "Agent";
          return prefix + ": " + stripTaskMemo(msg.content);
        }).filter(Boolean).join("\n\n");
        if (text) copyToClipboard(text);
        return;
      }

      // d → half page scroll down
      if (key === "d" && !e.shiftKey) {
        e.preventDefault();
        if (containerRef.current) {
          containerRef.current.scrollBy({ top: containerRef.current.clientHeight / 2, behavior: "instant" });
        }
        return;
      }

      // u → half page scroll up
      if (key === "u" && !e.shiftKey) {
        e.preventDefault();
        if (containerRef.current) {
          containerRef.current.scrollBy({ top: -containerRef.current.clientHeight / 2, behavior: "instant" });
        }
        return;
      }

      // Escape in normal mode → clear selection
      if (key === "Escape") {
        if (selectedIndices.size > 0) {
          e.preventDefault();
          setSelectedIndices(new Set());
          return;
        }
      }

      // i → enter insert mode (focus input)
      if (key === "i" && !e.shiftKey) {
        e.preventDefault();
        setFocusedIdx(null);
        document.dispatchEvent(new CustomEvent("focus-chat-input"));
        return;
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [scrollToBottom, scrollToTop, navigableIndices, focusedIdx, visibleMessages]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        대화 기록 불러오는 중...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <AgentAvatar agentId={agentId} size={48} className="opacity-50" />
        <p className="text-lg">무엇을 도와드릴까요?</p>
        <p className="text-sm text-muted-foreground">메시지를 입력하여 대화를 시작하세요</p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
    <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto overflow-x-hidden px-[3%] pt-3 pb-8 md:px-[5%] lg:px-[7%] md:pt-4 md:pb-12" style={{ WebkitOverflowScrolling: "touch" }}>
      <div className="mx-auto max-w-[1200px] space-y-3 md:space-y-4">
        {/* Load more indicator */}
        {hasMore && (
          <div className="flex justify-center py-3">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="flex items-center gap-2 rounded-lg border border-zinc-700/50 bg-zinc-800/60 px-4 py-2 text-xs text-zinc-400 transition hover:bg-zinc-700/60 hover:text-zinc-300 disabled:opacity-50"
            >
              {loadingMore ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <History size={14} />
              )}
              이전 메시지 불러오기 ({displayMessages.length - visibleCount}개 남음)
            </button>
          </div>
        )}
        {visibleMessages
          .map((msg, idx, arr) => {
            if (msg.role === "session-boundary") {
              return (
                <SessionBoundary
                  key={msg.id}
                  reason={msg.resetReason}
                  onLoadContext={onLoadPreviousContext}
                  onViewHistory={onOpenTopicHistory}
                />
              );
            }
            const prevRole = idx > 0 ? arr[idx - 1].role : null;
            const showAvatar = msg.role !== "assistant" || prevRole !== "assistant";
            return (
              <MessageBubble
                key={msg.id}
                ref={(el) => {
                  if (el) bubbleRefs.current.set(idx, el);
                  else bubbleRefs.current.delete(idx);
                }}
                message={msg}
                showAvatar={showAvatar}
                onCancel={msg.queued ? onCancelQueued : undefined}
                agentId={agentId}
                agentStatus={msg.streaming ? agentStatus : undefined}
                focused={focusedIdx === idx}
                selected={selectedIndices.has(idx)}
                onReply={onReply}
              />
            );
          })}
        {streaming && !messages.some(m => m.streaming) && <ThinkingIndicator agentId={agentId} />}
        <div ref={bottomRef} />
      </div>
    </div>

    {/* Scroll to bottom button */}
    {userScrolledUp && (
      <button
        onClick={scrollToBottom}
        className="absolute bottom-4 right-4 z-20 flex items-center justify-center rounded-full bg-zinc-800 border border-zinc-600 p-2.5 text-zinc-300 shadow-lg transition-all hover:bg-zinc-700 hover:text-white hover:scale-105 active:scale-95"
        title="최근 메시지로 이동"
      >
        <ArrowDown size={18} />
      </button>
    )}
    </div>
  );
}

function SessionBoundary({
  reason,
  onLoadContext,
  onViewHistory,
}: {
  reason?: string;
  onLoadContext?: () => void;
  onViewHistory?: () => void;
}) {
  const label = resetReasonLabel((reason || "unknown") as ResetReason);

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 border-t border-dashed border-amber-600/40" />
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-amber-500/80">
          <span>{label.icon}</span>
          <span>{label.text}</span>
        </div>
        <div className="flex items-center gap-2">
          {onLoadContext && (
            <button
              onClick={onLoadContext}
              className="flex items-center gap-1 rounded-md border border-amber-600/30 bg-amber-900/20 px-2.5 py-1 text-[10px] text-amber-400 transition hover:bg-amber-900/40 hover:border-amber-500/50"
            >
              <RefreshCw size={10} />
              이전 맥락 불러오기
            </button>
          )}
          {onViewHistory && (
            <button
              onClick={onViewHistory}
              className="flex items-center gap-1 rounded-md border border-zinc-600/30 bg-zinc-800/40 px-2.5 py-1 text-[10px] text-zinc-400 transition hover:bg-zinc-700/40 hover:text-zinc-300"
            >
              <History size={10} />
              이전 대화 보기
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 border-t border-dashed border-amber-600/40" />
    </div>
  );
}

function ThinkingIndicator({ agentId }: { agentId?: string }) {
  return (
    <div className="flex gap-3">
      <AgentAvatar agentId={agentId} size={32} />
      <div className="flex items-center gap-1.5 rounded-2xl bg-muted/60 px-4 py-3">
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "0ms" }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "150ms" }} />
        <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: "300ms" }} />
      </div>
    </div>
  );
}

function copyToClipboard(text: string): Promise<void> {
  // navigator.clipboard requires HTTPS or localhost
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for non-HTTPS (e.g. Tailscale HTTP)
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      resolve();
    } catch (err) {
      reject(err);
    } finally {
      document.body.removeChild(ta);
    }
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button
      onClick={handleCopy}
      className="rounded p-1 text-muted-foreground opacity-60 sm:opacity-0 transition group-hover:opacity-100 hover:bg-white/10 hover:text-accent-foreground active:scale-90"
      title="복사"
    >
      {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
    </button>
  );
}


/** Reply quote block shown above message content */
function ReplyQuoteBlock({ replyTo }: { replyTo: { id: string; content: string; role: string } }) {
  const roleLabel = replyTo.role === "user" ? "나" : "에이전트";
  return (
    <div className="mb-1.5 flex items-start gap-1.5 rounded-lg border-l-2 border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs text-muted-foreground">
      <Reply size={12} className="mt-0.5 shrink-0 rotate-180 text-primary/60" />
      <div className="min-w-0">
        <span className="font-medium text-primary/80">{roleLabel}</span>
        <p className="mt-0.5 truncate">{replyTo.content || "(내용 없음)"}</p>
      </div>
    </div>
  );
}

/** Reply button shown on hover */
function ReplyButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="rounded p-1 text-muted-foreground opacity-0 transition group-hover:opacity-60 hover:!opacity-100 hover:bg-white/10 hover:text-accent-foreground active:scale-90"
      title="답장"
    >
      <Reply size={12} />
    </button>
  );
}

const MessageBubble = React.memo(React.forwardRef<HTMLDivElement, { message: DisplayMessage; showAvatar?: boolean; onCancel?: (id: string) => void; agentId?: string; agentStatus?: AgentStatus; focused?: boolean; selected?: boolean; onReply?: (msg: DisplayMessage) => void }>(
  function MessageBubble({ message, showAvatar = true, onCancel, agentId, agentStatus, focused, selected, onReply }, ref) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isQueued = message.queued;
  const time = formatTime(message.timestamp);

  // System messages: centered, muted style
  if (isSystem) {
    return (
      <div ref={ref} className="flex justify-center py-1">
        <div className="max-w-[90%] rounded-lg border border-border/50 bg-muted/30 px-4 py-2 text-center text-xs text-muted-foreground">
          <MarkdownRenderer content={message.content} />
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={`group flex gap-3 ${isUser ? "justify-end" : ""} `}>
      {/* Action buttons for user messages (left of bubble) */}
      {isUser && (
        <div className="flex items-start gap-0.5 pt-2">
          {message.content && <CopyButton text={message.content} />}
          {onReply && canBeReplyTarget(message) && (
            <ReplyButton onClick={() => onReply(message)} />
          )}
        </div>
      )}
      {!isUser && (
        showAvatar ? (
          <div className="relative shrink-0">
            <AgentAvatar agentId={agentId} size={32} />
            {agentStatus && agentStatus.phase !== "idle" && (
              <span className={`absolute -bottom-0.5 -right-0.5 block h-2.5 w-2.5 rounded-full border-2 border-zinc-900 ${
                agentStatus.phase === "writing" ? "bg-green-400" :
                agentStatus.phase === "thinking" ? "bg-yellow-400" :
                agentStatus.phase === "tool" ? "bg-blue-400" :
                "bg-zinc-500"
              }`} />
            )}
          </div>
        ) : (
          <div className="w-8 shrink-0" />
        )
      )}

      <div
        className={`min-w-0 max-w-[90%] md:max-w-[85%] ${
          isUser
            ? `rounded-2xl rounded-br-md px-3.5 py-2 md:px-4 md:py-2.5 text-foreground ${isQueued ? "bg-primary/15 border border-primary/20" : "bg-primary/15 border border-primary/10"}${selected ? " outline outline-2 outline-amber-500 bg-amber-500/10" : focused ? " outline outline-2 outline-amber-500/50" : ""}`
            : `rounded-2xl rounded-bl-md px-3.5 py-2 md:px-4 md:py-2.5 bg-zinc-800/60 border border-zinc-700/50 flex-1${selected ? " outline outline-2 outline-amber-500 bg-amber-500/10" : focused ? " outline outline-2 outline-amber-500/50" : ""}`
        }`}
      >
        {isUser ? (
          <div>
            {/* Reply quote block */}
            {message.replyTo && <ReplyQuoteBlock replyTo={message.replyTo} />}
            {/* Attachment images */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {message.attachments.map((att, i) => {
                  if (att.dataUrl && att.mimeType.startsWith("image/")) {
                    return (
                      <img
                        key={i}
                        src={att.dataUrl}
                        alt={att.fileName}
                        className="max-h-48 w-full md:max-w-full md:w-auto rounded-lg object-contain"
                      />
                    );
                  }
                  if (att.textContent && (att.mimeType === "text/markdown" || att.fileName.endsWith(".md") || att.fileName.endsWith(".mdx"))) {
                    return (
                      <div key={i} className="w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-600/50">
                        <div className="flex items-center gap-1.5 bg-zinc-700/50 px-3 py-1.5 text-[11px] text-zinc-400">
                          📎 {att.fileName}
                        </div>
                        <div className="max-h-60 overflow-y-auto bg-zinc-800/40 px-3 py-2 prose prose-sm prose-invert max-w-none">
                          <MarkdownRenderer content={att.textContent} />
                        </div>
                      </div>
                    );
                  }
                  // PDF with preview thumbnail
                  if (att.dataUrl && att.mimeType.includes("pdf")) {
                    return (
                      <div key={i} className="flex flex-col gap-1 rounded-lg border border-zinc-600/40 bg-zinc-800/50 p-2 max-w-xs">
                        <img src={att.dataUrl} alt={att.fileName} className="max-h-48 rounded object-contain" />
                        <div className="text-[11px] text-zinc-400 truncate px-1">📎 {att.fileName}</div>
                      </div>
                    );
                  }
                  return (
                    <div key={i} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs">
                      📎 {att.fileName}
                    </div>
                  );
                })}
              </div>
            )}
            {message.content && message.content !== "(첨부 파일)" && (
              <p className={`whitespace-pre-wrap break-words text-sm ${isQueued ? "opacity-70" : ""}`}>{message.content}</p>
            )}
            {message.content && message.content === "(첨부 파일)" && !message.attachments?.length && (
              <p className={`whitespace-pre-wrap break-words text-sm ${isQueued ? "opacity-70" : ""}`}>{message.content}</p>
            )}
            {time && !isQueued && (
              <div className="mt-1 text-right text-[10px] text-zinc-400">{time}</div>
            )}
            {isQueued && (
              <div className="mt-1.5 flex items-center justify-end gap-2">
                <span className="flex items-center gap-1 text-[10px] text-primary/70">
                  <Clock size={10} />
                  대기 중
                </span>
                {onCancel && (
                  <button
                    onClick={() => onCancel(message.id)}
                    className="flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    <X size={10} />
                    취소
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div>
            {/* Reply quote block */}
            {message.replyTo && <ReplyQuoteBlock replyTo={message.replyTo} />}
            {message.toolCalls.length > 0 && (
              <div className="mb-2">
                {message.toolCalls.map((tc) => (
                  <ToolCallCard key={tc.callId} toolCall={tc} />
                ))}
              </div>
            )}
            {/* Assistant attachments (images + files) */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {message.attachments.map((att, i) => {
                  const isImage = att.mimeType.startsWith("image/");
                  const isAudio = att.mimeType.startsWith("audio/");
                  const isVideo = att.mimeType.startsWith("video/");
                  const url = att.downloadUrl || att.dataUrl;

                  if (isImage && (att.dataUrl || url)) {
                    return (
                      <AssistantImage key={i} src={(att.dataUrl || url)!} fileName={att.fileName} />
                    );
                  }

                  if (isAudio && url) {
                    return (
                      <div key={i} className="w-full max-w-sm">
                        <audio controls src={url} className="w-full rounded-lg" />
                        <div className="mt-1 text-[10px] text-zinc-500">{att.fileName}</div>
                      </div>
                    );
                  }

                  if (isVideo && url) {
                    return (
                      <div key={i} className="w-full max-w-md">
                        <video controls src={url} className="w-full rounded-lg border border-zinc-700" />
                        <div className="mt-1 text-[10px] text-zinc-500">{att.fileName}</div>
                      </div>
                    );
                  }

                  // Markdown file inline preview
                  const ext = att.fileName.split(".").pop()?.toLowerCase();
                  if (url && (ext === "md" || ext === "mdx")) {
                    return <MarkdownFilePreview key={i} src={url} fileName={att.fileName} />;
                  }

                  // File card (vertical style)
                  if (url) {
                    return (
                      <FileAttachmentCard
                        key={i}
                        att={att}
                        onDownload={() => blobDownload(forceDownloadUrl(url), att.fileName)}
                      />
                    );
                  }

                  return null;
                })}
              </div>
            )}
            {message.content && (() => {
              const cleaned = stripTaskMemo(message.content);
              return cleaned ? <MarkdownRenderer content={cleaned} /> : null;
            })()}
            {message.streaming && (
              <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-primary" />
            )}
            {!message.streaming && message.content && (
              <div className="mt-1 flex items-center gap-2">
                <CopyButton text={stripTaskMemo(message.content)} />
                {onReply && canBeReplyTarget(message) && (
                  <ReplyButton onClick={() => onReply(message)} />
                )}
                {time && <span className="text-[10px] text-zinc-500">{time}</span>}
              </div>
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-accent-foreground">
          <User size={18} />
        </div>
      )}
    </div>
  );
}), messageBubbleAreEqual);

/** React.memo comparator for MessageBubble — exported for testing */
export function messageBubbleAreEqual(
  prev: { message: DisplayMessage; showAvatar?: boolean; agentId?: string; agentStatus?: AgentStatus; focused?: boolean; selected?: boolean },
  next: { message: DisplayMessage; showAvatar?: boolean; agentId?: string; agentStatus?: AgentStatus; focused?: boolean; selected?: boolean },
): boolean {
  const pm = prev.message, nm = next.message;
  return pm.id === nm.id
    && pm.content === nm.content
    && pm.streaming === nm.streaming
    && pm.role === nm.role
    && (pm.toolCalls?.length ?? 0) === (nm.toolCalls?.length ?? 0)
    && (pm.attachments?.length ?? 0) === (nm.attachments?.length ?? 0)
    && prev.focused === next.focused
    && prev.selected === next.selected
    && prev.agentId === next.agentId
    && prev.agentStatus?.phase === next.agentStatus?.phase
    && prev.showAvatar === next.showAvatar;
}
