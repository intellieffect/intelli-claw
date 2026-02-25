import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
} from "react-native";
import { useGateway } from "@intelli-claw/shared";
import Constants from "expo-constants";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2.5">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm text-gray-900 font-mono max-w-[60%] text-right" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="bg-gray-50 rounded-xl p-4 mb-4">
      <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
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
    if (!url.trim()) {
      Alert.alert("오류", "Gateway URL을 입력하세요");
      return;
    }
    updateConfig(url.trim(), token.trim());
    setEditing(false);
    Alert.alert("저장됨", "Gateway 설정이 변경되었습니다. 재연결 중...");
  };

  const handleCancel = () => {
    setUrl(gatewayUrl || "");
    setToken("");
    setEditing(false);
  };

  return (
    <ScrollView className="flex-1 bg-white p-4" keyboardShouldPersistTaps="handled">
      {/* Connection Settings */}
      <Section title="Gateway 연결">
        {editing ? (
          <>
            <Text className="text-xs text-gray-500 mb-1">URL</Text>
            <TextInput
              className="h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm mb-3"
              value={url}
              onChangeText={setUrl}
              placeholder="ws://127.0.0.1:18789"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text className="text-xs text-gray-500 mb-1">Token</Text>
            <TextInput
              className="h-10 px-3 bg-white border border-gray-200 rounded-lg text-sm mb-4"
              value={token}
              onChangeText={setToken}
              placeholder="인증 토큰"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View className="flex-row gap-2">
              <TouchableOpacity
                onPress={handleSave}
                className="flex-1 py-2.5 bg-blue-500 rounded-lg items-center"
                activeOpacity={0.7}
              >
                <Text className="text-white font-medium text-sm">저장</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCancel}
                className="flex-1 py-2.5 bg-gray-200 rounded-lg items-center"
                activeOpacity={0.7}
              >
                <Text className="text-gray-700 font-medium text-sm">취소</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <>
            <InfoRow label="Status" value={state} />
            <InfoRow label="URL" value={gatewayUrl || "-"} />
            <InfoRow label="Server" value={serverVersion || "-"} />
            <InfoRow label="Commit" value={serverCommit?.slice(0, 8) || "-"} />
            <TouchableOpacity
              onPress={() => {
                setUrl(gatewayUrl || "");
                setEditing(true);
              }}
              className="mt-2 py-2.5 bg-gray-200 rounded-lg items-center"
              activeOpacity={0.7}
            >
              <Text className="text-gray-700 font-medium text-sm">연결 설정 변경</Text>
            </TouchableOpacity>
          </>
        )}
      </Section>

      {/* App Info */}
      <Section title="앱 정보">
        <InfoRow label="Version" value={Constants.expoConfig?.version || "0.1.0"} />
        <InfoRow label="SDK" value={`Expo ${Constants.expoConfig?.sdkVersion || "?"}`} />
        <InfoRow label="Platform" value="React Native" />
      </Section>
    </ScrollView>
  );
}
