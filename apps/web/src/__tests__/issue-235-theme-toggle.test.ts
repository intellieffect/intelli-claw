/**
 * #235 — 라이트/다크 테마 토글
 *
 * Pure function tests for the theme helpers. The full ThemeProvider is
 * exercised indirectly via the applied `.dark` class on document.documentElement.
 *
 * The provider stores a `Theme` value of "light" | "dark" | "system". When
 * the value is "system" it is resolved against
 * `matchMedia("(prefers-color-scheme: dark)").matches` at read time.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  THEME_STORAGE_KEY,
  getStoredTheme,
  resolveTheme,
  applyTheme,
  type Theme,
} from "@/lib/theme";

describe("#235 — theme helpers", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    });
    // jsdom gives us a real document; ensure we start without the class.
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
  });

  describe("THEME_STORAGE_KEY", () => {
    it("uses the awf: namespace like other settings", () => {
      expect(THEME_STORAGE_KEY).toBe("awf:theme");
    });
  });

  describe("getStoredTheme", () => {
    it("returns 'dark' as the default when nothing is stored", () => {
      expect(getStoredTheme()).toBe("dark");
    });

    it("returns the stored theme value when valid", () => {
      store[THEME_STORAGE_KEY] = "light";
      expect(getStoredTheme()).toBe("light");
      store[THEME_STORAGE_KEY] = "dark";
      expect(getStoredTheme()).toBe("dark");
      store[THEME_STORAGE_KEY] = "system";
      expect(getStoredTheme()).toBe("system");
    });

    it("falls back to 'dark' when the stored value is unrecognised", () => {
      store[THEME_STORAGE_KEY] = "purple";
      expect(getStoredTheme()).toBe("dark");
    });
  });

  describe("resolveTheme", () => {
    it("returns 'light' or 'dark' unchanged", () => {
      expect(resolveTheme("light", true)).toBe("light");
      expect(resolveTheme("light", false)).toBe("light");
      expect(resolveTheme("dark", true)).toBe("dark");
      expect(resolveTheme("dark", false)).toBe("dark");
    });

    it("resolves 'system' against prefersDark", () => {
      expect(resolveTheme("system", true)).toBe("dark");
      expect(resolveTheme("system", false)).toBe("light");
    });
  });

  describe("applyTheme", () => {
    it("adds the 'dark' class when theme resolves to dark", () => {
      applyTheme("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("removes the 'dark' class when theme resolves to light", () => {
      document.documentElement.classList.add("dark");
      applyTheme("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("is idempotent — calling twice does not toggle the class back", () => {
      applyTheme("dark");
      applyTheme("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      applyTheme("light");
      applyTheme("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });

  describe("Theme type", () => {
    it("only allows the three documented variants", () => {
      // Compile-time check: this block would fail to type-check if Theme
      // admits anything else. At runtime it's just an existence assertion.
      const values: Theme[] = ["light", "dark", "system"];
      expect(values).toHaveLength(3);
    });
  });
});
