import React, { useEffect, useRef } from "react";
import { Pressable, Animated } from "react-native";
import { ChevronDown } from "lucide-react-native";

interface ScrollToBottomProps {
  visible: boolean;
  onPress: () => void;
}

export function ScrollToBottomButton({ visible, onPress }: ScrollToBottomProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: visible ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [visible, fadeAnim]);

  if (!visible) return null;

  return (
    <Animated.View style={{ position: "absolute", bottom: 16, right: 16, opacity: fadeAnim, transform: [{ scale: fadeAnim }] }}>
      <Pressable
        className="w-11 h-11 rounded-full bg-card border border-border items-center justify-center shadow-md active:bg-secondary"
        onPress={onPress}
      >
        <ChevronDown size={20} color="hsl(0 0% 63%)" strokeWidth={2.5} />
      </Pressable>
    </Animated.View>
  );
}
