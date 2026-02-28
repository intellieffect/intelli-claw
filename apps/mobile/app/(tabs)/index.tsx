import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Modal,
  Animated,
  Clipboard,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Send, Square, ChevronDown, Settings, WifiOff, Bot, Puzzle } from "lucide-react-native";
import { useGateway, parseSessionKey, sessionDisplayName } from "@intelli-claw/shared";
import SettingsScreen from "../../src/components/SettingsScreen";
import { useChat, type DisplayMessage, type AgentStatus } from "../../src/hooks/useChat";
import { useSessionStore } from "../../src/stores/sessionStore";
import { useSessions } from "../../src/hooks/useSessions";
import { Markdown } from "../../src/components/Markdown";
import { ToolCallCard } from "../../src/components/ToolCallCard";
import { AttachmentPreview, AttachButton, useFileAttachments } from "../../src/components/FileAttachments";
import { SessionSwitcher } from "../../src/components/SessionSwitcher";
import { AgentSelector } from "../../src/components/AgentSelector";
import { SlashCommands, shouldShowSlashPicker } from "../../src/components/SlashCommands";
import { SkillPicker } from "../../src/components/SkillPicker";

// ─── Media helpers ───

const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i;
const MEDIA_LINE = /^MEDIA:(.+)$/;

interface MediaItem {
  type: "image" | "link";
  url: string;
}


/** Format timestamp HH:MM (today) or MM/DD HH:MM (other) KST */
function formatTime(ts?: string): string | null {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return null;
    const tz = { timeZone: "Asia/Seoul" as const };
    const time = d.toLocaleTimeString("ko-KR", { ...tz, hour: "2-digit", minute: "2-digit", hour12: false });
    const kstDate = d.toLocaleDateString("fr-CA", { ...tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const kstToday = new Date().toLocaleDateString("fr-CA", { ...tz, year: "numeric", month: "2-digit", day: "2-digit" });
    if (kstDate === kstToday) return time;
    const short = d.toLocaleDateString("ko-KR", { ...tz, month: "2-digit", day: "2-digit" });
    return `${short} ${time}`;
  } catch { return null; }
}

function extractMedia(content: string): { text: string; media: MediaItem[] } {
  const media: MediaItem[] = [];
  const textLines: string[] = [];
  for (const line of content.split("\n")) {
    const m = MEDIA_LINE.exec(line.trim());
    if (m) {
      const url = m[1].trim();
      media.push({ type: IMAGE_EXTS.test(url) ? "image" : "link", url });
    } else {
      textLines.push(line);
    }
  }
  const mdImg = /!\[([^\]]*)\]\(([^)]+)\)/g;
  let cleaned = textLines.join("\n");
  let match: RegExpExecArray | null;
  while ((match = mdImg.exec(cleaned)) !== null) {
    media.push({ type: "image", url: match[2] });
  }
  cleaned = cleaned.replace(mdImg, "").trim();
  return { text: cleaned, media };
}

// ─── Bouncing Dots (Electron style) ───

function BouncingDots() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const bounce = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, { toValue: -6, duration: 300, useNativeDriver: true }),
          Animated.timing(val, { toValue: 0, duration: 300, useNativeDriver: true }),
        ])
      );
    const a1 = bounce(dot1, 0);
    const a2 = bounce(dot2, 150);
    const a3 = bounce(dot3, 300);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [dot1, dot2, dot3]);

  return (
    <View style={s.dotsRow}>
      {[dot1, dot2, dot3].map((anim, i) => (
        <Animated.View key={i} style={[s.dot, { transform: [{ translateY: anim }] }]} />
      ))}
    </View>
  );
}

// ─── Message Bubble ───

const MessageBubble = React.memo(function MessageBubble({ msg }: { msg: DisplayMessage }) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const time = formatTime(msg.timestamp);

  if (msg.role === "system") {
    return (
      <View style={s.systemRow}>
        <View style={s.systemBubble}>
          <Text style={s.systemText}>{msg.content}</Text>
        </View>
      </View>
    );
  }

  const { text, media } = isUser
    ? { text: msg.content, media: [] as MediaItem[] }
    : extractMedia(msg.content || "");

  const handleCopy = useCallback(() => {
    if (!text) return;
    Clipboard.setString(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [text]);

  return (
    <View style={[s.bubbleRow, isUser ? s.bubbleRowRight : s.bubbleRowLeft]}>
      <View style={isUser ? { maxWidth: "88%" } : { width: "88%" }}>
        <Pressable
          onLongPress={!isUser ? handleCopy : undefined}
          style={[s.bubble, isUser ? s.bubbleUser : s.bubbleAssistant]}
        >
          {/* User-sent image attachments */}
          {isUser && msg.imageUris && msg.imageUris.length > 0 && (
            <View style={s.userImagesRow}>
              {msg.imageUris.map((uri, i) => (
                <Image key={i} source={{ uri }} style={s.userAttachedImg} resizeMode="cover" />
              ))}
            </View>
          )}

          {text ? (
            isUser ? (
              <Text style={[s.bubbleText, s.textWhite]} selectable>
                {text}
              </Text>
            ) : (
              <Markdown>{text}</Markdown>
            )
          ) : msg.streaming ? (
            <BouncingDots />
          ) : null}

          {/* Media */}
          {media.map((m, i) =>
            m.type === "image" ? (
              <TouchableOpacity key={i} onPress={() => Linking.openURL(m.url)} activeOpacity={0.8}>
                <Image source={{ uri: m.url }} style={s.mediaImage} resizeMode="contain" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity key={i} onPress={() => Linking.openURL(m.url)} activeOpacity={0.7}>
                <Text style={s.mediaLink}>📎 {m.url.split("/").pop()}</Text>
              </TouchableOpacity>
            )
          )}

          {/* Tool calls */}
          {msg.toolCalls.length > 0 && (
            <View style={s.toolSection}>
              {msg.toolCalls.map((tc) => (
                <ToolCallCard key={tc.callId} toolCall={tc} />
              ))}
            </View>
          )}
        </Pressable>

        {/* Timestamp + copy feedback */}
        <View style={[s.metaRow, isUser ? s.metaRight : s.metaLeft]}>
          {copied && <Text style={s.copiedText}>복사됨 ✓</Text>}
          {time && <Text style={s.timeText}>{time}</Text>}
        </View>
      </View>

    </View>
  );
});

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

// ─── Scroll To Bottom Button ───

function ScrollToBottomButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={s.scrollBtn} onPress={onPress} activeOpacity={0.8}>
      <ChevronDown size={20} color="#6B7280" />
    </TouchableOpacity>
  );
}

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
        // Execute slash command immediately
        if (command === "/stop") {
          abort();
        } else if (command === "/new") {
          setActiveSessionKey(null);
        } else if (command === "/reset") {
          // Send as message for server-side handling
          sendMessage(command);
        } else {
          sendMessage(command);
        }
        setText("");
      } else {
        // Append to input (e.g., /model needs a parameter)
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

  const filteredMessages = useMemo(() =>
    messages.filter((m) => m.content || m.streaming || m.toolCalls.length > 0),
    [messages],
  );

  const renderItem = useCallback(({ item }: { item: DisplayMessage }) => <MessageBubble msg={item} />, []);
  const keyExtractor = useCallback((item: DisplayMessage) => item.id, []);

  const dotColor = state === "connected" ? "#22C55E" : state === "connecting" ? "#EAB308" : state === "authenticating" ? "#3B82F6" : "#EF4444";
  const isConnected = state === "connected";

  return (
    <View style={[s.flex1, { paddingTop: insets.top }]}>
      {/* ─── AppBar ─── */}
      <View style={s.appBar}>
        <TouchableOpacity
          style={s.appBarLeft}
          onPress={() => { refreshSessions(); setSessionPickerOpen(true); }}
          activeOpacity={0.7}
          disabled={!isConnected}
        >
          <View style={[s.appBarDot, { backgroundColor: dotColor }]} />
          <Text style={s.appBarAgent} numberOfLines={1}>{agentLabel}</Text>
          {sessionLabel && sessionLabel !== "main" && (
            <Text style={s.appBarSession}>/ {sessionLabel}</Text>
          )}
          {isConnected && <ChevronDown size={14} color="#9CA3AF" style={{ marginLeft: 2 }} />}
        </TouchableOpacity>

        <View style={s.appBarRight}>
          {!isConnected && (
            <View style={s.statusChip}>
              <WifiOff size={11} color="#DC2626" />
              <Text style={s.statusChipText}>
                {state === "connecting" ? "연결 중" : state === "authenticating" ? "인증 중" : "끊김"}
              </Text>
            </View>
          )}
          {isConnected && (
            <TouchableOpacity onPress={() => setAgentSelectorOpen(true)} style={s.appBarIconBtn} activeOpacity={0.7}>
              <Bot size={18} color="#6B7280" />
            </TouchableOpacity>
          )}
          {isConnected && (
            <TouchableOpacity onPress={() => setSkillPickerOpen(true)} style={s.appBarIconBtn} activeOpacity={0.7}>
              <Puzzle size={18} color="#6B7280" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={() => setSettingsOpen(true)} style={s.appBarIconBtn} activeOpacity={0.7}>
            <Settings size={20} color="#6B7280" />
          </TouchableOpacity>
        </View>
      </View>

    <KeyboardAvoidingView
      style={s.flex1}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={8}
    >

      {/* Message area */}
      {loading ? (
        <View style={s.center}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={s.loadingText}>히스토리 로딩 중...</Text>
        </View>
      ) : filteredMessages.length === 0 ? (
        <View style={s.center}>
          <Text style={s.emptyEmoji}>🦞</Text>
          <Text style={s.emptyTitle}>
            {state === "connected" ? "무엇을 도와드릴까요?" : "연결 대기 중..."}
          </Text>
          <Text style={s.emptySubtitle}>
            {state === "connected"
              ? "메시지를 입력하여 대화를 시작하세요"
              : "Settings에서 Gateway URL과 Token을 설정하세요"}
          </Text>
        </View>
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
          {userScrolledUp && <ScrollToBottomButton onPress={scrollToBottom} />}
        </View>
      )}

      <AgentStatusBar status={agentStatus} />

      {/* Agent indicator above input — tap to open session list */}
      {currentKey && parsed?.agentId && (
        <TouchableOpacity
          style={s.agentIndicator}
          activeOpacity={0.6}
          onPress={() => { refreshSessions(); setSessionPickerOpen(true); }}
        >
          <Bot size={12} color="#6366F1" />
          <Text style={s.agentIndicatorText}>{parsed.agentId}</Text>
          {parsed.type !== "main" && (
            <Text style={s.agentIndicatorSub}>/ {parsed.detail || parsed.type}</Text>
          )}
          <ChevronDown size={12} color="#9CA3AF" />
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

      {/* Input bar */}
      <View style={[s.inputBar, { paddingBottom: keyboardVisible ? 0 : Math.max(8, insets.bottom) }]}>
        <AttachButton onAttach={addAttachments} disabled={state !== "connected"} />

        <TextInput
          style={s.input}
          placeholder={state === "connected" ? "메시지를 입력하세요..." : "연결 안 됨"}
          placeholderTextColor="#9CA3AF"
          value={text}
          onChangeText={setText}
          editable={state === "connected"}
          returnKeyType="default"
          multiline
        />
        {streaming ? (
          <TouchableOpacity onPress={abort} style={s.abortBtn} activeOpacity={0.7}>
            <Square size={14} color="#FFFFFF" fill="#FFFFFF" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={handleSend}
            style={[s.sendBtn, state === "connected" && (text.trim() || attachments.length > 0) ? s.sendActive : s.sendDisabled]}
            disabled={state !== "connected" || (!text.trim() && attachments.length === 0)}
            activeOpacity={0.7}
          >
            <Send size={18} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {/* Session switcher (extracted component) */}
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

// ─── Need React import for React.memo ───
import React from "react";

// ─── Styles ───

const s = StyleSheet.create({
  flex1: { flex: 1, backgroundColor: "#FFFFFF" },

  // AppBar
  appBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 48, paddingHorizontal: 16, backgroundColor: "#FFFFFF", borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E7EB" },
  appBarLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  appBarDot: { width: 9, height: 9, borderRadius: 5, marginRight: 10 },
  appBarAgent: { fontSize: 17, fontWeight: "700", color: "#111827" },
  appBarSession: { fontSize: 13, color: "#9CA3AF", marginLeft: 4 },
  appBarRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  appBarIconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  statusChip: { flexDirection: "row", alignItems: "center", gap: 3, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 6, backgroundColor: "#FEF2F2" },
  statusChipText: { fontSize: 11, fontWeight: "500", color: "#DC2626" },

  // Settings modal
  settingsModal: { flex: 1, backgroundColor: "#FFFFFF" },
  settingsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 48, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#E5E7EB" },
  settingsTitle: { fontSize: 17, fontWeight: "700", color: "#111827" },
  settingsClose: { fontSize: 14, fontWeight: "600", color: "#2563EB" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  loadingText: { fontSize: 13, color: "#9CA3AF", marginTop: 8 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: "600", color: "#374151" },
  emptySubtitle: { fontSize: 14, color: "#9CA3AF", marginTop: 6, textAlign: "center", lineHeight: 20 },
  listContent: { paddingVertical: 12, paddingHorizontal: 8 },

  // Bouncing dots
  dotsRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#9CA3AF" },



  // Bubbles
  bubbleRow: { flexDirection: "row", paddingHorizontal: 8, paddingVertical: 3, alignItems: "flex-start" },
  bubbleRowRight: { justifyContent: "flex-end" },
  bubbleRowLeft: { justifyContent: "flex-start" },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleUser: { backgroundColor: "#3B82F6", borderBottomRightRadius: 6 },
  bubbleAssistant: { backgroundColor: "#F3F4F6", borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 15, lineHeight: 22 },
  textWhite: { color: "#FFFFFF" },
  textDark: { color: "#111827" },

  // Meta (timestamp + copy)
  metaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3, paddingHorizontal: 4 },
  metaLeft: { justifyContent: "flex-start" },
  metaRight: { justifyContent: "flex-end" },
  timeText: { fontSize: 10, color: "#D1D5DB" },
  copiedText: { fontSize: 10, color: "#10B981", fontWeight: "600" },

  // System
  systemRow: { paddingHorizontal: 16, paddingVertical: 6, alignItems: "center" },
  systemBubble: { backgroundColor: "#F9FAFB", borderRadius: 12, borderWidth: 1, borderColor: "#F3F4F6", paddingHorizontal: 14, paddingVertical: 8, maxWidth: "90%" },
  systemText: { fontSize: 12, color: "#9CA3AF", textAlign: "center" },

  // Tool calls
  toolSection: { marginTop: 8, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E5E7EB" },

  // Status bar
  statusBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6, backgroundColor: "#EFF6FF" },
  statusText: { fontSize: 12, color: "#2563EB", fontWeight: "500" },

  // Scroll to bottom
  scrollBtn: {
    position: "absolute", bottom: 12, right: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E5E7EB",
    alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4,
    elevation: 4,
  },
  scrollBtnText: { fontSize: 18, color: "#6B7280", fontWeight: "600" },

  // Input
  agentIndicator: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 16, paddingVertical: 4, backgroundColor: "#F9FAFB", borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#E5E7EB" },
  agentIndicatorText: { fontSize: 12, fontWeight: "600", color: "#6366F1" },
  agentIndicatorSub: { fontSize: 11, color: "#9CA3AF" },
  inputBar: { flexDirection: "row", alignItems: "flex-end", paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#E5E7EB", backgroundColor: "#FFFFFF" },
  input: { flex: 1, minHeight: 40, maxHeight: 120, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: "#F3F4F6", borderRadius: 20, fontSize: 15, color: "#111827" },
  sendBtn: { marginLeft: 8, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  sendActive: { backgroundColor: "#3B82F6" },
  sendDisabled: { backgroundColor: "#D1D5DB" },
  abortBtn: { marginLeft: 8, width: 40, height: 40, borderRadius: 20, backgroundColor: "#EF4444", alignItems: "center", justifyContent: "center" },


  // User attached images
  userImagesRow: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, marginBottom: 6 },
  userAttachedImg: { width: 140, height: 140, borderRadius: 12 },

  // Media
  mediaImage: { width: "100%" as any, height: 200, borderRadius: 12, marginTop: 8 },
  mediaLink: { fontSize: 13, color: "#3B82F6", marginTop: 6, textDecorationLine: "underline" as any },



});
