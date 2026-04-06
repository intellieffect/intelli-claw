/**
 * theme-toggle.tsx — #235
 *
 * Three-way segmented control: Light / System / Dark. Mirrors macOS Settings
 * appearance picker. Uses the `useTheme` hook from `@/lib/theme`.
 */
import { Moon, Sun, Monitor } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";

const OPTIONS: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: "light", label: "라이트", icon: Sun },
  { value: "system", label: "시스템", icon: Monitor },
  { value: "dark", label: "다크", icon: Moon },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="border-b border-border px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {theme === "dark" ? (
            <Moon size={10} className="text-muted-foreground" />
          ) : theme === "light" ? (
            <Sun size={10} className="text-muted-foreground" />
          ) : (
            <Monitor size={10} className="text-muted-foreground" />
          )}
          <label className="text-[10px] font-medium text-muted-foreground">테마</label>
        </div>
        <div
          role="radiogroup"
          aria-label="테마 선택"
          className="flex items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5"
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const active = theme === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={label}
                onClick={() => setTheme(value)}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                  active
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={10} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <p className="mt-1 text-[10px] text-muted-foreground/70">
        시스템: OS 설정을 따라 자동 전환
      </p>
    </div>
  );
}
