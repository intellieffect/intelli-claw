"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Bot, Check } from "lucide-react";
import type { Agent } from "@/lib/gateway/protocol";

export function AgentSelector({
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

  const selected = agents.find((a) => a.id === selectedId);

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
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm text-foreground transition hover:border-border hover:bg-muted"
      >
        <Bot size={14} className="text-primary" />
        <span className="max-w-[120px] truncate">
          {selected?.name || "Auto"}
        </span>
        <ChevronDown size={14} className={`transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-lg border border-border bg-muted py-1 shadow-xl">
          <button
            onClick={() => {
              onSelect(undefined);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            <Bot size={14} className="text-muted-foreground" />
            <span className="flex-1">Auto (기본)</span>
            {!selectedId && <Check size={14} className="text-primary" />}
          </button>

          <div className="mx-2 my-1 border-t border-border" />

          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => {
                onSelect(agent.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
            >
              <Bot size={14} className="text-primary" />
              <div className="flex-1 min-w-0">
                <div className="truncate">{agent.name}</div>
                {agent.model && (
                  <div className="truncate text-xs text-muted-foreground">{agent.model}</div>
                )}
              </div>
              {selectedId === agent.id && (
                <Check size={14} className="text-primary" />
              )}
            </button>
          ))}

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
