import { View, Text, TouchableOpacity, FlatList, RefreshControl } from "react-native";
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
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-4xl mb-3">🔌</Text>
        <Text className="text-lg font-semibold text-gray-400">Gateway 연결 필요</Text>
        <Text className="text-sm text-gray-300 mt-1 text-center">
          Settings에서 Gateway URL과 Token을 설정하세요
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.key}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={refresh} tintColor="#3B82F6" />
        }
        contentContainerStyle={sessions.length === 0 ? { flex: 1 } : { paddingVertical: 4 }}
        ListEmptyComponent={
          <View className="flex-1 items-center justify-center">
            <Text className="text-gray-400">세션 없음</Text>
          </View>
        }
        renderItem={({ item }) => {
          const parsed = parseSessionKey(item.key);
          const isMain = item.key === mainSessionKey;
          const displayName = item.title || sessionDisplayName({ key: item.key, label: item.title });

          return (
            <TouchableOpacity
              className={`px-4 py-3 border-b border-gray-100 ${isMain ? "bg-blue-50" : ""}`}
              activeOpacity={0.6}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1 mr-3">
                  <View className="flex-row items-center gap-2">
                    <Text className="text-[15px] font-medium text-gray-900" numberOfLines={1}>
                      {displayName}
                    </Text>
                    {isMain && (
                      <View className="bg-blue-100 px-1.5 py-0.5 rounded">
                        <Text className="text-[10px] text-blue-600 font-medium">MAIN</Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-xs text-gray-400 mt-0.5" numberOfLines={1}>
                    {parsed?.agentId || item.key}
                  </Text>
                </View>
                <Text className="text-xs text-gray-300">{timeAgo(item.updatedAt)}</Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}
