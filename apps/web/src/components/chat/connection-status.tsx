
import type { ConnectionState } from "@/lib/gateway/client";
import type { ErrorShape } from "@/lib/gateway/protocol";
import { classifyError } from "@/lib/gateway/setup-guide";

export const STATUS_CONFIG: Record<
  ConnectionState,
  { label: string; color: string; pulse: boolean }
> = {
  disconnected: { label: "연결 끊김", color: "bg-red-500", pulse: false },
  connecting: { label: "연결 중...", color: "bg-yellow-500", pulse: true },
  authenticating: { label: "인증 중...", color: "bg-yellow-500", pulse: true },
  connected: { label: "연결됨", color: "bg-emerald-500", pulse: false },
};

/** Error codes that get specific mobile-friendly labels */
const ERROR_LABELS: Record<string, string> = {
  reconnect_exhausted: "재연결 실패 — 탭하여 다시 시도",
};

interface ConnectionStatusProps {
  state: ConnectionState;
  error?: ErrorShape | null;
  onClick?: () => void;
}

export function ConnectionStatus({ state, error, onClick }: ConnectionStatusProps) {
  const config = STATUS_CONFIG[state];

  let label = config.label;
  if (state === "disconnected" && error) {
    if (error.code && ERROR_LABELS[error.code]) {
      label = ERROR_LABELS[error.code];
    } else {
      const classified = classifyError(error.code, error.message);
      if (classified) {
        label = classified.label;
      } else if (error.message) {
        label = error.message.length > 20 ? error.message.slice(0, 20) + "..." : error.message;
      }
    }
  }

  const isClickable = !!onClick;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs text-muted-foreground rounded-md px-1.5 py-0.5 transition-colors ${
        isClickable ? "hover:bg-muted hover:text-foreground cursor-pointer" : "cursor-default"
      }`}
    >
      <span className="relative flex h-2 w-2">
        {config.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${config.color} opacity-75`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${config.color}`} />
      </span>
      <span>{label}</span>
    </button>
  );
}
