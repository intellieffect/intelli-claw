/**
 * AgentSelector — Modal for selecting which agent to chat with.
 * Ported from web agent-selector.tsx for React Native.
 */
import React, { useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { Bot, Check, X } from "lucide-react-native";
import { useAgents, type Agent } from "@intelli-claw/shared";

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
      <TouchableOpacity
        style={[s.row, isSelected && { backgroundColor: `${color}10` }]}
        onPress={() => handleSelect(item.id)}
        activeOpacity={0.7}
      >
        <View style={[s.iconCircle, { backgroundColor: `${color}20` }]}>
          <Bot size={16} color={color} />
        </View>
        <View style={s.rowMain}>
          <Text style={s.rowName} numberOfLines={1}>
            {item.name || item.id}
          </Text>
          {item.model && <Text style={s.rowModel}>{item.model}</Text>}
          {item.description && (
            <Text style={s.rowDesc} numberOfLines={1}>
              {item.description}
            </Text>
          )}
        </View>
        {isSelected && <Check size={16} color={color} />}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={s.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.handle} />

          <View style={s.header}>
            <Text style={s.title}>에이전트 선택</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <X size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* Auto option */}
          <TouchableOpacity
            style={[s.row, !selectedId && s.autoActive]}
            onPress={() => handleSelect(undefined)}
            activeOpacity={0.7}
          >
            <View style={[s.iconCircle, { backgroundColor: "#EFF6FF" }]}>
              <Bot size={16} color="#3B82F6" />
            </View>
            <View style={s.rowMain}>
              <Text style={[s.rowName, { fontWeight: "600" }]}>Auto (기본)</Text>
              <Text style={s.rowDesc}>서버 기본 에이전트 사용</Text>
            </View>
            {!selectedId && <Check size={16} color="#3B82F6" />}
          </TouchableOpacity>

          <View style={s.divider} />

          {/* Agent list */}
          <FlatList
            data={sortedAgents}
            keyExtractor={(item) => item.id}
            renderItem={renderAgent}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>
                  {loading ? "로딩 중..." : "등록된 에이전트 없음"}
                </Text>
              </View>
            }
          />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.32)", justifyContent: "flex-end" },
  backdropTouch: { flex: 1 },
  sheet: {
    maxHeight: "70%",
    backgroundColor: "#0a0a0a",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#333333",
    alignSelf: "center",
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#222222",
  },
  title: { fontSize: 17, fontWeight: "700", color: "#fafafa" },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  autoActive: { backgroundColor: "#F0F9FF" },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  rowMain: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: "500", color: "#fafafa" },
  rowModel: { fontSize: 12, color: "#888888", marginTop: 1 },
  rowDesc: { fontSize: 12, color: "#666666", marginTop: 1 },

  divider: { height: 1, backgroundColor: "#222222", marginHorizontal: 16 },
  listContent: { paddingBottom: 24 },
  emptyBox: { paddingVertical: 32, alignItems: "center" },
  emptyText: { fontSize: 13, color: "#666666" },
});
