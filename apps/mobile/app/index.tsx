import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useChannel, type ChannelMsg, type PermissionRequest } from "@intelli-claw/shared";
import Markdown from "react-native-markdown-display";

import { ConfigContext } from "./_layout";

function StatusPill() {
  const { state } = useChannel();
  const label =
    state === "connected"
      ? "연결됨"
      : state === "connecting"
        ? "연결 중"
        : state === "error"
          ? "오류"
          : "끊김";
  const bg =
    state === "connected"
      ? "#10b98133"
      : state === "connecting"
        ? "#f59e0b33"
        : "#71717a33";
  const fg =
    state === "connected"
      ? "#34d399"
      : state === "connecting"
        ? "#fbbf24"
        : "#d4d4d8";
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function Bubble({ msg }: { msg: ChannelMsg }) {
  const isUser = msg.from === "user";
  return (
    <View
      style={[
        styles.bubbleRow,
        { justifyContent: isUser ? "flex-end" : "flex-start" },
      ]}
    >
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        {isUser ? (
          <Text style={styles.bubbleUserText}>{msg.text || "(empty)"}</Text>
        ) : (
          <Markdown style={markdownStyles}>{msg.text || "(empty)"}</Markdown>
        )}
        <Text style={styles.bubbleTime}>
          {new Date(msg.ts).toTimeString().slice(0, 8)}
        </Text>
      </View>
    </View>
  );
}

function PermissionCard({
  request,
  onResolve,
}: {
  request: PermissionRequest;
  onResolve: (id: string, behavior: "allow" | "deny") => void;
}) {
  return (
    <View style={styles.permCard}>
      <Text style={styles.permTitle}>Tool: {request.tool_name}</Text>
      {!!request.description && (
        <Text style={styles.permDesc}>{request.description}</Text>
      )}
      {!!request.input_preview && (
        <Text style={styles.permPreview} numberOfLines={6}>
          {request.input_preview}
        </Text>
      )}
      <View style={styles.permButtons}>
        <Pressable
          onPress={() => onResolve(request.request_id, "allow")}
          style={[styles.permBtn, { backgroundColor: "#10b981" }]}
        >
          <Text style={styles.permBtnText}>Allow</Text>
        </Pressable>
        <Pressable
          onPress={() => onResolve(request.request_id, "deny")}
          style={[styles.permBtn, { backgroundColor: "#ef4444" }]}
        >
          <Text style={styles.permBtnText}>Deny</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function ChatScreen() {
  const {
    state,
    activeSessionId,
    messages,
    pendingPermissions,
    send,
    clearMessages,
    resolvePermission,
  } = useChannel();

  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const listRef = useRef<FlatList<ChannelMsg>>(null);

  const visible = useMemo(
    () => messages.filter((m) => m.sessionId === activeSessionId),
    [messages, activeSessionId],
  );

  useEffect(() => {
    if (visible.length === 0) return;
    requestAnimationFrame(() =>
      listRef.current?.scrollToEnd({ animated: true }),
    );
  }, [visible.length]);

  const onSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      await send(trimmed, { sessionId: activeSessionId });
      setText("");
    } catch (err) {
      console.error("[channel] send failed:", err);
    } finally {
      setPending(false);
    }
  }, [text, send, activeSessionId]);

  const renderItem: ListRenderItem<ChannelMsg> = useCallback(
    ({ item }) => <Bubble msg={item} />,
    [],
  );

  const disabled = state !== "connected";

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>intelli-claw</Text>
        <Text style={styles.session}>· {activeSessionId}</Text>
        <StatusPill />
        <Pressable
          onPress={() => {
            void ConfigContext.reset();
          }}
          style={styles.headerAction}
        >
          <Text style={styles.headerActionText}>연결 해제</Text>
        </Pressable>
      </View>

      {pendingPermissions.length > 0 && (
        <View style={styles.permList}>
          {pendingPermissions.map((p) => (
            <PermissionCard
              key={p.request_id}
              request={p}
              onResolve={resolvePermission}
            />
          ))}
        </View>
      )}

      <FlatList
        ref={listRef}
        data={visible}
        keyExtractor={(m) => m.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              아래에서 입력을 시작하세요.
            </Text>
          </View>
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Claude에게 메시지를 보내세요"
            placeholderTextColor="#52525b"
            style={styles.input}
            editable={!disabled && !pending}
            multiline
          />
          <Pressable
            onPress={onSend}
            disabled={disabled || pending || !text.trim()}
            style={({ pressed }) => [
              styles.sendBtn,
              (disabled || pending || !text.trim()) && styles.sendBtnDisabled,
              pressed && !disabled && styles.sendBtnPressed,
            ]}
          >
            {pending ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.sendBtnText}>전송</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {messages.length > 0 && (
        <Pressable onPress={clearMessages} style={styles.clearLink}>
          <Text style={styles.clearLinkText}>화면 비우기</Text>
        </Pressable>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#09090b" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#27272a",
    gap: 8,
  },
  title: { color: "#fafafa", fontSize: 15, fontWeight: "700" },
  session: { color: "#71717a", fontSize: 13 },
  headerAction: { marginLeft: "auto" },
  headerActionText: { color: "#a1a1aa", fontSize: 12 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  pillText: { fontSize: 11, fontWeight: "600" },

  listContent: { paddingVertical: 12, paddingHorizontal: 12, gap: 8 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  emptyText: { color: "#71717a", fontSize: 14 },

  bubbleRow: { flexDirection: "row" },
  bubble: {
    maxWidth: "82%",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleUser: { backgroundColor: "#2563eb" },
  bubbleAssistant: { backgroundColor: "#18181b" },
  bubbleUserText: { color: "#f8fafc", fontSize: 15 },
  bubbleTime: {
    fontSize: 10,
    marginTop: 4,
    color: "#d4d4d877",
  },

  permList: { padding: 12, gap: 8 },
  permCard: {
    borderWidth: 1,
    borderColor: "#f59e0b55",
    backgroundColor: "#f59e0b1a",
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  permTitle: { color: "#fbbf24", fontWeight: "600" },
  permDesc: { color: "#d4d4d8", fontSize: 13 },
  permPreview: {
    color: "#e4e4e7",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 12,
    backgroundColor: "#18181b",
    padding: 8,
    borderRadius: 6,
  },
  permButtons: { flexDirection: "row", gap: 8 },
  permBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  permBtnText: { color: "#f8fafc", fontWeight: "600" },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 12,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#27272a",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    color: "#fafafa",
    backgroundColor: "#18181b",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: "#fafafa",
    borderRadius: 10,
    paddingHorizontal: 16,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnPressed: { opacity: 0.85 },
  sendBtnText: { color: "#0a0a0a", fontWeight: "600" },

  clearLink: { alignItems: "center", paddingVertical: 6 },
  clearLinkText: { color: "#71717a", fontSize: 12 },
});

const markdownStyles = {
  body: { color: "#e4e4e7", fontSize: 15 },
  code_inline: {
    backgroundColor: "#27272a",
    color: "#fbbf24",
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  fence: {
    backgroundColor: "#0a0a0a",
    color: "#e4e4e7",
    padding: 8,
    borderRadius: 6,
  },
  link: { color: "#60a5fa" },
};
