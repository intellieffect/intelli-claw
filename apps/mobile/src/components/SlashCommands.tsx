/**
 * SlashCommands — Autocomplete popup for "/" commands shown above the keyboard.
 * Ported from web skill-picker.tsx for React Native.
 *
 * Detects when user types "/" at start of input and shows:
 * 1. Built-in commands (/stop, /new, /reset, /status, /model, /help)
 * 2. Dynamic skills from the gateway
 */
import React, { useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
} from "react-native";
import { useSkills, type Skill } from "@intelli-claw/shared";

// ─── Built-in commands ───

export interface BuiltinCommand {
  name: string;
  description: string;
  emoji: string;
  /** If true, execute immediately on select (don't append to input) */
  immediate?: boolean;
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  { name: "stop", description: "스트리밍 중단", emoji: "⏹️", immediate: true },
  { name: "new", description: "새 세션 시작", emoji: "✨", immediate: true },
  { name: "reset", description: "현재 세션 리셋", emoji: "🔄", immediate: true },
  { name: "status", description: "세션 상태 확인", emoji: "📊", immediate: true },
  { name: "model", description: "모델 변경 (예: /model opus)", emoji: "🤖" },
  { name: "help", description: "사용 가능한 커맨드 목록", emoji: "❓", immediate: true },
];

// ─── Types ───

type PickerItem =
  | { type: "builtin"; command: BuiltinCommand }
  | { type: "divider" }
  | { type: "skill"; skill: Skill };

export interface SlashCommandsProps {
  inputText: string;
  onSelect: (command: string, immediate?: boolean) => void;
  onDismiss: () => void;
}

/**
 * Detect whether the slash picker should be visible based on current input text.
 */
export function shouldShowSlashPicker(text: string): boolean {
  return text === "/" || (/^\/\S*$/.test(text) && !text.includes(" "));
}

export function SlashCommands({ inputText, onSelect, onDismiss }: SlashCommandsProps) {
  const { skills } = useSkills();

  const query = useMemo(() => {
    const match = inputText.match(/^\/(\S*)$/);
    return match ? match[1].toLowerCase() : "";
  }, [inputText]);

  const activeSkills = useMemo(
    () => skills.filter((s) => s.eligible && !s.disabled),
    [skills],
  );

  const filteredBuiltins = useMemo(() => {
    if (!query) return BUILTIN_COMMANDS;
    return BUILTIN_COMMANDS.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query),
    );
  }, [query]);

  const filteredSkills = useMemo(() => {
    if (!query) return activeSkills;
    return activeSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.description.toLowerCase().includes(query),
    );
  }, [activeSkills, query]);

  // Build flat list with optional divider
  const items = useMemo((): PickerItem[] => {
    const result: PickerItem[] = [];
    for (const cmd of filteredBuiltins) {
      result.push({ type: "builtin", command: cmd });
    }
    if (filteredBuiltins.length > 0 && filteredSkills.length > 0) {
      result.push({ type: "divider" });
    }
    for (const skill of filteredSkills) {
      result.push({ type: "skill", skill });
    }
    return result;
  }, [filteredBuiltins, filteredSkills]);

  if (items.length === 0) return null;

  const renderItem = ({ item }: { item: PickerItem }) => {
    if (item.type === "divider") {
      return <View style={s.divider} />;
    }

    if (item.type === "builtin") {
      const { command: cmd } = item;
      return (
        <TouchableOpacity
          style={s.row}
          onPress={() => onSelect(`/${cmd.name}`, cmd.immediate)}
          activeOpacity={0.7}
        >
          <Text style={s.emoji}>{cmd.emoji}</Text>
          <View style={s.rowMain}>
            <Text style={s.cmdName}>/{cmd.name}</Text>
            <Text style={s.cmdDesc} numberOfLines={1}>
              {cmd.description}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }

    // skill
    const { skill } = item;
    return (
      <TouchableOpacity
        style={s.row}
        onPress={() => onSelect(`/${skill.name} `, false)}
        activeOpacity={0.7}
      >
        <Text style={s.emoji}>{skill.emoji || "🔧"}</Text>
        <View style={s.rowMain}>
          <Text style={s.cmdName}>/{skill.name}</Text>
          <Text style={s.cmdDesc} numberOfLines={1}>
            {skill.description}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={s.container}>
      <View style={s.card}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerText}>Commands & Skills</Text>
          <Text style={s.headerCount}>{items.filter((i) => i.type !== "divider").length}</Text>
        </View>

        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item, i) => {
            if (item.type === "builtin") return `cmd-${item.command.name}`;
            if (item.type === "skill") return `skill-${item.skill.skillKey}`;
            return `div-${i}`;
          }}
          style={s.list}
          keyboardShouldPersistTaps="always"
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  headerText: { fontSize: 11, color: "#9CA3AF", fontWeight: "500" },
  headerCount: { fontSize: 10, color: "#D1D5DB" },

  list: { maxHeight: 240 },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  emoji: { fontSize: 18, width: 26, textAlign: "center" },
  rowMain: { flex: 1 },
  cmdName: { fontSize: 14, fontWeight: "600", color: "#111827" },
  cmdDesc: { fontSize: 12, color: "#9CA3AF", marginTop: 1 },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E5E7EB",
    marginHorizontal: 12,
    marginVertical: 4,
  },
});
