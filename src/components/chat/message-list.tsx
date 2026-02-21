"use client";

import { useEffect, useRef } from "react";
import { useState as useStateCopy } from "react";
import { User, Bot, Clock, X, Copy, Check } from "lucide-react";
import { MarkdownRenderer } from "./markdown-renderer";
import { ToolCallCard } from "./tool-call-card";
import type { DisplayMessage, DisplayAttachment } from "@/lib/gateway/hooks";

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
}: {
  messages: DisplayMessage[];
  loading: boolean;
  streaming: boolean;
  onCancelQueued?: (id: string) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        대화 기록 불러오는 중...
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 md:gap-3 px-4 text-muted-foreground">
        <Bot size={40} strokeWidth={1.5} className="text-muted-foreground md:size-12" />
        <p className="text-base md:text-lg">무엇을 도와드릴까요?</p>
        <p className="text-xs md:text-sm text-muted-foreground text-center">메시지를 입력하여 대화를 시작하세요</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 sm:px-3 sm:py-3 md:px-4 md:py-4" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
      <div className="mx-auto max-w-3xl space-y-3 md:space-y-4">
        {messages
          .filter((msg) => msg.content || msg.toolCalls.length > 0 || msg.streaming)
          .map((msg, idx, arr) => {
            const prevRole = idx > 0 ? arr[idx - 1].role : null;
            const showAvatar = msg.role !== "assistant" || prevRole !== "assistant";
            return (
              <MessageBubble key={msg.id} message={msg} showAvatar={showAvatar} onCancel={msg.queued ? onCancelQueued : undefined} />
            );
          })}
        {streaming && !messages.some(m => m.streaming) && <ThinkingIndicator />}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex gap-2 md:gap-3">
      <div className="flex size-7 md:size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Bot size={16} />
      </div>
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
  const [copied, setCopied] = useStateCopy(false);
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

function MessageBubble({ message, showAvatar = true, onCancel }: { message: DisplayMessage; showAvatar?: boolean; onCancel?: (id: string) => void }) {
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
    <div className={`group flex gap-2 md:gap-3 ${isUser ? "justify-end" : ""}`}>
      {/* Copy button for user messages (left of bubble) */}
      {isUser && message.content && (
        <div className="flex items-start pt-2">
          <CopyButton text={message.content} />
        </div>
      )}
      {!isUser && (
        showAvatar ? (
          <div className="flex size-7 md:size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Bot size={16} className="md:hidden" />
            <Bot size={18} className="hidden md:block" />
          </div>
        ) : (
          <div className="w-7 md:w-8 shrink-0" />
        )
      )}

      <div
        className={`min-w-0 max-w-[95%] sm:max-w-[90%] md:max-w-[85%] ${
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
            {/* Assistant image attachments */}
            {message.attachments && message.attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {message.attachments.map((att, i) =>
                  att.dataUrl && att.mimeType.startsWith("image/") ? (
                    <img
                      key={i}
                      src={att.dataUrl}
                      alt={att.fileName}
                      className="max-h-80 max-w-full md:max-w-md rounded-lg border border-zinc-700 object-contain"
                    />
                  ) : null
                )}
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
        <div className="flex size-7 md:size-8 shrink-0 items-center justify-center rounded-full bg-muted text-accent-foreground">
          <User size={16} className="md:hidden" />
          <User size={18} className="hidden md:block" />
        </div>
      )}
    </div>
  );
}
