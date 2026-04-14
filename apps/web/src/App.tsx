import { Component, type ReactNode } from "react";
import { GatewayProvider } from "@/lib/gateway/hooks";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChatView } from "@/components/chat/chat-view";
import { CronPanel } from "@/components/settings/cron-panel";
import { ClaudeCodePanel } from "@/components/claude-code/claude-code-panel";

function AppContent() {
  // Hash-based routing: #/cron → CronPanel, #/claude-code → ClaudeCodePanel, default → ChatView
  const hash = window.location.hash;

  if (hash === "#/cron") {
    return (
      <div className="h-dvh w-full">
        <CronPanel />
      </div>
    );
  }

  if (hash === "#/claude-code") {
    return (
      <div className="h-dvh w-full bg-background">
        <ClaudeCodePanel />
      </div>
    );
  }

  return <ChatView />;
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("[App] Render error caught by boundary:", error);
  }

  private handleReset = async () => {
    // Clear all in-memory web storage (including localStorage for migration flags)
    try { sessionStorage.clear(); } catch {}
    try { localStorage.clear(); } catch {}

    const SESSION_DBS = [
      "intelli-claw-messages",
      "intelli-claw-topics",
      "intelli-claw-input-history",
    ];

    try {
      await Promise.all(
        SESSION_DBS.map(
          (name) =>
            new Promise<void>((resolve) => {
              const req = indexedDB.deleteDatabase(name);
              req.onsuccess = req.onerror = () => resolve();
            }),
        ),
      );
    } catch {
      // Best-effort — proceed to reload regardless
    }

    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-dvh items-center justify-center bg-background text-foreground">
          <div className="flex flex-col items-center gap-4 p-8">
            <p className="text-lg font-semibold">앱 렌더링 오류</p>
            <p className="text-sm text-muted-foreground">
              캐시 데이터에 문제가 있을 수 있습니다.
            </p>
            <button
              onClick={() => void this.handleReset()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              캐시 초기화 후 새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <AppErrorBoundary>
      <GatewayProvider>
        <TooltipProvider>
          <AppContent />
        </TooltipProvider>
      </GatewayProvider>
    </AppErrorBoundary>
  );
}
