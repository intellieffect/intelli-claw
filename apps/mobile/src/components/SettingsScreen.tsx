import { useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Alert, Platform } from "react-native";
import { useGateway } from "@intelli-claw/shared";
import Constants from "expo-constants";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2.5">
      <Text className="text-[13px] text-muted-foreground">{label}</Text>
      <Text
        className="text-[13px] text-foreground font-mono max-w-[60%] text-right"
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="bg-card rounded-xl p-4 mb-4">
      <Text className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest mb-3">
        {title}
      </Text>
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
    <ScrollView className="flex-1 bg-background p-4" keyboardShouldPersistTaps="handled">
      <Section title="Gateway 연결">
        {editing ? (
          <>
            <Text className="text-[11px] text-muted-foreground mb-1">URL</Text>
            <TextInput
              className="h-10 px-3 bg-background border border-border rounded-lg text-[13px] text-foreground mb-3"
              value={url}
              onChangeText={setUrl}
              placeholder="ws://127.0.0.1:18789"
              placeholderTextColor="#444444"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text className="text-[11px] text-muted-foreground mb-1">Token</Text>
            <TextInput
              className="h-10 px-3 bg-background border border-border rounded-lg text-[13px] text-foreground mb-3"
              value={token}
              onChangeText={setToken}
              placeholder="인증 토큰"
              placeholderTextColor="#444444"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View className="flex-row gap-2">
              <Pressable
                className="flex-1 py-2.5 rounded-lg bg-info items-center active:opacity-80"
                onPress={handleSave}
              >
                <Text className="text-[13px] font-medium text-white">저장</Text>
              </Pressable>
              <Pressable
                className="flex-1 py-2.5 rounded-lg bg-border items-center active:opacity-80"
                onPress={() => { setUrl(gatewayUrl || ""); setToken(""); setEditing(false); }}
              >
                <Text className="text-[13px] font-medium text-card-foreground/80">취소</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <InfoRow label="Status" value={state} />
            <InfoRow label="URL" value={gatewayUrl || "-"} />
            <InfoRow label="Server" value={serverVersion || "-"} />
            <InfoRow label="Commit" value={serverCommit?.slice(0, 8) || "-"} />
            <Pressable
              className="mt-2 py-2.5 rounded-lg bg-border items-center active:opacity-80"
              onPress={() => { setUrl(gatewayUrl || ""); setEditing(true); }}
            >
              <Text className="text-[13px] font-medium text-card-foreground/80">연결 설정 변경</Text>
            </Pressable>
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
