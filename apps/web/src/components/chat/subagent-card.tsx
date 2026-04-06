
import { useEffect, useRef, useState } from "react";
import { useGateway } from "@/lib/gateway/hooks";
import type { EventFrame } from "@/lib/gateway/protocol";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  File,
  FileText,
  Image as ImageIcon,
  Loader2,
  CheckCircle2,
  Paperclip,
  Video,
  Wrench,
  Zap,
} from "lucide-react";

// --- #292: Proactive progress helpers ---

/**
 * How long a running sub-agent can go without a new event before we flag it
 * as potentially stalled. The card keeps displaying as "running" but adds a
 * warning glyph and a "stalled?" hint so the user can decide whether to
 * abort.
 */
export const SUBAGENT_STALL_THRESHOLD_MS = 30_000;

/** Humanise an elapsed duration in ms. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/**
 * Decide whether a sub-agent is stalled — i.e. still marked as running but
 * hasn't emitted an event in a while. `pending` is NOT stalled because it
 * hasn't started yet. `done` is obviously not stalled.
 */
export function isSubagentStalled(params: {
  phase: "pending" | "running" | "done";
  updatedAt: number;
  now: number;
}): boolean {
  const { phase, updatedAt, now } = params;
  if (phase !== "running") return false;
  return now - updatedAt > SUBAGENT_STALL_THRESHOLD_MS;
}

interface SubagentStatus {
  content: string;
  toolName?: string;
  phase: "pending" | "running" | "done";
  tokenCount: number;
  startedAt: number;
  updatedAt: number;
}

export interface SpawnAttachment {
  name: string;
  mimeType?: string;
}

export interface SpawnReceipt {
  name: string;
  sha256: string;
}

function attachmentIcon(mimeType?: string) {
  if (!mimeType) return <File size={12} className="text-muted-foreground" />;
  if (mimeType === "application/pdf") return <FileText size={12} className="text-muted-foreground" />;
  if (mimeType.startsWith("image/")) return <ImageIcon size={12} className="text-muted-foreground" />;
  if (mimeType.startsWith("video/")) return <Video size={12} className="text-muted-foreground" />;
  return <File size={12} className="text-muted-foreground" />;
}

/**
 * Inline card that shows realtime subagent progress inside an assistant bubble.
 * Subscribes to gateway agent events for the given sessionKey.
 */
export function SubagentCard({
  sessionKey,
  label,
  task,
  attachments,
  receipts,
}: {
  sessionKey?: string;
  label?: string;
  task?: string;
  attachments?: SpawnAttachment[];
  receipts?: SpawnReceipt[];
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
  // #292: tick every 1s so elapsed/stalled state advances even without events
  const [now, setNow] = useState(() => Date.now());
  const lastSeqRef = useRef(-1);

  useEffect(() => {
    if (status.phase === "done") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [status.phase]);

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

  // #292: elapsed counts from start to "now" (tick-driven), not last event.
  // This way the user sees time advance even when the agent is thinking.
  const referenceNow = status.phase === "done" ? status.updatedAt : now;
  const elapsedMs = referenceNow - status.startedAt;
  const elapsedStr = formatElapsed(elapsedMs);
  const stalled = isSubagentStalled({
    phase: status.phase,
    updatedAt: status.updatedAt,
    now,
  });

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

        {/* Attachments badge */}
        {attachments && attachments.length > 0 && (
          <span
            className="flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            title={`첨부 ${attachments.length}개`}
          >
            <Paperclip size={10} />
            {attachments.length}
          </span>
        )}

        {/* Tool indicator */}
        {status.toolName && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Wrench size={10} />
            {status.toolName}
          </span>
        )}

        {/* #292: Stalled warning — visible before the user has to guess */}
        {stalled && (
          <span
            className="flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500"
            title="30초 동안 새 이벤트가 없습니다. 느린 도구 호출이거나 멈춘 상태일 수 있습니다."
          >
            <AlertTriangle size={10} />
            멈춤?
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
          {attachments && attachments.length > 0 && (
            <div className="mb-2">
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">첨부 파일</div>
              <div className="flex flex-col gap-1">
                {attachments.map((att, i) => {
                  const receipt = receipts?.find((r) => r.name === att.name);
                  return (
                  <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    {attachmentIcon(att.mimeType)}
                    <span>{att.name}</span>
                    {receipt && (
                      <span className="ml-auto font-mono text-[9px] text-emerald-500">
                        {receipt.sha256.slice(0, 12)}…
                      </span>
                    )}
                  </div>
                  );
                })}
              </div>
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
