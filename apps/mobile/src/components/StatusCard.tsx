import React from "react";
import { View, Text } from "react-native";

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

function Row({ emoji, children }: { emoji: string; children: React.ReactNode }) {
  return (
    <View className="flex-row items-start gap-2 mb-1">
      <Text className="text-base leading-6">{emoji}</Text>
      <Text className="font-mono text-sm leading-6 text-muted-foreground flex-1">
        {children}
      </Text>
    </View>
  );
}

export function StatusCard({ data }: { data: StatusData }) {
  const commitShort = data.commit ? data.commit.slice(0, 7) : "";

  return (
    <View className="my-2 rounded-2xl border border-border bg-card p-4">
      <Text className="text-base font-bold text-card-foreground/80 mb-2.5">
        {data.agentName || data.agentId}
      </Text>

      <Row emoji="🌱">
        OpenClaw {data.version}
        {commitShort ? ` (${commitShort})` : ""}
      </Row>

      <Row emoji="🧠">
        Model: <Text className="text-card-foreground/80">{data.model}</Text>
      </Row>

      <Row emoji="🔢">
        Tokens: {data.inputTokens} in / {data.outputTokens} out
      </Row>

      <Row emoji="🧮">
        Context:{" "}
        <Text style={{ color: contextColor(data.percentUsed) }}>
          {formatTokens(data.totalTokens)}/
          {formatTokens(data.contextTokens)} ({data.percentUsed}%)
        </Text>
        {data.compactions != null && (
          <Text className="text-muted-foreground">
            {" "}· 🔧 Compactions: {data.compactions}
          </Text>
        )}
      </Row>

      <Row emoji="📋">
        Session: <Text className="text-muted-foreground">{data.sessionKey}</Text>
        {data.updatedAt > 0 && (
          <Text className="text-muted-foreground/60">
            {" "}· {timeAgo(data.updatedAt)}
          </Text>
        )}
      </Row>

      {data.thinking && (
        <Row emoji="⚙️">
          Runtime: direct · Think: {data.thinking}
        </Row>
      )}

      {data.queueDepth != null && (
        <Row emoji="🔄">
          Queue: collect (depth {data.queueDepth})
        </Row>
      )}
    </View>
  );
}
