/**
 * Vim-style visual select helpers.
 * Pure functions for computing selection ranges.
 */

/** Compute inclusive range [start, end] from anchor and cursor positions. */
export function computeVisualRange(
  anchor: number,
  cursor: number,
): { start: number; end: number } {
  return {
    start: Math.min(anchor, cursor),
    end: Math.max(anchor, cursor),
  };
}

/** Given items with keys and an inclusive range, return the set of keys in that range. */
export function getSelectedKeysFromRange(
  items: { key: string }[],
  start: number,
  end: number,
): Set<string> {
  const clampedStart = Math.max(0, start);
  const clampedEnd = Math.min(items.length - 1, end);
  const keys = new Set<string>();
  for (let i = clampedStart; i <= clampedEnd; i++) {
    keys.add(items[i].key);
  }
  return keys;
}
