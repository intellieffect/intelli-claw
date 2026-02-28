import React from "react";
import { View, Text, StyleSheet } from "react-native";

export interface StatusData {
  version: string;
  commit: string;
  agentId: string;
  agentName?: string;
  sessionKey: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextTokens: number;
  percentUsed: number;
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
  if (percent >= 80) return "#F87171";
  if (percent >= 50) return "#FBBF24";
  return "#34D399";
}

export function StatusCard({ data }: { data: StatusData }) {
  const commitShort = data.commit ? data.commit.slice(0, 7) : "";

  return (
    <View style={styles.container}>
      {/* Agent name */}
      <Text style={styles.agentName}>
        {data.agentName || data.agentId}
      </Text>

      {/* Version */}
      <View style={styles.row}>
        <Text style={styles.emoji}>🌱</Text>
        <Text style={styles.value}>
          OpenClaw {data.version}
          {commitShort ? ` (${commitShort})` : ""}
        </Text>
      </View>

      {/* Model */}
      <View style={styles.row}>
        <Text style={styles.emoji}>🧠</Text>
        <Text style={styles.value}>
          Model: <Text style={styles.highlight}>{data.model}</Text>
        </Text>
      </View>

      {/* Tokens */}
      <View style={styles.row}>
        <Text style={styles.emoji}>🔢</Text>
        <Text style={styles.value}>
          Tokens: {data.inputTokens} in / {data.outputTokens} out
        </Text>
      </View>

      {/* Context */}
      <View style={styles.row}>
        <Text style={styles.emoji}>🧮</Text>
        <Text style={styles.value}>
          Context:{" "}
          <Text style={{ color: contextColor(data.percentUsed) }}>
            {formatTokens(data.totalTokens)}/
            {formatTokens(data.contextTokens)} ({data.percentUsed}%)
          </Text>
          {data.compactions != null && (
            <Text style={styles.dimValue}>
              {" "}· 🔧 Compactions: {data.compactions}
            </Text>
          )}
        </Text>
      </View>

      {/* Session */}
      <View style={styles.row}>
        <Text style={styles.emoji}>📋</Text>
        <Text style={styles.value} numberOfLines={1}>
          Session: <Text style={styles.dimValue}>{data.sessionKey}</Text>
          {data.updatedAt > 0 && (
            <Text style={styles.dimmerValue}>
              {" "}· {timeAgo(data.updatedAt)}
            </Text>
          )}
        </Text>
      </View>

      {/* Runtime / Thinking */}
      {data.thinking && (
        <View style={styles.row}>
          <Text style={styles.emoji}>⚙️</Text>
          <Text style={styles.value}>
            Runtime: direct · Think: {data.thinking}
          </Text>
        </View>
      )}

      {/* Queue */}
      {data.queueDepth != null && (
        <View style={styles.row}>
          <Text style={styles.emoji}>🔄</Text>
          <Text style={styles.value}>
            Queue: collect (depth {data.queueDepth})
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#222222",
    backgroundColor: "#141414",
    padding: 14,
  },
  agentName: {
    fontSize: 14,
    fontWeight: "700",
    color: "#d4d4d4",
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    marginBottom: 2,
  },
  emoji: {
    fontSize: 13,
    lineHeight: 20,
  },
  value: {
    fontFamily: "monospace",
    fontSize: 12,
    lineHeight: 20,
    color: "#888888",
    flex: 1,
  },
  highlight: {
    color: "#d4d4d4",
  },
  dimValue: {
    color: "#666666",
  },
  dimmerValue: {
    color: "#D1D5DB",
  },
});
