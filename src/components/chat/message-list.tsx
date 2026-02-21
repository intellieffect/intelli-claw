"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  User, Bot, Clock, X, Copy, Check, ArrowDown, Download,
  FileText, Music, Video, File, Image as ImageIcon,
  FileSpreadsheet, FileCode, FileArchive, FileAudio, FileVideo,
} from "lucide-react";
import { MarkdownRenderer } from "./markdown-renderer";
import { ToolCallCard } from "./tool-call-card";
import type { DisplayMessage, DisplayAttachment } from "@/lib/gateway/hooks";
import { getAgentAvatar } from "@/lib/agent-avatars";

/** Append dl=1 to /api/media URLs to force download */
function forceDownloadUrl(url: string): string {
  if (url.startsWith("/api/media")) {
    return url + (url.includes("?") ? "&" : "?") + "dl=1";
  }
  return url;
}

/** Blob-based download to bypass browser "unverified download" warnings on HTTP */
async function blobDownload(url: string, fileName: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch {
    // Fallback to normal navigation
    window.open(url, "_blank");
  }
}

/** Get file extension from filename */
function getExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Get icon component by MIME type */
function getFileIcon(mime: string, ext: string) {
  if (mime.startsWith("image/")) return ImageIcon;
  if (mime.startsWith("video/")) return FileVideo;
  if (mime.startsWith("audio/")) return FileAudio;
  if (mime.includes("pdf")) return FileText;
  if (["xls", "xlsx", "csv"].includes(ext)) return FileSpreadsheet;
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return FileArchive;
  if (["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "sh", "html", "css"].includes(ext)) return FileCode;
  if (["doc", "docx", "txt", "md", "json", "yaml", "yml"].includes(ext)) return FileText;
  return File;
}

/** Get accent color by file type */
function getFileAccent(mime: string, ext: string): string {
  if (mime.includes("pdf")) return "bg-red-500/20 text-red-400";
  if (mime.startsWith("image/")) return "bg-blue-500/20 text-blue-400";
  if (mime.startsWith("video/")) return "bg-purple-500/20 text-purple-400";
  if (mime.startsWith("audio/")) return "bg-green-500/20 text-green-400";
  if (["xls", "xlsx", "csv"].includes(ext)) return "bg-emerald-500/20 text-emerald-400";
  if (["zip", "tar", "gz", "7z", "rar"].includes(ext)) return "bg-yellow-500/20 text-yellow-400";
  if (["js", "ts", "tsx", "jsx", "py", "rs", "go", "java", "c", "cpp", "sh", "html", "css"].includes(ext)) return "bg-cyan-500/20 text-cyan-400";
  return "bg-zinc-500/20 text-zinc-400";
}

/** Vertical file attachment card */
function FileAttachmentCard({ att, onDownload }: { att: DisplayAttachment; onDownload: () => void }) {
  const ext = getExt(att.fileName);
  const Icon = getFileIcon(att.mimeType, ext);
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
        <Icon size={24} />
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

/** Strip task-memo HTML comments from display text */
const TASK_MEMO_STRIP_RE = /\s*<!--\s*task-memo:\s*\{[\s\S]*?\}\s*-->\s*/g;
function stripTaskMemo(text: string): string {
  return text.replace(TASK_MEMO_STRIP_RE, "").trimEnd();
}

export function MessageList({
  messages,
  loading,
  streaming,
  onCancelQueued,
  agentId,
}: {
  messages: DisplayMessage[];
  loading: boolean;
  streaming: boolean;
  onCancelQueued?: (id: string) => void;
  agentId?: string;
}) {
  const agentAv = getAgentAvatar(agentId);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);

  // Detect if user has scrolled up from bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    // Consider "at bottom" if within 80px of the bottom
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setUserScrolledUp(!atBottom);
  }, []);

  // Auto-scroll only when user is at the bottom
  useEffect(() => {
    if (!userScrolledUp) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, userScrolledUp]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUserScrolledUp(false);
  }, []);

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
        {agentAv.imageUrl ? (
          <img src={agentAv.imageUrl} alt="" className="size-12 rounded-full object-cover opacity-50" />
        ) : (
          <Bot size={48} strokeWidth={1.5} className="text-muted-foreground" />
        )}
        <p className="text-lg">무엇을 도와드릴까요?</p>
        <p className="text-sm text-muted-foreground">메시지를 입력하여 대화를 시작하세요</p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
    <div ref={containerRef} onScroll={handleScroll} className="h-full overflow-y-auto overflow-x-hidden px-[3%] py-3 md:px-[5%] lg:px-[7%] md:py-4" style={{ WebkitOverflowScrolling: "touch" }}>
      <div className="mx-auto space-y-3 md:space-y-4">
        {messages
          .filter((msg) => msg.content || msg.toolCalls.length > 0 || msg.streaming)
          .map((msg, idx, arr) => {
            const prevRole = idx > 0 ? arr[idx - 1].role : null;
            const showAvatar = msg.role !== "assistant" || prevRole !== "assistant";
            return (
              <MessageBubble key={msg.id} message={msg} showAvatar={showAvatar} onCancel={msg.queued ? onCancelQueued : undefined} agentImageUrl={agentAv.imageUrl} />
            );
          })}
        {streaming && !messages.some(m => m.streaming) && <ThinkingIndicator agentImageUrl={agentAv.imageUrl} />}
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

function AgentAvatarBubble({ imageUrl, size = 18 }: { imageUrl?: string; size?: number }) {
  if (imageUrl) {
    return <img src={imageUrl} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
      <Bot size={size} />
    </div>
  );
}

function ThinkingIndicator({ agentImageUrl }: { agentImageUrl?: string }) {
  return (
    <div className="flex gap-3">
      <AgentAvatarBubble imageUrl={agentImageUrl} />
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

function MessageBubble({ message, showAvatar = true, onCancel, agentImageUrl }: { message: DisplayMessage; showAvatar?: boolean; onCancel?: (id: string) => void; agentImageUrl?: string }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const isQueued = message.queued;

  // System messages: centered, muted style
  if (isSystem) {
    return (
      <div className="flex justify-center py-1">
        <div className="max-w-[90%] rounded-lg border border-border/50 bg-muted/30 px-4 py-2 text-center text-xs text-muted-foreground">
          <MarkdownRenderer content={message.content} />
        </div>
      </div>
    );
  }

  return (
    <div className={`group flex gap-3 ${isUser ? "justify-end" : ""}`}>
      {/* Copy button for user messages (left of bubble) */}
      {isUser && message.content && (
        <div className="flex items-start pt-2">
          <CopyButton text={message.content} />
        </div>
      )}
      {!isUser && (
        showAvatar ? (
          <AgentAvatarBubble imageUrl={agentImageUrl} />
        ) : (
          <div className="w-8 shrink-0" />
        )
      )}

      <div
        className={`min-w-0 max-w-[90%] md:max-w-[85%] ${
          isUser
            ? `rounded-2xl rounded-br-md px-3.5 py-2 md:px-4 md:py-2.5 text-foreground ${isQueued ? "bg-primary/15 border border-primary/20" : "bg-primary/15 border border-primary/10"}`
            : "flex-1"
        }`}
      >
        {isUser ? (
          <div>
            {/* Attachment images */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {message.attachments.map((att, i) =>
                  att.dataUrl && att.mimeType.startsWith("image/") ? (
                    <img
                      key={i}
                      src={att.dataUrl}
                      alt={att.fileName}
                      className="max-h-48 w-full md:max-w-full md:w-auto rounded-lg object-contain"
                    />
                  ) : (
                    <div key={i} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs">
                      📎 {att.fileName}
                    </div>
                  )
                )}
              </div>
            )}
            {message.content && message.content !== "(첨부 파일)" && (
              <p className={`whitespace-pre-wrap break-words text-sm ${isQueued ? "opacity-70" : ""}`}>{message.content}</p>
            )}
            {message.content && message.content === "(첨부 파일)" && !message.attachments?.length && (
              <p className={`whitespace-pre-wrap break-words text-sm ${isQueued ? "opacity-70" : ""}`}>{message.content}</p>
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
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                        <img
                          src={att.dataUrl || url}
                          alt={att.fileName}
                          className="max-h-80 max-w-full md:max-w-md rounded-lg border border-zinc-700 object-contain hover:opacity-90 transition"
                        />
                      </a>
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
              <div className="mt-1">
                <CopyButton text={stripTaskMemo(message.content)} />
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
}
