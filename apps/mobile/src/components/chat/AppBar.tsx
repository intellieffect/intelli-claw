import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
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
    <View className="flex-row items-center justify-between h-[50px] px-4 bg-background border-b border-border">
      <TouchableOpacity
        className="flex-row items-center flex-1"
        onPress={onSessionPress}
        activeOpacity={0.6}
        disabled={!isConnected}
        accessibilityLabel="세션 선택"
        accessibilityRole="button"
      >
        <View className="w-2 h-2 rounded-full mr-2.5" style={{ backgroundColor: dotColor }} />
        <Text className="text-[17px] font-semibold text-foreground tracking-tight" numberOfLines={1}>{agentLabel}</Text>
        {sessionLabel && sessionLabel !== "main" && (
          <Text className="text-[13px] text-muted-foreground ml-1.5 tracking-wide">/ {sessionLabel}</Text>
        )}
        {isConnected && <ChevronDown size={14} color="hsl(0 0% 45%)" style={{ marginLeft: 2 }} />}
      </TouchableOpacity>

      <View className="flex-row items-center gap-2">
        {!isConnected && (
          <View className="flex-row items-center gap-1 py-1 px-2 rounded-md bg-destructive/10">
            <WifiOff size={10} color="hsl(0 84% 60%)" strokeWidth={2.5} />
            <Text className="text-[11px] font-medium text-destructive">
              {connectionState === "connecting" ? "연결 중" : connectionState === "authenticating" ? "인증 중" : "끊김"}
            </Text>
          </View>
        )}
        <TouchableOpacity
          onPress={() => setMenuOpen(true)}
          className="w-9 h-9 rounded-full items-center justify-center"
          activeOpacity={0.6}
          accessibilityLabel="메뉴"
          accessibilityRole="button"
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        >
          <MoreHorizontal size={20} color="hsl(0 0% 63%)" />
        </TouchableOpacity>
      </View>

      {/* Menu popup */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity
          className="flex-1 justify-start items-end pt-24 pr-4"
          style={{ backgroundColor: "rgba(255,255,255,0.04)" }}
          activeOpacity={1}
          onPress={() => setMenuOpen(false)}
        >
          <View className="bg-card rounded-xl p-1 min-w-[190px] border border-border shadow-lg">
            {isConnected && (
              <>
                <TouchableOpacity
                  className="flex-row items-center gap-3 px-3.5 py-3 rounded-lg"
                  onPress={() => { setMenuOpen(false); onAgentSelect(); }}
                  activeOpacity={0.6}
                  accessibilityLabel="에이전트 선택"
                  accessibilityRole="button"
                >
                  <View className="w-7 h-7 rounded-full bg-secondary items-center justify-center">
                    <Bot size={16} color="hsl(18 100% 56%)" strokeWidth={2} />
                  </View>
                  <Text className="text-[15px] font-medium text-foreground tracking-wide">에이전트 선택</Text>
                </TouchableOpacity>
                <View className="h-[0.5px] bg-border mx-3.5" />
                <TouchableOpacity
                  className="flex-row items-center gap-3 px-3.5 py-3 rounded-lg"
                  onPress={() => { setMenuOpen(false); onSkillPicker(); }}
                  activeOpacity={0.6}
                  accessibilityLabel="스킬"
                  accessibilityRole="button"
                >
                  <View className="w-7 h-7 rounded-full bg-secondary items-center justify-center">
                    <Puzzle size={16} color="hsl(18 100% 56%)" strokeWidth={2} />
                  </View>
                  <Text className="text-[15px] font-medium text-foreground tracking-wide">스킬</Text>
                </TouchableOpacity>
                <View className="h-[0.5px] bg-border mx-3.5" />
              </>
            )}
            <TouchableOpacity
              className="flex-row items-center gap-3 px-3.5 py-3 rounded-lg"
              onPress={() => { setMenuOpen(false); onSettingsPress(); }}
              activeOpacity={0.6}
              accessibilityLabel="설정"
              accessibilityRole="button"
            >
              <View className="w-7 h-7 rounded-full bg-secondary items-center justify-center">
                <Settings size={16} color="hsl(0 0% 63%)" strokeWidth={2} />
              </View>
              <Text className="text-[15px] font-medium text-foreground tracking-wide">설정</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}
