import { useState, useCallback } from "react";

const STORAGE_KEY = "awf:show-thinking";

function getStored(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === "true";
  } catch {
    return true;
  }
}

/**
 * Simple localStorage-backed toggle for showing/hiding thinking blocks (#222).
 * Default: true (show thinking).
 */
export function useShowThinking(): [boolean, () => void] {
  const [show, setShow] = useState(getStored);

  const toggle = useCallback(() => {
    setShow((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  return [show, toggle];
}
