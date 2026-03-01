import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
} from "react-native";
import {
  ChevronDown,
  WifiOff,
  MoreHorizontal,
  Bot,
  Puzzle,
  Settings,
} from "lucide-react-native";

interface AppBarProps {
  agentLabel: string;
  sessionLabel: string;
  dotColor: string;
  isConnected: boolean;
  connectionState: string;
  onSessionPress: () => void;
  onSettingsPress: () => void;
  onAgentSelect: () => void;
  onSkillPicker: () => void;
}

export function AppBar({
  agentLabel,
  sessionLabel,
  dotColor,
  isConnected,
  connectionState,
  onSessionPress,
  onSettingsPress,
  onAgentSelect,
  onSkillPicker,
}: AppBarProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <View className="flex-row items-center justify-between h-16 px-5 bg-background border-b border-border">
      <Pressable
        className="flex-row items-center flex-1"
        onPress={onSessionPress}
        disabled={!isConnected}
        accessibilityLabel="세션 선택"
        accessibilityRole="button"
      >
        <View className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: dotColor }} />
        <Text className="text-[22px] font-bold text-foreground tracking-tight" numberOfLines={1}>{agentLabel}</Text>
        {sessionLabel && sessionLabel !== "main" && (
          <Text className="text-[17px] text-muted-foreground ml-2">/ {sessionLabel}</Text>
        )}
        {isConnected && <ChevronDown size={18} color="hsl(0 0% 45%)" style={{ marginLeft: 6 }} />}
      </Pressable>

      <View className="flex-row items-center gap-3">
        {!isConnected && (
          <View className="flex-row items-center gap-1.5 py-1.5 px-3 rounded-lg bg-destructive/10">
            <WifiOff size={14} color="hsl(0 84% 60%)" strokeWidth={2.5} />
            <Text className="text-sm font-medium text-destructive">
              {connectionState === "connecting" ? "연결 중" : connectionState === "authenticating" ? "인증 중" : "끊김"}
            </Text>
          </View>
        )}
        <Pressable
          onPress={() => setMenuOpen(true)}
          className="w-12 h-12 rounded-full items-center justify-center active:bg-secondary"
          accessibilityLabel="메뉴"
          accessibilityRole="button"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <MoreHorizontal size={26} color="hsl(0 0% 63%)" />
        </Pressable>
      </View>

      {/* Menu popup */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable
          className="flex-1 justify-start items-end pt-28 pr-5"
          style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
          onPress={() => setMenuOpen(false)}
        >
          <View className="bg-card rounded-2xl p-2 min-w-[240px] border border-border shadow-lg">
            {isConnected && (
              <>
                <Pressable
                  className="flex-row items-center gap-4 px-4 py-4 rounded-xl active:bg-secondary"
                  onPress={() => { setMenuOpen(false); onAgentSelect(); }}
                  accessibilityLabel="에이전트 선택"
                  accessibilityRole="button"
                >
                  <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                    <Bot size={20} color="hsl(18 100% 56%)" strokeWidth={2} />
                  </View>
                  <Text className="text-[17px] font-medium text-foreground">에이전트 선택</Text>
                </Pressable>
                <View className="h-px bg-border mx-4" />
                <Pressable
                  className="flex-row items-center gap-4 px-4 py-4 rounded-xl active:bg-secondary"
                  onPress={() => { setMenuOpen(false); onSkillPicker(); }}
                  accessibilityLabel="스킬"
                  accessibilityRole="button"
                >
                  <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                    <Puzzle size={20} color="hsl(18 100% 56%)" strokeWidth={2} />
                  </View>
                  <Text className="text-[17px] font-medium text-foreground">스킬</Text>
                </Pressable>
                <View className="h-px bg-border mx-4" />
              </>
            )}
            <Pressable
              className="flex-row items-center gap-4 px-4 py-4 rounded-xl active:bg-secondary"
              onPress={() => { setMenuOpen(false); onSettingsPress(); }}
              accessibilityLabel="설정"
              accessibilityRole="button"
            >
              <View className="w-10 h-10 rounded-full bg-secondary items-center justify-center">
                <Settings size={20} color="hsl(0 0% 63%)" strokeWidth={2} />
              </View>
              <Text className="text-[17px] font-medium text-foreground">설정</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
