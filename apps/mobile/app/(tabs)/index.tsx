import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
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
// #293: AgentTabBar is now rendered inside InputBar via AgentChatPage props.
import { useSwipeMode } from "../../src/hooks/useSwipeMode";

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

  // ─── Sort agents by most recent session activity ───
  const sortedAgents = useMemo(() => {
    if (agents.length === 0 || sessions.length === 0) return agents;

    // Build a map: agentId → latest updatedAt timestamp
    const latestByAgent = new Map<string, number>();
    for (const session of sessions) {
      const parsed = parseSessionKey(session.key);
      const aid = parsed.agentId;
      if (!aid || aid === "unknown") continue;
      const ts = session.updatedAt ? new Date(session.updatedAt).getTime() : 0;
      const prev = latestByAgent.get(aid) ?? 0;
      if (ts > prev) latestByAgent.set(aid, ts);
    }

    return [...agents].sort((a, b) => {
      const ta = latestByAgent.get(a.id) ?? 0;
      const tb = latestByAgent.get(b.id) ?? 0;
      return tb - ta; // descending — most recent first
    });
  }, [agents, sessions]);

  // ─── Derived state ───
  const activeAgent = sortedAgents[activePageIndex];
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

  // ─── #291: Swipe mode toggle (agent ↔ topic) ───
  // The toggle is wired through to the InputBar and persisted via AsyncStorage.
  // The actual PagerView data branching ("topic" mode swiping over the active
  // agent's sessions instead of agents) is intentionally left to a follow-up
  // PR — this PR delivers the toggle, persistence, and visible-mode hint so
  // the UX surface is in place without rewriting the pager state machine.
  const { mode: swipeMode, setMode: setSwipeMode } = useSwipeMode(sortedAgents.length);

  // ─── Infinite swipe: clone first/last pages ───
  const n = sortedAgents.length;
  const useInfinite = n >= 2;

  // #293: AgentTabBar moved into the InputBar — header is now AppBar only.
  const headerHeight = insets.top + 64;

  // Pages: [clone-last, ...real, clone-first]  (offsets by +1)
  const pagerPages = useMemo(() => {
    if (!useInfinite) return sortedAgents;
    return [sortedAgents[n - 1], ...sortedAgents, sortedAgents[0]];
  }, [sortedAgents, n, useInfinite]);

  // Real index → pager index (offset by 1 when infinite)
  const toPagerIndex = useCallback(
    (realIndex: number) => (useInfinite ? realIndex + 1 : realIndex),
    [useInfinite],
  );

  // ─── Tab / Page navigation ───
  const goToPage = useCallback(
    (index: number) => {
      const pagerIdx = toPagerIndex(index);
      pagerRef.current?.setPage(pagerIdx);
      setActivePageIndex(index);
    },
    [toPagerIndex],
  );

  const handlePageSelected = useCallback(
    (e: { nativeEvent: { position: number } }) => {
      const pos = e.nativeEvent.position;
      if (!useInfinite) {
        setActivePageIndex(pos);
        return;
      }
      // Landed on clone-last (pos 0) → jump to real last
      if (pos === 0) {
        setActivePageIndex(n - 1);
        requestAnimationFrame(() => {
          pagerRef.current?.setPageWithoutAnimation(n);
        });
        return;
      }
      // Landed on clone-first (pos n+1) → jump to real first
      if (pos === n + 1) {
        setActivePageIndex(0);
        requestAnimationFrame(() => {
          pagerRef.current?.setPageWithoutAnimation(1);
        });
        return;
      }
      // Normal page: pager pos → real index (pos - 1)
      setActivePageIndex(pos - 1);
    },
    [useInfinite, n],
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
        const targetIndex = sortedAgents.findIndex((a) => a.id === targetAgentId);
        if (targetIndex >= 0 && targetIndex !== activePageIndex) {
          goToPage(targetIndex);
        }
      }
    },
    [activeAgentId, sortedAgents, activePageIndex, goToPage],
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

        {/* #293: AgentTabBar moved into InputBar (see AgentChatPage props below) */}
      </View>

      {/* PagerView — native swipe between agent chats (infinite) */}
      <PagerView
        ref={pagerRef}
        style={s.flex1}
        initialPage={useInfinite ? 1 : 0}
        onPageSelected={handlePageSelected}
      >
        {pagerPages.map((agent, pagerIdx) => {
          const isClone = useInfinite && (pagerIdx === 0 || pagerIdx === n + 1);
          const realIndex = useInfinite
            ? (pagerIdx === 0 ? n - 1 : pagerIdx === n + 1 ? 0 : pagerIdx - 1)
            : pagerIdx;
          return (
            <View key={`${agent.id}-${pagerIdx}`} style={s.flex1}>
              {isClone ? (
                <View style={s.flex1} />
              ) : (
                <AgentChatPage
                  sessionKey={getSessionKeyForAgent(agent.id)}
                  agentId={agent.id}
                  isActive={realIndex === activePageIndex}
                  headerHeight={headerHeight}
                  agents={sortedAgents}
                  activeAgentIndex={activePageIndex}
                  onAgentTabPress={goToPage}
                  swipeMode={swipeMode}
                  onSwipeModeChange={setSwipeMode}
                />
              )}
            </View>
          );
        })}
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
          const idx = sortedAgents.findIndex((a) => a.id === id);
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
