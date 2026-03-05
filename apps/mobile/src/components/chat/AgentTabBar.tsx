/**
 * AgentTabBar — Horizontal tab bar for switching between agent chats.
 *
 * Features:
 * - Animated underline indicator (react-native-reanimated)
 * - Streaming agent pulse indicator
 * - Unread message count badge
 * - Horizontal scroll for many agents
 */
import React, { useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
} from "react-native-reanimated";
import { cn } from "@/lib/utils";

/* ─── Palette (synced with AgentSelector) ─── */

const PALETTE = [
  "#6366F1", "#EC4899", "#F59E0B", "#10B981", "#8B5CF6",
  "#14B8A6", "#F97316", "#EF4444", "#06B6D4", "#3B82F6",
];

function getAgentColor(agentId: string): string {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash + agentId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/* ─── Types ─── */

export interface AgentTabBarProps {
  agents: Array<{ id: string; name?: string }>;
  activeIndex: number;
  onTabPress: (index: number) => void;
  streamingAgentIds?: Set<string>;
  unreadCounts?: Map<string, number>;
}

/* ─── Constants ─── */

const TAB_HEIGHT = 44;
const INDICATOR_HEIGHT = 3;
const INDICATOR_RADIUS = 1.5;

/* ─── Component ─── */

export function AgentTabBar({
  agents,
  activeIndex,
  onTabPress,
  streamingAgentIds,
  unreadCounts,
}: AgentTabBarProps) {
  const scrollRef = useRef<ScrollView>(null);

  // Track tab layouts for indicator positioning
  const tabLayouts = useRef<Array<{ x: number; width: number }>>([]);

  // Animated values for the underline indicator
  const indicatorX = useSharedValue(0);
  const indicatorW = useSharedValue(0);

  // Active agent color (for indicator)
  const activeColor = agents[activeIndex]
    ? getAgentColor(agents[activeIndex].id)
    : PALETTE[0];

  // Update indicator position when activeIndex changes
  useEffect(() => {
    const layout = tabLayouts.current[activeIndex];
    if (layout) {
      indicatorX.value = withTiming(layout.x, {
        duration: 250,
        easing: Easing.out(Easing.cubic),
      });
      indicatorW.value = withTiming(layout.width, {
        duration: 250,
        easing: Easing.out(Easing.cubic),
      });
    }
  }, [activeIndex, indicatorX, indicatorW]);

  // Scroll active tab into view
  useEffect(() => {
    const layout = tabLayouts.current[activeIndex];
    if (layout && scrollRef.current) {
      scrollRef.current.scrollTo({
        x: Math.max(0, layout.x - 40),
        animated: true,
      });
    }
  }, [activeIndex]);

  const handleTabLayout = useCallback(
    (index: number, event: LayoutChangeEvent) => {
      const { x, width } = event.nativeEvent.layout;
      tabLayouts.current[index] = { x, width };

      // Set initial position without animation for the active tab
      if (index === activeIndex) {
        indicatorX.value = x;
        indicatorW.value = width;
      }
    },
    [activeIndex, indicatorX, indicatorW],
  );

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: indicatorX.value }],
    width: indicatorW.value,
  }));

  if (agents.length <= 1) return null;

  return (
    <View
      className="bg-background border-b border-border"
      style={{ height: TAB_HEIGHT }}
    >
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row items-stretch"
      >
        {agents.map((agent, index) => {
          const isActive = index === activeIndex;
          const color = getAgentColor(agent.id);
          const isStreaming = streamingAgentIds?.has(agent.id) ?? false;
          const unread = unreadCounts?.get(agent.id) ?? 0;

          return (
            <Pressable
              key={agent.id}
              className={cn(
                "flex-row items-center justify-center px-4 gap-1.5",
                isActive ? "opacity-100" : "opacity-60",
              )}
              style={{ height: TAB_HEIGHT }}
              onLayout={(e) => handleTabLayout(index, e)}
              onPress={() => onTabPress(index)}
              accessibilityLabel={`${agent.name || agent.id} 에이전트`}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              {/* Streaming pulse dot */}
              {isStreaming && <StreamingDot color={color} />}

              <Text
                className={cn(
                  "text-sm font-semibold",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
                numberOfLines={1}
                style={isActive ? { color } : undefined}
              >
                {agent.name || agent.id}
              </Text>

              {/* Unread badge */}
              {unread > 0 && !isActive && (
                <View
                  className="min-w-[18px] h-[18px] rounded-full items-center justify-center px-1"
                  style={{ backgroundColor: color }}
                >
                  <Text className="text-[11px] font-bold text-white">
                    {unread > 99 ? "99+" : unread}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}

        {/* Animated underline indicator */}
        <Animated.View
          style={[
            {
              position: "absolute",
              bottom: 0,
              height: INDICATOR_HEIGHT,
              borderRadius: INDICATOR_RADIUS,
              backgroundColor: activeColor,
            },
            indicatorStyle,
          ]}
        />
      </ScrollView>
    </View>
  );
}

/* ─── StreamingDot ─── */

function StreamingDot({ color }: { color: string }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(0.2, { duration: 600, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) }),
      ),
      -1, // infinite
      false,
    );
  }, [opacity]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        },
        dotStyle,
      ]}
    />
  );
}
