import React, { useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, Animated } from "react-native";
import { Sparkles, Code, FileText, Lightbulb } from "lucide-react-native";

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
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay: 80, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, delay: 80, useNativeDriver: true }),
    ]).start();
    if (connected) {
      chipAnims.forEach((anim, i) => {
        Animated.timing(anim, { toValue: 1, duration: 300, delay: 300 + i * 80, useNativeDriver: true }).start();
      });
    }
  }, [fadeAnim, slideAnim, chipAnims, connected]);

  return (
    <Animated.View
      style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
      className="flex-1 items-center justify-center px-10"
    >
      {/* Icon */}
      <View className="w-[72px] h-[72px] rounded-full bg-primary/5 items-center justify-center mb-6">
        <View className="w-[52px] h-[52px] rounded-full bg-primary/10 items-center justify-center">
          <Sparkles size={28} color="hsl(18 100% 56%)" strokeWidth={1.8} />
        </View>
      </View>

      <Text className="text-2xl font-bold text-foreground text-center tracking-tight">
        {connected ? "무엇을 도와드릴까요?" : "연결 대기 중..."}
      </Text>
      <Text className="text-sm text-muted-foreground mt-2.5 text-center leading-[21px] tracking-wide">
        {connected
          ? "궁금한 것을 물어보거나 아래 제안을 선택하세요"
          : "Settings에서 Gateway URL과 Token을 설정하세요"}
      </Text>

      {connected && (
        <View className="flex-row flex-wrap justify-center gap-2.5 mt-8 px-1">
          {SUGGESTIONS.map((item, i) => {
            const Icon = item.icon;
            return (
              <Animated.View
                key={i}
                style={{
                  opacity: chipAnims[i],
                  transform: [{ translateY: chipAnims[i].interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
                }}
              >
                <TouchableOpacity
                  className="flex-row items-center gap-2 px-4 py-3 rounded-xl bg-card border border-border"
                  activeOpacity={0.65}
                  onPress={() => onSuggestionPress?.(item.prompt)}
                >
                  <View className="w-7 h-7 rounded-full bg-primary/5 items-center justify-center">
                    <Icon size={15} color="hsl(18 100% 56%)" strokeWidth={2} />
                  </View>
                  <Text className="text-sm font-medium text-foreground tracking-wide">{item.label}</Text>
                </TouchableOpacity>
              </Animated.View>
            );
          })}
        </View>
      )}
    </Animated.View>
  );
}
