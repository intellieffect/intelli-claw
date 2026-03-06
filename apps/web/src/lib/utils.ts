import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Per-window localStorage key prefix.
 *
 * - **Electron**: uses `electronAPI.windowId` (window 0 = "" for backward compat).
 * - **Web**: generates a unique tab ID stored in `sessionStorage` (per-tab,
 *   survives refresh, new tab gets new ID). Fixes #142 — multiple browser tabs
 *   sharing the same localStorage keys.
 */
export function windowStoragePrefix(): string {
  if (typeof window === "undefined") return "";

  // Electron — existing behavior preserved
  const api = (window as unknown as Record<string, unknown>).electronAPI as { windowId?: number } | undefined;
  if (api?.windowId != null) {
    return api.windowId === 0 ? "" : `w${api.windowId}:`;
  }

  // Web — per-tab unique prefix via sessionStorage
  const KEY = "__iclaw_window_id__";
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    sessionStorage.setItem(KEY, id);
  }
  return `${id}:`;
}
