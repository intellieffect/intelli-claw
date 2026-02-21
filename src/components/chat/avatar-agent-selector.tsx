"use client";

import { useState, useRef, useEffect } from "react";
import { Check } from "lucide-react";
import type { Agent } from "@/lib/gateway/protocol";
import { getAgentAvatar } from "@/lib/agent-avatars";
import { cn } from "@/lib/utils";

export function AvatarAgentSelector({
  agents,
  selectedId,
  onSelect,
}: {
  agents: Agent[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const avatar = getAgentAvatar(selectedId);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full text-lg transition-all hover:scale-110 hover:ring-2 hover:ring-ring/30 md:size-14 md:text-2xl",
          avatar.color
        )}
        title={selectedId ? `${selectedId} · 클릭하여 변경` : "에이전트 선택"}
      >
        {avatar.emoji}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-52 rounded-xl border border-border bg-popover py-1 shadow-xl">
          {agents.map((agent) => {
            const av = getAgentAvatar(agent.id);
            return (
              <button
                key={agent.id}
                onClick={() => {
                  onSelect(agent.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground transition hover:bg-accent"
              >
                <div
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                    av.color
                  )}
                >
                  {av.emoji}
                </div>
                <span className="flex-1 truncate">{agent.name}</span>
                {selectedId === agent.id && (
                  <Check size={14} className="shrink-0 text-primary" />
                )}
              </button>
            );
          })}

          {agents.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              에이전트 없음
            </div>
          )}
        </div>
      )}
    </div>
  );
}
