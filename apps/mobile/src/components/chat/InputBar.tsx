import React, { useRef, useEffect } from "react";
import { View, TextInput, Pressable, Animated } from "react-native";
import { ArrowUp, Square } from "lucide-react-native";
import { cn } from "@/lib/utils";
import { AttachButton } from "../FileAttachments";
import { AgentTabBar } from "./AgentTabBar";

interface InputBarProps {
  text: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onAbort: () => void;
  onAttach: (attachments: any[]) => void;
  streaming: boolean;
  connected: boolean;
  hasContent: boolean;
  bottomInset: number;
  keyboardVisible: boolean;
  /**
   * #293: agent selector merged into the InputBar.
   *
   * When provided, a compact horizontal AgentTabBar is rendered above the
   * text input. The previously-separate AgentTabBar above the PagerView is
   * removed by the parent. Single-agent setups (`agents.length <= 1`) hide
   * the bar entirely so the InputBar collapses back to its old footprint.
   */
  agents?: Array<{ id: string; name?: string }>;
  activeAgentIndex?: number;
  onAgentTabPress?: (index: number) => void;
  streamingAgentIds?: Set<string>;
  unreadCounts?: Map<string, number>;
}

export function InputBar({
  text,
  onChangeText,
  onSend,
  onAbort,
  onAttach,
  streaming,
  connected,
  hasContent,
  bottomInset,
  keyboardVisible,
  agents,
  activeAgentIndex = 0,
  onAgentTabPress,
  streamingAgentIds,
  unreadCounts,
}: InputBarProps) {
  // #293: Show agent selector inside the InputBar only when there are 2+ agents.
  const showAgentBar = !!agents && agents.length >= 2 && !!onAgentTabPress;
  const sendScale = useRef(new Animated.Value(1)).current;
  const sendOpacity = useRef(new Animated.Value(0)).current;
  const canSend = connected && hasContent;

  useEffect(() => {
    Animated.timing(sendOpacity, {
      toValue: canSend || streaming ? 1 : 0.5,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [canSend, streaming, sendOpacity]);

  const handleSendPress = () => {
    Animated.sequence([
      Animated.timing(sendScale, { toValue: 0.85, duration: 60, useNativeDriver: true }),
      Animated.timing(sendScale, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    onSend();
  };

  return (
    <View
      className="px-3 pt-2.5 bg-background"
      style={{ paddingBottom: keyboardVisible ? 8 : Math.max(12, bottomInset) }}
    >
      {/* #293: Inline agent tab bar above the text field */}
      {showAgentBar && (
        <View className="mb-2">
          <AgentTabBar
            agents={agents!}
            activeIndex={activeAgentIndex}
            onTabPress={onAgentTabPress!}
            streamingAgentIds={streamingAgentIds}
            unreadCounts={unreadCounts}
          />
        </View>
      )}
      <View className="flex-row items-end bg-card rounded-[28px] border border-border px-3 py-2.5 min-h-[56px]">
        {/* Attach */}
        <View className="w-11 h-11 items-center justify-center self-end">
          <AttachButton onAttach={onAttach} disabled={!connected} />
        </View>

        {/* Input */}
        <TextInput
          className="flex-1 min-h-[44px] max-h-[120px] px-2 py-2.5 text-[17px] leading-7 text-foreground"
          placeholder={connected ? "메시지 입력..." : "연결 안 됨"}
          placeholderTextColor="hsl(0 0% 40%)"
          value={text}
          onChangeText={onChangeText}
          editable={connected}
          returnKeyType="default"
          multiline
          accessibilityLabel="메시지 입력"
        />

        {/* Send / Abort */}
        <View className="w-11 h-11 items-center justify-center self-end">
          <Animated.View style={{ opacity: sendOpacity, transform: [{ scale: sendScale }] }}>
            {streaming ? (
              <Pressable
                onPress={onAbort}
                className="w-10 h-10 rounded-full bg-foreground items-center justify-center"
                accessibilityLabel="스트리밍 중단"
                accessibilityRole="button"
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Square size={14} color="hsl(0 0% 4%)" fill="hsl(0 0% 4%)" />
              </Pressable>
            ) : (
              <Pressable
                onPress={handleSendPress}
                className={cn(
                  "w-10 h-10 rounded-full items-center justify-center",
                  canSend ? "bg-primary" : "bg-muted",
                )}
                disabled={!canSend}
                accessibilityLabel="전송"
                accessibilityRole="button"
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <ArrowUp size={22} color={canSend ? "hsl(0 0% 4%)" : "hsl(0 0% 45%)"} strokeWidth={2.5} />
              </Pressable>
            )}
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
