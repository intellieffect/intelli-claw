import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bot, ChevronDown } from "lucide-react-native";
import { useGateway, parseSessionKey } from "@intelli-claw/shared";
import SettingsScreen from "../../src/components/SettingsScreen";
import { useChat, type DisplayMessage } from "../../src/hooks/useChat";
import { useSessionStore } from "../../src/stores/sessionStore";
import { useSessions } from "../../src/hooks/useSessions";
import { AttachmentPreview, useFileAttachments } from "../../src/components/FileAttachments";
import { SessionSwitcher } from "../../src/components/SessionSwitcher";
import { AgentSelector } from "../../src/components/AgentSelector";
import { SlashCommands, shouldShowSlashPicker } from "../../src/components/SlashCommands";
import { SkillPicker } from "../../src/components/SkillPicker";

// Chat components (redesigned)
import {
  MessageBubble,
  EmptyState,
  AgentStatusBar,
  InputBar,
  ScrollToBottomButton,
  AppBar,
} from "../../src/components/chat";


// ─── Chat Screen ───

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { state, mainSessionKey } = useGateway();
  const { activeSessionKey, setActiveSessionKey } = useSessionStore();

  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();

  // Compute effective session key: explicit session > agent-based main > gateway default
  const effectiveSessionKey = useMemo(() => {
    if (activeSessionKey) return activeSessionKey;
    if (selectedAgentId) return `agent:${selectedAgentId}:main`;
    return mainSessionKey || undefined;
  }, [activeSessionKey, selectedAgentId, mainSessionKey]);

  // Sync selectedAgentId from the current session key
  useEffect(() => {
    if (!effectiveSessionKey) return;
    const p = parseSessionKey(effectiveSessionKey);
    if (p.agentId && p.agentId !== "unknown" && p.agentId !== selectedAgentId) {
      setSelectedAgentId(p.agentId);
    }
  }, [effectiveSessionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = effectiveSessionKey ? parseSessionKey(effectiveSessionKey) : null;
  const agentLabel = parsed?.agentId || "Chat";
  const sessionLabel = parsed
    ? parsed.type === "main" ? "main" : parsed.detail || parsed.type
    : "";

  const { messages, streaming, loading, agentStatus, sendMessage, abort } = useChat(effectiveSessionKey);
  const { sessions, loading: sessionsLoading, refresh: refreshSessions } = useSessions();

  const [text, setText] = useState("");
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { attachments, addAttachments, removeAttachment, clearAttachments, toPayloads, imageUris: getImageUris } = useFileAttachments();
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const showSlashPicker = shouldShowSlashPicker(text);
  const flatListRef = useRef<FlatList>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const isAtBottomRef = useRef(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardWillShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardWillHide", () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  // ─── Smart auto-scroll ───
  const handleScroll = useCallback((e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
    isAtBottomRef.current = atBottom;
    setUserScrolledUp(!atBottom);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current && flatListRef.current) {
      flatListRef.current.scrollToEnd({ animated: true });
    }
  }, [messages.length, streaming]);

  const scrollToBottom = useCallback(() => {
    flatListRef.current?.scrollToEnd({ animated: true });
    setUserScrolledUp(false);
    isAtBottomRef.current = true;
  }, []);

  // ─── Slash command handler ───
  const handleSlashSelect = useCallback(
    (command: string, immediate?: boolean) => {
      if (immediate) {
        if (command === "/stop") {
          abort();
        } else if (command === "/new") {
          setActiveSessionKey(null);
        } else if (command === "/reset") {
          sendMessage(command);
        } else {
          sendMessage(command);
        }
        setText("");
      } else {
        setText(command);
      }
    },
    [abort, setActiveSessionKey, sendMessage],
  );

  // ─── Send ───
  const handleSend = useCallback(() => {
    if ((!text.trim() && attachments.length === 0) || streaming) return;
    const payloads = toPayloads();
    const uris = getImageUris();
    sendMessage(text.trim(), payloads.length > 0 ? payloads : undefined, uris.length > 0 ? uris : undefined);
    setText("");
    clearAttachments();
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
  }, [text, attachments, streaming, sendMessage, toPayloads, getImageUris, clearAttachments]);

  // ─── Suggestion press (empty state) ───
  const handleSuggestionPress = useCallback((prompt: string) => {
    setText(prompt);
  }, []);

  const filteredMessages = useMemo(() =>
    messages.filter((m) => m.content || m.streaming || m.toolCalls.length > 0),
    [messages],
  );

  const renderItem = useCallback(({ item, index }: { item: DisplayMessage; index: number }) => {
    const prev = index > 0 ? filteredMessages[index - 1] : undefined;
    return <MessageBubble msg={item} previousMsg={prev} />;
  }, [filteredMessages]);

  const keyExtractor = useCallback((item: DisplayMessage) => item.id, []);

  const dotColor = state === "connected" ? "#10B981" : state === "connecting" ? "#F59E0B" : state === "authenticating" ? "#3B82F6" : "#EF4444";
  const isConnected = state === "connected";

  return (
    <View className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {/* ─── AppBar (minimalist with menu) ─── */}
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

      <KeyboardAvoidingView
        style={s.flex1}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >

        {/* Message area */}
        {loading ? (
          <View className="flex-1 items-center justify-center px-8">
            <ActivityIndicator size="large" color="hsl(18 100% 56%)" />
            <Text className="text-base font-medium text-muted-foreground mt-3">히스토리 로딩 중...</Text>
          </View>
        ) : filteredMessages.length === 0 ? (
          <EmptyState
            connected={isConnected}
            onSuggestionPress={handleSuggestionPress}
          />
        ) : (
          <View style={s.flex1}>
            <FlatList
              ref={flatListRef}
              data={filteredMessages}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              style={s.flex1}
              contentContainerStyle={s.listContent}
              onScroll={handleScroll}
              scrollEventThrottle={100}
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            />
            <ScrollToBottomButton visible={userScrolledUp} onPress={scrollToBottom} />
          </View>
        )}

        <AgentStatusBar status={agentStatus} />

        {/* Agent indicator above input */}
        {effectiveSessionKey && parsed?.agentId && (
          <Pressable
            className="flex-row items-center gap-2 px-5 py-3 bg-secondary border-t border-border active:opacity-70"
            onPress={() => { refreshSessions(); setSessionPickerOpen(true); }}
          >
            <Bot size={16} color="hsl(18 100% 56%)" />
            <Text className="text-base font-semibold text-primary">{parsed.agentId}</Text>
            {parsed.type !== "main" && (
              <Text className="text-sm text-muted-foreground">/ {parsed.detail || parsed.type}</Text>
            )}
            <ChevronDown size={14} color="hsl(0 0% 45%)" />
          </Pressable>
        )}

        {/* Attachment preview */}
        <AttachmentPreview attachments={attachments} onRemove={removeAttachment} />

        {/* Slash command suggestions */}
        {showSlashPicker && (
          <SlashCommands
            inputText={text}
            onSelect={handleSlashSelect}
            onDismiss={() => setText("")}
          />
        )}

        {/* Input bar (redesigned) */}
        <InputBar
          text={text}
          onChangeText={setText}
          onSend={handleSend}
          onAbort={abort}
          onAttach={addAttachments}
          streaming={streaming}
          connected={isConnected}
          hasContent={!!(text.trim() || attachments.length > 0)}
          bottomInset={insets.bottom}
          keyboardVisible={keyboardVisible}
        />

        {/* Session switcher */}
        <SessionSwitcher
          visible={sessionPickerOpen}
          onClose={() => setSessionPickerOpen(false)}
          sessions={sessions}
          sessionsLoading={sessionsLoading}
          onRefresh={refreshSessions}
          currentKey={effectiveSessionKey}
          mainSessionKey={mainSessionKey}
          onSelect={(key) => {
            if (key === mainSessionKey) {
              setActiveSessionKey(null);
            } else {
              setActiveSessionKey(key);
            }
            // Sync agent selection from the chosen session
            const p = parseSessionKey(key);
            if (p.agentId && p.agentId !== "unknown") {
              setSelectedAgentId(p.agentId);
            }
          }}
        />

        {/* Agent selector */}
        <AgentSelector
          visible={agentSelectorOpen}
          onClose={() => setAgentSelectorOpen(false)}
          selectedId={selectedAgentId}
          onSelect={(id) => {
            setSelectedAgentId(id);
            // Clear explicit session so effectiveSessionKey switches to agent:{id}:main
            setActiveSessionKey(null);
          }}
        />

        {/* Skill picker */}
        <SkillPicker
          visible={skillPickerOpen}
          onClose={() => setSkillPickerOpen(false)}
        />
      </KeyboardAvoidingView>

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
  listContent: {
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
});
