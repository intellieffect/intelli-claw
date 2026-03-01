/**
 * SessionSwitcher — Bottom sheet for switching between chat sessions.
 *
 * Features:
 * - Session list grouped by agent, sorted by updatedAt
 * - Search/filter sessions
 * - Long-press for delete/reset actions via Alert
 * - Create new session
 * - "Default session" quick-select at top
 */
import React, { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  SectionList,
  RefreshControl,
  Alert,
} from "react-native";
import {
  Search,
  Plus,
  X,
  Check,
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
import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
} from "@/components/ui/actionsheet";

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

  const sortedItems = useMemo((): SessionItem[] => {
    const items: SessionItem[] = [];
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

      if (search.trim()) {
        const q = search.toLowerCase();
        const match =
          item.title.toLowerCase().includes(q) ||
          item.agentId.toLowerCase().includes(q) ||
          item.key.toLowerCase().includes(q);
        if (!match) continue;
      }

      items.push(item);
    }

    return items.sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
    );
  }, [sessions, search]);

  const sections = useMemo((): SectionData[] => {
    if (sortedItems.length === 0) return [];
    return [{ title: "all", agentId: "all", data: sortedItems }];
  }, [sortedItems]);

  const totalCount = sortedItems.length;

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
    <Actionsheet isOpen={visible} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="max-h-[85%]">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        {/* Header */}
        <View className="flex-row items-center px-4 pb-3 border-b border-border gap-2">
          <Text className="text-[17px] font-bold text-foreground">세션 선택</Text>
          <Text className="flex-1 text-xs text-muted-foreground">
            {totalCount}개{search ? ` (${sessions.length}개 중)` : ""}
          </Text>
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="닫기" accessibilityRole="button">
            <Text className="text-sm font-semibold text-primary">닫기</Text>
          </Pressable>
        </View>

        {/* Search */}
        <View className="flex-row items-center px-4 py-2.5 border-b border-border/50 gap-2">
          <Search size={16} color="#666666" />
          <TextInput
            className="flex-1 text-sm text-foreground p-0"
            placeholder="세션 검색..."
            placeholderTextColor="#444444"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")} hitSlop={8} accessibilityLabel="검색 지우기" accessibilityRole="button">
              <X size={16} color="#666666" />
            </Pressable>
          )}
        </View>

        {/* Session list */}
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.key}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={sessionsLoading} onRefresh={onRefresh} tintColor="hsl(18, 100%, 56%)" />
          }
          contentContainerStyle={{ paddingBottom: 8 }}
          ListHeaderComponent={
            <Pressable
              className={`flex-row items-center px-4 py-3 border-b border-border/50 gap-2.5 ${!currentKey ? "bg-secondary" : ""}`}
              onPress={() => handleSelect(null)}
              accessibilityLabel="기본 세션"
              accessibilityRole="button"
            >
              <View className="w-7 items-center">
                <Bot size={16} color="hsl(18, 100%, 56%)" />
              </View>
              <View className="flex-1 mr-2">
                <Text className="text-sm font-semibold text-foreground">기본 세션 (auto)</Text>
                <Text className="text-xs text-muted-foreground" numberOfLines={1}>
                  {mainSessionKey || "main"}
                </Text>
              </View>
              {!currentKey && <Check size={16} color="#10B981" />}
            </Pressable>
          }
          ListEmptyComponent={
            search ? (
              <View className="py-8 items-center">
                <Text className="text-[13px] text-muted-foreground">검색 결과 없음</Text>
              </View>
            ) : null
          }
          renderSectionHeader={() => null}
          renderItem={({ item }) => {
            const isActive = item.key === currentKey;
            const color = getAgentColor(item.agentId);
            const parsed = parseSessionKey(item.key);
            const Icon = TYPE_ICONS[parsed?.type || ""] || MessageSquare;
            return (
              <Pressable
                className="flex-row items-center px-4 py-3 border-b border-border/50 gap-2.5"
                style={isActive ? { backgroundColor: `${color}14`, borderLeftWidth: 3, borderLeftColor: color } : undefined}
                onPress={() => handleSelect(item.key === mainSessionKey ? null : item.key)}
                accessibilityLabel={item.title}
                accessibilityRole="button"
                onLongPress={() => {
                  const actions: Array<{ text: string; style?: "cancel" | "destructive"; onPress?: () => void }> = [];
                  if (onReset) actions.push({ text: "리셋", onPress: () => handleReset(item.key) });
                  if (onDelete) actions.push({ text: "삭제", style: "destructive", onPress: () => handleDelete(item.key) });
                  if (actions.length > 0) {
                    Alert.alert(item.title, item.key, [
                      { text: "취소", style: "cancel" },
                      ...actions,
                    ]);
                  }
                }}
              >
                <View className="w-7 items-center">
                  <Icon size={14} color="#666666" />
                </View>
                <View className="flex-1 mr-2">
                  <Text
                    className="text-sm text-foreground font-medium"
                    style={isActive ? { color, fontWeight: "700" } : undefined}
                    numberOfLines={1}
                  >
                    {item.sessionId === "main" ? "main" : item.title}
                  </Text>
                  <View className="flex-row items-center gap-1.5 mt-0.5">
                    <View className="px-1.5 py-px rounded-md" style={{ backgroundColor: color + "20" }}>
                      <Text className="text-[10px] font-bold" style={{ color }}>{item.agentId}</Text>
                    </View>
                    {item.lastMessage ? (
                      <Text className="text-xs text-muted-foreground flex-1" numberOfLines={1}>
                        {item.lastMessage}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View className="items-end gap-1">
                  <Text className="text-[11px] text-muted-foreground/60">{timeAgo(item.updatedAt)}</Text>
                  {isActive && <Check size={14} color={color} />}
                </View>
              </Pressable>
            );
          }}
        />

        {/* New session button */}
        <Pressable
          className="flex-row items-center justify-center gap-2 py-3.5 border-t border-border bg-background"
          onPress={() => handleSelect(null)}
          accessibilityLabel="새 대화 시작"
          accessibilityRole="button"
        >
          <Plus size={18} color="hsl(217, 91%, 60%)" />
          <Text className="text-sm font-semibold text-primary">새 대화 시작</Text>
        </Pressable>
      </ActionsheetContent>
    </Actionsheet>
  );
}
