import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Electron 멀티 윈도우 환경에서 localStorage 키 충돌을 방지하기 위한 윈도우별 prefix.
 * 단일 윈도우 환경에서는 빈 문자열을 반환합니다.
 */
export function windowStoragePrefix(): string {
  if (typeof window === "undefined") return "";
  const id = (window as any).__awfWindowId;
  return id ? `w${id}:` : "";
}
