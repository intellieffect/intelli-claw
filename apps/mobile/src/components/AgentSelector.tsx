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
        className="flex-row items-center px-5 py-4 gap-3.5"
        style={isSelected ? { backgroundColor: `${color}10` } : undefined}
        onPress={() => handleSelect(item.id)}
      >
        <View
          className="w-11 h-11 rounded-full items-center justify-center"
          style={{ backgroundColor: `${color}20` }}
        >
          <Bot size={20} color={color} />
        </View>
        <View className="flex-1">
          <Text className="text-base font-medium text-foreground" numberOfLines={1}>
            {item.name || item.id}
          </Text>
          {item.model && <Text className="text-sm text-muted-foreground mt-0.5">{item.model}</Text>}
          {item.description && (
            <Text className="text-sm text-muted-foreground mt-0.5" numberOfLines={1}>
              {item.description}
            </Text>
          )}
        </View>
        {isSelected && <Check size={18} color={color} />}
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

        <View className="flex-row items-center justify-between px-5 pb-3.5 border-b border-border">
          <Text className="text-lg font-bold text-foreground">에이전트 선택</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <X size={22} color="#9CA3AF" />
          </Pressable>
        </View>

        <Pressable
          className={`flex-row items-center px-5 py-4 gap-3.5 ${!selectedId ? "bg-info/5" : ""}`}
          onPress={() => handleSelect(undefined)}
        >
          <View className="w-11 h-11 rounded-full items-center justify-center bg-info/10">
            <Bot size={20} color="hsl(217, 91%, 60%)" />
          </View>
          <View className="flex-1">
            <Text className="text-base font-semibold text-foreground">Auto (기본)</Text>
            <Text className="text-sm text-muted-foreground mt-0.5">서버 기본 에이전트 사용</Text>
          </View>
          {!selectedId && <Check size={18} color="hsl(217, 91%, 60%)" />}
        </Pressable>

        <View className="h-px bg-border mx-5" />

        <FlatList
          data={sortedAgents}
          keyExtractor={(item) => item.id}
          renderItem={renderAgent}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View className="py-10 items-center">
              <Text className="text-base text-muted-foreground">
                {loading ? "로딩 중..." : "등록된 에이전트 없음"}
              </Text>
            </View>
          }
        />
      </ActionsheetContent>
    </Actionsheet>
  );
}
