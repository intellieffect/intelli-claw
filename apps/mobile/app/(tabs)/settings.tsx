import { View, Text, ScrollView } from "react-native";
import { useGateway } from "@intelli-claw/shared";
import Constants from "expo-constants";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-2">
      <Text className="text-sm text-gray-500">{label}</Text>
      <Text className="text-sm text-gray-900 font-mono max-w-[60%] text-right">
        {value}
      </Text>
    </View>
  );
}

export default function SettingsScreen() {
  const { state, gatewayUrl, serverVersion, serverCommit } = useGateway();

  return (
    <ScrollView className="flex-1 bg-white p-4">
      <View className="bg-gray-50 rounded-xl p-4 mb-4">
        <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          Gateway
        </Text>
        <InfoRow label="Status" value={state} />
        <InfoRow label="URL" value={gatewayUrl || "-"} />
        <InfoRow label="Server" value={serverVersion || "-"} />
        <InfoRow label="Commit" value={serverCommit?.slice(0, 8) || "-"} />
      </View>

      <View className="bg-gray-50 rounded-xl p-4">
        <Text className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
          App
        </Text>
        <InfoRow
          label="Version"
          value={Constants.expoConfig?.version || "0.1.0"}
        />
        <InfoRow
          label="SDK"
          value={`Expo ${Constants.expoConfig?.sdkVersion || "?"}`}
        />
        <InfoRow label="Platform" value="React Native" />
      </View>
    </ScrollView>
  );
}
