import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import type { ToolCall } from "@intelli-claw/shared";
import { SubagentCard } from "./SubagentCard";

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
        label: (args.label || result.label || undefined) as string | undefined,
        task: (args.task || args.message || undefined) as string | undefined,
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
      ? "bg-info"
      : toolCall.status === "done"
        ? "bg-success"
        : "bg-destructive";

  return (
    <View className="my-1.5 rounded-xl border border-border bg-card overflow-hidden">
      <Pressable
        className="flex-row items-center gap-2 px-3.5 py-3"
        onPress={() => setExpanded(!expanded)}
      >
        <Text className="text-sm text-muted-foreground w-4">
          {expanded ? "▾" : "▸"}
        </Text>

        {toolCall.status === "running" ? (
          <ActivityIndicator size={14} color="hsl(217, 91%, 60%)" />
        ) : (
          <View className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
        )}

        <Text className="font-mono text-sm text-card-foreground/80 flex-1">
          {toolCall.name}
        </Text>

        {toolCall.status === "running" && (
          <Text className="text-sm text-muted-foreground">실행 중...</Text>
        )}
      </Pressable>

      {expanded && (
        <View className="border-t border-border px-3.5 py-3">
          {toolCall.args && (
            <View className="mb-3">
              <Text className="text-xs text-muted-foreground mb-1.5 font-medium">Arguments</Text>
              <ScrollView
                className="max-h-[160px] bg-secondary rounded-lg p-3"
                nestedScrollEnabled
              >
                <Text className="font-mono text-xs text-muted-foreground leading-5">
                  {formatJson(toolCall.args)}
                </Text>
              </ScrollView>
            </View>
          )}
          {toolCall.result && (
            <View className="mb-2">
              <Text className="text-xs text-muted-foreground mb-1.5 font-medium">Result</Text>
              <ScrollView
                className="max-h-[160px] bg-secondary rounded-lg p-3"
                nestedScrollEnabled
              >
                <Text className="font-mono text-xs text-muted-foreground leading-5">
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
