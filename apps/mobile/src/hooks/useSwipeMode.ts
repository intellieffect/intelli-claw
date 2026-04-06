/**
 * useSwipeMode — #291
 *
 * Mobile counterpart of `apps/web/src/lib/hooks/use-swipe-gesture.ts`
 * `useSwipeMode`. Persists the user's preference of what the horizontal
 * PagerView swipes between:
 *
 *   - "agent" — swipe cycles through different agents (current default)
 *   - "topic" — swipe cycles through topics/sessions of the current agent
 *
 * Single-agent setups auto-fall back to "topic" because there's nothing to
 * swipe between in agent mode.
 *
 * Storage: AsyncStorage (mobile equivalent of localStorage). Reads happen
 * once on mount; writes are fire-and-forget.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type SwipeMode = "agent" | "topic";

const STORAGE_KEY = "awf:swipe-mode";

/** Pure: validate / coerce a stored value into a SwipeMode. */
export function coerceSwipeMode(value: unknown, agentCount: number): SwipeMode {
  const v = value === "agent" || value === "topic" ? value : "agent";
  // Single-agent setups have nothing to swipe between in agent mode.
  if (agentCount <= 1 && v === "agent") return "topic";
  return v;
}

/** Pure: cycle index helper, mirrors web's getNextAgentIndex/getNextTopicIndex. */
export function getNextIndex(
  current: number,
  total: number,
  direction: "left" | "right",
): number {
  if (total <= 1) return 0;
  // Right swipe → previous, left swipe → next (matches PagerView semantics)
  const delta = direction === "right" ? -1 : 1;
  return (current + delta + total) % total;
}

export interface UseSwipeModeReturn {
  mode: SwipeMode;
  setMode: (next: SwipeMode) => void;
  /** True after the initial AsyncStorage read resolved. */
  ready: boolean;
}

/**
 * Mobile React hook for `SwipeMode`. Uses AsyncStorage so the choice
 * survives app restarts. Defaults to "agent" (or "topic" when only one
 * agent exists).
 */
export function useSwipeMode(agentCount: number): UseSwipeModeReturn {
  const [mode, setModeState] = useState<SwipeMode>("agent");
  const [ready, setReady] = useState(false);
  const mountedRef = useRef(true);

  // Initial read
  useEffect(() => {
    mountedRef.current = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!mountedRef.current) return;
        setModeState(coerceSwipeMode(stored, agentCount));
        setReady(true);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setModeState(coerceSwipeMode(null, agentCount));
        setReady(true);
      });
    return () => { mountedRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-coerce when agentCount drops to 1 while in agent mode
  useEffect(() => {
    if (!ready) return;
    if (agentCount <= 1 && mode === "agent") {
      setModeState("topic");
    }
  }, [agentCount, mode, ready]);

  const setMode = useCallback((next: SwipeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => { /* best effort */ });
  }, []);

  return { mode, setMode, ready };
}
