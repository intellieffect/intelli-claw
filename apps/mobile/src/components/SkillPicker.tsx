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
import { colors } from "../theme/colors";

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
                <View style={[s.sourceBadge, { backgroundColor: colors.accentPurpleFaint }]}>
                  <Text style={[s.sourceText, { color: colors.accentPurple }]}>관리</Text>
                </View>
              )}
            </View>
            <Text style={s.desc} numberOfLines={2}>
              {item.description}
            </Text>
            {isBlocked && (
              <View style={s.blockedRow}>
                <AlertCircle size={10} color={colors.error} />
                <Text style={s.blockedText}>
                  {item.blockedByAllowlist ? "허용 목록에 없음" : "요구사항 미충족"}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View style={s.rowRight}>
          {isBusy ? (
            <ActivityIndicator size="small" color={colors.info} />
          ) : (
            <Switch
              value={isEnabled}
              onValueChange={() => handleToggle(item)}
              disabled={isBlocked}
              trackColor={{ false: colors.bgHandle, true: colors.primarySemi }}
              thumbColor={isEnabled ? colors.primary : colors.textTertiary}
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
              <Puzzle size={18} color={colors.info} />
              <Text style={s.title}>Skills</Text>
              <View style={s.countBadge}>
                <Text style={s.countText}>{enabledCount}/{skills.length}</Text>
              </View>
            </View>
            <View style={s.headerRight}>
              <TouchableOpacity onPress={refresh} hitSlop={8} style={s.refreshBtn}>
                <RefreshCw size={16} color={colors.textPlaceholder} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} hitSlop={8}>
                <X size={20} color={colors.textPlaceholder} />
              </TouchableOpacity>
            </View>
          </View>

          {error && (
            <View style={s.errorBar}>
              <AlertCircle size={12} color={colors.error} />
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
  backdrop: { flex: 1, backgroundColor: colors.overlayDim, justifyContent: "flex-end" },
  backdropTouch: { flex: 1 },
  sheet: {
    maxHeight: "80%",
    backgroundColor: colors.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.bgHandle,
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
    borderBottomColor: colors.border,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 17, fontWeight: "700", color: colors.text },
  countBadge: {
    backgroundColor: colors.primaryFaint,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  countText: { fontSize: 11, fontWeight: "600", color: colors.primary },
  refreshBtn: { padding: 4 },

  // Error
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.errorFaint,
  },
  errorText: { fontSize: 12, color: colors.error },

  // List
  listContent: { paddingBottom: 24 },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowBlocked: { opacity: 0.5 },
  rowLeft: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  rowMain: { flex: 1 },
  emoji: { fontSize: 20, width: 28, textAlign: "center", marginTop: 2 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  name: { fontSize: 14, fontWeight: "600", color: colors.text },
  nameBlocked: { color: colors.textTertiary },
  desc: { fontSize: 12, color: colors.textMid, marginTop: 2, lineHeight: 16 },
  sourceBadge: {
    backgroundColor: colors.successFaint,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  sourceText: { fontSize: 9, fontWeight: "600", color: colors.successDark },
  blockedRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  blockedText: { fontSize: 10, color: colors.error },
  rowRight: { marginLeft: 12 },

  // Empty
  emptyBox: { paddingVertical: 32, alignItems: "center" },
  emptyText: { fontSize: 13, color: colors.textTertiary },
});
