import { View, Text } from "react-native";
import { useGateway } from "@intelli-claw/shared";

export default function SessionsScreen() {
  const { state } = useGateway();

  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Text className="text-lg font-semibold text-gray-400">Sessions</Text>
      <Text className="text-sm text-gray-300 mt-2">
        {state === "connected"
          ? "세션 관리 기능은 Phase 3에서 구현됩니다"
          : "Gateway 연결 후 이용 가능"}
      </Text>
    </View>
  );
}
