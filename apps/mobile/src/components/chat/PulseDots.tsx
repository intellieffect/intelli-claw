import React, { useEffect, useRef } from "react";
import { View, Animated } from "react-native";

export function PulseDots() {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (val: Animated.Value, delay: number) =>
      Animated.loop(Animated.sequence([
        Animated.delay(delay),
        Animated.timing(val, { toValue: 1, duration: 400, useNativeDriver: true }),
        Animated.timing(val, { toValue: 0.3, duration: 400, useNativeDriver: true }),
      ]));
    const a1 = pulse(dot1, 0); const a2 = pulse(dot2, 200); const a3 = pulse(dot3, 400);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [dot1, dot2, dot3]);

  return (
    <View className="flex-row items-center gap-1 py-2 px-0.5">
      {[dot1, dot2, dot3].map((anim, i) => (
        <Animated.View key={i} style={{ opacity: anim }} className="w-[7px] h-[7px] rounded-full bg-primary" />
      ))}
    </View>
  );
}
