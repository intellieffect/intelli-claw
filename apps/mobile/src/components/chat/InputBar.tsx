import React, { useRef, useEffect } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from "react-native";
import { ArrowUp, Square } from "lucide-react-native";
import { AttachButton } from "../FileAttachments";
import { colors, shadows, radii } from "../../theme/colors";

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

  // Animate send button appearance
  useEffect(() => {
    Animated.timing(sendOpacity, {
      toValue: canSend || streaming ? 1 : 0.6,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [canSend, streaming, sendOpacity]);

  const handleSendPress = () => {
    Animated.sequence([
      Animated.timing(sendScale, { toValue: 0.82, duration: 60, useNativeDriver: true }),
      Animated.timing(sendScale, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start();
    onSend();
  };

  return (
    <View style={[s.container, { paddingBottom: keyboardVisible ? 6 : Math.max(10, bottomInset) }]}>
      <View style={s.inputRow}>
        {/* Attach button */}
        <AttachButton onAttach={onAttach} disabled={!connected} />

        {/* Input */}
        <TextInput
          style={s.input}
          placeholder={connected ? "메시지 입력..." : "연결 안 됨"}
          placeholderTextColor={colors.textMuted}
          value={text}
          onChangeText={onChangeText}
          editable={connected}
          returnKeyType="default"
          multiline
        />

        {/* Send / Abort button */}
        <Animated.View style={{ opacity: sendOpacity, transform: [{ scale: sendScale }] }}>
          {streaming ? (
            <TouchableOpacity onPress={onAbort} style={s.abortBtn} activeOpacity={0.7}>
              <Square size={12} color={colors.textWhite} fill={colors.textWhite} />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSendPress}
              style={[s.sendBtn, canSend ? s.sendActive : s.sendDisabled]}
              disabled={!canSend}
              activeOpacity={0.7}
            >
              <ArrowUp size={18} color={colors.textWhite} strokeWidth={2.5} />
            </TouchableOpacity>
          )}
        </Animated.View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 14,
    paddingTop: 8,
    backgroundColor: colors.bg,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    backgroundColor: colors.bgSecondary,
    borderRadius: radii.xxl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 6,
    paddingVertical: 5,
    ...shadows.input,
  },
  attachBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    minHeight: 34,
    maxHeight: 120,
    paddingHorizontal: 6,
    paddingVertical: 7,
    fontSize: 15,
    lineHeight: 21,
    letterSpacing: 0.1,
    color: colors.text,
  },
  sendBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  sendActive: {
    backgroundColor: colors.primary,
  },
  sendDisabled: {
    backgroundColor: colors.textMuted,
  },
  abortBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
  },
});
