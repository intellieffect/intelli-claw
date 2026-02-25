"use client";

import { useEffect, useRef, useState } from "react";
import { useGateway } from "@/lib/gateway/hooks";
import type { EventFrame } from "@/lib/gateway/protocol";
import {
  Bot,
  ChevronDown,
  ChevronUp,
  Loader2,
  CheckCircle2,
  Wrench,
  Zap,
} from "lucide-react";

interface SubagentStatus {
  content: string;
  toolName?: string;
  phase: "pending" | "running" | "done";
  tokenCount: number;
  startedAt: number;
  updatedAt: number;
}

/**
 * Inline card that shows realtime subagent progress inside an assistant bubble.
 * Subscribes to gateway agent events for the given sessionKey.
 */
export function SubagentCard({
  sessionKey,
  label,
  task,
}: {
  sessionKey?: string;
  label?: string;
  task?: string;
}) {
  const { client } = useGateway();
  const [status, setStatus] = useState<SubagentStatus>({
    content: "",
    phase: "pending",
    tokenCount: 0,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  });
  const [expanded, setExpanded] = useState(false);
  const lastSeqRef = useRef(-1);

  useEffect(() => {
    if (!client || !sessionKey) return;

    const unsub = client.onEvent((frame: EventFrame) => {
      if (frame.event !== "agent") return;

      // Dedup
      if (frame.seq != null) {
        if (frame.seq <= lastSeqRef.current) return;
        lastSeqRef.current = frame.seq;
      }

      const raw = frame.payload as Record<string, unknown>;
      const evKey = raw.sessionKey as string | undefined;
      if (evKey !== sessionKey) return;

      const stream = raw.stream as string | undefined;
      const data = raw.data as Record<string, unknown> | undefined;

      setStatus((prev) => {
        const next = { ...prev, updatedAt: Date.now() };

        if (stream === "assistant" && data?.delta) {
          next.content += data.delta as string;
          next.phase = "running";
          next.toolName = undefined;
          next.tokenCount += 1;
        } else if (stream === "tool-start") {
          next.toolName = (data?.name as string) || "tool";
          next.phase = "running";
        } else if (stream === "tool-end") {
          next.toolName = undefined;
        } else if (
          stream === "lifecycle" &&
          data?.phase === "end"
        ) {
          next.phase = "done";
          next.toolName = undefined;
        }

        return next;
      });
    });

    return unsub;
  }, [client, sessionKey]);

  const elapsed = Math.floor(
    (status.updatedAt - status.startedAt) / 1000
  );
  const elapsedStr =
    elapsed < 60
      ? `${elapsed}s`
      : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  const lastLines = status.content
    .split("\n")
    .filter(Boolean)
    .slice(-4)
    .join("\n");

  const displayLabel = label || parseLabel(sessionKey || "");

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border/50 bg-muted/30">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-muted/50"
      >
        {/* Status indicator */}
        {status.phase === "pending" ? (
          <Zap size={14} className="text-amber-400" />
        ) : status.phase === "running" ? (
          <Loader2 size={14} className="animate-spin text-primary" />
        ) : (
          <CheckCircle2 size={14} className="text-emerald-400" />
        )}

        {/* Label */}
        <span className="flex-1 truncate text-xs font-medium text-foreground">
          {displayLabel}
        </span>

        {/* Tool indicator */}
        {status.toolName && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Wrench size={10} />
            {status.toolName}
          </span>
        )}

        {/* Stats */}
        <span className="text-[10px] text-muted-foreground">{elapsedStr}</span>

        {expanded ? (
          <ChevronUp size={12} className="text-muted-foreground" />
        ) : (
          <ChevronDown size={12} className="text-muted-foreground" />
        )}
      </button>

      {/* Preview (always show last line when collapsed) */}
      {!expanded && lastLines && (
        <div className="border-t border-border/30 px-3 py-1.5">
          <p className="truncate text-[11px] text-muted-foreground font-mono">
            {lastLines.split("\n").pop()}
          </p>
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border/30 px-3 py-2">
          {task && (
            <div className="mb-2 text-[11px] text-muted-foreground">
              <span className="text-muted-foreground">Task: </span>
              {task.length > 200 ? task.slice(0, 200) + "…" : task}
            </div>
          )}
          <pre className="max-h-48 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground font-mono">
            {status.content || (status.phase === "pending" ? "대기 중..." : "처리 중...")}
          </pre>
        </div>
      )}
    </div>
  );
}

function parseLabel(sessionKey: string): string {
  const parts = sessionKey.split(":");
  if (parts.length >= 3) {
    const agent = parts[1];
    const type = parts[2];
    if (type === "subagent") return `${agent} 서브에이전트`;
    if (type === "cron") return `${agent} 크론`;
    return `${agent}/${type}`;
  }
  return sessionKey;
}
