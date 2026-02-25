"use client";

import { useEffect, useRef, useState } from "react";
import { useGateway } from "@/lib/gateway/hooks";
import type { EventFrame } from "@/lib/gateway/protocol";
import { Bot, ChevronDown, ChevronUp, X } from "lucide-react";

interface SubagentEvent {
  sessionKey: string;
  label: string;
  stream: string;
  text: string;
  timestamp: number;
}

interface SubagentState {
  sessionKey: string;
  label: string;
  content: string;
  status: "running" | "done";
  toolName?: string;
  updatedAt: number;
}

export function SubagentStream({ currentSessionKey }: { currentSessionKey?: string }) {
  const { client } = useGateway();
  const [subagents, setSubagents] = useState<Map<string, SubagentState>>(new Map());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const bottomRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (!client) return;

    const unsub = client.onEvent((frame: EventFrame) => {
      if (frame.event !== "agent") return;
      const raw = frame.payload as Record<string, unknown>;
      const evSessionKey = raw.sessionKey as string | undefined;
      if (!evSessionKey) return;

      // 현재 메인 채팅 세션은 제외 (이미 메인 채팅에서 처리)
      if (currentSessionKey && evSessionKey === currentSessionKey) return;

      // 서브에이전트 세션만 (subagent, cron 등)
      const stream = raw.stream as string | undefined;
      const data = raw.data as Record<string, unknown> | undefined;

      setSubagents((prev) => {
        const next = new Map(prev);
        const existing = next.get(evSessionKey) || {
          sessionKey: evSessionKey,
          label: parseLabel(evSessionKey),
          content: "",
          status: "running" as const,
          updatedAt: Date.now(),
        };

        if (stream === "assistant" && data?.delta) {
          existing.content += data.delta as string;
          existing.status = "running";
          existing.toolName = undefined;
        } else if (stream === "tool-start") {
          existing.toolName = (data?.name as string) || "tool";
        } else if (stream === "tool-end") {
          existing.toolName = undefined;
        } else if (stream === "lifecycle" && data?.phase === "end") {
          existing.status = "done";
        }

        existing.updatedAt = Date.now();
        next.set(evSessionKey, { ...existing });
        return next;
      });
    });

    return unsub;
  }, [client, currentSessionKey]);

  // Auto-scroll
  useEffect(() => {
    bottomRefs.current.forEach((el) => el?.scrollIntoView({ behavior: "smooth" }));
  }, [subagents]);

  const activeSubagents = Array.from(subagents.values())
    .filter((s) => Date.now() - s.updatedAt < 10 * 60 * 1000) // 10분 이내
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (activeSubagents.length === 0) return null;

  const dismiss = (key: string) => {
    setSubagents((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  };

  const toggle = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  return (
    <div className="border-t border-border bg-background/80 backdrop-blur overflow-x-hidden max-w-full">
      {activeSubagents.map((sa) => {
        const isCollapsed = collapsed.has(sa.sessionKey);
        const lastLines = sa.content.split("\n").slice(-8).join("\n");

        return (
          <div key={sa.sessionKey} className="border-b border-border last:border-b-0">
            {/* Header */}
            <div
              className="flex cursor-pointer items-center gap-2 px-4 py-2 hover:bg-muted/50"
              onClick={() => toggle(sa.sessionKey)}
            >
              <Bot size={14} className={sa.status === "running" ? "text-primary animate-pulse" : "text-green-400"} />
              <span className="flex-1 text-xs font-medium text-foreground truncate">
                {sa.label}
                {sa.toolName && (
                  <span className="ml-2 text-muted-foreground">⚙️ {sa.toolName}</span>
                )}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {sa.status === "running" ? "작업중" : "완료"}
              </span>
              {sa.status === "done" && (
                <button
                  onClick={(e) => { e.stopPropagation(); dismiss(sa.sessionKey); }}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X size={12} />
                </button>
              )}
              {isCollapsed ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronUp size={14} className="text-muted-foreground" />}
            </div>

            {/* Content */}
            {!isCollapsed && (
              <div className="max-h-40 overflow-y-auto overflow-x-hidden px-4 pb-2">
                <pre className="whitespace-pre-wrap break-all text-xs text-muted-foreground font-mono leading-relaxed">
                  {lastLines || (sa.status === "running" ? "처리중..." : "완료")}
                </pre>
                <div ref={(el) => { if (el) bottomRefs.current.set(sa.sessionKey, el); }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function parseLabel(sessionKey: string): string {
  // agent:myagent:subagent:uuid → "myagent/subagent"
  // agent:brxce:cron:uuid → "brxce/cron"
  const parts = sessionKey.split(":");
  if (parts.length >= 3) {
    const agent = parts[1];
    const type = parts[2];
    if (type === "subagent") return `🤖 ${agent} 서브에이전트`;
    if (type === "cron") return `⏰ ${agent} 크론`;
    return `${agent}/${type}`;
  }
  return sessionKey;
}
