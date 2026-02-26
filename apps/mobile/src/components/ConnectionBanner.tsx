import { View, Text, StyleSheet } from "react-native";
import { useGateway, type ConnectionState } from "@intelli-claw/shared";

const STATUS_CONFIG: Record<
  ConnectionState,
  { bg: string; dot: string; text: string; label: string }
> = {
  connected: { bg: "#F0FDF4", dot: "#22C55E", text: "#166534", label: "Connected" },
  connecting: { bg: "#FEFCE8", dot: "#EAB308", text: "#854D0E", label: "Connecting..." },
  authenticating: { bg: "#EFF6FF", dot: "#3B82F6", text: "#1E40AF", label: "Authenticating..." },
  disconnected: { bg: "#FEF2F2", dot: "#EF4444", text: "#991B1B", label: "Disconnected" },
};

export function ConnectionBanner() {
  const { state, error } = useGateway();
  const config = STATUS_CONFIG[state];

  return (
    <View style={[styles.container, { backgroundColor: config.bg }]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: config.dot }]} />
        <Text style={[styles.label, { color: config.text }]}>{config.label}</Text>
      </View>
      {error && <Text style={styles.error}>{error.message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { paddingHorizontal: 16, paddingVertical: 10 },
  row: { flexDirection: "row", alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  label: { fontSize: 13, fontWeight: "500" },
  error: { fontSize: 11, color: "#DC2626", marginTop: 4 },
});
