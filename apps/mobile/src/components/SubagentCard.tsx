import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
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
    <View style={styles.container}>
      {/* Header */}
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        {status.phase === "running" ? (
          <ActivityIndicator size={12} color="#3B82F6" />
        ) : (
          <Text style={styles.phaseIcon}>{phaseIcon}</Text>
        )}

        <Text style={styles.label} numberOfLines={1}>
          {displayLabel}
        </Text>

        {status.toolName && (
          <Text style={styles.toolIndicator}>⚙ {status.toolName}</Text>
        )}

        <Text style={styles.elapsed}>{elapsedStr}</Text>
        <Text style={styles.chevron}>{expanded ? "▴" : "▾"}</Text>
      </TouchableOpacity>

      {/* Preview (collapsed) */}
      {!expanded && lastLines ? (
        <View style={styles.preview}>
          <Text style={styles.previewText} numberOfLines={1}>
            {lastLines.split("\n").pop()}
          </Text>
        </View>
      ) : null}

      {/* Expanded content */}
      {expanded && (
        <View style={styles.body}>
          {task && (
            <Text style={styles.taskText}>
              Task: {task.length > 200 ? task.slice(0, 200) + "…" : task}
            </Text>
          )}
          <ScrollView style={styles.contentScroll} nestedScrollEnabled>
            <Text style={styles.contentText}>
              {status.content ||
                (status.phase === "pending" ? "대기 중..." : "처리 중...")}
            </Text>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5E7EB80",
    backgroundColor: "#141414",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  phaseIcon: {
    fontSize: 12,
  },
  label: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
    color: "#d4d4d4",
  },
  toolIndicator: {
    fontSize: 10,
    color: "#666666",
  },
  elapsed: {
    fontSize: 10,
    color: "#666666",
  },
  chevron: {
    fontSize: 12,
    color: "#666666",
  },
  preview: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB50",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  previewText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#666666",
  },
  body: {
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB50",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  taskText: {
    fontSize: 11,
    color: "#666666",
    marginBottom: 6,
  },
  contentScroll: {
    maxHeight: 160,
  },
  contentText: {
    fontFamily: "monospace",
    fontSize: 11,
    lineHeight: 16,
    color: "#666666",
  },
});
