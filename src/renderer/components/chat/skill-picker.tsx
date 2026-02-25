"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Puzzle, ExternalLink, Terminal } from "lucide-react";
import { useSkills, type Skill } from "@/lib/gateway/use-skills";

// Built-in slash commands
export interface BuiltinCommand {
  name: string;
  description: string;
  emoji: string;
  /** If true, execute immediately on select (don't append to input) */
  immediate?: boolean;
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { name: "stop", description: "스트리밍 중단", emoji: "⏹️", immediate: true },
  { name: "new", description: "새 세션 시작", emoji: "✨", immediate: true },
  { name: "reset", description: "현재 세션 리셋", emoji: "🔄", immediate: true },
  { name: "status", description: "세션 상태 확인 (토큰, 모델 등)", emoji: "📊", immediate: true },
  { name: "reasoning", description: "추론 모드 토글", emoji: "🧠", immediate: true },
  { name: "model", description: "모델 변경 (예: /model opus)", emoji: "🤖" },
  { name: "help", description: "사용 가능한 커맨드 목록", emoji: "❓", immediate: true },
];

interface SkillPickerProps {
  /** Current input text to detect "/" trigger */
  inputText: string;
  /** Called when a skill slash command is selected */
  onSelect: (command: string) => void;
  /** Called to dismiss */
  onDismiss: () => void;
  /** Whether picker should be visible */
  visible: boolean;
}

export function SkillPicker({ inputText, onSelect, onDismiss, visible }: SkillPickerProps) {
  const { skills } = useSkills();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Only show eligible, non-disabled skills
  const activeSkills = useMemo(
    () => skills.filter((s) => s.eligible && !s.disabled),
    [skills]
  );

  // Extract search query after "/"
  const query = useMemo(() => {
    if (!visible) return "";
    const match = inputText.match(/^\/(\S*)$/);
    return match ? match[1].toLowerCase() : "";
  }, [inputText, visible]);

  // Filter built-in commands
  const filteredBuiltins = useMemo(() => {
    if (!query) return BUILTIN_COMMANDS;
    return BUILTIN_COMMANDS.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query)
    );
  }, [query]);

  // Filter skills by query
  const filtered = useMemo(() => {
    if (!query) return activeSkills;
    return activeSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query)
    );
  }, [activeSkills, query]);

  const totalCount = filteredBuiltins.length + filtered.length;

  // Reset selection on filter change
  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered.length, query]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!visible || totalCount === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 right-0 mx-auto max-w-3xl px-4 pb-2 z-50"
      onMouseDown={(e) => e.preventDefault()} // Prevent input blur
    >
      <div className="rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Commands & Skills</span>
          <span className="text-[10px] text-muted-foreground">
            {totalCount} available
          </span>
        </div>

        {/* List */}
        <div ref={listRef} className="max-h-64 overflow-y-auto py-1">
          {/* Built-in commands */}
          {filteredBuiltins.length > 0 && (
            <>
              {filteredBuiltins.map((cmd, i) => (
                <button
                  key={`cmd-${cmd.name}`}
                  onClick={() => {
                    if (cmd.immediate) {
                      onSelect(`/${cmd.name}`);
                    } else {
                      onSelect(`/${cmd.name} `);
                    }
                  }}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                    i === selectedIndex ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  <span className="text-base shrink-0">{cmd.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">
                        /{cmd.name}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{cmd.description}</p>
                  </div>
                </button>
              ))}
              {filtered.length > 0 && (
                <div className="mx-3 my-1 border-t border-border/30" />
              )}
            </>
          )}

          {/* Skills */}
          {filtered.map((skill, i) => {
            const idx = filteredBuiltins.length + i;
            return (
              <button
                key={skill.skillKey}
                onClick={() => onSelect(`/${skill.name} `)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
                  idx === selectedIndex ? "bg-muted" : "hover:bg-muted/50"
                }`}
              >
                <span className="text-base shrink-0">{skill.emoji || "🔧"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-foreground">
                      /{skill.name}
                    </span>
                    {skill.homepage && (
                      <ExternalLink className="h-2.5 w-2.5 text-muted-foreground" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{skill.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="border-t border-border/50 px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">
            ↑↓ 이동 · Enter 선택 · Esc 닫기
          </span>
        </div>
      </div>
    </div>
  );
}

/** Keyboard handler for the skill picker — call from ChatInput's onKeyDown */
export function useSkillPickerKeys(
  visible: boolean,
  filteredCount: number,
  selectedIndex: number,
  setSelectedIndex: (i: number | ((prev: number) => number)) => void,
  onSelect: (index: number) => void,
  onDismiss: () => void
) {
  return (e: React.KeyboardEvent) => {
    if (!visible) return false;

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredCount - 1));
      return true;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filteredCount - 1 ? prev + 1 : 0));
      return true;
    }
    if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault();
      onSelect(selectedIndex);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onDismiss();
      return true;
    }
    return false;
  };
}
