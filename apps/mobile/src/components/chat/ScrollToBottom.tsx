import React, { useEffect, useRef } from "react";
import { TouchableOpacity, Animated } from "react-native";
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
    <Animated.View style={{ position: "absolute", bottom: 14, right: 16, opacity: fadeAnim, transform: [{ scale: fadeAnim }] }}>
      <TouchableOpacity
        className="w-[38px] h-[38px] rounded-full bg-card border border-border items-center justify-center shadow-md"
        onPress={onPress}
        activeOpacity={0.7}
      >
        <ChevronDown size={17} color="hsl(0 0% 63%)" strokeWidth={2.5} />
      </TouchableOpacity>
    </Animated.View>
  );
}
