/**
 * AgentSelector — Bottom sheet for selecting which agent to chat with.
 */
import React, { useMemo } from "react";
import { View, Text, Pressable, FlatList } from "react-native";
import { Bot, Check, X } from "lucide-react-native";
import { useAgents, type Agent } from "@intelli-claw/shared";
import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
} from "@/components/ui/actionsheet";

// ─── Color helper ───

const PALETTE = [
  "#6366F1", "#EC4899", "#F59E0B", "#10B981", "#8B5CF6",
  "#14B8A6", "#F97316", "#EF4444", "#06B6D4", "#3B82F6",
];

function getAgentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// ─── Props ───

export interface AgentSelectorProps {
  visible: boolean;
  onClose: () => void;
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
}

export function AgentSelector({ visible, onClose, selectedId, onSelect }: AgentSelectorProps) {
  const { agents, loading } = useAgents();

  const handleSelect = (id: string | undefined) => {
    onSelect(id);
    onClose();
  };

  const sortedAgents = useMemo(
    () => [...agents].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
    [agents],
  );

  const renderAgent = ({ item }: { item: Agent }) => {
    const isSelected = item.id === selectedId;
    const color = getAgentColor(item.id);
    return (
      <Pressable
        className="flex-row items-center px-4 py-3.5 gap-3"
        style={isSelected ? { backgroundColor: `${color}10` } : undefined}
        onPress={() => handleSelect(item.id)}
      >
        <View
          className="w-9 h-9 rounded-full items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <Bot size={16} color={color} />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-medium text-foreground" numberOfLines={1}>
            {item.name || item.id}
          </Text>
          {item.model && <Text className="text-xs text-muted-foreground mt-px">{item.model}</Text>}
          {item.description && (
            <Text className="text-xs text-muted-foreground mt-px" numberOfLines={1}>
              {item.description}
            </Text>
          )}
        </View>
        {isSelected && <Check size={16} color={color} />}
      </Pressable>
    );
  };

  return (
    <Actionsheet isOpen={visible} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="max-h-[70%]">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pb-3 border-b border-border">
          <Text className="text-[17px] font-bold text-foreground">에이전트 선택</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={20} color="#9CA3AF" />
          </Pressable>
        </View>

        {/* Auto option */}
        <Pressable
          className={`flex-row items-center px-4 py-3.5 gap-3 ${!selectedId ? "bg-info/5" : ""}`}
          onPress={() => handleSelect(undefined)}
        >
          <View className="w-9 h-9 rounded-full items-center justify-center bg-info/10">
            <Bot size={16} color="hsl(217, 91%, 60%)" />
          </View>
          <View className="flex-1">
            <Text className="text-[15px] font-semibold text-foreground">Auto (기본)</Text>
            <Text className="text-xs text-muted-foreground">서버 기본 에이전트 사용</Text>
          </View>
          {!selectedId && <Check size={16} color="hsl(217, 91%, 60%)" />}
        </Pressable>

        <View className="h-px bg-border mx-4" />

        {/* Agent list */}
        <FlatList
          data={sortedAgents}
          keyExtractor={(item) => item.id}
          renderItem={renderAgent}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View className="py-8 items-center">
              <Text className="text-[13px] text-muted-foreground">
                {loading ? "로딩 중..." : "등록된 에이전트 없음"}
              </Text>
            </View>
          }
        />
      </ActionsheetContent>
    </Actionsheet>
  );
}
