import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useGateway, type EventFrame } from "@intelli-claw/shared";
import { ConnectionBanner } from "../../src/components/ConnectionBanner";

interface LogEntry {
  id: string;
  text: string;
  type: "sent" | "received" | "error" | "info";
}

export default function ChatScreen() {
  const { client, state } = useGateway();
  const [message, setMessage] = useState("");
  const [log, setLog] = useState<LogEntry[]>([]);
  const scrollRef = useRef<ScrollView>(null);

  const addLog = useCallback(
    (text: string, type: LogEntry["type"] = "info") => {
      setLog((prev) => [
        ...prev,
        { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text, type },
      ]);
    },
    [],
  );

  // Log connection state changes
  useEffect(() => {
    addLog(`Connection: ${state}`, "info");
  }, [state, addLog]);

  // Listen for agent events
  useEffect(() => {
    if (!client) return;
    const unsub = client.onEvent((frame: EventFrame) => {
      if (frame.event === "agent") {
        const raw = frame.payload as Record<string, unknown>;
        const stream = raw.stream as string | undefined;
        const data = raw.data as Record<string, unknown> | undefined;

        if (stream === "assistant" && data?.delta) {
          addLog(String(data.delta), "received");
        } else if (stream === "lifecycle") {
          addLog(`Agent: ${(data?.phase as string) || stream}`, "info");
        }
      }
    });
    return unsub;
  }, [client, addLog]);

  const sendTestMessage = async () => {
    if (!client || state !== "connected" || !message.trim()) return;
    const text = message.trim();
    setMessage("");
    addLog(text, "sent");
    try {
      await client.request("chat.send", {
        message: text,
        idempotencyKey: `mobile-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      });
    } catch (err) {
      addLog(String(err), "error");
    }
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={90}
    >
      <ConnectionBanner />
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4 pt-2"
        onContentSizeChange={() =>
          scrollRef.current?.scrollToEnd({ animated: true })
        }
      >
        {log.length === 0 ? (
          <View className="items-center justify-center py-20">
            <Text className="text-lg font-semibold text-gray-400">
              {state === "connected"
                ? "Gateway 연결됨"
                : "연결 대기중..."}
            </Text>
            <Text className="text-sm text-gray-300 mt-2">
              메시지를 입력하여 연결을 테스트하세요
            </Text>
          </View>
        ) : (
          log.map((entry) => (
            <View key={entry.id} className="mb-2">
              <Text
                className={`text-sm ${
                  entry.type === "sent"
                    ? "text-blue-700"
                    : entry.type === "received"
                      ? "text-gray-900"
                      : entry.type === "error"
                        ? "text-red-600"
                        : "text-gray-400 text-xs"
                }`}
              >
                {entry.type === "sent" ? "→ " : ""}
                {entry.type === "error" ? "✗ " : ""}
                {entry.text}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
      <View className="flex-row items-center px-3 py-2 border-t border-gray-200 bg-white">
        <TextInput
          className="flex-1 h-10 px-3 bg-gray-100 rounded-lg mr-2 text-sm"
          placeholder="메시지를 입력하세요..."
          placeholderTextColor="#9CA3AF"
          value={message}
          onChangeText={setMessage}
          onSubmitEditing={sendTestMessage}
          editable={state === "connected"}
          returnKeyType="send"
        />
        <TouchableOpacity
          onPress={sendTestMessage}
          className={`px-4 py-2.5 rounded-lg ${
            state === "connected" ? "bg-blue-500" : "bg-gray-300"
          }`}
          disabled={state !== "connected"}
          activeOpacity={0.7}
        >
          <Text className="text-white font-medium text-sm">전송</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
