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
import { colors, shadows, radii, typography } from "../../theme/colors";

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
    <View style={s.appBar}>
      <TouchableOpacity
        style={s.left}
        onPress={onSessionPress}
        activeOpacity={0.6}
        disabled={!isConnected}
      >
        <View style={[s.dot, { backgroundColor: dotColor }]} />
        <Text style={s.agentText} numberOfLines={1}>{agentLabel}</Text>
        {sessionLabel && sessionLabel !== "main" && (
          <Text style={s.sessionText}>/ {sessionLabel}</Text>
        )}
        {isConnected && <ChevronDown size={14} color={colors.textTertiary} style={{ marginLeft: 2 }} />}
      </TouchableOpacity>

      <View style={s.right}>
        {!isConnected && (
          <View style={s.statusChip}>
            <WifiOff size={10} color={colors.error} strokeWidth={2.5} />
            <Text style={s.statusChipText}>
              {connectionState === "connecting" ? "연결 중" : connectionState === "authenticating" ? "인증 중" : "끊김"}
            </Text>
          </View>
        )}
        <TouchableOpacity
          onPress={() => setMenuOpen(true)}
          style={s.menuBtn}
          activeOpacity={0.6}
        >
          <MoreHorizontal size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Compact menu popup */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={s.menuSheet}>
            {isConnected && (
              <>
                <TouchableOpacity
                  style={s.menuItem}
                  onPress={() => { setMenuOpen(false); onAgentSelect(); }}
                  activeOpacity={0.6}
                >
                  <View style={s.menuIconWrap}>
                    <Bot size={16} color={colors.primary} strokeWidth={2} />
                  </View>
                  <Text style={s.menuLabel}>에이전트 선택</Text>
                </TouchableOpacity>
                <View style={s.menuDivider} />
                <TouchableOpacity
                  style={s.menuItem}
                  onPress={() => { setMenuOpen(false); onSkillPicker(); }}
                  activeOpacity={0.6}
                >
                  <View style={s.menuIconWrap}>
                    <Puzzle size={16} color={colors.accent} strokeWidth={2} />
                  </View>
                  <Text style={s.menuLabel}>스킬</Text>
                </TouchableOpacity>
                <View style={s.menuDivider} />
              </>
            )}
            <TouchableOpacity
              style={s.menuItem}
              onPress={() => { setMenuOpen(false); onSettingsPress(); }}
              activeOpacity={0.6}
            >
              <View style={s.menuIconWrap}>
                <Settings size={16} color={colors.textSecondary} strokeWidth={2} />
              </View>
              <Text style={s.menuLabel}>설정</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  appBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 50,
    paddingHorizontal: 16,
    backgroundColor: colors.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 10,
  },
  agentText: {
    ...typography.headline,
    color: colors.text,
  },
  sessionText: {
    fontSize: 13,
    color: colors.textTertiary,
    marginLeft: 5,
    letterSpacing: 0.1,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: radii.sm,
    backgroundColor: "rgba(239, 68, 68, 0.06)",
  },
  statusChipText: {
    ...typography.tiny,
    color: colors.error,
  },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },

  // Menu overlay
  overlay: {
    flex: 1,
    backgroundColor: colors.overlayLight,
    justifyContent: "flex-start",
    alignItems: "flex-end",
    paddingTop: 96,
    paddingRight: 16,
  },
  menuSheet: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.lg,
    padding: 4,
    minWidth: 190,
    ...shadows.lg,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.sm,
  },
  menuIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bgTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  menuLabel: {
    fontSize: 15,
    color: colors.text,
    fontWeight: "500",
    letterSpacing: 0.1,
  },
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderLight,
    marginHorizontal: 14,
  },
});
