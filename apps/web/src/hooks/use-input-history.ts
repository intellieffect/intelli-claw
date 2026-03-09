/**
 * useInputHistory — React hook for terminal-style input recall (#161).
 *
 * Provides push/navigate API for chat-input to cycle through previous
 * inputs with Arrow Up / Arrow Down.
 *
 * Navigation model:
 * - Arrow Up from the bottom (or when cursor === -1) → last entry
 * - Arrow Up continues backward through history
 * - Arrow Down moves forward; past the end restores the draft
 * - Starting navigation saves the current textarea value as "draft"
 * - Navigating past newest entry restores draft
 */

import { useRef, useCallback, useEffect } from "react";
import {
  pushInput,
  getInputHistory,
  MAX_ENTRIES_PER_SESSION,
  type InputEntry,
} from "@/lib/gateway/input-history-store";

export interface UseInputHistoryReturn {
  /**
   * Record a sent message into history.
   * Call this after successful send.
   */
  push: (text: string) => void;

  /**
   * Navigate up (older). Returns the text to display, or null if at top.
   * On first call, saves `currentText` as the draft.
   */
  navigateUp: (currentText: string) => string | null;

  /**
   * Navigate down (newer). Returns the text to display, or null if at bottom.
   * When navigating past the newest entry, returns the saved draft.
   */
  navigateDown: () => string | null;

  /**
   * Reset navigation state (e.g., after sending or when session changes).
   */
  reset: () => void;

  /**
   * Whether the user is currently browsing history.
   */
  isNavigating: boolean;
}

export function useInputHistory(sessionKey: string | undefined): UseInputHistoryReturn {
  // In-memory cache of the history for this session, loaded on mount/change
  const entriesRef = useRef<InputEntry[]>([]);
  // Current navigation index (-1 = not navigating, 0..N-1 = in history)
  const cursorRef = useRef<number>(-1);
  // Draft saved when navigation starts
  const draftRef = useRef<string>("");
  // Track the session key to reset on change
  const sessionKeyRef = useRef(sessionKey);

  // Load history when session changes
  useEffect(() => {
    if (sessionKey !== sessionKeyRef.current) {
      sessionKeyRef.current = sessionKey;
      cursorRef.current = -1;
      draftRef.current = "";
    }

    if (!sessionKey) {
      entriesRef.current = [];
      return;
    }

    let cancelled = false;
    getInputHistory(sessionKey).then((entries) => {
      if (!cancelled) {
        entriesRef.current = entries;
      }
    });
    return () => { cancelled = true; };
  }, [sessionKey]);

  const push = useCallback(
    (text: string) => {
      if (!sessionKey) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      // Optimistically add to in-memory cache (avoid re-read)
      const last = entriesRef.current[entriesRef.current.length - 1];
      if (!last || last.text !== trimmed) {
        entriesRef.current.push({
          sessionKey,
          text: trimmed,
          sentAt: Date.now(),
        });
        // Enforce cap in memory too
        if (entriesRef.current.length > MAX_ENTRIES_PER_SESSION) {
          entriesRef.current = entriesRef.current.slice(-MAX_ENTRIES_PER_SESSION);
        }
      }

      // Reset navigation
      cursorRef.current = -1;
      draftRef.current = "";

      // Persist asynchronously
      pushInput(sessionKey, trimmed).catch(() => {});
    },
    [sessionKey],
  );

  const navigateUp = useCallback(
    (currentText: string): string | null => {
      const entries = entriesRef.current;
      if (entries.length === 0) return null;

      if (cursorRef.current === -1) {
        // First navigation — save draft
        draftRef.current = currentText;
        cursorRef.current = entries.length - 1;
      } else if (cursorRef.current > 0) {
        cursorRef.current -= 1;
      } else {
        // Already at oldest — no change
        return null;
      }

      return entries[cursorRef.current].text;
    },
    [],
  );

  const navigateDown = useCallback((): string | null => {
    const entries = entriesRef.current;
    if (cursorRef.current === -1) return null; // Not navigating

    if (cursorRef.current < entries.length - 1) {
      cursorRef.current += 1;
      return entries[cursorRef.current].text;
    }

    // Past the end — restore draft
    cursorRef.current = -1;
    return draftRef.current;
  }, []);

  const reset = useCallback(() => {
    cursorRef.current = -1;
    draftRef.current = "";
  }, []);

  return {
    push,
    navigateUp,
    navigateDown,
    reset,
    get isNavigating() {
      return cursorRef.current !== -1;
    },
  };
}
