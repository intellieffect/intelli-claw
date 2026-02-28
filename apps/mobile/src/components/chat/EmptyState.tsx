import React, { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, Animated } from "react-native";
import { Sparkles, Code, FileText, Lightbulb } from "lucide-react-native";
import { colors, shadows, radii, typography } from "../../theme/colors";

const SUGGESTIONS = [
  { icon: Sparkles, label: "브레인스토밍", prompt: "새로운 프로젝트 아이디어를 브레인스토밍 해줘" },
  { icon: Code, label: "코드 작성", prompt: "코드 작성을 도와줘" },
  { icon: FileText, label: "문서 요약", prompt: "이 문서를 요약해줘" },
  { icon: Lightbulb, label: "문제 해결", prompt: "이 문제를 해결해줘" },
];

interface EmptyStateProps {
  connected: boolean;
  onSuggestionPress?: (prompt: string) => void;
}

export function EmptyState({ connected, onSuggestionPress }: EmptyStateProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;
  const chipAnims = useRef(SUGGESTIONS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // Main content fade in
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay: 80, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, delay: 80, useNativeDriver: true }),
    ]).start();

    // Staggered chip animation
    if (connected) {
      chipAnims.forEach((anim, i) => {
        Animated.timing(anim, {
          toValue: 1,
          duration: 300,
          delay: 300 + i * 80,
          useNativeDriver: true,
        }).start();
      });
    }
  }, [fadeAnim, slideAnim, chipAnims, connected]);

  return (
    <Animated.View
      style={[s.container, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
    >
      {/* Gradient-like icon with glow */}
      <View style={s.iconOuter}>
        <View style={s.iconInner}>
          <Sparkles size={28} color={colors.primary} strokeWidth={1.8} />
        </View>
      </View>

      <Text style={s.title}>
        {connected ? "무엇을 도와드릴까요?" : "연결 대기 중..."}
      </Text>
      <Text style={s.subtitle}>
        {connected
          ? "궁금한 것을 물어보거나 아래 제안을 선택하세요"
          : "Settings에서 Gateway URL과 Token을 설정하세요"}
      </Text>

      {connected && (
        <View style={s.chips}>
          {SUGGESTIONS.map((item, i) => {
            const Icon = item.icon;
            return (
              <Animated.View
                key={i}
                style={{
                  opacity: chipAnims[i],
                  transform: [{ translateY: chipAnims[i].interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                  }) }],
                }}
              >
                <TouchableOpacity
                  style={s.chip}
                  activeOpacity={0.65}
                  onPress={() => onSuggestionPress?.(item.prompt)}
                >
                  <View style={s.chipIcon}>
                    <Icon size={15} color={colors.primary} strokeWidth={2} />
                  </View>
                  <Text style={s.chipText}>{item.label}</Text>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  iconOuter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primaryFaint,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  iconInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...typography.title,
    color: colors.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: colors.textTertiary,
    marginTop: 10,
    textAlign: "center",
    lineHeight: 21,
    letterSpacing: 0.1,
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginTop: 32,
    paddingHorizontal: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: radii.lg,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    ...shadows.sm,
  },
  chipIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primaryFaint,
    alignItems: "center",
    justifyContent: "center",
  },
  chipText: {
    fontSize: 14,
    fontWeight: "500",
    color: colors.text,
    letterSpacing: 0.1,
  },
});
