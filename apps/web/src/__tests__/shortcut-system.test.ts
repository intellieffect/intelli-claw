import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  matchesShortcut,
  matchesShortcutId,
  parseKeys,
  getEffectiveShortcuts,
  loadCustomBindings,
  saveCustomBindings,
  DEFAULT_SHORTCUTS,
} from "@/lib/shortcuts";

// jsdom userAgent doesn't contain "Mac", so isMac=false in test env.
// Shortcuts default to Ctrl-based (Windows/Linux) variants.
// We test against effective shortcuts to be OS-independent.
const isMacEnv = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

// --- Helper: create a KeyboardEvent with specific properties ---

function createKeyboardEvent(
  key: string,
  opts: {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    code?: string;
    repeat?: boolean;
  } = {}
): KeyboardEvent {
  const code =
    opts.code ??
    (key.length === 1 && key >= "a" && key <= "z"
      ? `Key${key.toUpperCase()}`
      : key.length === 1 && key >= "0" && key <= "9"
        ? `Digit${key}`
        : key === "\\"
          ? "Backslash"
          : key === "/"
            ? "Slash"
            : key === "Tab"
              ? "Tab"
              : `Key${key.toUpperCase()}`);

  return new KeyboardEvent("keydown", {
    key,
    code,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    shiftKey: opts.shiftKey ?? false,
    altKey: opts.altKey ?? false,
    bubbles: true,
    cancelable: true,
  });
}

// ============================================================
// 1. parseKeys — key combo 문자열 파싱
// ============================================================

describe("parseKeys", () => {
  it("parses Cmd+O correctly", () => {
    const result = parseKeys("Cmd+O");
    expect(result).toEqual({ meta: true, ctrl: false, shift: false, alt: false, key: "o" });
  });

  it("parses Ctrl+1 correctly", () => {
    const result = parseKeys("Ctrl+1");
    expect(result).toEqual({ meta: false, ctrl: true, shift: false, alt: false, key: "1" });
  });

  it("parses Cmd+Ctrl+Shift+S correctly", () => {
    const result = parseKeys("Cmd+Ctrl+Shift+S");
    expect(result).toEqual({ meta: true, ctrl: true, shift: true, alt: false, key: "s" });
  });

  it("parses Cmd+\\ correctly", () => {
    const result = parseKeys("Cmd+\\");
    expect(result).toEqual({ meta: true, ctrl: false, shift: false, alt: false, key: "\\" });
  });

  it("parses Tab (no modifier) correctly", () => {
    const result = parseKeys("Tab");
    expect(result).toEqual({ meta: false, ctrl: false, shift: false, alt: false, key: "tab" });
  });

  it("parses Shift+Tab correctly", () => {
    const result = parseKeys("Shift+Tab");
    expect(result).toEqual({ meta: false, ctrl: false, shift: true, alt: false, key: "tab" });
  });
});

// ============================================================
// 2. matchesShortcut — KeyboardEvent와 키 조합 문자열 매칭
// ============================================================

describe("matchesShortcut", () => {
  it("matches Cmd+O", () => {
    const e = createKeyboardEvent("o", { metaKey: true });
    expect(matchesShortcut(e, "Cmd+O")).toBe(true);
  });

  it("does not match Cmd+O when Ctrl is pressed instead", () => {
    const e = createKeyboardEvent("o", { ctrlKey: true });
    expect(matchesShortcut(e, "Cmd+O")).toBe(false);
  });

  it("matches Ctrl+1", () => {
    const e = createKeyboardEvent("1", { ctrlKey: true, code: "Digit1" });
    expect(matchesShortcut(e, "Ctrl+1")).toBe(true);
  });

  it("matches Cmd+\\", () => {
    const e = createKeyboardEvent("\\", { metaKey: true, code: "Backslash" });
    expect(matchesShortcut(e, "Cmd+\\")).toBe(true);
  });

  it("matches Tab without modifiers", () => {
    const e = createKeyboardEvent("Tab", { code: "Tab" });
    expect(matchesShortcut(e, "Tab")).toBe(true);
  });

  it("matches Shift+Tab", () => {
    const e = createKeyboardEvent("Tab", { shiftKey: true, code: "Tab" });
    expect(matchesShortcut(e, "Shift+Tab")).toBe(true);
  });

  it("does not match Tab when Shift is also pressed", () => {
    const e = createKeyboardEvent("Tab", { shiftKey: true, code: "Tab" });
    expect(matchesShortcut(e, "Tab")).toBe(false);
  });
});

// ============================================================
// 3. matchesShortcutId — 정의된 shortcut ID로 매칭
// ============================================================

describe("matchesShortcutId", () => {
  // Helper: use metaKey on Mac, ctrlKey elsewhere (matching how shortcuts.ts resolves)
  const cmdMod = isMacEnv ? { metaKey: true } : { ctrlKey: true };
  // For shortcuts that use Ctrl on Mac and Alt on non-Mac
  const ctrlMod = isMacEnv ? { ctrlKey: true } : { altKey: true };

  it("matches agent-browser (Cmd+O / Ctrl+O)", () => {
    const e = createKeyboardEvent("o", cmdMod);
    expect(matchesShortcutId(e, "agent-browser")).toBe(true);
  });

  it("matches session-switcher (Cmd+K / Ctrl+K)", () => {
    const e = createKeyboardEvent("k", cmdMod);
    expect(matchesShortcutId(e, "session-switcher")).toBe(true);
  });

  it("matches help (Cmd+/ / Ctrl+/)", () => {
    const e = createKeyboardEvent("/", { ...cmdMod, code: "Slash" });
    expect(matchesShortcutId(e, "help")).toBe(true);
  });

  it("next-session (Tab) removed — returns false", () => {
    const e = createKeyboardEvent("Tab", { code: "Tab" });
    expect(matchesShortcutId(e, "next-session")).toBe(false);
  });

  it("prev-session (Shift+Tab) removed — returns false", () => {
    const e = createKeyboardEvent("Tab", { shiftKey: true, code: "Tab" });
    expect(matchesShortcutId(e, "prev-session")).toBe(false);
  });

  it("returns false for unknown shortcut id", () => {
    const e = createKeyboardEvent("z", { metaKey: true });
    expect(matchesShortcutId(e, "nonexistent-shortcut")).toBe(false);
  });
});

// ============================================================
// 4. Custom bindings — 사용자 커스텀 바인딩
// ============================================================

describe("custom bindings", () => {
  const STORAGE_KEY = "awf:custom-shortcuts";
  let store: Record<string, string> = {};

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadCustomBindings returns empty when nothing saved", () => {
    expect(loadCustomBindings()).toEqual({});
  });

  it("saveCustomBindings + loadCustomBindings roundtrip", () => {
    const bindings = { "agent-browser": "Cmd+Shift+O", "add-panel": "Cmd+Shift+\\" };
    saveCustomBindings(bindings);
    expect(loadCustomBindings()).toEqual(bindings);
  });

  it("getEffectiveShortcuts applies custom bindings", () => {
    saveCustomBindings({ "agent-browser": "Cmd+Shift+O" });
    const effective = getEffectiveShortcuts();
    const agentBrowser = effective.find((s) => s.id === "agent-browser");
    expect(agentBrowser?.keys).toBe("Cmd+Shift+O");
  });

  it("matchesShortcutId respects custom bindings", () => {
    saveCustomBindings({ "agent-browser": "Cmd+Shift+O" });

    // Original Cmd+O should NOT match anymore
    const origEvent = createKeyboardEvent("o", { metaKey: true });
    expect(matchesShortcutId(origEvent, "agent-browser")).toBe(false);

    // New Cmd+Shift+O SHOULD match
    const newEvent = createKeyboardEvent("o", { metaKey: true, shiftKey: true });
    expect(matchesShortcutId(newEvent, "agent-browser")).toBe(true);
  });

  it("non-overridden shortcuts remain at defaults", () => {
    saveCustomBindings({ "agent-browser": "Cmd+Shift+O" });
    const effective = getEffectiveShortcuts();
    const sessionSwitcher = effective.find((s) => s.id === "session-switcher");
    // Default should be preserved
    expect(sessionSwitcher?.keys).toMatch(/K/);
  });
});

// ============================================================
// 5. close-tab → Opt+W / Alt+W (#133: Cmd+W should close window, not tab)
// ============================================================

describe("close-tab shortcut (#133)", () => {
  it("close-tab is mapped to Opt+W (Mac) or Alt+W (non-Mac), NOT Cmd+W/Ctrl+W", () => {
    const closeTab = DEFAULT_SHORTCUTS.find((s) => s.id === "close-tab");
    expect(closeTab).toBeDefined();
    // In jsdom (non-Mac): should be Alt+W
    // On Mac: should be Opt+W
    if (isMacEnv) {
      expect(closeTab!.keys).toBe("Opt+W");
    } else {
      expect(closeTab!.keys).toBe("Alt+W");
    }
  });

  it("Alt+W matches close-tab (non-Mac env)", () => {
    if (isMacEnv) return; // skip on Mac
    const e = createKeyboardEvent("w", { altKey: true });
    expect(matchesShortcutId(e, "close-tab")).toBe(true);
  });

  it("Ctrl+W does NOT match close-tab (non-Mac env)", () => {
    if (isMacEnv) return;
    const e = createKeyboardEvent("w", { ctrlKey: true });
    expect(matchesShortcutId(e, "close-tab")).toBe(false);
  });

  it("Cmd+W does NOT match close-tab on any platform", () => {
    const e = createKeyboardEvent("w", { metaKey: true });
    expect(matchesShortcutId(e, "close-tab")).toBe(false);
  });
});

// ============================================================
// 6. SplitView panel shortcuts removed (#134)
// ============================================================

describe("SplitView panel shortcuts removed (#134)", () => {
  const removedIds = [
    "add-panel",
    "focus-left",
    "focus-right",
    "swap-panels",
    "close-panel",
    "reopen-panel",
    "focus-panel-1",
    "focus-panel-2",
    "focus-panel-3",
    "focus-panel-4",
    "focus-panel-5",
  ];

  it("panel-related shortcuts are NOT in DEFAULT_SHORTCUTS", () => {
    const definedIds = DEFAULT_SHORTCUTS.map((s) => s.id);
    for (const id of removedIds) {
      expect(definedIds).not.toContain(id);
    }
  });

  it("matchesShortcutId returns false for removed panel shortcuts", () => {
    // Ctrl+\\ was add-panel
    const e = createKeyboardEvent("\\", { ctrlKey: true, code: "Backslash" });
    expect(matchesShortcutId(e, "add-panel")).toBe(false);

    // Ctrl+X was close-panel
    const e2 = createKeyboardEvent("x", { ctrlKey: true });
    expect(matchesShortcutId(e2, "close-panel")).toBe(false);

    // Ctrl+1 was focus-panel-1
    const e3 = createKeyboardEvent("1", { ctrlKey: true, code: "Digit1" });
    expect(matchesShortcutId(e3, "focus-panel-1")).toBe(false);
  });
});

// ============================================================
// 7. Shortcut definitions — 전체 shortcut 정의 완전성 검증
// ============================================================

describe("shortcut definitions completeness", () => {
  const requiredIds = [
    "help",
    "new-session",
    "abort-stream",
    "session-switcher",
    "agent-browser",
    "new-tab",
    "close-tab",
    "reopen-tab",
    "prev-session-bracket",
    "next-session-bracket",
    "scroll-bottom",
    "scroll-top",
  ];

  it("all core shortcuts are defined in DEFAULT_SHORTCUTS", () => {
    const definedIds = DEFAULT_SHORTCUTS.map((s) => s.id);
    for (const id of requiredIds) {
      expect(definedIds).toContain(id);
    }
  });

  it("every shortcut has a non-empty keys string", () => {
    for (const s of DEFAULT_SHORTCUTS) {
      expect(s.keys.length).toBeGreaterThan(0);
    }
  });

  it("every shortcut has a non-empty description", () => {
    for (const s of DEFAULT_SHORTCUTS) {
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  it("no duplicate shortcut ids", () => {
    const ids = DEFAULT_SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no duplicate key combos", () => {
    const keys = DEFAULT_SHORTCUTS.map((s) => s.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
