import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGateway } from "@intelli-claw/shared";
import { useChat, type DisplayMessage } from "../../hooks/useChat";
import { AttachmentPreview, useFileAttachments } from "../FileAttachments";
import { SlashCommands, shouldShowSlashPicker } from "../SlashCommands";
import {
  MessageBubble,
  EmptyState,
  AgentStatusBar,
  InputBar,
  ScrollToBottomButton,
} from "./index";

// ─── Props ───

export interface AgentChatPageProps {
  sessionKey: string | undefined;
  agentId: string | undefined;
  /** Whether this page is currently visible (scroll/keyboard optimization) */
  isActive: boolean;
  /** Total height of fixed headers above PagerView (safe area + AppBar + TabBar) */
  headerHeight?: number;
  /** #293: agent selector inside the InputBar (passed through) */
  agents?: Array<{ id: string; name?: string }>;
  activeAgentIndex?: number;
  onAgentTabPress?: (index: number) => void;
  streamingAgentIds?: Set<string>;
  unreadCounts?: Map<string, number>;
  /** #291: swipe mode toggle (agent ↔ topic) */
  swipeMode?: import("../../hooks/useSwipeMode").SwipeMode;
  onSwipeModeChange?: (next: import("../../hooks/useSwipeMode").SwipeMode) => void;
  swipeModeToggleVisible?: boolean;
}

// ─── AgentChatPage ───

export function AgentChatPage({
  sessionKey,
  agentId,
  isActive,
  headerHeight = 0,
  agents,
  activeAgentIndex,
  onAgentTabPress,
  streamingAgentIds,
  unreadCounts,
  swipeMode,
  onSwipeModeChange,
  swipeModeToggleVisible,
}: AgentChatPageProps) {
  const insets = useSafeAreaInsets();
  const { state } = useGateway();

  const { messages, streaming, loading, agentStatus, sendMessage, abort } = useChat(sessionKey);

  const [text, setText] = useState("");
  const { attachments, addAttachments, removeAttachment, clearAttachments, toPayloads, imageUris: getImageUris } = useFileAttachments();
  const showSlashPicker = shouldShowSlashPicker(text);
  const flatListRef = useRef<FlatList>(null);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  const isAtBottomRef = useRef(true);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const isConnected = state === "connected";

  // ─── Keyboard tracking ───
  useEffect(() => {
    if (!isActive) return;
    const showSub = Keyboard.addListener("keyboardWillShow", () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener("keyboardWillHide", () => setKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, [isActive]);

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

  // Scroll to bottom when page becomes active (swipe transition)
  useEffect(() => {
    if (isActive && !loading && filteredMessages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: false });
        isAtBottomRef.current = true;
        setUserScrolledUp(false);
      }, 50);
    }
  }, [isActive, loading]);

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
    [abort, sendMessage],
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

  return (
    <KeyboardAvoidingView
      style={s.flex1}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
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

      {/* Input bar */}
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
        agents={agents}
        activeAgentIndex={activeAgentIndex}
        onAgentTabPress={onAgentTabPress}
        streamingAgentIds={streamingAgentIds}
        unreadCounts={unreadCounts}
        swipeMode={swipeMode}
        onSwipeModeChange={onSwipeModeChange}
        swipeModeToggleVisible={swipeModeToggleVisible}
      />
    </KeyboardAvoidingView>
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
