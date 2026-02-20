"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Paperclip, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAutosizeTextArea } from "@/hooks/use-autosize-textarea";
import {
  AttachmentPreview,
  type ChatAttachment,
} from "./file-attachments";
import { SkillPicker, BUILTIN_COMMANDS } from "./skill-picker";
import { useSkills } from "@/lib/gateway/use-skills";

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
}) {
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
  const storageKey = panelId ? `awf:draft:${panelId}` : null;
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
    onSend(text.trim());
    setText("");
    if (storageKey) localStorage.removeItem(storageKey);
  }, [text, disabled, onSend, canSend, storageKey]);

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

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend, skillPickerOpen, filteredSkills, filteredBuiltins, totalPickerItems, skillSelectedIndex, handleSkillSelect, onSend, storageKey]
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

  const showAttachments = onRemoveAttachment && attachments.length > 0;

  return (
    <div className="relative px-2 py-2 sm:px-3 sm:py-3 md:px-4 safe-bottom">
      {/* Skill picker */}
      <SkillPicker
        inputText={text}
        onSelect={handleSkillSelect}
        onDismiss={() => setSkillPickerOpen(false)}
        visible={skillPickerOpen}
      />

      <div
        className="mx-auto w-full max-w-3xl"
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
            "focus-within:border-primary focus-within:ring-[3px] focus-within:ring-ring/20"
          )}
        >
          {/* Toolbar: controls */}
          {toolbar && (
            <div className="flex items-center gap-2 px-2.5 pt-2 sm:px-3">
              {toolbar}
            </div>
          )}

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
            {/* Attach button */}
            {onAttachFiles && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
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
              className="min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-foreground placeholder:text-muted-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />

            {/* Send / Stop button */}
            {streaming ? (
              <Button
                type="button"
                size="icon-sm"
                className="shrink-0 rounded-lg"
                aria-label="중단"
                onClick={onAbort}
              >
                <Square className="size-3 animate-pulse" fill="currentColor" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon-sm"
                className="shrink-0 rounded-lg transition-opacity"
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
      <p className="mt-1 text-center text-[10px] sm:text-[11px] text-muted-foreground/50">
        Shift+Enter로 줄바꿈 · 에이전트는 실수할 수 있습니다
      </p>
    </div>
  );
}
