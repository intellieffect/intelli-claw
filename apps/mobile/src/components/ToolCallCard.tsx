import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import type { ToolCall } from "@intelli-claw/shared";
import { SubagentCard } from "./SubagentCard";

/** Tools that spawn subagents */
const SPAWN_TOOLS = new Set(["sessions_spawn", "subagents"]);

function formatJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

export function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  const spawnInfo = useMemo(() => {
    if (!SPAWN_TOOLS.has(toolCall.name)) return null;
    try {
      const args = toolCall.args ? JSON.parse(toolCall.args) : {};
      let result: Record<string, unknown> = {};
      try {
        result = toolCall.result ? JSON.parse(toolCall.result) : {};
      } catch {}
      return {
        sessionKey: (result.childSessionKey ||
          result.sessionKey ||
          result.key ||
          undefined) as string | undefined,
        label: (args.label || result.label || undefined) as
          | string
          | undefined,
        task: (args.task || args.message || undefined) as
          | string
          | undefined,
      };
    } catch {
      return { sessionKey: undefined, label: undefined, task: undefined };
    }
  }, [toolCall.name, toolCall.args, toolCall.result]);

  if (spawnInfo) {
    return (
      <SubagentCard
        sessionKey={spawnInfo.sessionKey}
        label={spawnInfo.label}
        task={spawnInfo.task}
      />
    );
  }

  const statusColor =
    toolCall.status === "running"
      ? "#3B82F6"
      : toolCall.status === "done"
        ? "#10B981"
        : "#EF4444";

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <Text style={styles.chevron}>{expanded ? "▾" : "▸"}</Text>

        {toolCall.status === "running" ? (
          <ActivityIndicator size={12} color="#3B82F6" />
        ) : (
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        )}

        <Text style={styles.toolName}>{toolCall.name}</Text>

        {toolCall.status === "running" && (
          <Text style={styles.runningLabel}>실행 중...</Text>
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {toolCall.args && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Arguments</Text>
              <ScrollView
                style={styles.codeScroll}
                nestedScrollEnabled
              >
                <Text style={styles.codeText}>
                  {formatJson(toolCall.args)}
                </Text>
              </ScrollView>
            </View>
          )}
          {toolCall.result && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Result</Text>
              <ScrollView
                style={styles.codeScroll}
                nestedScrollEnabled
              >
                <Text style={styles.codeText}>
                  {formatJson(toolCall.result)}
                </Text>
              </ScrollView>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#222222",
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
  chevron: {
    fontSize: 12,
    color: "#888888",
    width: 14,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  toolName: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#d4d4d4",
    flex: 1,
  },
  runningLabel: {
    fontSize: 11,
    color: "#666666",
  },
  body: {
    borderTopWidth: 1,
    borderTopColor: "#222222",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  section: {
    marginBottom: 8,
  },
  sectionLabel: {
    fontSize: 11,
    color: "#666666",
    marginBottom: 4,
  },
  codeScroll: {
    maxHeight: 140,
    backgroundColor: "#1a1a1a",
    borderRadius: 6,
    padding: 8,
  },
  codeText: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#888888",
    lineHeight: 16,
  },
});
