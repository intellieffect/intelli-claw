
import React, { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";

interface ThinkingBlockProps {
  thinking: Array<{ text: string }>;
  streaming?: boolean;
}

/**
 * Collapsible thinking/reasoning block (#222).
 * Auto-expands during streaming, auto-collapses when streaming completes.
 */
export function ThinkingBlock({ thinking, streaming }: ThinkingBlockProps) {
  const [open, setOpen] = useState(false);

  // Auto-expand during streaming, auto-collapse when done
  useEffect(() => {
    if (streaming) {
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [streaming]);

  if (!thinking || thinking.length === 0) return null;

  const combinedText = thinking.map((t) => t.text).join("\n\n");

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        className="flex items-center gap-1.5 text-xs text-amber-400/70 hover:text-amber-400 transition-colors"
        aria-expanded={open}
        data-testid="thinking-toggle"
      >
        <ChevronDown
          size={14}
          className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
        />
        <span className="italic">Reasoning</span>
        {streaming && (
          <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
        )}
      </button>
      {open && (
        <div
          className="mt-1.5 border-l-2 border-amber-500/40 bg-zinc-800/30 rounded-r-lg pl-3 pr-2 py-2 text-xs text-zinc-400 italic whitespace-pre-wrap"
          data-testid="thinking-content"
        >
          {combinedText}
        </div>
      )}
    </div>
  );
}
