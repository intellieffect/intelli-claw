"use client";

import { useState, useEffect } from "react";
import {
  Settings2,
  RotateCcw,
  Trash2,
  Brain,
  Monitor,
  Zap,
  ChevronDown,
} from "lucide-react";
import { useSessionSettings } from "@/lib/gateway/use-session-settings";

const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "Off",
  low: "Low",
  medium: "Medium",
  high: "High",
};

interface SessionSettingsProps {
  sessionKey?: string;
  onDelete?: () => void;
  onReset?: () => void;
}

export function SessionSettings({ sessionKey, onDelete, onReset }: SessionSettingsProps) {
  const { session, models, loading, patchSession, setThinking, setVerbose, resetSession, deleteSession, refresh } =
    useSessionSettings(sessionKey);

  const [open, setOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setModelOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Refresh session on open
  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!sessionKey) return null;

  const currentThinking = (session?.thinking as ThinkingLevel) || "off";

  const formatTokens = (n?: number) => {
    if (n == null || n === 0) return null;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
  };

  const totalStr = formatTokens(session?.totalTokens);
  const ctxStr = formatTokens(session?.contextTokens);

  const currentModelName = session?.model && session.model !== "default"
    ? (models.find((m) => m.id === session.model)?.name || session.model.split("/").pop())
    : "Default";

  return (
    <>
      <button
        onClick={() => setOpen((p) => !p)}
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
      >
        <Settings2 size={14} />
      </button>

      {open && (
        <div className="fixed inset-0 z-[120]" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute left-1/2 top-1/2 w-[min(92vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700/80 bg-zinc-900 shadow-2xl">
          {/* Token usage */}
          {(totalStr || ctxStr) && (
            <div className="flex items-center gap-3 border-b border-zinc-800 px-3 py-2">
              <Zap size={11} className="text-amber-500" />
              <div className="flex gap-3 text-[11px]">
                {totalStr && <span className="text-zinc-400">Total: <span className="text-zinc-200">{totalStr}</span></span>}
                {ctxStr && <span className="text-zinc-400">Context: <span className="text-zinc-200">{ctxStr}</span></span>}
              </div>
            </div>
          )}

          {/* Model */}
          <div className="border-b border-zinc-800 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium text-zinc-500">
              <Monitor size={10} /> Model
            </div>
            <button
              onClick={() => setModelOpen((p) => !p)}
              className="flex w-full items-center justify-between rounded-md bg-zinc-800/60 px-2 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              <span className="truncate">{currentModelName}</span>
              <ChevronDown size={12} className={`text-zinc-500 transition-transform ${modelOpen ? "rotate-180" : ""}`} />
            </button>
            {modelOpen && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-zinc-700/50 bg-zinc-850">
                <button
                  onClick={() => { patchSession({ model: "default" }); setModelOpen(false); }}
                  className="w-full px-2 py-1.5 text-left text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                >
                  Default (agent config)
                </button>
                {models.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { patchSession({ model: m.id }); setModelOpen(false); }}
                    className={`w-full px-2 py-1.5 text-left text-[11px] hover:bg-zinc-800 hover:text-zinc-200 ${
                      session?.model === m.id ? "text-amber-400" : "text-zinc-400"
                    }`}
                  >
                    {m.name || m.id}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Thinking */}
          <div className="border-b border-zinc-800 px-3 py-2">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-zinc-500">
              <Brain size={10} /> Thinking
            </div>
            <div className="flex gap-1">
              {THINKING_LEVELS.map((level) => (
                <button
                  key={level}
                  onClick={() => setThinking(level)}
                  disabled={loading}
                  className={`flex-1 rounded-md py-1 text-[11px] font-medium transition-colors ${
                    currentThinking === level
                      ? "bg-amber-600/80 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                  }`}
                >
                  {THINKING_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          {/* Verbose */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-500">
              <Monitor size={10} /> Verbose
            </span>
            <button
              onClick={() => setVerbose(!(session?.verbose ?? false))}
              className={`h-5 w-9 rounded-full transition-colors ${
                session?.verbose ? "bg-amber-600" : "bg-zinc-700"
              }`}
            >
              <div className={`h-4 w-4 rounded-full bg-white transition-transform ${
                session?.verbose ? "translate-x-4.5" : "translate-x-0.5"
              }`} />
            </button>
          </div>

          {/* Actions */}
          <div className="flex gap-2 px-3 py-2">
            <button
              onClick={async () => { await resetSession(); onReset?.(); setOpen(false); }}
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-zinc-800 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
            >
              <RotateCcw size={11} /> Reset
            </button>
            {confirmDelete ? (
              <div className="flex flex-1 gap-1">
                <button
                  onClick={async () => { await deleteSession(); onDelete?.(); setOpen(false); }}
                  className="flex-1 rounded-md bg-red-600/80 py-1.5 text-[11px] text-white hover:bg-red-600"
                >
                  확인
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 rounded-md bg-zinc-800 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-700"
                >
                  취소
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={loading}
                className="flex flex-1 items-center justify-center gap-1 rounded-md bg-zinc-800 py-1.5 text-[11px] text-red-400 hover:bg-zinc-700 hover:text-red-300"
              >
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
          </div>
        </div>
      )}
    </>
  );
}
