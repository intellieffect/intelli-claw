import React, { useEffect, useRef } from "react";
import { View, Text, Animated } from "react-native";
import { Wrench } from "lucide-react-native";
import type { AgentStatus } from "../../hooks/useChat";

export function AgentStatusBar({ status }: { status: AgentStatus }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(4)).current;
  const isActive = status.phase !== "idle";

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: isActive ? 1 : 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: isActive ? 0 : 4, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [isActive, fadeAnim, slideAnim]);

  if (!isActive) return null;

  const label =
    status.phase === "thinking" ? "생각하는 중" :
    status.phase === "writing" ? "작성 중" :
    status.phase === "tool" ? status.toolName : "";

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }} className="px-4 py-2">
      <View className="flex-row items-center gap-2.5 px-4 py-2.5 rounded-xl bg-primary/5 border border-primary/10">
        {status.phase === "tool" ? (
          <View className="w-6 h-6 rounded-full bg-primary/15 items-center justify-center">
            <Wrench size={13} color="hsl(18 100% 56%)" strokeWidth={2.5} />
          </View>
        ) : (
          <View className="flex-row gap-1">
            {[0, 1, 2].map((i) => (
              <PulsingDot key={i} delay={i * 200} />
            ))}
          </View>
        )}
        <Text className="text-sm font-semibold text-primary">{label}</Text>
      </View>
    </Animated.View>
  );
}

function PulsingDot({ delay }: { delay: number }) {
  const anim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.3, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return <Animated.View style={{ opacity: anim }} className="w-1.5 h-1.5 rounded-full bg-primary" />;
}
