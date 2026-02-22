"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getEffectiveShortcuts,
  loadCustomBindings,
  saveCustomBindings,
  eventToKeyString,
  type ShortcutDef,
  type CustomBindings,
} from "@/lib/shortcuts";
import { Pencil, RotateCcw } from "lucide-react";

export function ShortcutHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>([]);
  const [customBindings, setCustomBindings] = useState<CustomBindings>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);

  // Load on open
  useEffect(() => {
    if (open) {
      setShortcuts(getEffectiveShortcuts());
      setCustomBindings(loadCustomBindings());
      setEditingId(null);
      setRecording(false);
    }
  }, [open]);

  // Record key combo when editing
  useEffect(() => {
    if (!recording || !editingId) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const keyStr = eventToKeyString(e);
      if (!keyStr) return; // modifier-only press

      // Save the new binding
      const updated = { ...customBindings, [editingId]: keyStr };
      setCustomBindings(updated);
      saveCustomBindings(updated);
      setShortcuts(getEffectiveShortcuts());
      setEditingId(null);
      setRecording(false);
    };

    // Use capture to intercept before other handlers
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [recording, editingId, customBindings]);

  const startEditing = useCallback((id: string) => {
    setEditingId(id);
    setRecording(true);
  }, []);

  const resetBinding = useCallback((id: string) => {
    const updated = { ...customBindings };
    delete updated[id];
    setCustomBindings(updated);
    saveCustomBindings(updated);
    setShortcuts(getEffectiveShortcuts());
    setEditingId(null);
    setRecording(false);
  }, [customBindings]);

  const resetAll = useCallback(() => {
    setCustomBindings({});
    saveCustomBindings({});
    setShortcuts(getEffectiveShortcuts());
    setEditingId(null);
    setRecording(false);
  }, []);

  if (!open) return null;

  const hasCustom = Object.keys(customBindings).length > 0;

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</h3>
          <div className="flex items-center gap-2">
            {hasCustom && (
              <button
                onClick={resetAll}
                className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                title="모든 단축키 초기화"
              >
                <RotateCcw size={10} />
                전체 초기화
              </button>
            )}
            <button onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">ESC</button>
          </div>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-3">
          <p className="mb-3 text-[11px] text-zinc-500">
            단축키를 변경하려면 ✏️ 아이콘을 클릭 후 원하는 키 조합을 누르세요.
          </p>
          {shortcuts.map((s) => {
            const isEditing = editingId === s.id && recording;
            const isCustom = !!customBindings[s.id];

            return (
              <div key={s.id} className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-zinc-800/50">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-200">{s.description}</span>
                  {isCustom && (
                    <button
                      onClick={() => resetBinding(s.id)}
                      className="rounded p-0.5 text-zinc-600 hover:text-zinc-400"
                      title="기본값으로 복원"
                    >
                      <RotateCcw size={10} />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {isEditing ? (
                    <kbd className="animate-pulse rounded border border-amber-600 bg-amber-900/30 px-2 py-0.5 text-xs text-amber-300">
                      키 입력 대기중…
                    </kbd>
                  ) : (
                    <kbd className={`rounded border px-2 py-0.5 text-xs ${
                      isCustom
                        ? "border-amber-700 bg-amber-900/20 text-amber-300"
                        : "border-zinc-700 bg-zinc-800 text-zinc-300"
                    }`}>
                      {s.keys}
                    </kbd>
                  )}
                  <button
                    onClick={() => startEditing(s.id)}
                    className="rounded p-1 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"
                    title="단축키 변경"
                  >
                    <Pencil size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
