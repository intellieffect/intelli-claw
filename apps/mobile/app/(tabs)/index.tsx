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
} from "react-native";
import { useGateway } from "@intelli-claw/shared";
import { ConnectionBanner } from "../../src/components/ConnectionBanner";
import { useChat, type DisplayMessage, type AgentStatus } from "../../src/hooks/useChat";

// ─── Message Bubble ───

function MessageBubble({ msg }: { msg: DisplayMessage }) {
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <View className="px-4 py-1 my-1">
        <Text className="text-xs text-gray-400 text-center italic">{msg.content}</Text>
      </View>
    );
  }

  return (
    <View className={`px-4 py-1.5 my-0.5 flex-row ${isUser ? "justify-end" : "justify-start"}`}>
      <View
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? "bg-blue-500 rounded-br-md"
            : "bg-gray-100 rounded-bl-md"
        }`}
      >
        <Text
          className={`text-[15px] leading-[22px] ${isUser ? "text-white" : "text-gray-900"}`}
          selectable
        >
          {msg.content || (msg.streaming ? " " : "")}
        </Text>
        {msg.streaming && !msg.content && (
          <View className="flex-row items-center gap-1 py-1">
            <ActivityIndicator size="small" color="#9CA3AF" />
            <Text className="text-xs text-gray-400">생각 중...</Text>
          </View>
        )}
        {msg.toolCalls.length > 0 && (
          <View className="mt-1.5 pt-1.5 border-t border-gray-200/50">
            {msg.toolCalls.map((tc) => (
              <Text key={tc.callId} className="text-xs text-gray-400">
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
    <View className="px-4 py-1.5 bg-blue-50">
      <View className="flex-row items-center gap-2">
        <ActivityIndicator size="small" color="#3B82F6" />
        <Text className="text-xs text-blue-600 font-medium">{label}</Text>
      </View>
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
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <ConnectionBanner />

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text className="text-sm text-gray-400 mt-2">히스토리 로딩 중...</Text>
        </View>
      ) : messages.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-4xl mb-3">💬</Text>
          <Text className="text-lg font-semibold text-gray-400">
            {state === "connected" ? "대화를 시작하세요" : "연결 대기 중..."}
          </Text>
          <Text className="text-sm text-gray-300 mt-1 text-center">
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
          className="flex-1"
          contentContainerStyle={{ paddingVertical: 8 }}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          inverted={false}
        />
      )}

      <AgentStatusBar status={agentStatus} />

      {/* Input Bar */}
      <View className="flex-row items-end px-3 py-2 border-t border-gray-200 bg-white safe-bottom">
        <TextInput
          className="flex-1 min-h-[40px] max-h-[120px] px-4 py-2.5 bg-gray-100 rounded-2xl text-[15px] text-gray-900"
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
          <TouchableOpacity
            onPress={abort}
            className="ml-2 w-10 h-10 rounded-full bg-red-500 items-center justify-center"
            activeOpacity={0.7}
          >
            <View className="w-3.5 h-3.5 rounded-sm bg-white" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSend}
            className={`ml-2 w-10 h-10 rounded-full items-center justify-center ${
              state === "connected" && text.trim() ? "bg-blue-500" : "bg-gray-300"
            }`}
            disabled={state !== "connected" || !text.trim()}
            activeOpacity={0.7}
          >
            <Text className="text-white text-lg font-bold">↑</Text>
          </TouchableOpacity>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
