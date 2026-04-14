/**
 * Channel-based chat view — minimal rebuild on top of `@intelli-claw/shared/channel`.
 *
 * Replaces the OpenClaw-gateway `chat-view` + `chat-panel` pair with a single
 * focused component. Tool-call visualization, slash commands, topic management,
 * and settings panels are intentionally omitted; they'll be reintroduced
 * incrementally on top of the channel contract.
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ChannelClient,
  useChannel,
  type ChannelMsg,
  type ChannelConnectionState,
  type ClaudeSessionSummary,
  type PermissionRequest,
} from "@intelli-claw/shared";
import {
  Clipboard,
  Loader2,
  Paperclip,
  RefreshCw,
  Send,
  ShieldCheck,
  ShieldX,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

const MarkdownRenderer = lazy(() =>
  import("./markdown-renderer").then((m) => ({ default: m.MarkdownRenderer })),
);

const SESSIONS_POLL_MS = 15_000;
const DEFAULT_CHANNEL_URL =
  (import.meta.env.VITE_CHANNEL_URL as string | undefined) ?? "http://127.0.0.1:8790";
const DEFAULT_PROJECT_CWD =
  (import.meta.env.VITE_CLAUDE_PROJECT_CWD as string | undefined) ?? "";

function StatusBadge({ state }: { state: ChannelConnectionState }) {
  if (state === "connected") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <Wifi className="h-3 w-3" /> 연결됨
      </span>
    );
  }
  if (state === "connecting") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <Loader2 className="h-3 w-3 animate-spin" /> 연결 중
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-600 dark:text-rose-400">
        <WifiOff className="h-3 w-3" /> 오류
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <WifiOff className="h-3 w-3" /> 끊김
    </span>
  );
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "방금 전";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}시간 전`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    // Older browsers / insecure contexts — silently ignore.
  }
}

function SessionSidebar({
  sessions,
  selectedUuid,
  activeUuid,
  loading,
  error,
  projectCwd,
  onSelect,
  onRefresh,
}: {
  sessions: ClaudeSessionSummary[];
  selectedUuid: string | null;
  activeUuid: string | null;
  loading: boolean;
  error: string | null;
  projectCwd: string;
  onSelect: (uuid: string) => void;
  onRefresh: () => void;
}) {
  return (
    <aside className="flex h-full w-80 flex-col border-r border-border bg-muted/30">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold">Claude Code sessions</div>
          <div className="truncate text-[10px] text-muted-foreground" title={projectCwd}>
            {projectCwd || "(cwd unknown)"}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-input hover:bg-accent disabled:opacity-50"
          aria-label="새로고침"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      {error && (
        <div className="px-3 py-2 text-xs text-rose-500">{error}</div>
      )}
      <div className="flex-1 overflow-y-auto">
        {sessions.length === 0 && !loading && !error ? (
          <div className="p-4 text-xs text-muted-foreground">
            세션이 없습니다. 이 프로젝트 cwd에서 Claude Code를 한 번 이상 실행해야 합니다.
          </div>
        ) : (
          sessions.map((s) => {
            const isSelected = s.uuid === selectedUuid;
            const isActive = s.uuid === activeUuid;
            return (
              <button
                key={s.uuid}
                type="button"
                onClick={() => onSelect(s.uuid)}
                className={cn(
                  "flex w-full flex-col items-start gap-1 border-b border-border/50 px-3 py-2 text-left text-xs hover:bg-accent/50",
                  isSelected && "bg-accent",
                )}
              >
                <div className="flex w-full items-center gap-2">
                  {isActive && (
                    <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  )}
                  <span className="truncate text-[10px] font-mono text-muted-foreground">
                    {s.uuid.slice(0, 8)}
                  </span>
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {s.messageCount} msg · {formatRelative(s.updatedAt)}
                  </span>
                </div>
                <div className="line-clamp-2 w-full text-foreground">
                  {s.title || "(제목 없음)"}
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}

function SelectedSessionBanner({
  session,
  projectCwd,
}: {
  session: ClaudeSessionSummary | null;
  projectCwd: string;
}) {
  if (!session) return null;
  const command = `cd "${projectCwd}" && claude -r ${session.uuid} --dangerously-load-development-channels plugin:intelli-claw-channel@intelli-claw`;
  return (
    <div className="flex items-center gap-2 border-b border-border bg-accent/30 px-4 py-2 text-xs">
      <span className="truncate">
        선택된 세션 <code className="rounded bg-muted px-1 py-0.5">{session.uuid.slice(0, 8)}</code>{" "}
        — 연결하려면 아래 명령을 터미널에서 실행하세요
      </span>
      <button
        type="button"
        onClick={() => copyToClipboard(command)}
        className="ml-auto inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 hover:bg-accent"
      >
        <Clipboard className="h-3 w-3" />
        명령 복사
      </button>
    </div>
  );
}

function MessageBubble({ msg }: { msg: ChannelMsg }) {
  const isUser = msg.from === "user";
  return (
    <div
      className={cn(
        "flex w-full gap-3",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm shadow-sm",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground",
        )}
      >
        {msg.replyTo && (
          <div className="mb-1 border-l-2 border-current/30 pl-2 text-xs opacity-70">
            ↳ {msg.replyTo}
          </div>
        )}
        <Suspense fallback={<div className="whitespace-pre-wrap">{msg.text || "(empty)"}</div>}>
          <MarkdownRenderer content={msg.text || "(empty)"} />
        </Suspense>
        {msg.file && (
          <a
            href={msg.file.url}
            target="_blank"
            rel="noreferrer"
            download={msg.file.name}
            className="mt-1 inline-flex items-center gap-1 text-xs underline opacity-80"
          >
            <Paperclip className="h-3 w-3" />
            {msg.file.name}
          </a>
        )}
        <div className="mt-1 text-[10px] opacity-50">
          {new Date(msg.ts).toTimeString().slice(0, 8)}
        </div>
      </div>
    </div>
  );
}

function MessageList({ messages, sessionId }: { messages: ChannelMsg[]; sessionId: string }) {
  const filtered = useMemo(
    () => messages.filter((m) => m.sessionId === sessionId),
    [messages, sessionId],
  );

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [filtered.length]);

  if (filtered.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        아직 메시지가 없습니다. 아래에서 입력을 시작하세요.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {filtered.map((m) => (
        <MessageBubble key={m.id} msg={m} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

function Composer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string, file?: File) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed && !file) return;
    setPending(true);
    try {
      await onSubmit(trimmed, file ?? undefined);
      setText("");
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setPending(false);
      textareaRef.current?.focus();
    }
  }, [text, file, onSubmit]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <form
      className="flex flex-col gap-2 border-t border-border bg-background p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={textareaRef}
        className="min-h-[60px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
        placeholder="Claude에게 메시지를 보내세요 (Shift+Enter로 개행)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled || pending}
        rows={2}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || pending}
          className="inline-flex h-8 items-center gap-1 rounded-md border border-input px-2 text-xs hover:bg-accent"
        >
          <Paperclip className="h-3.5 w-3.5" />
          첨부
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {file && (
          <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs">
            {file.name}
            <button
              type="button"
              onClick={() => {
                setFile(null);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              aria-label="첨부 제거"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {pending ? "전송 중…" : "Enter로 전송"}
        </span>
        <button
          type="submit"
          disabled={disabled || pending || (!text.trim() && !file)}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" />
          보내기
        </button>
      </div>
    </form>
  );
}

function PermissionPrompt({
  request,
  onResolve,
}: {
  request: PermissionRequest;
  onResolve: (id: string, behavior: "allow" | "deny") => void;
}) {
  return (
    <div className="mx-4 my-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <ShieldCheck className="h-4 w-4 text-amber-600" />
        Tool approval: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{request.tool_name}</code>
        <code className="ml-auto rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {request.request_id}
        </code>
      </div>
      {request.description && (
        <p className="mb-2 whitespace-pre-wrap text-xs text-muted-foreground">
          {request.description}
        </p>
      )}
      {request.input_preview && (
        <pre className="mb-3 max-h-32 overflow-auto rounded-md bg-muted p-2 text-xs">
          {request.input_preview}
        </pre>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onResolve(request.request_id, "allow")}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-emerald-600 px-3 text-xs font-medium text-white hover:bg-emerald-700"
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Allow
        </button>
        <button
          type="button"
          onClick={() => onResolve(request.request_id, "deny")}
          className="inline-flex h-8 items-center gap-1 rounded-md bg-rose-600 px-3 text-xs font-medium text-white hover:bg-rose-700"
        >
          <ShieldX className="h-3.5 w-3.5" />
          Deny
        </button>
      </div>
    </div>
  );
}

function useClaudeSessionList(projectCwd: string, channelUrl: string) {
  const [sessions, setSessions] = useState<ClaudeSessionSummary[]>([]);
  const [activeUuid, setActiveUuid] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const client = new ChannelClient({ url: channelUrl });
      const res = await client.listSessions(projectCwd);
      setSessions(res.sessions);
      setActiveUuid(res.activeUuid);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectCwd, channelUrl]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      void refresh();
    }, SESSIONS_POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return { sessions, activeUuid, loading, error, refresh };
}

export function ChannelChatView() {
  const {
    client,
    state,
    activeSessionId,
    messages,
    pendingPermissions,
    send,
    clearMessages,
    resolvePermission,
  } = useChannel();

  const projectCwd = DEFAULT_PROJECT_CWD;
  const channelUrl = client?.getConfig().url ?? DEFAULT_CHANNEL_URL;
  const { sessions, activeUuid, loading, error, refresh } = useClaudeSessionList(
    projectCwd,
    channelUrl,
  );
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  useEffect(() => {
    if (activeUuid && !selectedUuid) setSelectedUuid(activeUuid);
  }, [activeUuid, selectedUuid]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.uuid === selectedUuid) ?? null,
    [sessions, selectedUuid],
  );

  const handleSubmit = useCallback(
    async (text: string, file?: File) => {
      try {
        await send(text, { sessionId: activeSessionId, file });
      } catch (err) {
        console.error("[channel] send failed:", err);
      }
    },
    [send, activeSessionId],
  );

  const disabled = state !== "connected";

  return (
    <div className="flex h-dvh bg-background">
      <SessionSidebar
        sessions={sessions}
        selectedUuid={selectedUuid}
        activeUuid={activeUuid}
        loading={loading}
        error={error}
        projectCwd={projectCwd}
        onSelect={setSelectedUuid}
        onRefresh={() => {
          void refresh();
        }}
      />
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border px-4 py-2">
          <h1 className="text-sm font-semibold">intelli-claw</h1>
          <span className="text-xs text-muted-foreground">· {activeSessionId}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {channelUrl.replace(/^https?:\/\//, "")}
          </span>
          <StatusBadge state={state} />
          <button
            type="button"
            onClick={clearMessages}
            className="ml-auto text-xs text-muted-foreground hover:text-foreground"
          >
            화면 비우기
          </button>
        </header>
        {selectedSession && selectedSession.uuid !== activeUuid && (
          <SelectedSessionBanner session={selectedSession} projectCwd={projectCwd} />
        )}
        {pendingPermissions.length > 0 && (
          <div className="flex flex-col gap-1 pt-1">
            {pendingPermissions.map((p) => (
              <PermissionPrompt
                key={p.request_id}
                request={p}
                onResolve={resolvePermission}
              />
            ))}
          </div>
        )}
        <main className="flex-1 overflow-y-auto">
          <MessageList messages={messages} sessionId={activeSessionId} />
        </main>
        <Composer disabled={disabled} onSubmit={handleSubmit} />
      </div>
    </div>
  );
}
