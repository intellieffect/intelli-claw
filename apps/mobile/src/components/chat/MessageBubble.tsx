import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  Image,
  Linking,
  StyleSheet,
  Animated,
  Clipboard,
} from "react-native";
import { Check } from "lucide-react-native";
import type { DisplayMessage } from "../../hooks/useChat";
import { Markdown } from "../Markdown";
import { ToolCallCard } from "../ToolCallCard";
import { colors, shadows, radii, typography } from "../../theme/colors";
import { PulseDots } from "./PulseDots";
import { DateSeparator } from "./DateSeparator";

const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i;
const MEDIA_LINE = /^MEDIA:(.+)$/;

interface MediaItem { type: "image" | "link"; url: string; }

export function extractMedia(content: string): { text: string; media: MediaItem[] } {
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

export function formatTime(ts?: string): string | null {
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

export function shouldShowTimestamp(current?: string, previous?: string): boolean {
  if (!current) return false;
  if (!previous) return true;
  try {
    return Math.abs(new Date(current).getTime() - new Date(previous).getTime()) > 5 * 60 * 1000;
  } catch { return true; }
}

export function shouldShowDateSeparator(current?: string, previous?: string): string | null {
  if (!current) return null;
  const tz = { timeZone: "Asia/Seoul" as const };
  try {
    const curDate = new Date(current).toLocaleDateString("fr-CA", { ...tz, year: "numeric", month: "2-digit", day: "2-digit" });
    if (previous) {
      const prevDate = new Date(previous).toLocaleDateString("fr-CA", { ...tz, year: "numeric", month: "2-digit", day: "2-digit" });
      if (curDate === prevDate) return null;
    }
    const today = new Date().toLocaleDateString("fr-CA", { ...tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("fr-CA", { ...tz, year: "numeric", month: "2-digit", day: "2-digit" });
    if (curDate === today) return "오늘";
    if (curDate === yesterday) return "어제";
    return new Date(current).toLocaleDateString("ko-KR", { ...tz, month: "long", day: "numeric", weekday: "short" });
  } catch { return null; }
}

interface MessageBubbleProps {
  msg: DisplayMessage;
  previousMsg?: DisplayMessage;
}

export const MessageBubble = React.memo(function MessageBubble({ msg, previousMsg }: MessageBubbleProps) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(6)).current;

  const showTime = shouldShowTimestamp(msg.timestamp, previousMsg?.timestamp);
  const time = showTime ? formatTime(msg.timestamp) : null;
  const dateLabel = shouldShowDateSeparator(msg.timestamp, previousMsg?.timestamp);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  if (msg.role === "system") {
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={[s.systemRow, { opacity: fadeAnim }]}>
          <View style={s.systemLine} />
          <Text style={s.systemText}>{msg.content}</Text>
          <View style={s.systemLine} />
        </Animated.View>
      </>
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
    <>
      {dateLabel && <DateSeparator label={dateLabel} />}
      {time && (
        <View style={s.timestampRow}>
          <Text style={s.timestampText}>{time}</Text>
        </View>
      )}
      <Animated.View
        style={[
          s.bubbleRow,
          isUser ? s.bubbleRowRight : s.bubbleRowLeft,
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
        ]}
      >
        <View style={isUser ? s.userBubbleWrap : s.assistantBubbleWrap}>
          {isUser ? (
            <View style={s.bubbleUser}>
              {msg.imageUris && msg.imageUris.length > 0 && (
                <View style={s.userImagesRow}>
                  {msg.imageUris.map((uri, i) => (
                    <Image key={i} source={{ uri }} style={s.userAttachedImg} resizeMode="cover" />
                  ))}
                </View>
              )}
              {text ? <Text style={s.userText} selectable>{text}</Text> : null}
            </View>
          ) : (
            <Pressable onLongPress={handleCopy} style={s.bubbleAssistant}>
              {text ? (
                <Markdown>{text}</Markdown>
              ) : msg.streaming ? (
                <PulseDots />
              ) : null}

              {media.map((m, i) =>
                m.type === "image" ? (
                  <TouchableOpacity key={i} onPress={() => Linking.openURL(m.url)} activeOpacity={0.8}>
                    <Image source={{ uri: m.url }} style={s.mediaImage} resizeMode="contain" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity key={i} onPress={() => Linking.openURL(m.url)} activeOpacity={0.7}>
                    <Text style={s.mediaLink}>{m.url.split("/").pop()}</Text>
                  </TouchableOpacity>
                )
              )}

              {msg.toolCalls.length > 0 && (
                <View style={s.toolSection}>
                  {msg.toolCalls.map((tc) => (
                    <ToolCallCard key={tc.callId} toolCall={tc} />
                  ))}
                </View>
              )}
            </Pressable>
          )}

          {!isUser && copied && (
            <View style={s.copiedBadge}>
              <Check size={10} color={colors.success} strokeWidth={3} />
              <Text style={s.copiedText}>복사됨</Text>
            </View>
          )}
        </View>
      </Animated.View>
    </>
  );
});

const s = StyleSheet.create({
  timestampRow: { alignItems: "center", paddingVertical: 10 },
  timestampText: { ...typography.tiny, color: colors.textTertiary },

  systemRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 24, paddingVertical: 14, gap: 14 },
  systemLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  systemText: { ...typography.caption, color: colors.textTertiary },

  bubbleRow: { flexDirection: "row", paddingHorizontal: 14, paddingVertical: 3, alignItems: "flex-start" },
  bubbleRowRight: { justifyContent: "flex-end" },
  bubbleRowLeft: { justifyContent: "flex-start" },

  userBubbleWrap: { maxWidth: "78%" },
  bubbleUser: {
    backgroundColor: colors.userBubble,
    borderRadius: radii.xl,
    borderBottomRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  userText: { fontSize: 15, lineHeight: 22, color: colors.userBubbleText, letterSpacing: 0.1 },

  assistantBubbleWrap: { flex: 1, maxWidth: "88%" },
  bubbleAssistant: { paddingVertical: 10, paddingHorizontal: 14, backgroundColor: "#141414", borderRadius: 18, borderBottomLeftRadius: 6 },

  copiedBadge: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6, paddingLeft: 2 },
  copiedText: { ...typography.tiny, color: colors.success, fontWeight: "600" },

  userImagesRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  userAttachedImg: { width: 140, height: 140, borderRadius: radii.md },

  mediaImage: { width: "100%" as any, height: 200, borderRadius: radii.md, marginTop: 10 },
  mediaLink: { fontSize: 13, color: colors.primary, marginTop: 6, textDecorationLine: "underline" as any },

  toolSection: { marginTop: 10 },
});
