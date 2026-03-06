
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Paperclip, Square, X, Reply, History, Trash2 } from "lucide-react";

import { cn, windowStoragePrefix } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAutosizeTextArea } from "@/hooks/use-autosize-textarea";
import {
  AttachmentPreview,
  type ChatAttachment,
} from "./file-attachments";
import { SkillPicker, BUILTIN_COMMANDS } from "./skill-picker";
import { useSkills } from "@/lib/gateway/use-skills";
import { useKeyboardHeight } from "@/lib/hooks/use-keyboard-height";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { useInputHistory } from "@/hooks/use-input-history";
import type { ReplyTo, AgentStatus } from "@/lib/gateway/hooks";

/** Format agent status for display */
function formatAgentStatus(status?: AgentStatus): { text: string; dotColor: string } | null {
  if (!status || status.phase === "idle") return null;
  switch (status.phase) {
    case "thinking":
      return { text: "생각 중…", dotColor: "bg-yellow-400" };
    case "writing":
      return { text: "작성 중…", dotColor: "bg-green-400" };
    case "tool":
      return { text: `${status.toolName}`, dotColor: "bg-blue-400" };
    case "waiting":
      return { text: "응답 대기 중", dotColor: "bg-zinc-500" };
    default:
      return null;
  }
}

export function ChatInput({
  onSend,
  onAbort,
  streaming,
  disabled,
  attachments = [],
  onAttachFiles,
  onRemoveAttachment,
  panelId,
  toolbar,
  agentAvatar,
  agentSlot: agentSlotProp,
  model,
  tokenStr,
  tokenPercent,
  replyingTo,
  onClearReply,
  sessionType,
  topicCount,
  agentStatus,
  onOpenTopicHistory,
  onClearMessages,
  sessionKey,
}: {
  onSend: (text: string) => void;
  onAbort: () => void;
  streaming: boolean;
  disabled: boolean;
  attachments?: ChatAttachment[];
  onAttachFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  panelId?: string;
  /** Slot rendered inside the input container, above the textarea row */
  toolbar?: React.ReactNode;
  /** Optional agent avatar badge */
  agentAvatar?: { emoji: string; color: string };
  /** Custom agent slot node (overrides agentAvatar) */
  agentSlot?: React.ReactNode;
  /** Model name */
  model?: string;
  /** Token display string (e.g. "62.7k") */
  tokenStr?: string;
  /** Token usage percent */
  tokenPercent?: number;
  /** Currently replying to message */
  replyingTo?: ReplyTo | null;
  /** Clear reply target */
  onClearReply?: () => void;
  /** Session type label (e.g. "Main", "Thread") */
  sessionType?: string;
  /** Number of topics for topic history button */
  topicCount?: number;
  /** Agent status for writing/thinking indicator */
  agentStatus?: AgentStatus;
  /** Callback to open topic history */
  onOpenTopicHistory?: () => void;
  /** Callback to clear messages */
  onClearMessages?: () => void;
  /** Session key for input history (#161) */
  sessionKey?: string;
}) {
  const keyboardHeight = useKeyboardHeight();
  const isMobile = useIsMobile();
  const inputHistory = useInputHistory(sessionKey);

  const agentSlotFromAvatar = agentAvatar ? (
    <div
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-full text-sm",
        agentAvatar.color
      )}
      title="에이전트"
    >
      {agentAvatar.emoji}
    </div>
  ) : null;
  const agentSlot = agentSlotProp || agentSlotFromAvatar;
  const storageKey = panelId ? `awf:${windowStoragePrefix()}draft:${panelId}` : null;
  const [text, setText] = useState(() => {
    if (storageKey && typeof window !== "undefined") {
      return localStorage.getItem(storageKey) || "";
    }
    return "";
  });
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  // Auto-resize
  useAutosizeTextArea({
    ref: textareaRef,
    maxHeight: 200,
    borderWidth: 1,
    dependencies: [text, attachments.length > 0],
  });

  // Skill picker state
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [skillSelectedIndex, setSkillSelectedIndex] = useState(0);
  const { skills } = useSkills();
  const activeSkills = useMemo(
    () => skills.filter((s) => s.eligible && !s.disabled),
    [skills]
  );
  const skillQuery = useMemo(() => {
    if (!skillPickerOpen) return "";
    const match = text.match(/^\/(\S*)$/);
    return match ? match[1].toLowerCase() : "";
  }, [text, skillPickerOpen]);
  const filteredBuiltins = useMemo(() => {
    if (!skillQuery) return BUILTIN_COMMANDS;
    return BUILTIN_COMMANDS.filter(
      (c) =>
        c.name.toLowerCase().includes(skillQuery) ||
        c.description.toLowerCase().includes(skillQuery)
    );
  }, [skillQuery]);

  const filteredSkills = useMemo(() => {
    if (!skillQuery) return activeSkills;
    return activeSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(skillQuery) ||
        s.description.toLowerCase().includes(skillQuery)
    );
  }, [activeSkills, skillQuery]);

  const totalPickerItems = filteredBuiltins.length + filteredSkills.length;

  useEffect(() => {
    const shouldShow = text === "/" || (/^\/\S*$/.test(text) && !text.includes(" "));
    setSkillPickerOpen(shouldShow);
    if (shouldShow) setSkillSelectedIndex(0);
  }, [text]);

  // Persist draft
  useEffect(() => {
    if (!storageKey) return;
    if (text) {
      localStorage.setItem(storageKey, text);
    } else {
      localStorage.removeItem(storageKey);
    }
  }, [text, storageKey]);

  const canSend = text.trim().length > 0 || attachments.length > 0;

  const handleSend = useCallback(() => {
    if (!canSend || disabled) return;
    const trimmed = text.trim();
    inputHistory.push(trimmed);
    inputHistory.reset();
    onSend(trimmed);
    setText("");
    if (storageKey) localStorage.removeItem(storageKey);
  }, [text, disabled, onSend, canSend, storageKey, inputHistory]);

  const handleSkillSelect = useCallback((command: string) => {
    setText(command);
    setSkillPickerOpen(false);
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || composingRef.current) return;

      // Skill picker navigation (builtins + skills)
      if (skillPickerOpen && totalPickerItems > 0) {
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSkillSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : totalPickerItems - 1
          );
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSkillSelectedIndex((prev) =>
            prev < totalPickerItems - 1 ? prev + 1 : 0
          );
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          if (skillSelectedIndex < filteredBuiltins.length) {
            // Built-in command
            const cmd = filteredBuiltins[skillSelectedIndex];
            if (cmd.immediate) {
              handleSkillSelect(`/${cmd.name}`);
              // Trigger send immediately for immediate commands
              onSend(`/${cmd.name}`);
              setText("");
              if (storageKey) localStorage.removeItem(storageKey);
            } else {
              handleSkillSelect(`/${cmd.name} `);
            }
          } else {
            // Skill
            const skill = filteredSkills[skillSelectedIndex - filteredBuiltins.length];
            if (skill) handleSkillSelect(`/${skill.name} `);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSkillPickerOpen(false);
          return;
        }
      }

      // Input history navigation (#161): ArrowUp/Down when skill picker is closed
      if (e.key === "ArrowUp" && !skillPickerOpen) {
        const ta = e.target as HTMLTextAreaElement;
        const beforeCursor = ta.value.substring(0, ta.selectionStart);
        // Only navigate history when cursor is on the first line
        if (!beforeCursor.includes("\n")) {
          const prev = inputHistory.navigateUp(ta.value);
          if (prev !== null) {
            e.preventDefault();
            setText(prev);
            // Move cursor to end after state update
            requestAnimationFrame(() => {
              if (textareaRef.current) {
                textareaRef.current.selectionStart = prev.length;
                textareaRef.current.selectionEnd = prev.length;
              }
            });
          }
          return;
        }
      }

      if (e.key === "ArrowDown" && !skillPickerOpen) {
        const ta = e.target as HTMLTextAreaElement;
        const afterCursor = ta.value.substring(ta.selectionStart);
        // Only navigate history when cursor is on the last line
        if (!afterCursor.includes("\n")) {
          const next = inputHistory.navigateDown();
          if (next !== null) {
            e.preventDefault();
            setText(next);
            requestAnimationFrame(() => {
              if (textareaRef.current) {
                textareaRef.current.selectionStart = next.length;
                textareaRef.current.selectionEnd = next.length;
              }
            });
          }
          return;
        }
      }

      if (e.key === "Escape") {
        e.preventDefault();
        (e.target as HTMLTextAreaElement).blur();
        // Signal vim normal mode: focus last message
        document.dispatchEvent(new CustomEvent("enter-normal-mode"));
        return;
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, skillPickerOpen, filteredSkills, filteredBuiltins, totalPickerItems, skillSelectedIndex, handleSkillSelect, onSend, storageKey, inputHistory]
  );

  // Paste files
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      if (!onAttachFiles) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) {
        e.preventDefault();
        onAttachFiles(files);
      }
    },
    [onAttachFiles]
  );

  // Drag & drop
  const onDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!onAttachFiles) return;
      e.preventDefault();
      setIsDragging(true);
    },
    [onAttachFiles]
  );
  const onDragLeave = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
    },
    []
  );
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragging(false);
      if (!onAttachFiles) return;
      e.preventDefault();
      if (e.dataTransfer.files.length) {
        onAttachFiles(Array.from(e.dataTransfer.files));
      }
    },
    [onAttachFiles]
  );

  // Focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Focus textarea when window gains focus (Electron multi-window)
  useEffect(() => {
    const handler = () => textareaRef.current?.focus();
    window.addEventListener("focus", handler);
    return () => window.removeEventListener("focus", handler);
  }, []);

  // Listen for vim normal-mode "i" → focus input (enter insert mode)
  useEffect(() => {
    const handler = () => textareaRef.current?.focus();
    document.addEventListener("focus-chat-input", handler);
    return () => document.removeEventListener("focus-chat-input", handler);
  }, []);

  // Clock: update every minute
  const [clockTime, setClockTime] = useState(() => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  });
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClockTime(`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
    };
    // Align to next minute boundary
    const msUntilNextMinute = (60 - new Date().getSeconds()) * 1000 - new Date().getMilliseconds();
    const alignTimeout = setTimeout(() => {
      tick();
      // Then tick every 60s
      intervalRef.current = setInterval(tick, 60_000);
    }, msUntilNextMinute);
    const intervalRef: { current: ReturnType<typeof setInterval> | null } = { current: null };
    return () => {
      clearTimeout(alignTimeout);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const showAttachments = onRemoveAttachment && attachments.length > 0;

  return (
    <div
      className="relative px-[3%] py-1.5 sm:py-2 md:px-[5%] lg:px-[7%] safe-bottom electron-bottom-pad"
      style={isMobile && keyboardHeight > 0 ? { paddingBottom: `max(4px, env(safe-area-inset-bottom, 0px))` } : undefined}
      onMouseDown={() => document.dispatchEvent(new CustomEvent("focus-chat-input"))}
    >
      {/* Skill picker */}
      <SkillPicker
        inputText={text}
        onSelect={handleSkillSelect}
        onDismiss={() => setSkillPickerOpen(false)}
        visible={skillPickerOpen}
      />

      <div
        className="mx-auto w-full"
      >
        <div
          className="flex-1"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
        <div
          className={cn(
            "relative flex w-full flex-col rounded-xl sm:rounded-2xl border border-input bg-background shadow-sm transition-[border-color,box-shadow]",
            "focus-within:border-primary focus-within:ring-[3px] focus-within:ring-inset focus-within:ring-primary/40"
          )}
        >
          {/* Reply preview bar */}
          {replyingTo && (
            <div className="flex items-center gap-2 border-b border-primary/20 bg-primary/5 px-3 py-2">
              <Reply size={14} className="shrink-0 rotate-180 text-primary/60" />
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-primary/80">
                  {replyingTo.role === "user" ? "나" : "에이전트"}에게 답장
                </span>
                <p className="truncate text-xs text-muted-foreground">{replyingTo.content || "(내용 없음)"}</p>
              </div>
              <button
                onClick={onClearReply}
                className="shrink-0 rounded p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                title="답장 취소"
              >
                <X size={14} />
              </button>
            </div>
          )}

          {/* Toolbar: controls */}
          {toolbar && (
            <div className="flex w-full min-w-0 items-center gap-1.5 px-2.5 pt-2 sm:px-3">
              {toolbar}
            </div>
          )}

          {/* Model & token info bar + session meta */}
          {(model || tokenStr || sessionType || topicCount || agentStatus) && (() => {
            const isCritical = tokenPercent != null && tokenPercent >= 90;
            const isWarning = tokenPercent != null && tokenPercent >= 70;
            const statusInfo = formatAgentStatus(agentStatus);
            return (
              <div className={cn(
                "flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3 pt-2 pb-0.5 text-xs tabular-nums tracking-tight",
                isCritical
                  ? "text-red-400"
                  : isWarning
                    ? "text-amber-400"
                    : "text-zinc-500"
              )}>
                {model && (
                  <span className="font-medium">{model.split("/").pop()}</span>
                )}
                {tokenStr && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="font-semibold">{tokenStr}</span>
                  </>
                )}
                {tokenPercent != null && (
                  <>
                    <span className="text-zinc-700">·</span>
                    <span className="font-semibold">{tokenPercent}%</span>
                  </>
                )}
                <span className="text-zinc-700">·</span>
                <span data-testid="chat-clock">{clockTime}</span>
                {isCritical && (
                  <span className="ml-1 text-[11px] font-medium text-red-400/90">
                    ⚠️ 컨텍스트 한도 임박 — <code className="rounded bg-red-400/10 px-1 py-0.5 text-[10px]">/new</code> 또는 <code className="rounded bg-red-400/10 px-1 py-0.5 text-[10px]">/compact</code> 권장
                  </span>
                )}
                {!isCritical && isWarning && (
                  <span className="ml-1 text-[11px] font-medium text-amber-400/80">
                    ⚡ 토큰 사용량 높음
                  </span>
                )}

                {/* Session meta — moved from header */}
                {(sessionType || (topicCount && topicCount > 1) || onClearMessages || statusInfo) && (
                  <>
                    <span className="text-zinc-700">|</span>

                    {sessionType && (
                      <span className="rounded-md bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">
                        {sessionType}
                      </span>
                    )}

                    {topicCount != null && topicCount > 1 && onOpenTopicHistory && (
                      <button
                        onClick={onOpenTopicHistory}
                        className="flex items-center gap-1 rounded-md bg-amber-900/20 border border-amber-600/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-500 hover:bg-amber-900/40 hover:border-amber-500/40 transition"
                        title="대화 이력 보기 (리셋 기록)"
                      >
                        <History size={10} />
                        <span>대화 {topicCount}</span>
                      </button>
                    )}

                    {onClearMessages && (
                      <button
                        onClick={onClearMessages}
                        className="flex items-center gap-1 rounded-md bg-zinc-800/50 border border-zinc-700/30 px-1 py-0.5 text-[10px] font-medium text-zinc-400 hover:bg-red-900/30 hover:border-red-500/30 hover:text-red-400 transition"
                        title="채팅 비우기"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}

                    {statusInfo && (() => {
                      const isAnimating = agentStatus?.phase !== "waiting";
                      return (
                        <span className="flex items-center gap-1.5">
                          <span className="relative flex h-2 w-2">
                            {isAnimating && (
                              <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", statusInfo.dotColor)} />
                            )}
                            <span className={cn("relative inline-flex h-2 w-2 rounded-full", statusInfo.dotColor)} />
                          </span>
                          <span className={cn(
                            "text-[11px] font-medium",
                            agentStatus?.phase === "waiting" ? "text-zinc-500" : "text-zinc-300"
                          )}>
                            {statusInfo.text}
                          </span>
                        </span>
                      );
                    })()}
                  </>
                )}
              </div>
            );
          })()}

          {/* Attachment previews inside container */}
          {showAttachments && (
            <div className="overflow-x-auto px-2 pt-2 sm:px-3 sm:pt-3">
              <AttachmentPreview
                attachments={attachments}
                onRemove={onRemoveAttachment}
              />
            </div>
          )}

          {/* Textarea + inline actions row */}
          <div className="flex items-end gap-1 p-1.5 sm:p-2">
            {/* Agent selector */}
            {agentSlot}

            {/* Attach button */}
            {onAttachFiles && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-lg text-muted-foreground hover:text-foreground min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0"
                aria-label="파일 첨부"
                onClick={() => {
                  const input = document.createElement("input");
                  input.type = "file";
                  input.multiple = true;
                  input.onchange = () => {
                    if (input.files) onAttachFiles(Array.from(input.files));
                  };
                  input.click();
                }}
              >
                <Paperclip className="size-4" />
              </Button>
            )}

            {/* Textarea */}
            <textarea
              ref={textareaRef}
              aria-label="메시지를 입력하세요"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              placeholder="메시지를 입력하세요..."
              disabled={disabled}
              rows={1}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              data-form-type="other"
              data-lpignore="true"
              name="chat-message-input"
              enterKeyHint="send"
              className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />

            {/* Send / Stop button — 44px min touch target on mobile */}
            {streaming ? (
              <Button
                type="button"
                size="icon-sm"
                className="shrink-0 rounded-lg min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0"
                aria-label="중단"
                onClick={onAbort}
              >
                <Square className="size-3 animate-pulse" fill="currentColor" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                className="shrink-0 rounded-lg transition-opacity min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0"
                aria-label="전송"
                onClick={handleSend}
                disabled={disabled || !canSend}
              >
                <ArrowUp className="size-4" strokeWidth={2.5} />
              </Button>
            )}
          </div>

          {/* Drag overlay */}
          <AnimatePresence>
            {isDragging && (
              <motion.div
                className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-xl sm:rounded-2xl border-2 border-dashed border-primary/50 bg-primary/5 text-sm text-muted-foreground"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                <Paperclip className="size-4" />
                <span>파일을 놓으면 첨부됩니다</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        </div>
      </div>
      {!isMobile && (
        <p className="mt-1 text-center text-[10px] sm:text-[11px] text-muted-foreground/50">
          v{import.meta.env.VITE_APP_VERSION || "0.0.0"} · {import.meta.env.MODE}
        </p>
      )}
    </div>
  );
}
