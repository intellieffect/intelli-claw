import { Component, type ReactNode } from "react";
import { ChannelProvider, DEFAULT_CHANNEL_URL } from "@intelli-claw/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChannelChatView } from "@/components/chat/channel-chat-view";

const CHANNEL_URL =
  (import.meta.env.VITE_CHANNEL_URL as string | undefined) ?? DEFAULT_CHANNEL_URL;
const CHANNEL_TOKEN = import.meta.env.VITE_CHANNEL_TOKEN as string | undefined;

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

  private handleReset = () => {
    try {
      sessionStorage.clear();
      localStorage.clear();
    } catch {}
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
              onClick={this.handleReset}
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
      <ChannelProvider url={CHANNEL_URL} token={CHANNEL_TOKEN}>
        <TooltipProvider>
          <ChannelChatView />
        </TooltipProvider>
      </ChannelProvider>
    </AppErrorBoundary>
  );
}
