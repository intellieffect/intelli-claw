import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, StyleSheet, Platform } from "react-native";
import { useGateway } from "@intelli-claw/shared";
import Constants from "expo-constants";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.infoRow}>
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function SettingsScreen() {
  const { state, gatewayUrl, serverVersion, serverCommit, updateConfig } = useGateway();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(gatewayUrl || "");
  const [token, setToken] = useState("");

  const handleSave = () => {
    if (!url.trim()) { Alert.alert("오류", "Gateway URL을 입력하세요"); return; }
    updateConfig(url.trim(), token.trim());
    setEditing(false);
    Alert.alert("저장됨", "Gateway 설정이 변경되었습니다. 재연결 중...");
  };

  return (
    <ScrollView style={s.container} keyboardShouldPersistTaps="handled">
      <Section title="Gateway 연결">
        {editing ? (
          <>
            <Text style={s.fieldLabel}>URL</Text>
            <TextInput style={s.textInput} value={url} onChangeText={setUrl} placeholder="ws://127.0.0.1:18789" autoCapitalize="none" autoCorrect={false} keyboardType="url" />
            <Text style={s.fieldLabel}>Token</Text>
            <TextInput style={s.textInput} value={token} onChangeText={setToken} placeholder="인증 토큰" autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <View style={s.btnRow}>
              <TouchableOpacity onPress={handleSave} style={[s.btn, s.btnPrimary]} activeOpacity={0.7}>
                <Text style={s.btnPrimaryText}>저장</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setUrl(gatewayUrl || ""); setToken(""); setEditing(false); }} style={[s.btn, s.btnSecondary]} activeOpacity={0.7}>
                <Text style={s.btnSecondaryText}>취소</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <InfoRow label="Status" value={state} />
            <InfoRow label="URL" value={gatewayUrl || "-"} />
            <InfoRow label="Server" value={serverVersion || "-"} />
            <InfoRow label="Commit" value={serverCommit?.slice(0, 8) || "-"} />
            <TouchableOpacity onPress={() => { setUrl(gatewayUrl || ""); setEditing(true); }} style={[s.btn, s.btnSecondary, { marginTop: 8 }]} activeOpacity={0.7}>
              <Text style={s.btnSecondaryText}>연결 설정 변경</Text>
            </TouchableOpacity>
          </>
        )}
      </Section>

      <Section title="앱 정보">
        <InfoRow label="Version" value={Constants.expoConfig?.version || "0.1.0"} />
        <InfoRow label="SDK" value={`Expo ${Constants.expoConfig?.sdkVersion || "?"}`} />
        <InfoRow label="Platform" value="React Native" />
      </Section>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#FFFFFF", padding: 16 },
  section: { backgroundColor: "#F9FAFB", borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: "600", color: "#9CA3AF", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10 },
  infoLabel: { fontSize: 13, color: "#6B7280" },
  infoValue: { fontSize: 13, color: "#111827", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", maxWidth: "60%", textAlign: "right" },
  fieldLabel: { fontSize: 11, color: "#6B7280", marginBottom: 4 },
  textInput: { height: 40, paddingHorizontal: 12, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 8, fontSize: 13, marginBottom: 12 },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  btnPrimary: { backgroundColor: "#3B82F6" },
  btnPrimaryText: { color: "#FFFFFF", fontWeight: "500", fontSize: 13 },
  btnSecondary: { backgroundColor: "#E5E7EB" },
  btnSecondaryText: { color: "#374151", fontWeight: "500", fontSize: 13 },
});
