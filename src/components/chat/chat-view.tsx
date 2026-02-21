"use client";

import { useEffect, useState } from "react";
import { useGateway } from "@/lib/gateway/hooks";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { ConnectionStatus } from "./connection-status";
import { SplitView } from "./split-view";
import { ShortcutHelpDialog } from "./shortcut-help-dialog";
import { isShortcutHelp } from "@/lib/shortcuts";
import { Plus, Keyboard, Menu } from "lucide-react";

export function ChatView() {
  const { state } = useGateway();
  const isMobile = useIsMobile();
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isShortcutHelp(e)) {
        e.preventDefault();
        setShortcutOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") setShortcutOpen(false);

      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        (window as any).__awfSplitAddPanel?.();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!mounted) return <div className="h-dvh bg-background" />;

  return (
    <div className="flex h-dvh flex-col bg-background overflow-x-hidden max-w-[100vw]">
      <header className="safe-top relative z-20 flex items-center justify-between border-b border-border bg-background/80 px-3 py-1.5 md:px-4 md:py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-2 md:gap-3">
          {isMobile && (
            <button
              onClick={() => (window as any).__awfMobileSessionToggle?.()}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition active:bg-muted"
              aria-label="세션 목록"
            >
              <Menu size={18} />
            </button>
          )}
          <div className="flex items-center gap-1.5 md:gap-2">
            <img src="/logo.svg" alt="intelli-claw" className="h-5 w-5 md:h-6 md:w-6" />
            {!isMobile && <span className="text-sm font-semibold text-foreground">intelli-claw</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 md:gap-3">
          <ConnectionStatus state={state} />
          {!isMobile && (
            <button
              onClick={() => setShortcutOpen(true)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="단축키 (Cmd+/)"
            >
              <Keyboard size={14} />
              <span className="hidden sm:inline">단축키</span>
            </button>
          )}
          {!isMobile && (
            <button
              onClick={() => (window as any).__awfSplitAddPanel?.()}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
              title="패널 추가 (Cmd+\\)"
            >
              <Plus size={14} />
              <span className="hidden sm:inline">패널 추가</span>
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <SplitView />
      </div>

      <ShortcutHelpDialog open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
    </div>
  );
}
