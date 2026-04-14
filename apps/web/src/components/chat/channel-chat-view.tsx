/**
 * Channel-based chat view — minimal rebuild on top of `@intelli-claw/shared/channel`.
 *
 * Replaces the OpenClaw-gateway `chat-view` + `chat-panel` pair with a single
 * focused component. Tool-call visualization, slash commands, topic management,
 * and settings panels are intentionally omitted; they'll be reintroduced
 * incrementally on top of the channel contract.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useChannel, type ChannelMsg, type ChannelConnectionState } from "@intelli-claw/shared";
import { Paperclip, Send, X, Wifi, WifiOff, Loader2 } from "lucide-react";
import { MarkdownRenderer } from "./markdown-renderer";
import { cn } from "@/lib/utils";

const PRESET_SESSIONS = [
  { id: "main", label: "main" },
  { id: "scout", label: "scout" },
  { id: "biz-ops", label: "biz-ops" },
  { id: "product-dev", label: "product-dev" },
  { id: "content-engine", label: "content-engine" },
];

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

function SessionPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const options = PRESET_SESSIONS.some((s) => s.id === value)
    ? PRESET_SESSIONS
    : [...PRESET_SESSIONS, { id: value, label: value }];

  return (
    <select
      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((s) => (
        <option key={s.id} value={s.id}>
          {s.label}
        </option>
      ))}
    </select>
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
        <MarkdownRenderer content={msg.text || "(empty)"} />
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

export function ChannelChatView() {
  const { state, activeSessionId, messages, send, clearMessages } = useChannel();
  const [sessionId, setSessionId] = useState(activeSessionId);

  useEffect(() => {
    setSessionId(activeSessionId);
  }, [activeSessionId]);

  const handleSubmit = useCallback(
    async (text: string, file?: File) => {
      try {
        await send(text, { sessionId, file });
      } catch (err) {
        console.error("[channel] send failed:", err);
      }
    },
    [send, sessionId],
  );

  const disabled = state !== "connected";

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2">
        <h1 className="text-sm font-semibold">intelli-claw</h1>
        <SessionPicker value={sessionId} onChange={setSessionId} />
        <StatusBadge state={state} />
        <button
          type="button"
          onClick={clearMessages}
          className="ml-auto text-xs text-muted-foreground hover:text-foreground"
        >
          화면 비우기
        </button>
      </header>
      <main className="flex-1 overflow-y-auto">
        <MessageList messages={messages} sessionId={sessionId} />
      </main>
      <Composer disabled={disabled} onSubmit={handleSubmit} />
    </div>
  );
}
