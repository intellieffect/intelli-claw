/**
 * SkillPicker — Bottom sheet for viewing and toggling skills attached to a session.
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  Switch,
  ActivityIndicator,
} from "react-native";
import {
  Puzzle,
  X,
  AlertCircle,
  RefreshCw,
} from "lucide-react-native";
import { useSkills, type Skill } from "@intelli-claw/shared";
import {
  Actionsheet,
  ActionsheetBackdrop,
  ActionsheetContent,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
} from "@/components/ui/actionsheet";

// ─── Props ───

export interface SkillPickerProps {
  visible: boolean;
  onClose: () => void;
}

export function SkillPicker({ visible, onClose }: SkillPickerProps) {
  const { skills, loading, error, refresh, toggleSkill } = useSkills();
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());

  const sortedSkills = useMemo(
    () =>
      [...skills].sort((a, b) => {
        if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [skills],
  );

  const enabledCount = useMemo(
    () => skills.filter((s) => s.eligible && !s.disabled).length,
    [skills],
  );

  const handleToggle = async (skill: Skill) => {
    setBusyKeys((prev) => new Set(prev).add(skill.skillKey));
    try {
      await toggleSkill(skill.skillKey, skill.disabled);
    } finally {
      setBusyKeys((prev) => {
        const next = new Set(prev);
        next.delete(skill.skillKey);
        return next;
      });
    }
  };

  const renderSkill = ({ item }: { item: Skill }) => {
    const isBusy = busyKeys.has(item.skillKey);
    const isEnabled = !item.disabled && item.eligible;
    const isBlocked = item.blockedByAllowlist || !item.eligible;

    return (
      <View className={`flex-row items-center px-4 py-3 border-b border-border/50 ${isBlocked ? "opacity-50" : ""}`}>
        <View className="flex-1 flex-row items-start gap-2.5">
          <Text className="text-xl w-7 text-center mt-0.5">{item.emoji || "🔧"}</Text>
          <View className="flex-1">
            <View className="flex-row items-center gap-1.5">
              <Text
                className={`text-sm font-semibold ${isBlocked ? "text-muted-foreground" : "text-foreground"}`}
                numberOfLines={1}
              >
                {item.name}
              </Text>
              {item.bundled && (
                <View className="bg-success/10 px-1.5 py-px rounded">
                  <Text className="text-[9px] font-semibold text-success">내장</Text>
                </View>
              )}
              {item.source === "managed" && (
                <View className="bg-purple-400/10 px-1.5 py-px rounded">
                  <Text className="text-[9px] font-semibold text-purple-400">관리</Text>
                </View>
              )}
            </View>
            <Text className="text-xs text-muted-foreground mt-0.5 leading-4" numberOfLines={2}>
              {item.description}
            </Text>
            {isBlocked && (
              <View className="flex-row items-center gap-1 mt-1">
                <AlertCircle size={10} color="#EF4444" />
                <Text className="text-[10px] text-destructive">
                  {item.blockedByAllowlist ? "허용 목록에 없음" : "요구사항 미충족"}
                </Text>
              </View>
            )}
          </View>
        </View>
        <View className="ml-3">
          {isBusy ? (
            <ActivityIndicator size="small" color="hsl(217, 91%, 60%)" />
          ) : (
            <Switch
              value={isEnabled}
              onValueChange={() => handleToggle(item)}
              disabled={isBlocked}
              trackColor={{ false: "#333333", true: "rgba(255, 107, 53, 0.50)" }}
              thumbColor={isEnabled ? "hsl(18, 100%, 56%)" : "#666666"}
            />
          )}
        </View>
      </View>
    );
  };

  return (
    <Actionsheet isOpen={visible} onClose={onClose}>
      <ActionsheetBackdrop />
      <ActionsheetContent className="max-h-[80%]">
        <ActionsheetDragIndicatorWrapper>
          <ActionsheetDragIndicator />
        </ActionsheetDragIndicatorWrapper>

        {/* Header */}
        <View className="flex-row items-center justify-between px-4 pb-3 border-b border-border">
          <View className="flex-row items-center gap-2">
            <Puzzle size={18} color="hsl(217, 91%, 60%)" />
            <Text className="text-[17px] font-bold text-foreground">Skills</Text>
            <View className="bg-primary/10 px-2 py-0.5 rounded-xl">
              <Text className="text-[11px] font-semibold text-primary">{enabledCount}/{skills.length}</Text>
            </View>
          </View>
          <View className="flex-row items-center gap-3">
            <Pressable onPress={refresh} hitSlop={8} className="p-1">
              <RefreshCw size={16} color="#9CA3AF" />
            </Pressable>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color="#9CA3AF" />
            </Pressable>
          </View>
        </View>

        {error && (
          <View className="flex-row items-center gap-1.5 px-4 py-2 bg-destructive/10">
            <AlertCircle size={12} color="#EF4444" />
            <Text className="text-xs text-destructive">{error}</Text>
          </View>
        )}

        {/* Skill list */}
        <FlatList
          data={sortedSkills}
          keyExtractor={(item) => item.skillKey}
          renderItem={renderSkill}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View className="py-8 items-center">
              <Text className="text-[13px] text-muted-foreground">
                {loading ? "스킬 로딩 중..." : "등록된 스킬 없음"}
              </Text>
            </View>
          }
        />
      </ActionsheetContent>
    </Actionsheet>
  );
}
