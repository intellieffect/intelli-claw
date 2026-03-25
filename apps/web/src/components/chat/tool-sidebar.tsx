
import { useEffect, useCallback, useState, useRef } from "react";
import {
  X, Copy, Check, Loader2, CheckCircle2, AlertCircle, Wrench,
  Maximize2, Minimize2,
} from "lucide-react";
import { MarkdownRenderer } from "./markdown-renderer";
import type { ToolCall } from "@intelli-claw/shared";
import { resolveToolDisplay } from "@/lib/gateway/tool-display";

interface ToolSidebarProps {
  toolCall: ToolCall;
  onClose: () => void;
  /** Mobile overlay mode */
  overlay?: boolean;
}

/** Format JSON with indentation, or return raw string */
function formatJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/** Detect if string is valid JSON */
function isJson(s: string): boolean {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

/** Wrap JSON in markdown code block for syntax highlighting */
function formatResultForDisplay(result: string): { content: string; isJsonResult: boolean } {
  const trimmed = result.trim();
  if (isJson(trimmed)) {
    const formatted = formatJson(trimmed);
    return { content: "```json\n" + formatted + "\n```", isJsonResult: true };
  }
  return { content: trimmed, isJsonResult: false };
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-zinc-700/50 hover:text-zinc-300 transition"
      title={`${label || "내용"} 복사`}
    >
      {copied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
      {copied ? "복사됨" : "복사"}
    </button>
  );
}

const MIN_WIDTH = 280;
const MAX_WIDTH_PERCENT = 0.6;
const STORAGE_KEY = "awf:tool-sidebar-width";

function getStoredWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v ? Math.max(MIN_WIDTH, parseInt(v, 10)) : 420;
  } catch {
    return 420;
  }
}

/**
 * Tool output sidebar panel (#232).
 * Shows full tool call details: args + result with syntax highlighting.
 * Desktop: side panel with drag resize. Mobile: overlay modal.
 */
export function ToolSidebar({ toolCall, onClose, overlay }: ToolSidebarProps) {
  const display = resolveToolDisplay(toolCall.name);
  const [width, setWidth] = useState(getStoredWidth);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const lastClientXRef = useRef(0);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Drag resize handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (me: MouseEvent) => {
      if (!draggingRef.current) return;
      lastClientXRef.current = me.clientX;
      const delta = startXRef.current - me.clientX; // drag left = wider
      const maxWidth = window.innerWidth * MAX_WIDTH_PERCENT;
      const newWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidthRef.current + delta));
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      // Persist final width (compute from last mousemove, not captured closure)
      const finalDelta = startXRef.current - (lastClientXRef.current ?? startXRef.current);
      const maxWidth = window.innerWidth * MAX_WIDTH_PERCENT;
      const finalWidth = Math.min(maxWidth, Math.max(MIN_WIDTH, startWidthRef.current + finalDelta));
      try { localStorage.setItem(STORAGE_KEY, String(Math.round(finalWidth))); } catch {}
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [width]);

  const statusIcon =
    toolCall.status === "running" ? (
      <Loader2 size={14} className="animate-spin text-primary" />
    ) : toolCall.status === "done" ? (
      <CheckCircle2 size={14} className="text-emerald-400" />
    ) : (
      <AlertCircle size={14} className="text-destructive" />
    );

  const formattedArgs = toolCall.args ? formatJson(toolCall.args) : null;
  const resultDisplay = toolCall.result ? formatResultForDisplay(toolCall.result) : null;

  const content = (
    <div className="flex h-full flex-col bg-zinc-900 border-l border-zinc-700/60">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-zinc-700/60 px-3 py-2.5 shrink-0">
        {statusIcon}
        <Wrench size={14} className="text-muted-foreground" />
        <span className="flex-1 text-sm font-medium text-zinc-200 truncate">{display.label}</span>
        <button
          onClick={onClose}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-700/50 hover:text-zinc-300 transition"
          aria-label="사이드바 닫기"
        >
          <X size={16} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-4">
        {/* Tool name + call ID */}
        <div className="text-[11px] text-zinc-500 font-mono">
          {toolCall.name}
          {toolCall.callId && (
            <span className="ml-2 text-zinc-600">({toolCall.callId.slice(0, 12)})</span>
          )}
        </div>

        {/* Arguments */}
        {formattedArgs && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Arguments</span>
              <CopyButton text={formattedArgs} label="Arguments" />
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-zinc-800/60 p-3 text-xs text-zinc-300 font-mono border border-zinc-700/40">
              {formattedArgs}
            </pre>
          </div>
        )}

        {/* Result */}
        {resultDisplay && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Result</span>
              <CopyButton text={toolCall.result!} label="Result" />
            </div>
            {resultDisplay.isJsonResult ? (
              <div className="rounded-lg border border-zinc-700/40 overflow-hidden">
                <div className="prose prose-sm prose-invert max-w-none [&_pre]:max-h-none [&_pre]:m-0 [&_pre]:rounded-none">
                  <MarkdownRenderer content={resultDisplay.content} />
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-zinc-800/60 border border-zinc-700/40 p-3">
                <div className="prose prose-sm prose-invert max-w-none text-xs">
                  <MarkdownRenderer content={resultDisplay.content} />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Running state */}
        {toolCall.status === "running" && !toolCall.result && (
          <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2.5 text-xs text-primary">
            <Loader2 size={14} className="animate-spin" />
            실행 중...
          </div>
        )}
      </div>
    </div>
  );

  // Mobile: overlay modal
  if (overlay) {
    return (
      <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
        <div className="absolute inset-0 bg-black/50" onClick={onClose} />
        <div className="absolute inset-x-0 bottom-0 top-16 rounded-t-xl overflow-hidden shadow-2xl">
          {content}
        </div>
      </div>
    );
  }

  // Desktop: side panel with drag resize
  return (
    <div className="relative flex shrink-0 h-full" style={{ width }}>
      {/* Drag resize handle */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/30 active:bg-primary/50 transition-colors z-10"
        title="드래그하여 너비 조절"
      />
      {content}
    </div>
  );
}
