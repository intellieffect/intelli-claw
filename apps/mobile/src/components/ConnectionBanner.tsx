import { View, Text } from "react-native";
import { useGateway, type ConnectionState } from "@intelli-claw/shared";

const STATUS_CONFIG: Record<
  ConnectionState,
  { bg: string; dot: string; text: string; label: string }
> = {
  connected: {
    bg: "bg-green-50",
    dot: "bg-green-500",
    text: "text-green-800",
    label: "Connected",
  },
  connecting: {
    bg: "bg-yellow-50",
    dot: "bg-yellow-500",
    text: "text-yellow-800",
    label: "Connecting...",
  },
  authenticating: {
    bg: "bg-blue-50",
    dot: "bg-blue-500",
    text: "text-blue-800",
    label: "Authenticating...",
  },
  disconnected: {
    bg: "bg-red-50",
    dot: "bg-red-500",
    text: "text-red-800",
    label: "Disconnected",
  },
};

export function ConnectionBanner() {
  const { state, error } = useGateway();
  const config = STATUS_CONFIG[state];

  return (
    <View className={`px-4 py-2.5 ${config.bg}`}>
      <View className="flex-row items-center">
        <View className={`w-2 h-2 rounded-full mr-2 ${config.dot}`} />
        <Text className={`text-sm font-medium ${config.text}`}>
          {config.label}
        </Text>
      </View>
      {error && (
        <Text className="text-xs text-red-600 mt-1">{error.message}</Text>
      )}
    </View>
  );
}
