
import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";

export function sanitizeTopicName(raw: string): string | null {
  let s = raw
    .trim()
    .toLowerCase()
    // replace spaces with hyphens
    .replace(/\s+/g, "-")
    // remove anything that isn't alphanumeric, hangul (가-힣,ㄱ-ㅎ,ㅏ-ㅣ), or hyphens
    .replace(/[^a-z0-9가-힣ㄱ-ㅎㅏ-ㅣ\-]/g, "")
    // collapse consecutive hyphens
    .replace(/-{2,}/g, "-")
    // trim leading/trailing hyphens
    .replace(/^-+|-+$/g, "");

  if (!s) return null;
  if (s.length > 50) s = s.slice(0, 50);
  return s;
}

interface TopicNameDialogProps {
  open: boolean;
  onConfirm: (name: string | null) => void;
  onCancel: () => void;
}

export function TopicNameDialog({ open, onConfirm, onCancel }: TopicNameDialogProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      // auto-focus after portal mount
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const handleSubmit = useCallback(() => {
    const sanitized = sanitizeTopicName(value);
    onConfirm(sanitized);
  }, [value, onConfirm]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener("keydown", handler, true);
    return () => document.removeEventListener("keydown", handler, true);
  }, [open, onCancel]);

  if (!open) return null;

  const container = document.getElementById("portal-root") || document.body;

  return createPortal(
    <div className="fixed inset-0 z-[200]" role="dialog" aria-modal="true" data-testid="topic-name-dialog">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="absolute left-1/2 top-1/2 w-[min(92vw,400px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <h3 className="mb-3 text-sm font-semibold text-zinc-100">
          새 토픽 이름
        </h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="토픽 이름 입력..."
            maxLength={50}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-zinc-500 transition"
            data-testid="topic-name-input"
          />
          <p className="mt-1.5 text-[11px] text-zinc-500">
            비워두면 자동 생성됩니다. Enter 확인, Esc 취소
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
            >
              취소
            </button>
            <button
              type="submit"
              className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs text-zinc-100 hover:bg-zinc-600 transition"
            >
              생성
            </button>
          </div>
        </form>
      </div>
    </div>,
    container,
  );
}
