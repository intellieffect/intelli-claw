"use client";

import { SHORTCUTS } from "@/lib/shortcuts";

export function ShortcutHelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[min(92vw,640px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</h3>
          <button onClick={onClose} className="rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200">ESC</button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-3">
          {SHORTCUTS.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-md px-2 py-2 hover:bg-zinc-800/50">
              <div className="text-sm text-zinc-200">{s.description}</div>
              <kbd className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300">{s.keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
