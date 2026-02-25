"use client";

import { cn } from "@/lib/utils";

export interface StatusData {
  // Server
  version: string;
  commit: string;
  // Session
  agentId: string;
  agentName?: string;
  sessionKey: string;
  model: string;
  // Tokens
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  percentUsed: number;
  // Meta
  updatedAt: number;
  compactions?: number;
  thinking?: string;
  runtime?: string;
  queueDepth?: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function contextColor(percent: number): string {
  if (percent >= 80) return "text-red-400";
  if (percent >= 50) return "text-yellow-400";
  return "text-green-400";
}

export function StatusCard({ data }: { data: StatusData }) {
  const commitShort = data.commit ? data.commit.slice(0, 7) : "";

  return (
    <div className="my-2 w-full max-w-md rounded-xl border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed shadow-sm">
      {/* Agent name header */}
      <div className="mb-2 text-sm font-semibold text-foreground">
        {data.agentName || data.agentId}
      </div>

      {/* Version */}
      <div className="flex items-center gap-1.5">
        <span>🌱</span>
        <span className="text-muted-foreground">
          OpenClaw {data.version}
          {commitShort && <span className="text-muted-foreground/60"> ({commitShort})</span>}
        </span>
      </div>

      {/* Model */}
      <div className="flex items-center gap-1.5">
        <span>🧠</span>
        <span>
          Model: <span className="text-foreground">{data.model}</span>
        </span>
      </div>

      {/* Tokens */}
      <div className="flex items-center gap-1.5">
        <span>🔢</span>
        <span>
          Tokens: {data.inputTokens} in / {data.outputTokens} out
        </span>
      </div>

      {/* Context */}
      <div className="flex items-center gap-1.5">
        <span>🧮</span>
        <span>
          Context:{" "}
          <span className={cn(contextColor(data.percentUsed))}>
            {formatTokens(data.totalTokens)}/{formatTokens(data.contextTokens)} ({data.percentUsed}%)
          </span>
          {data.compactions != null && (
            <span className="text-muted-foreground"> · 🔧 Compactions: {data.compactions}</span>
          )}
        </span>
      </div>

      {/* Session */}
      <div className="flex items-center gap-1.5">
        <span>📋</span>
        <span className="truncate">
          Session: <span className="text-muted-foreground">{data.sessionKey}</span>
          {data.updatedAt > 0 && (
            <span className="text-muted-foreground/60"> · {timeAgo(data.updatedAt)}</span>
          )}
        </span>
      </div>

      {/* Runtime */}
      {data.thinking && (
        <div className="flex items-center gap-1.5">
          <span>⚙️</span>
          <span>
            Runtime: direct · Think: {data.thinking}
          </span>
        </div>
      )}

      {/* Queue */}
      {data.queueDepth != null && (
        <div className="flex items-center gap-1.5">
          <span>🔄</span>
          <span>
            Queue: collect (depth {data.queueDepth})
          </span>
        </div>
      )}
    </div>
  );
}
