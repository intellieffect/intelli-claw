import React, { useEffect, useRef } from "react";
import { TouchableOpacity, StyleSheet, Animated } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { colors, shadows, radii } from "../../theme/colors";

interface ScrollToBottomProps {
  visible: boolean;
  onPress: () => void;
}

export function ScrollToBottomButton({ visible, onPress }: ScrollToBottomProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [visible, fadeAnim]);

  if (!visible) return null;

  return (
    <Animated.View style={[s.wrapper, { opacity: fadeAnim, transform: [{ scale: fadeAnim }] }]}>
      <TouchableOpacity style={s.btn} onPress={onPress} activeOpacity={0.7}>
        <ChevronDown size={17} color={colors.textSecondary} strokeWidth={2.5} />
      </TouchableOpacity>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    position: "absolute",
    bottom: 14,
    right: 16,
  },
  btn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.md,
  },
});
