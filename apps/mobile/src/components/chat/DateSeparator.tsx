import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, radii, typography } from "../../theme/colors";

export function DateSeparator({ label }: { label: string }) {
  return (
    <View style={s.container}>
      <View style={s.line} />
      <View style={s.badge}>
        <Text style={s.text}>{label}</Text>
      </View>
      <View style={s.line} />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 18,
    gap: 14,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderLight,
  },
  badge: {
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: radii.full,
    backgroundColor: colors.bgTertiary,
  },
  text: {
    ...typography.caption,
    color: colors.textTertiary,
  },
});
