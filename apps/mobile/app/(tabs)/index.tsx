import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  ActivityIndicator,
} from "react-native";
import PagerView from "react-native-pager-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bot } from "lucide-react-native";
import { useGateway, useAgents, parseSessionKey } from "@intelli-claw/shared";
import SettingsScreen from "../../src/components/SettingsScreen";
import { useSessionStore } from "../../src/stores/sessionStore";
import { useSessions } from "../../src/hooks/useSessions";
import { SessionSwitcher } from "../../src/components/SessionSwitcher";
import { AgentSelector } from "../../src/components/AgentSelector";
import { SkillPicker } from "../../src/components/SkillPicker";

import { AppBar, AgentChatPage } from "../../src/components/chat";
import { AgentTabBar } from "../../src/components/chat/AgentTabBar";

// ─── Chat Screen (PagerView-based) ───

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { state, mainSessionKey } = useGateway();
  const { setActiveSessionKey } = useSessionStore();
  const { agents, loading: agentsLoading } = useAgents();
  const { sessions, loading: sessionsLoading, refresh: refreshSessions } = useSessions();

  // ─── PagerView ───
  const pagerRef = useRef<PagerView>(null);
  const [activePageIndex, setActivePageIndex] = useState(0);

  // ─── Per-agent sessionKey overrides ───
  // Default: `agent:{agentId}:main`. SessionSwitcher can override per agent.
  const [sessionKeyOverrides, setSessionKeyOverrides] = useState<Map<string, string>>(new Map());

  // ─── Modal states ───
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);

  // ─── Derived state ───
  const activeAgent = agents[activePageIndex];
  const activeAgentId = activeAgent?.id;

  const getSessionKeyForAgent = useCallback(
    (agentId: string | undefined): string | undefined => {
      if (!agentId) return undefined;
      return sessionKeyOverrides.get(agentId) || `agent:${agentId}:main`;
    },
    [sessionKeyOverrides],
  );

  const effectiveSessionKey = getSessionKeyForAgent(activeAgentId);

  // Sync sessionStore's activeSessionKey so other parts of the app stay aware
  useEffect(() => {
    setActiveSessionKey(effectiveSessionKey || null);
  }, [effectiveSessionKey, setActiveSessionKey]);

  // ─── AppBar labels ───
  const parsed = effectiveSessionKey ? parseSessionKey(effectiveSessionKey) : null;
  const agentLabel = activeAgent?.name || activeAgent?.id || "Chat";
  const sessionLabel = parsed
    ? parsed.type === "main" ? "main" : parsed.detail || parsed.type
    : "";

  const dotColor =
    state === "connected"
      ? "#10B981"
      : state === "connecting"
        ? "#F59E0B"
        : state === "authenticating"
          ? "#3B82F6"
          : "#EF4444";
  const isConnected = state === "connected";

  // ─── Tab / Page navigation ───
  const goToPage = useCallback(
    (index: number) => {
      pagerRef.current?.setPage(index);
      setActivePageIndex(index);
    },
    [],
  );

  const handlePageSelected = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      setActivePageIndex(e.nativeEvent.position);
    },
    [],
  );

  // ─── SessionSwitcher handler ───
  const handleSessionSelect = useCallback(
    (key: string | null) => {
      if (!key) {
        // "New / default" — clear override for the active agent
        if (activeAgentId) {
          setSessionKeyOverrides((prev) => {
            const next = new Map(prev);
            next.delete(activeAgentId);
            return next;
          });
        }
        return;
      }

      const p = parseSessionKey(key);
      const targetAgentId = p.agentId && p.agentId !== "unknown" ? p.agentId : activeAgentId;

      if (targetAgentId) {
        // Override sessionKey for that agent
        setSessionKeyOverrides((prev) => {
          const next = new Map(prev);
          next.set(targetAgentId, key);
          return next;
        });

        // If the selected session belongs to a different agent, navigate to its page
        const targetIndex = agents.findIndex((a) => a.id === targetAgentId);
        if (targetIndex >= 0 && targetIndex !== activePageIndex) {
          goToPage(targetIndex);
        }
      }
    },
    [activeAgentId, agents, activePageIndex, goToPage],
  );

  // ─── Fallback: no agents ───
  if (agentsLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center" style={{ paddingTop: insets.top }}>
        <ActivityIndicator size="large" color="hsl(18 100% 56%)" />
        <Text className="text-base font-medium text-muted-foreground mt-3">에이전트 로딩 중...</Text>
      </View>
    );
  }

  if (agents.length === 0) {
    return (
      <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <AppBar
          agentLabel="Chat"
          sessionLabel=""
          dotColor={dotColor}
          isConnected={isConnected}
          connectionState={state}
          onSessionPress={() => {}}
          onSettingsPress={() => setSettingsOpen(true)}
          onAgentSelect={() => setAgentSelectorOpen(true)}
          onSkillPicker={() => setSkillPickerOpen(true)}
        />
        <View className="flex-1 items-center justify-center px-8">
          <Bot size={48} color="hsl(0 0% 45%)" strokeWidth={1.5} />
          <Text className="text-lg font-semibold text-foreground mt-4">에이전트 없음</Text>
          <Text className="text-base text-muted-foreground text-center mt-2">
            {isConnected
              ? "등록된 에이전트가 없습니다. Gateway 설정을 확인하세요."
              : "Gateway에 연결되지 않았습니다."}
          </Text>
        </View>

        {/* Agent selector — fallback for when agents appear later */}
        <AgentSelector
          visible={agentSelectorOpen}
          onClose={() => setAgentSelectorOpen(false)}
          onSelect={() => {}}
        />

        {/* Skill picker */}
        <SkillPicker
          visible={skillPickerOpen}
          onClose={() => setSkillPickerOpen(false)}
        />

        {/* Settings modal */}
        <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
          <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
            <View className="flex-row items-center justify-between h-14 px-5 border-b border-border">
              <Text className="text-lg font-bold text-foreground">Settings</Text>
              <Pressable onPress={() => setSettingsOpen(false)} hitSlop={8}>
                <Text className="text-base font-semibold text-primary">닫기</Text>
              </Pressable>
            </View>
            <SettingsScreen />
          </View>
        </Modal>
      </View>
    );
  }

  // ─── Main render: PagerView with agents ───
  return (
    <View style={s.flex1} className="bg-background" >
      <View style={{ paddingTop: insets.top }}>
        {/* AppBar */}
        <AppBar
          agentLabel={agentLabel}
          sessionLabel={sessionLabel}
          dotColor={dotColor}
          isConnected={isConnected}
          connectionState={state}
          onSessionPress={() => { refreshSessions(); setSessionPickerOpen(true); }}
          onSettingsPress={() => setSettingsOpen(true)}
          onAgentSelect={() => setAgentSelectorOpen(true)}
          onSkillPicker={() => setSkillPickerOpen(true)}
        />

        {/* Agent tab bar (hidden when only 1 agent) */}
        <AgentTabBar
          agents={agents}
          activeIndex={activePageIndex}
          onTabPress={goToPage}
        />
      </View>

      {/* PagerView — native swipe between agent chats */}
      <PagerView
        ref={pagerRef}
        style={s.flex1}
        initialPage={0}
        onPageSelected={handlePageSelected}
      >
        {agents.map((agent, index) => (
          <View key={agent.id} style={s.flex1}>
            <AgentChatPage
              sessionKey={getSessionKeyForAgent(agent.id)}
              agentId={agent.id}
              isActive={index === activePageIndex}
            />
          </View>
        ))}
      </PagerView>

      {/* ─── Modals ─── */}

      {/* Session switcher */}
      <SessionSwitcher
        visible={sessionPickerOpen}
        onClose={() => setSessionPickerOpen(false)}
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        onRefresh={refreshSessions}
        currentKey={effectiveSessionKey}
        mainSessionKey={mainSessionKey}
        onSelect={handleSessionSelect}
      />

      {/* Agent selector — long press / menu fallback */}
      <AgentSelector
        visible={agentSelectorOpen}
        onClose={() => setAgentSelectorOpen(false)}
        selectedId={activeAgentId}
        onSelect={(id) => {
          if (!id) return;
          const idx = agents.findIndex((a) => a.id === id);
          if (idx >= 0) {
            goToPage(idx);
          }
        }}
      />

      {/* Skill picker */}
      <SkillPicker
        visible={skillPickerOpen}
        onClose={() => setSkillPickerOpen(false)}
      />

      {/* Settings modal */}
      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
          <View className="flex-row items-center justify-between h-14 px-5 border-b border-border">
            <Text className="text-lg font-bold text-foreground">Settings</Text>
            <Pressable onPress={() => setSettingsOpen(false)} hitSlop={8}>
              <Text className="text-base font-semibold text-primary">닫기</Text>
            </Pressable>
          </View>
          <SettingsScreen />
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───

const s = StyleSheet.create({
  flex1: { flex: 1 },
});
