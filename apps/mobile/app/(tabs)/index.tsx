import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
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

import { colors, radii, typography } from "../../src/theme/colors";

// ─── Chat Screen ───

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { state, mainSessionKey } = useGateway();
  const { activeSessionKey, setActiveSessionKey } = useSessionStore();
  const currentKey = activeSessionKey || mainSessionKey || undefined;
  const parsed = currentKey ? parseSessionKey(currentKey) : null;
  const agentLabel = parsed?.agentId || "Chat";
  const sessionLabel = parsed
    ? parsed.type === "main" ? "main" : parsed.detail || parsed.type
    : "";

  const { messages, streaming, loading, agentStatus, sendMessage, abort } = useChat(currentKey);
  const { sessions, loading: sessionsLoading, refresh: refreshSessions } = useSessions();

  const [text, setText] = useState("");
  const [sessionPickerOpen, setSessionPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { attachments, addAttachments, removeAttachment, clearAttachments, toPayloads, imageUris: getImageUris } = useFileAttachments();
  const [agentSelectorOpen, setAgentSelectorOpen] = useState(false);
  const [skillPickerOpen, setSkillPickerOpen] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
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

  const dotColor = state === "connected" ? colors.success : state === "connecting" ? colors.warning : state === "authenticating" ? colors.info : colors.error;
  const isConnected = state === "connected";

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
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
          <View style={s.center}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={s.loadingText}>히스토리 로딩 중...</Text>
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
        {currentKey && parsed?.agentId && (
          <TouchableOpacity
            style={s.agentIndicator}
            activeOpacity={0.6}
            onPress={() => { refreshSessions(); setSessionPickerOpen(true); }}
          >
            <Bot size={12} color={colors.primary} />
            <Text style={s.agentIndicatorText}>{parsed.agentId}</Text>
            {parsed.type !== "main" && (
              <Text style={s.agentIndicatorSub}>/ {parsed.detail || parsed.type}</Text>
            )}
            <ChevronDown size={12} color={colors.textTertiary} />
          </TouchableOpacity>
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
          onAttach={() => addAttachments()}
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
          currentKey={currentKey}
          mainSessionKey={mainSessionKey}
          onSelect={(key) => {
            if (key === mainSessionKey) setActiveSessionKey(null);
            else setActiveSessionKey(key);
          }}
        />

        {/* Agent selector */}
        <AgentSelector
          visible={agentSelectorOpen}
          onClose={() => setAgentSelectorOpen(false)}
          selectedId={selectedAgentId}
          onSelect={setSelectedAgentId}
        />

        {/* Skill picker */}
        <SkillPicker
          visible={skillPickerOpen}
          onClose={() => setSkillPickerOpen(false)}
        />
      </KeyboardAvoidingView>

      {/* Settings modal */}
      <Modal visible={settingsOpen} animationType="slide" onRequestClose={() => setSettingsOpen(false)}>
        <View style={[s.settingsModal, { paddingTop: insets.top }]}>
          <View style={s.settingsHeader}>
            <Text style={s.settingsTitle}>Settings</Text>
            <TouchableOpacity onPress={() => setSettingsOpen(false)}>
              <Text style={s.settingsClose}>닫기</Text>
            </TouchableOpacity>
          </View>
          <SettingsScreen />
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ───

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex1: { flex: 1 },

  // Loading
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  loadingText: {
    ...typography.caption,
    color: colors.textTertiary,
    marginTop: 10,
  },

  // Message list
  listContent: {
    paddingVertical: 10,
    paddingHorizontal: 2,
  },

  // Agent indicator
  agentIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 16,
    paddingVertical: 5,
    backgroundColor: colors.bgSecondary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  agentIndicatorText: {
    ...typography.caption,
    fontWeight: "600",
    color: colors.primary,
  },
  agentIndicatorSub: {
    ...typography.tiny,
    color: colors.textTertiary,
  },

  // Settings modal
  settingsModal: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  settingsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 50,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  settingsTitle: {
    ...typography.headline,
    color: colors.text,
  },
  settingsClose: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.primary,
    letterSpacing: 0.1,
  },
});
