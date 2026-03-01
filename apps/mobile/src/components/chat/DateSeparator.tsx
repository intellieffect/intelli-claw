import React from "react";
import { View, Text } from "react-native";

export function DateSeparator({ label }: { label: string }) {
  return (
    <View className="flex-row items-center px-6 py-4 gap-3.5">
      <View className="flex-1 h-[0.5px] bg-border" />
      <View className="px-3.5 py-1 rounded-full bg-secondary">
        <Text className="text-xs font-medium text-muted-foreground">{label}</Text>
      </View>
      <View className="flex-1 h-[0.5px] bg-border" />
    </View>
  );
}
