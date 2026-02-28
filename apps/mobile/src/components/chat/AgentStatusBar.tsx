import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Wrench } from "lucide-react-native";
import type { AgentStatus } from "../../hooks/useChat";
import { colors, radii, typography } from "../../theme/colors";

export function AgentStatusBar({ status }: { status: AgentStatus }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(4)).current;
  const isActive = status.phase !== "idle";

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: isActive ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: isActive ? 0 : 4,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isActive, fadeAnim, slideAnim]);

  if (!isActive) return null;

  const label =
    status.phase === "thinking" ? "생각하는 중" :
    status.phase === "writing" ? "작성 중" :
    status.phase === "tool" ? status.toolName : "";

  return (
    <Animated.View style={[s.container, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={s.inner}>
        {status.phase === "tool" ? (
          <View style={s.iconWrap}>
            <Wrench size={11} color={colors.primary} strokeWidth={2.5} />
          </View>
        ) : (
          <View style={s.dotRow}>
            {[0, 1, 2].map((i) => (
              <PulsingDot key={i} delay={i * 200} />
            ))}
          </View>
        )}
        <Text style={s.label}>{label}</Text>
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

  return <Animated.View style={[s.pulseDot, { opacity: anim }]} />;
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  inner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.md,
    backgroundColor: colors.primaryFaint,
    borderWidth: 1,
    borderColor: colors.primaryMuted,
  },
  iconWrap: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primaryMuted,
    alignItems: "center",
    justifyContent: "center",
  },
  dotRow: {
    flexDirection: "row",
    gap: 3,
  },
  pulseDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: colors.primary,
  },
  label: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: "600",
  },
});
