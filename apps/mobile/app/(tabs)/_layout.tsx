import { Tabs } from "expo-router";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { WifiOff, ChevronDown } from "lucide-react-native";
import { useGateway, parseSessionKey } from "@intelli-claw/shared";
import { useSessionStore } from "../../src/stores/sessionStore";

// ─── Connection dot color ───
const STATE_DOT: Record<string, string> = {
  connected: "#22C55E",
  connecting: "#EAB308",
  authenticating: "#3B82F6",
  disconnected: "#EF4444",
};

function ChatHeader() {
  const insets = useSafeAreaInsets();
  const { state } = useGateway();
  const { activeSessionKey, openSessionPicker } = useSessionStore();
  const { mainSessionKey } = useGateway();
  const currentKey = activeSessionKey || mainSessionKey || undefined;
  const parsed = currentKey ? parseSessionKey(currentKey) : null;
  const agentLabel = parsed?.agentId || "iClaw";
  const sessionLabel = parsed
    ? parsed.type === "main" ? "main" : parsed.detail || parsed.type
    : "";
  const dotColor = STATE_DOT[state] || "#EF4444";
  const isConnected = state === "connected";

  return (
    <View style={[h.container, { paddingTop: insets.top }]}>
      {/* Left: connection + agent */}
      <View style={h.left}>
        <View style={[h.dot, { backgroundColor: dotColor }]} />
        <Text style={h.agent} numberOfLines={1}>{agentLabel}</Text>
        {sessionLabel && sessionLabel !== "main" && (
          <Text style={h.session}>/ {sessionLabel}</Text>
        )}
      </View>

      {/* Right: session picker */}
      {isConnected && (
        <TouchableOpacity style={h.pickerBtn} onPress={openSessionPicker} activeOpacity={0.7}>
          <Text style={h.pickerText}>세션</Text>
          <ChevronDown size={14} color="#2563EB" />
        </TouchableOpacity>
      )}

      {!isConnected && (
        <View style={h.statusChip}>
          <WifiOff size={12} color="#DC2626" />
          <Text style={h.statusText}>
            {state === "connecting" ? "연결 중..." : state === "authenticating" ? "인증 중..." : "연결 끊김"}
          </Text>
        </View>
      )}
    </View>
  );
}

const h = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    height: 44,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  left: { flexDirection: "row", alignItems: "center", flex: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  agent: { fontSize: 17, fontWeight: "700", color: "#111827" },
  session: { fontSize: 13, color: "#9CA3AF", marginLeft: 4 },
  pickerBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, backgroundColor: "#EFF6FF" },
  pickerText: { fontSize: 13, fontWeight: "600", color: "#2563EB" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: "#FEF2F2" },
  statusText: { fontSize: 11, fontWeight: "500", color: "#DC2626" },
});

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#007AFF",
        tabBarStyle: { borderTopWidth: 0.5, borderTopColor: "#E5E7EB" },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          header: () => <ChatHeader />,
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="chatbubble-outline" size={size} color={color} />
          ),
          tabBarLabel: "Chat",
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          headerShown: true,
          tabBarIcon: ({ color, size }: { color: string; size: number }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
