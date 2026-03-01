import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useGateway, type EventFrame } from "@intelli-claw/shared";

interface SubagentStatus {
  content: string;
  toolName?: string;
  phase: "pending" | "running" | "done";
  tokenCount: number;
  startedAt: number;
  updatedAt: number;
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
        } else if (stream === "lifecycle" && data?.phase === "end") {
          next.phase = "done";
          next.toolName = undefined;
        }

        return next;
      });
    });

    return unsub;
  }, [client, sessionKey]);

  const elapsed = Math.floor(
    (status.updatedAt - status.startedAt) / 1000,
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

  const phaseIcon =
    status.phase === "pending"
      ? "⚡"
      : status.phase === "done"
        ? "✅"
        : null;

  return (
    <View className="my-1.5 rounded-[10px] border border-border bg-card overflow-hidden">
      {/* Header */}
      <Pressable
        className="flex-row items-center gap-1.5 px-2.5 py-2"
        onPress={() => setExpanded(!expanded)}
      >
        {status.phase === "running" ? (
          <ActivityIndicator size={12} color="hsl(217, 91%, 60%)" />
        ) : (
          <Text className="text-xs">{phaseIcon}</Text>
        )}

        <Text className="flex-1 text-xs font-semibold text-card-foreground/80" numberOfLines={1}>
          {displayLabel}
        </Text>

        {status.toolName && (
          <Text className="text-[10px] text-muted-foreground">⚙ {status.toolName}</Text>
        )}

        <Text className="text-[10px] text-muted-foreground">{elapsedStr}</Text>
        <Text className="text-xs text-muted-foreground">{expanded ? "▴" : "▾"}</Text>
      </Pressable>

      {/* Preview (collapsed) */}
      {!expanded && lastLines ? (
        <View className="border-t border-border/30 px-2.5 py-1.5">
          <Text className="font-mono text-[11px] text-muted-foreground" numberOfLines={1}>
            {lastLines.split("\n").pop()}
          </Text>
        </View>
      ) : null}

      {/* Expanded content */}
      {expanded && (
        <View className="border-t border-border/30 px-2.5 py-2">
          {task && (
            <Text className="text-[11px] text-muted-foreground mb-1.5">
              Task: {task.length > 200 ? task.slice(0, 200) + "…" : task}
            </Text>
          )}
          <ScrollView className="max-h-[160px]" nestedScrollEnabled>
            <Text className="font-mono text-[11px] leading-4 text-muted-foreground">
              {status.content ||
                (status.phase === "pending" ? "대기 중..." : "처리 중...")}
            </Text>
          </ScrollView>
        </View>
      )}
    </View>
  );
}
