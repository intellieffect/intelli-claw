
import { useEffect, useState } from "react";
import { useGateway } from "@/lib/gateway/hooks";
import { useIsMobile } from "@/lib/hooks/use-mobile";
import { ConnectionStatus } from "./connection-status";
import { ConnectionSettings } from "@/components/settings/connection-settings";
import { ChatPanel } from "./chat-panel";
import { ShortcutHelpDialog } from "./shortcut-help-dialog";
import { isShortcutHelp } from "@/lib/shortcuts";
import { Keyboard, Menu } from "lucide-react";
import logoSvg from "@/assets/logo.svg";

export function ChatView() {
  const { state, error } = useGateway();
  const isMobile = useIsMobile();
  const [shortcutOpen, setShortcutOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
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
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!mounted) return <div className="h-dvh bg-background" />;

  return (
    <div className="flex h-dvh flex-col bg-background overflow-x-hidden max-w-[100vw] pb-2 md:pb-3">
      <header className="safe-top relative z-20 flex items-center justify-between border-b border-border bg-background/80 px-3 py-1.5 md:px-4 md:py-2.5 backdrop-blur-sm electron-drag electron-header-pad">
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
            <img src={logoSvg} alt="iClaw" className="h-5 w-5 md:h-6 md:w-6" />
            {!isMobile && <span className="text-sm font-semibold text-foreground">iClaw</span>}
          </div>
        </div>

        <div className="flex items-center gap-1.5 md:gap-3">
          <ConnectionStatus state={state} error={error} onClick={() => setConnectionOpen(true)} />
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
        </div>
      </header>

      <div className="flex-1 min-w-0 overflow-hidden">
        <ChatPanel />
      </div>

      <ShortcutHelpDialog open={shortcutOpen} onClose={() => setShortcutOpen(false)} />
      <ConnectionSettings open={connectionOpen} onClose={() => setConnectionOpen(false)} />
    </div>
  );
}
