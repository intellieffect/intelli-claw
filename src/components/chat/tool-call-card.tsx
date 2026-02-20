"use client";

import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import type { ToolCall } from "@/lib/gateway/protocol";
import { SubagentCard } from "./subagent-card";

/** Tools that spawn subagents */
const SPAWN_TOOLS = new Set(["sessions_spawn", "subagents"]);

export function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  // Extract subagent info from sessions_spawn args/result
  const spawnInfo = useMemo(() => {
    if (!SPAWN_TOOLS.has(toolCall.name)) return null;
    try {
      const args = toolCall.args ? JSON.parse(toolCall.args) : {};
      let result: Record<string, unknown> = {};
      try { result = toolCall.result ? JSON.parse(toolCall.result) : {}; } catch {}
      return {
        sessionKey: (result.childSessionKey || result.sessionKey || result.key || undefined) as string | undefined,
        label: (args.label || result.label || undefined) as string | undefined,
        task: (args.task || args.message || undefined) as string | undefined,
      };
    } catch {
      // Even if parsing fails, still show the card for spawn tools
      return { sessionKey: undefined, label: undefined, task: undefined };
    }
  }, [toolCall.name, toolCall.args, toolCall.result]);

  // If this is a spawn tool, render SubagentCard instead
  if (spawnInfo) {
    return (
      <SubagentCard
        sessionKey={spawnInfo.sessionKey}
        label={spawnInfo.label}
        task={spawnInfo.task}
      />
    );
  }

  const statusIcon =
    toolCall.status === "running" ? (
      <Loader2 size={14} className="animate-spin text-primary" />
    ) : toolCall.status === "done" ? (
      <CheckCircle2 size={14} className="text-emerald-400" />
    ) : (
      <AlertCircle size={14} className="text-destructive" />
    );

  return (
    <div className="my-1.5 rounded-lg border border-border bg-muted/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-muted"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {statusIcon}
        <span className="font-mono text-xs text-foreground">{toolCall.name}</span>
        {toolCall.status === "running" && (
          <span className="ml-auto text-xs text-muted-foreground">실행 중...</span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2 text-xs">
          {toolCall.args && (
            <div className="mb-2">
              <div className="mb-1 text-muted-foreground">Arguments</div>
              <pre className="max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded bg-background p-2 text-muted-foreground">
                {formatJson(toolCall.args)}
              </pre>
            </div>
          )}
          {toolCall.result && (
            <div>
              <div className="mb-1 text-muted-foreground">Result</div>
              <pre className="max-h-40 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-all rounded bg-background p-2 text-muted-foreground">
                {formatJson(toolCall.result)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}
