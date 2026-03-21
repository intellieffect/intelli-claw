/**
 * #260 — usePageVisibility hook
 *
 * Returns `true` when the page/tab is visible, `false` when hidden.
 * Uses the Page Visibility API (document.visibilitychange).
 *
 * Polling hooks should pause when the page is not visible
 * to reduce CPU/network usage in background Electron windows.
 */
import { useState, useEffect } from "react";

export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document !== "undefined" ? document.visibilityState === "visible" : true,
  );

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handler = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  return visible;
}
