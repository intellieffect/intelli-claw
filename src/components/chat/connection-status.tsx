"use client";

import type { ConnectionState } from "@/lib/gateway/client";

const STATUS_CONFIG: Record<
  ConnectionState,
  { label: string; color: string; pulse: boolean }
> = {
  disconnected: { label: "연결 끊김", color: "bg-red-500", pulse: false },
  connecting: { label: "연결 중...", color: "bg-yellow-500", pulse: true },
  authenticating: { label: "인증 중...", color: "bg-yellow-500", pulse: true },
  connected: { label: "연결됨", color: "bg-emerald-500", pulse: false },
};

export function ConnectionStatus({ state }: { state: ConnectionState }) {
  const config = STATUS_CONFIG[state];

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        {config.pulse && (
          <span
            className={`absolute inline-flex h-full w-full animate-ping rounded-full ${config.color} opacity-75`}
          />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${config.color}`} />
      </span>
      <span>{config.label}</span>
    </div>
  );
}
