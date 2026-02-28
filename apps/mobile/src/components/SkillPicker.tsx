/**
 * SkillPicker — Bottom sheet for viewing and toggling skills attached to a session.
 * Ported from web skill-picker.tsx for React Native.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  Switch,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import {
  Puzzle,
  X,
  ExternalLink,
  AlertCircle,
  RefreshCw,
} from "lucide-react-native";
import { useSkills, type Skill } from "@intelli-claw/shared";

// ─── Props ───

export interface SkillPickerProps {
  visible: boolean;
  onClose: () => void;
}

export function SkillPicker({ visible, onClose }: SkillPickerProps) {
  const { skills, loading, error, refresh, toggleSkill } = useSkills();
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

  const sortedSkills = useMemo(
    () =>
      [...skills].sort((a, b) => {
        // Eligible first, then alphabetical
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [skills],
  );

  const enabledCount = useMemo(
    () => skills.filter((s) => s.eligible && !s.disabled).length,
    [skills],
  );

  const handleToggle = async (skill: Skill) => {
    setBusyKeys((prev) => new Set(prev).add(skill.skillKey));
    try {
      await toggleSkill(skill.skillKey, skill.disabled);
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(skill.skillKey);
        return next;
      });
    }
  };

  const renderSkill = ({ item }: { item: Skill }) => {
    const isBusy = busyKeys.has(item.skillKey);
    const isEnabled = !item.disabled && item.eligible;
    const isBlocked = item.blockedByAllowlist || !item.eligible;

    return (
      <View style={[s.row, isBlocked && s.rowBlocked]}>
        <View style={s.rowLeft}>
          <Text style={s.emoji}>{item.emoji || "🔧"}</Text>
          <View style={s.rowMain}>
            <View style={s.nameRow}>
              <Text style={[s.name, isBlocked && s.nameBlocked]} numberOfLines={1}>
                {item.name}
              </Text>
              {item.bundled && (
                <View style={s.sourceBadge}>
                  <Text style={s.sourceText}>내장</Text>
                </View>
              )}
              {item.source === "managed" && (
                <View style={[s.sourceBadge, { backgroundColor: "#EDE9FE" }]}>
                  <Text style={[s.sourceText, { color: "#7C3AED" }]}>관리</Text>
                </View>
              )}
            </View>
            <Text style={s.desc} numberOfLines={2}>
              {item.description}
            </Text>
            {isBlocked && (
              <View style={s.blockedRow}>
                <AlertCircle size={10} color="#EF4444" />
                <Text style={s.blockedText}>
                  {item.blockedByAllowlist ? "허용 목록에 없음" : "요구사항 미충족"}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={s.rowRight}>
          {isBusy ? (
            <ActivityIndicator size="small" color="#3B82F6" />
          ) : (
            <Switch
              value={isEnabled}
              onValueChange={() => handleToggle(item)}
              disabled={isBlocked}
              trackColor={{ false: "#333333", true: "#FF6B3580" }}
              thumbColor={isEnabled ? "#FF6B35" : "#666666"}
            />
          )}
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={s.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <View style={s.headerLeft}>
              <Puzzle size={18} color="#3B82F6" />
              <Text style={s.title}>Skills</Text>
              <View style={s.countBadge}>
                <Text style={s.countText}>{enabledCount}/{skills.length}</Text>
              </View>
            </View>
            <View style={s.headerRight}>
              <TouchableOpacity onPress={refresh} hitSlop={8} style={s.refreshBtn}>
                <RefreshCw size={16} color="#9CA3AF" />
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <X size={20} color="#9CA3AF" />
              </TouchableOpacity>
            </View>
          </View>

          {error && (
            <View style={s.errorBar}>
              <AlertCircle size={12} color="#EF4444" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          {/* Skill list */}
          <FlatList
            data={sortedSkills}
            keyExtractor={(item) => item.skillKey}
            renderItem={renderSkill}
            contentContainerStyle={s.listContent}
            ListEmptyComponent={
              <View style={s.emptyBox}>
                <Text style={s.emptyText}>
                  {loading ? "스킬 로딩 중..." : "등록된 스킬 없음"}
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
    maxHeight: "80%",
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

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#222222",
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 17, fontWeight: "700", color: "#fafafa" },
  countBadge: {
    backgroundColor: "#EFF6FF",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: { fontSize: 11, fontWeight: "600", color: "#FF6B35" },
  refreshBtn: { padding: 4 },

  // Error
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#FEF2F2",
  },
  errorText: { fontSize: 12, color: "#EF4444" },

  // List
  listContent: { paddingBottom: 24 },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#222222",
  },
  rowBlocked: { opacity: 0.5 },
  rowLeft: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  rowMain: { flex: 1 },
  emoji: { fontSize: 20, width: 28, textAlign: "center", marginTop: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 14, fontWeight: "600", color: "#fafafa" },
  nameBlocked: { color: "#666666" },
  desc: { fontSize: 12, color: "#888888", marginTop: 2, lineHeight: 16 },
  sourceBadge: {
    backgroundColor: "#ECFDF5",
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  sourceText: { fontSize: 9, fontWeight: "600", color: "#059669" },
  blockedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  blockedText: { fontSize: 10, color: "#EF4444" },
  rowRight: { marginLeft: 12 },

  // Empty
  emptyBox: { paddingVertical: 32, alignItems: "center" },
  emptyText: { fontSize: 13, color: "#666666" },
});
