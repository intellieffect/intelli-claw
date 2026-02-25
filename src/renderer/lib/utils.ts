import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Returns a localStorage key prefix scoped to the current Electron window.
 * Window 0 (the first window / web mode) uses no prefix for backward compatibility.
 */
export function windowStoragePrefix(): string {
  if (typeof window === "undefined") return "";
  const api = (window as unknown as Record<string, unknown>).electronAPI as { windowId?: number } | undefined;
  const wid = api?.windowId;
  if (wid === undefined || wid === 0) return "";
  return `w${wid}:`;
}
