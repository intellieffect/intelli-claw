import React, { useRef, useEffect } from "react";
import { View, TextInput, TouchableOpacity, Animated } from "react-native";
import { ArrowUp, Square, Paperclip } from "lucide-react-native";
import { cn } from "@/lib/utils";

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
}: InputBarProps) {
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

  // Import AttachButton lazily to avoid circular deps
  const { AttachButton } = require("../FileAttachments");

  return (
    <View
      className="px-3 pt-2 bg-background"
      style={{ paddingBottom: keyboardVisible ? 6 : Math.max(10, bottomInset) }}
    >
      <View className="flex-row items-end bg-card rounded-3xl border border-border px-2 py-1.5 min-h-[44px]">
        {/* Attach */}
        <View className="w-9 h-9 items-center justify-center self-end">
          <AttachButton onAttach={onAttach} disabled={!connected} />
        </View>

        {/* Input */}
        <TextInput
          className="flex-1 min-h-[34px] max-h-[120px] px-2 py-1.5 text-[15px] leading-[21px] text-foreground"
          placeholder={connected ? "메시지 입력..." : "연결 안 됨"}
          placeholderTextColor="hsl(0 0% 45%)"
          value={text}
          onChangeText={onChangeText}
          editable={connected}
          returnKeyType="default"
          multiline
        />

        {/* Send / Abort */}
        <View className="w-9 h-9 items-center justify-center self-end">
          <Animated.View style={{ opacity: sendOpacity, transform: [{ scale: sendScale }] }}>
            {streaming ? (
              <TouchableOpacity
                onPress={onAbort}
                className="w-8 h-8 rounded-full bg-foreground items-center justify-center"
                activeOpacity={0.7}
              >
                <Square size={11} color="hsl(0 0% 4%)" fill="hsl(0 0% 4%)" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleSendPress}
                className={cn(
                  "w-8 h-8 rounded-full items-center justify-center",
                  canSend ? "bg-primary" : "bg-muted",
                )}
                disabled={!canSend}
                activeOpacity={0.7}
              >
                <ArrowUp size={17} color={canSend ? "hsl(0 0% 4%)" : "hsl(0 0% 45%)"} strokeWidth={2.5} />
              </TouchableOpacity>
            )}
          </Animated.View>
        </View>
      </View>
    </View>
  );
}
