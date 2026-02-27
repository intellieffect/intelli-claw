/**
 * SessionSwitcher — Bottom sheet modal for switching between chat sessions.
 * Ported from web session-switcher.tsx for React Native.
 *
 * Features:
 * - Session list grouped by agent, sorted by updatedAt
 * - Search/filter sessions
 * - Swipe-to-delete via long-press + confirm
 * - Create new session
 * - "Default session" quick-select at top
 */
import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  SectionList,
  RefreshControl,
  Alert,
  StyleSheet,
} from "react-native";
import {
  Search,
  Plus,
  X,
  Check,
  Trash2,
  RotateCcw,
  MessageSquare,
  Bot,
  Hash,
  Timer,
  GitBranch,
  ArrowRight,
} from "lucide-react-native";
import {
  parseSessionKey,
  sessionDisplayName,
  type Session,
} from "@intelli-claw/shared";

// ─── Constants ───

const PALETTE = [
  "#6366F1", "#EC4899", "#F59E0B", "#10B981", "#8B5CF6",
  "#14B8A6", "#F97316", "#EF4444", "#06B6D4", "#3B82F6",
  "#84CC16", "#A855F7", "#0EA5E9", "#D946EF", "#F43F5E",
];

function getAgentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function timeAgo(iso?: string | number): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return "";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간`;
  return `${Math.floor(hr / 24)}일`;
}

const TYPE_ICONS: Record<string, typeof Bot> = {
  main: Bot,
  thread: Hash,
  cron: Timer,
  subagent: GitBranch,
  a2a: ArrowRight,
};

// ─── Types ───

interface SessionItem {
  key: string;
  agentId: string;
  sessionId: string;
  title: string;
  lastMessage?: string;
  updatedAt?: string;
}

interface SectionData {
  title: string;
  agentId: string;
  data: SessionItem[];
}

export interface SessionSwitcherProps {
  visible: boolean;
  onClose: () => void;
  sessions: Session[];
  sessionsLoading: boolean;
  onRefresh: () => void;
  currentKey?: string;
  mainSessionKey?: string;
  onSelect: (key: string | null) => void;
  onDelete?: (key: string) => Promise<void>;
  onReset?: (key: string) => Promise<void>;
}

export function SessionSwitcher({
  visible,
  onClose,
  sessions,
  sessionsLoading,
  onRefresh,
  currentKey,
  mainSessionKey,
  onSelect,
  onDelete,
  onReset,
}: SessionSwitcherProps) {
  const [search, setSearch] = useState("");

  // Build sections from sessions
  const sections = useMemo((): SectionData[] => {
    const grouped = new Map<string, SessionItem[]>();
    for (const sess of sessions) {
      const p = parseSessionKey(sess.key);
      const aid = p?.agentId || "unknown";
      const sid = p ? (p.type === "main" ? "main" : p.detail || p.type) : sess.key;
      const item: SessionItem = {
        key: sess.key,
        agentId: aid,
        sessionId: sid,
        title: sess.title || sessionDisplayName({ key: sess.key, label: sess.title }),
        lastMessage: sess.lastMessage,
        updatedAt: sess.updatedAt,
      };

      // Filter by search
      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          item.title.toLowerCase().includes(q) ||
          item.agentId.toLowerCase().includes(q) ||
          item.key.toLowerCase().includes(q);
        if (!match) continue;
      }

      const list = grouped.get(aid) || [];
      list.push(item);
      grouped.set(aid, list);
    }

    return Array.from(grouped.entries())
      .map(([aid, data]) => ({
        title: aid,
        agentId: aid,
        data: data.sort((a, b) => {
          if (a.sessionId === "main" && b.sessionId !== "main") return -1;
          if (b.sessionId === "main" && a.sessionId !== "main") return 1;
          return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
        }),
      }))
      .sort((a, b) =>
        String(b.data[0]?.updatedAt || "").localeCompare(String(a.data[0]?.updatedAt || "")),
      );
  }, [sessions, search]);

  const totalCount = useMemo(
    () => sections.reduce((sum, s) => sum + s.data.length, 0),
    [sections],
  );

  const handleSelect = useCallback(
    (key: string | null) => {
      onSelect(key);
      onClose();
      setSearch("");
    },
    [onSelect, onClose],
  );

  const handleDelete = useCallback(
    (key: string) => {
      Alert.alert("세션 삭제", "이 세션을 삭제하시겠습니까?", [
        { text: "취소", style: "cancel" },
        {
          text: "삭제",
          style: "destructive",
          onPress: () => onDelete?.(key),
        },
      ]);
    },
    [onDelete],
  );

  const handleReset = useCallback(
    (key: string) => {
      Alert.alert("세션 리셋", "모든 메시지가 초기화됩니다.", [
        { text: "취소", style: "cancel" },
        {
          text: "리셋",
          style: "destructive",
          onPress: () => onReset?.(key),
        },
      ]);
    },
    [onReset],
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={s.backdropTouch} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          {/* Handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <Text style={s.title}>세션 선택</Text>
            <Text style={s.countBadge}>
              {totalCount}개{search ? ` (${sessions.length}개 중)` : ""}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Text style={s.closeBtn}>닫기</Text>
            </TouchableOpacity>
          </View>

          {/* Search */}
          <View style={s.searchRow}>
            <Search size={16} color="#9CA3AF" />
            <TextInput
              style={s.searchInput}
              placeholder="세션 검색..."
              placeholderTextColor="#9CA3AF"
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
              clearButtonMode="while-editing"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
                <X size={16} color="#9CA3AF" />
              </TouchableOpacity>
            )}
          </View>

          {/* Session list */}
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.key}
            stickySectionHeadersEnabled={false}
            refreshControl={
              <RefreshControl refreshing={sessionsLoading} onRefresh={onRefresh} tintColor="#3B82F6" />
            }
            contentContainerStyle={s.listContent}
            ListHeaderComponent={
              <TouchableOpacity
                style={[s.row, !currentKey && s.defaultRow]}
                onPress={() => handleSelect(null)}
                activeOpacity={0.7}
              >
                <View style={s.rowIcon}>
                  <Bot size={16} color="#3B82F6" />
                </View>
                <View style={s.rowMain}>
                  <Text style={[s.rowTitle, { fontWeight: "600" }]}>기본 세션 (auto)</Text>
                  <Text style={s.rowSub} numberOfLines={1}>
                    {mainSessionKey || "main"}
                  </Text>
                </View>
                {!currentKey && <Check size={16} color="#10B981" />}
              </TouchableOpacity>
            }
            ListEmptyComponent={
              search ? (
                <View style={s.emptyBox}>
                  <Text style={s.emptyText}>검색 결과 없음</Text>
                </View>
              ) : null
            }
            renderSectionHeader={({ section }) => {
              const color = getAgentColor(section.agentId);
              return (
                <View style={s.sectionHeader}>
                  <Text style={[s.sectionTitle, { color }]}>{section.title}</Text>
                  <View style={[s.sectionBadge, { backgroundColor: color + "20" }]}>
                    <Text style={[s.sectionCount, { color }]}>{section.data.length}</Text>
                  </View>
                </View>
              );
            }}
            renderItem={({ item }) => {
              const isActive = item.key === currentKey;
              const color = getAgentColor(item.agentId);
              const parsed = parseSessionKey(item.key);
              const Icon = TYPE_ICONS[parsed?.type || ""] || MessageSquare;
              return (
                <TouchableOpacity
                  style={[
                    s.row,
                    isActive && { backgroundColor: `${color}14`, borderLeftWidth: 3, borderLeftColor: color },
                  ]}
                  onPress={() => handleSelect(item.key === mainSessionKey ? null : item.key)}
                  onLongPress={() => {
                    // Show action sheet on long press
                    const actions = [];
                    if (onReset) actions.push({ text: "리셋", onPress: () => handleReset(item.key) });
                    if (onDelete) actions.push({ text: "삭제", style: "destructive" as const, onPress: () => handleDelete(item.key) });
                    if (actions.length > 0) {
                      Alert.alert(item.title, item.key, [
                        { text: "취소", style: "cancel" },
                        ...actions,
                      ]);
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <View style={s.rowIcon}>
                    <Icon size={14} color="#9CA3AF" />
                  </View>
                  <View style={s.rowMain}>
                    <View style={s.rowTitleRow}>
                      <Text
                        style={[s.rowTitle, isActive && { color, fontWeight: "700" }]}
                        numberOfLines={1}
                      >
                        {item.sessionId === "main"
                          ? `${item.agentId} / main`
                          : item.title}
                      </Text>
                    </View>
                    {item.lastMessage ? (
                      <Text style={s.rowSub} numberOfLines={1}>
                        {item.lastMessage}
                      </Text>
                    ) : null}
                  </View>
                  <View style={s.rowRight}>
                    <Text style={s.rowTime}>{timeAgo(item.updatedAt)}</Text>
                    {isActive && <Check size={14} color={color} />}
                  </View>
                </TouchableOpacity>
              );
            }}
          />

          {/* New session button */}
          <TouchableOpacity
            style={s.newSessionBtn}
            onPress={() => {
              handleSelect(null);
            }}
            activeOpacity={0.7}
          >
            <Plus size={18} color="#3B82F6" />
            <Text style={s.newSessionText}>새 대화 시작</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.32)", justifyContent: "flex-end" },
  backdropTouch: { flex: 1 },
  sheet: {
    maxHeight: "85%",
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#D1D5DB",
    alignSelf: "center",
    marginBottom: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
    gap: 8,
  },
  title: { fontSize: 17, fontWeight: "700", color: "#111827" },
  countBadge: { flex: 1, fontSize: 12, color: "#9CA3AF" },
  closeBtn: { fontSize: 14, fontWeight: "600", color: "#2563EB" },

  // Search
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: "#111827",
    padding: 0,
  },

  // List
  listContent: { paddingBottom: 8 },

  // Section header
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
    gap: 8,
  },
  sectionTitle: { fontSize: 12, textTransform: "uppercase", fontWeight: "700", letterSpacing: 0.3 },
  sectionBadge: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
  sectionCount: { fontSize: 10, fontWeight: "600" },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#F3F4F6",
    gap: 10,
  },
  defaultRow: { backgroundColor: "#F0F9FF" },
  rowIcon: { width: 28, alignItems: "center" },
  rowMain: { flex: 1, marginRight: 8 },
  rowTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { fontSize: 14, color: "#111827", fontWeight: "500" },
  rowSub: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  rowRight: { alignItems: "flex-end", gap: 4 },
  rowTime: { fontSize: 11, color: "#D1D5DB" },

  // Empty
  emptyBox: { paddingVertical: 32, alignItems: "center" },
  emptyText: { fontSize: 13, color: "#9CA3AF" },

  // New session
  newSessionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
  },
  newSessionText: { fontSize: 14, fontWeight: "600", color: "#3B82F6" },
});
