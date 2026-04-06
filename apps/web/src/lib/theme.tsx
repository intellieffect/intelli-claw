/**
 * theme.tsx — #235 light/dark/system theme management.
 *
 * Usage:
 *
 *   <ThemeProvider>
 *     <App />
 *   </ThemeProvider>
 *
 * Then inside any component:
 *
 *   const { theme, setTheme, resolved } = useTheme();
 *
 * The `resolved` value is "light" or "dark" (never "system"); it is what's
 * actually applied to `document.documentElement` via the `dark` class.
 *
 * Pure helpers (`getStoredTheme`, `resolveTheme`, `applyTheme`) are exported
 * so the logic can be unit-tested without mounting the provider.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "awf:theme";

const THEME_VALUES: readonly Theme[] = ["light", "dark", "system"] as const;

/**
 * Read the persisted theme preference. Defaults to "dark" so existing
 * installs (which never had a stored value) keep the current behaviour.
 */
export function getStoredTheme(): Theme {
  try {
    const raw = typeof localStorage !== "undefined"
      ? localStorage.getItem(THEME_STORAGE_KEY)
      : null;
    if (raw && (THEME_VALUES as readonly string[]).includes(raw)) {
      return raw as Theme;
    }
  } catch { /* ignore — SSR / disabled storage */ }
  return "dark";
}

/** Resolve a possibly-"system" theme against the user's OS preference. */
export function resolveTheme(theme: Theme, prefersDark: boolean): "light" | "dark" {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

/**
 * Apply a resolved theme to `document.documentElement`. Idempotent.
 * Safe to call in effects or inline — calling with the same value twice is a
 * no-op thanks to `classList.toggle`'s second argument.
 */
export function applyTheme(resolved: "light" | "dark"): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

// ─── React context ────────────────────────────────────────────────────────

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolved: "light" | "dark";
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
  resolved: "dark",
});

function readPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return true; // default dark, matches getStoredTheme fallback
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [prefersDark, setPrefersDark] = useState<boolean>(() => readPrefersDark());

  const resolved = resolveTheme(theme, prefersDark);

  // Apply + persist on every theme/resolved change.
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Listen to OS-level preference changes so "system" stays live.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setPrefersDark(e.matches);
    // Safari < 14 uses addListener/removeListener
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch { /* ignore */ }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, resolved }),
    [theme, setTheme, resolved],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
