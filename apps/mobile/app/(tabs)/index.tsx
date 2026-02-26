import { useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useGateway } from "@intelli-claw/shared";
import { ConnectionBanner } from "../../src/components/ConnectionBanner";
import { useChat, type DisplayMessage, type AgentStatus } from "../../src/hooks/useChat";

// ─── Message Bubble ───

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  const isUser = msg.role === "user";

  if (msg.role === "system") {
    return (
      <View style={s.systemRow}>
        <Text style={s.systemText}>{msg.content}</Text>
      </View>
    );
  }

  return (
    <View style={[s.bubbleRow, isUser ? s.bubbleRowRight : s.bubbleRowLeft]}>
      <View style={[s.bubble, isUser ? s.bubbleUser : s.bubbleAssistant]}>
        <Text style={[s.bubbleText, isUser ? s.textWhite : s.textDark]} selectable>
          {msg.content || (msg.streaming ? " " : "")}
        </Text>
        {msg.streaming && !msg.content && (
          <View style={s.thinkingRow}>
            <ActivityIndicator size="small" color="#9CA3AF" />
            <Text style={s.thinkingText}>생각 중...</Text>
          </View>
        )}
        {msg.toolCalls.length > 0 && (
          <View style={s.toolSection}>
            {msg.toolCalls.map((tc) => (
              <Text key={tc.callId} style={s.toolText}>
                🔧 {tc.name} {tc.status === "running" ? "..." : "✓"}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

// ─── Status Bar ───

function AgentStatusBar({ status }: { status: AgentStatus }) {
  if (status.phase === "idle") return null;
  const label =
    status.phase === "thinking" ? "생각 중..." :
    status.phase === "writing" ? "작성 중..." :
    status.phase === "tool" ? `🔧 ${status.toolName}` : "";

  return (
    <View style={s.statusBar}>
      <ActivityIndicator size="small" color="#3B82F6" />
      <Text style={s.statusText}>{label}</Text>
    </View>
  );
}

// ─── Chat Screen ───

export default function ChatScreen() {
  const { state, mainSessionKey } = useGateway();
  const { messages, streaming, loading, agentStatus, sendMessage, abort } = useChat(mainSessionKey || undefined);
  const [text, setText] = useState("");
  const flatListRef = useRef<FlatList>(null);

  const handleSend = useCallback(() => {
    if (!text.trim() || streaming) return;
    sendMessage(text.trim());
    setText("");
  }, [text, streaming, sendMessage]);

  const renderItem = useCallback(({ item }: { item: DisplayMessage }) => (
    <MessageBubble msg={item} />
  ), []);

  const keyExtractor = useCallback((item: DisplayMessage) => item.id, []);

  return (
    <KeyboardAvoidingView
      style={s.flex1}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <ConnectionBanner />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={s.loadingText}>히스토리 로딩 중...</Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyEmoji}>💬</Text>
          <Text style={s.emptyTitle}>
            {state === "connected" ? "대화를 시작하세요" : "연결 대기 중..."}
          </Text>
          <Text style={s.emptySubtitle}>
            {state === "connected"
              ? "메시지를 입력하면 AI 에이전트가 응답합니다"
              : "Settings에서 Gateway URL과 Token을 설정하세요"}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={s.flex1}
          contentContainerStyle={s.listContent}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      <AgentStatusBar status={agentStatus} />

      <View style={s.inputBar}>
        <TextInput
          style={s.input}
          placeholder={state === "connected" ? "메시지를 입력하세요..." : "연결 안 됨"}
          placeholderTextColor="#9CA3AF"
          value={text}
          onChangeText={setText}
          onSubmitEditing={handleSend}
          editable={state === "connected"}
          returnKeyType="send"
          multiline
          blurOnSubmit
        />
        {streaming ? (
          <TouchableOpacity onPress={abort} style={s.abortBtn} activeOpacity={0.7}>
            <View style={s.abortIcon} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSend}
            style={[s.sendBtn, state === "connected" && text.trim() ? s.sendActive : s.sendDisabled]}
            disabled={state !== "connected" || !text.trim()}
            activeOpacity={0.7}
          >
            <Text style={s.sendArrow}>↑</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex1: { flex: 1, backgroundColor: "#FFFFFF" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  loadingText: { fontSize: 13, color: "#9CA3AF", marginTop: 8 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: "600", color: "#9CA3AF" },
  emptySubtitle: { fontSize: 13, color: "#D1D5DB", marginTop: 4, textAlign: "center" },
  listContent: { paddingVertical: 8 },

  // Bubbles
  bubbleRow: { paddingHorizontal: 16, paddingVertical: 3 },
  bubbleRowRight: { alignItems: "flex-end" },
  bubbleRowLeft: { alignItems: "flex-start" },
  bubble: { maxWidth: "85%", borderRadius: 18, paddingHorizontal: 16, paddingVertical: 10 },
  bubbleUser: { backgroundColor: "#3B82F6", borderBottomRightRadius: 6 },
  bubbleAssistant: { backgroundColor: "#F3F4F6", borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  textWhite: { color: "#FFFFFF" },
  textDark: { color: "#111827" },
  systemRow: { paddingHorizontal: 16, paddingVertical: 4 },
  systemText: { fontSize: 11, color: "#9CA3AF", textAlign: "center", fontStyle: "italic" },
  thinkingRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  thinkingText: { fontSize: 11, color: "#9CA3AF" },
  toolSection: { marginTop: 6, paddingTop: 6, borderTopWidth: 0.5, borderTopColor: "rgba(209,213,219,0.5)" },
  toolText: { fontSize: 11, color: "#9CA3AF" },

  // Status
  statusBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: "#EFF6FF" },
  statusText: { fontSize: 11, color: "#2563EB", fontWeight: "500" },

  // Input
  inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#E5E7EB", backgroundColor: "#FFFFFF" },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#F3F4F6", borderRadius: 20, fontSize: 15, color: "#111827" },
  sendBtn: { marginLeft: 8, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  sendActive: { backgroundColor: "#3B82F6" },
  sendDisabled: { backgroundColor: "#D1D5DB" },
  sendArrow: { color: "#FFFFFF", fontSize: 18, fontWeight: "700" },
  abortBtn: { marginLeft: 8, width: 40, height: 40, borderRadius: 20, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center" },
  abortIcon: { width: 14, height: 14, borderRadius: 3, backgroundColor: "#FFFFFF" },
});
