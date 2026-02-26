import { View, Text, TouchableOpacity, FlatList, RefreshControl, StyleSheet } from "react-native";
import { useGateway, sessionDisplayName, parseSessionKey } from "@intelli-claw/shared";
import { useSessions } from "../../src/hooks/useSessions";

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const d = Math.floor(hr / 24);
  return `${d}일 전`;
}

export default function SessionsScreen() {
  const { state, mainSessionKey } = useGateway();
  const { sessions, loading, refresh } = useSessions();

  if (state !== "connected") {
    return (
      <View style={s.center}>
        <Text style={s.emptyEmoji}>🔌</Text>
        <Text style={s.emptyTitle}>Gateway 연결 필요</Text>
        <Text style={s.emptySubtitle}>Settings에서 Gateway URL과 Token을 설정하세요</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.key}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#3B82F6" />}
        contentContainerStyle={sessions.length === 0 ? s.emptyList : s.listContent}
        ListEmptyComponent={
          <View style={s.center}>
            <Text style={s.emptySubtitle}>세션 없음</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isMain = item.key === mainSessionKey;
          const displayName = item.title || sessionDisplayName({ key: item.key, label: item.title });

          return (
            <TouchableOpacity
              style={[s.sessionRow, isMain && s.sessionMain]}
              activeOpacity={0.6}
            >
              <View style={s.sessionContent}>
                <View style={s.sessionHeader}>
                  <Text style={s.sessionName} numberOfLines={1}>{displayName}</Text>
                  {isMain && (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>MAIN</Text>
                    </View>
                  )}
                </View>
                <Text style={s.sessionKey} numberOfLines={1}>
                  {parseSessionKey(item.key)?.agentId || item.key}
                </Text>
              </View>
              <Text style={s.sessionTime}>{timeAgo(item.updatedAt)}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#9CA3AF" },
  emptySubtitle: { fontSize: 13, color: "#D1D5DB", marginTop: 4, textAlign: "center" },
  emptyList: { flex: 1 },
  listContent: { paddingVertical: 4 },
  sessionRow: { paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F3F4F6", flexDirection: "row", alignItems: "center" },
  sessionMain: { backgroundColor: "#EFF6FF" },
  sessionContent: { flex: 1, marginRight: 12 },
  sessionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sessionName: { fontSize: 15, fontWeight: "500", color: "#111827", flexShrink: 1 },
  badge: { backgroundColor: "#DBEAFE", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeText: { fontSize: 10, color: "#2563EB", fontWeight: "600" },
  sessionKey: { fontSize: 12, color: "#9CA3AF", marginTop: 2 },
  sessionTime: { fontSize: 11, color: "#D1D5DB" },
});
