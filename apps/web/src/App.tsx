import {
  Component,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ChannelProvider, DEFAULT_CHANNEL_URL } from "@intelli-claw/shared";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ChannelChatView } from "@/components/chat/channel-chat-view";
import {
  getElectronBridge,
  isElectron,
  type ManagedSessionInfo,
} from "@/lib/electron-bridge";

const DEFAULT_PROJECT_CWD =
  (import.meta.env.VITE_CLAUDE_PROJECT_CWD as string | undefined) ??
  "/Volumes/WorkSSD/Projects/intelli-claw";

/**
 * In the browser fall back to env / query-string config; in Electron the
 * SessionManager owns spawn/teardown and the URL gets driven by selected
 * session port.
 */
function resolveBrowserChannelConfig(): { url: string; token?: string } {
  const params = new URLSearchParams(window.location.search);
  const rawChannel = params.get("channel");
  let url: string;
  if (rawChannel) {
    url = /^\d+$/.test(rawChannel)
      ? `http://127.0.0.1:${rawChannel}`
      : rawChannel;
  } else {
    url =
      (import.meta.env.VITE_CHANNEL_URL as string | undefined) ??
      DEFAULT_CHANNEL_URL;
  }
  const token =
    params.get("token") ??
    (import.meta.env.VITE_CHANNEL_TOKEN as string | undefined);
  return { url, token: token || undefined };
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

function ElectronShell() {
  const bridge = getElectronBridge()!;
  const [sessions, setSessions] = useState<ManagedSessionInfo[]>([]);
  const [activePort, setActivePort] = useState<number | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [pendingSpawn, setPendingSpawn] = useState(false);

  // Subscribe to lifecycle changes so the sidebar refreshes as PTYs come and go.
  useEffect(() => {
    bridge.session.list().then(setSessions).catch(() => {});
    return bridge.session.onChanged(setSessions);
  }, [bridge]);

  // Auto-spawn a default session on first launch if the pool is empty.
  useEffect(() => {
    if (sessions.length > 0 || pendingSpawn) return;
    setPendingSpawn(true);
    bridge.session
      .spawn({ cwd: DEFAULT_PROJECT_CWD })
      .then((info) => setActivePort(info.port))
      .catch((err) =>
        setBootError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setPendingSpawn(false));
  }, [bridge, sessions.length, pendingSpawn]);

  // If we don't yet know the active port, adopt the first available session.
  useEffect(() => {
    if (activePort !== null) return;
    if (sessions.length > 0) setActivePort(sessions[0].port);
  }, [activePort, sessions]);

  const handleResume = useCallback(
    async (uuid: string) => {
      setPendingSpawn(true);
      try {
        const info = await bridge.session.spawn({
          uuid,
          cwd: DEFAULT_PROJECT_CWD,
        });
        setActivePort(info.port);
      } catch (err) {
        setBootError(err instanceof Error ? err.message : String(err));
      } finally {
        setPendingSpawn(false);
      }
    },
    [bridge],
  );

  const channelUrl = useMemo(
    () => (activePort ? `http://127.0.0.1:${activePort}` : null),
    [activePort],
  );

  if (bootError) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background p-8 text-sm text-rose-400">
        세션 기동 실패: {bootError}
      </div>
    );
  }

  if (!channelUrl) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Claude Code 세션 기동 중…
      </div>
    );
  }

  return (
    <ChannelProvider key={channelUrl} url={channelUrl}>
      <TooltipProvider>
        <ChannelChatView
          managedSessions={sessions}
          activePort={activePort}
          onResume={handleResume}
          spawning={pendingSpawn}
        />
      </TooltipProvider>
    </ChannelProvider>
  );
}

function BrowserShell() {
  const { url, token } = resolveBrowserChannelConfig();
  return (
    <ChannelProvider url={url} token={token}>
      <TooltipProvider>
        <ChannelChatView />
      </TooltipProvider>
    </ChannelProvider>
  );
}

export function App() {
  return (
    <AppErrorBoundary>
      {isElectron() ? <ElectronShell /> : <BrowserShell />}
    </AppErrorBoundary>
  );
}
