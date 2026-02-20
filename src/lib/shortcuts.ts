// --- Shortcut types ---

export type ShortcutDef = {
  id: string;
  /** Default key combo (display string) */
  keys: string;
  description: string;
  scope?: "global" | "panel";
};

// --- Default shortcuts ---

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { id: "help", keys: "Cmd+/", description: "단축키 도움말 열기", scope: "global" },
  { id: "add-panel", keys: "Cmd+\\", description: "패널 추가 (가로)", scope: "global" },
  { id: "add-panel-alt", keys: "Cmd+-", description: "패널 추가 (대체)", scope: "global" },
  { id: "focus-left", keys: "Opt+H", description: "왼쪽 패널 포커스", scope: "global" },
  { id: "focus-right", keys: "Opt+L", description: "오른쪽 패널 포커스", scope: "global" },
  { id: "focus-up", keys: "Opt+K", description: "위 패널 포커스 (=왼쪽)", scope: "global" },
  { id: "focus-down", keys: "Opt+J", description: "아래 패널 포커스 (=오른쪽)", scope: "global" },
  { id: "swap-panels", keys: "Cmd+Ctrl+Shift+S", description: "패널 위치 스왑", scope: "global" },
  { id: "close-panel", keys: "Ctrl+X", description: "현재 패널 닫기", scope: "global" },
  { id: "reopen-panel", keys: "Ctrl+Shift+X", description: "닫은 패널 다시 열기", scope: "global" },
  { id: "new-session", keys: "Ctrl+N", description: "현재 패널 새 세션", scope: "panel" },
  { id: "session-switcher", keys: "Cmd+K", description: "세션 스위처 열기", scope: "panel" },
];

// Re-export for backward compat
export const SHORTCUTS = DEFAULT_SHORTCUTS;

// --- Storage ---

const STORAGE_KEY = "awf:custom-shortcuts";

export type CustomBindings = Record<string, string>; // id → keys

export function loadCustomBindings(): CustomBindings {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveCustomBindings(bindings: CustomBindings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

/** Get effective shortcuts (defaults + user overrides merged) */
export function getEffectiveShortcuts(): ShortcutDef[] {
  const custom = loadCustomBindings();
  return DEFAULT_SHORTCUTS.map((s) => ({
    ...s,
    keys: custom[s.id] || s.keys,
  }));
}

// --- Key matching ---

/**
 * Parse a display key string like "Cmd+Shift+K" into a normalized set.
 * Supports: Cmd, Ctrl, Shift, Opt/Alt, plus a main key.
 */
export function parseKeys(keys: string): { meta: boolean; ctrl: boolean; shift: boolean; alt: boolean; key: string } {
  const parts = keys.split("+").map((p) => p.trim().toLowerCase());
  return {
    meta: parts.includes("cmd") || parts.includes("meta"),
    ctrl: parts.includes("ctrl") || parts.includes("control"),
    shift: parts.includes("shift"),
    alt: parts.includes("opt") || parts.includes("alt") || parts.includes("option"),
    key: parts.filter((p) => !["cmd", "meta", "ctrl", "control", "shift", "opt", "alt", "option"].includes(p))[0] || "",
  };
}

/** Check if a KeyboardEvent matches a key combo string */
export function matchesShortcut(e: KeyboardEvent, keys: string): boolean {
  const combo = parseKeys(keys);

  if (combo.meta !== e.metaKey) return false;
  if (combo.ctrl !== e.ctrlKey) return false;
  if (combo.shift !== e.shiftKey) return false;
  if (combo.alt !== e.altKey) return false;

  // Normalize the event key
  const eventKey = e.key.toLowerCase();
  const eventCode = e.code.toLowerCase();

  // Match by key name or code
  const target = combo.key.toLowerCase();
  if (!target) return false;

  // Special key mappings
  const keyMap: Record<string, string[]> = {
    "/": ["/", "?", "slash"],
    "?": ["/", "?"],
    "\\": ["\\", "backslash"],
    "-": ["-", "minus"],
    "=": ["=", "equal"],
    "[": ["[", "bracketleft"],
    "]": ["]", "bracketright"],
  };

  if (keyMap[target]) {
    return keyMap[target].some((k) => eventKey === k || eventCode === `key${k}` || eventCode === k);
  }

  // Letter keys
  if (target.length === 1 && target >= "a" && target <= "z") {
    return eventCode === `key${target}` || eventKey === target;
  }

  // Number keys
  if (target.length === 1 && target >= "0" && target <= "9") {
    return eventKey === target || eventCode === `digit${target}`;
  }

  return eventKey === target;
}

/** Find a shortcut by id and check if event matches it */
export function matchesShortcutId(e: KeyboardEvent, id: string): boolean {
  const shortcuts = getEffectiveShortcuts();
  const shortcut = shortcuts.find((s) => s.id === id);
  if (!shortcut) return false;
  return matchesShortcut(e, shortcut.keys);
}

/** Convert a KeyboardEvent to a display string for recording custom shortcuts */
export function eventToKeyString(e: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (e.metaKey) parts.push("Cmd");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Opt");

  // Ignore modifier-only presses
  if (["Meta", "Control", "Shift", "Alt"].includes(e.key)) return null;

  // Normalize key display
  let key = e.key;
  if (key.length === 1) key = key.toUpperCase();
  else if (key === "Escape") key = "Esc";
  else if (key === "Backspace") key = "Backspace";
  else if (key === "Enter") key = "Enter";

  parts.push(key);
  return parts.join("+");
}

export function isShortcutHelp(e: KeyboardEvent) {
  return matchesShortcutId(e, "help");
}
