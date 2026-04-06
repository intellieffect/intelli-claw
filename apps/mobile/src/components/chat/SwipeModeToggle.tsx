/**
 * SwipeModeToggle — #291
 *
 * Compact two-segment toggle that flips the PagerView between
 * agent-swipe and topic-swipe modes. Designed to sit inside the
 * InputBar agent strip area so it's always reachable next to where
 * the user is typing.
 */
import React from "react";
import { View, Pressable, Text } from "react-native";
import { Bot, MessageCircle } from "lucide-react-native";
import { cn } from "@/lib/utils";
import type { SwipeMode } from "../../hooks/useSwipeMode";

interface SwipeModeToggleProps {
  mode: SwipeMode;
  onChange: (next: SwipeMode) => void;
  /** Hide the toggle when there's nothing to switch (e.g. single-agent setups). */
  visible?: boolean;
}

export function SwipeModeToggle({ mode, onChange, visible = true }: SwipeModeToggleProps) {
  if (!visible) return null;

  const isAgent = mode === "agent";

  return (
    <View
      className="flex-row items-center bg-muted rounded-full p-0.5"
      accessibilityRole="radiogroup"
      accessibilityLabel="스와이프 전환 모드"
    >
      <Pressable
        onPress={() => onChange("agent")}
        accessibilityRole="radio"
        accessibilityState={{ selected: isAgent }}
        accessibilityLabel="에이전트 스와이프"
        className={cn(
          "flex-row items-center gap-1 px-2.5 py-1 rounded-full",
          isAgent ? "bg-card" : "bg-transparent",
        )}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      >
        <Bot size={11} color={isAgent ? "hsl(18 100% 56%)" : "hsl(0 0% 50%)"} />
        <Text
          className={cn(
            "text-[11px] font-medium",
            isAgent ? "text-foreground" : "text-muted-foreground",
          )}
        >
          에이전트
        </Text>
      </Pressable>
      <Pressable
        onPress={() => onChange("topic")}
        accessibilityRole="radio"
        accessibilityState={{ selected: !isAgent }}
        accessibilityLabel="토픽 스와이프"
        className={cn(
          "flex-row items-center gap-1 px-2.5 py-1 rounded-full",
          !isAgent ? "bg-card" : "bg-transparent",
        )}
        hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      >
        <MessageCircle size={11} color={!isAgent ? "hsl(18 100% 56%)" : "hsl(0 0% 50%)"} />
        <Text
          className={cn(
            "text-[11px] font-medium",
            !isAgent ? "text-foreground" : "text-muted-foreground",
          )}
        >
          토픽
        </Text>
      </Pressable>
    </View>
  );
}
