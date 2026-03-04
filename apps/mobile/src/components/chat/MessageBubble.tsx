import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text as RNText,
  TouchableOpacity,
  Pressable,
  Image,
  Linking,
  StyleSheet,
  Animated,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Check } from "lucide-react-native";
import type { DisplayMessage } from "../../hooks/useChat";
import { mobilePlatform } from "../../platform/mobile";
import { Markdown } from "../Markdown";
import { ToolCallCard } from "../ToolCallCard";
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
      const raw = m[1].trim();
      // Convert local file paths to platform media URLs (#103)
      const isHttp = raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("data:");
      const url = isHttp ? raw : mobilePlatform.mediaUrl(raw);
      media.push({ type: IMAGE_EXTS.test(raw) ? "image" : "link", url });
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

  const handleCopy = useCallback(async () => {
    if (!msg.content) return;
    await Clipboard.setStringAsync(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [msg.content]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 280, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  // System message
  if (msg.role === "system") {
    return (
      <>
        {dateLabel && <DateSeparator label={dateLabel} />}
        <Animated.View style={{ opacity: fadeAnim }} className="flex-row items-center px-6 py-3.5 gap-3.5">
          <View className="flex-1 h-[0.5px] bg-border" />
          <RNText className="text-xs font-medium text-muted-foreground">{msg.content}</RNText>
          <View className="flex-1 h-[0.5px] bg-border" />
        </Animated.View>
      </>
    );
  }

  const { text, media } = isUser
    ? { text: msg.content, media: [] as MediaItem[] }
    : extractMedia(msg.content || "");


  return (
    <>
      {dateLabel && <DateSeparator label={dateLabel} />}
      {time && (
        <View className="items-center py-2.5">
          <RNText className="text-[11px] font-medium text-muted-foreground tracking-wider">{time}</RNText>
        </View>
      )}
      <Animated.View
        style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        className={`flex-row px-3.5 py-1 items-start ${isUser ? "justify-end" : "justify-start"}`}
      >
        <View className={isUser ? "max-w-[78%]" : "flex-1 max-w-[88%]"}>
          {isUser ? (
            <View className="bg-primary rounded-2xl rounded-br-md px-4 py-2.5">
              {msg.imageUris && msg.imageUris.length > 0 && (
                <View className="flex-row flex-wrap gap-1.5 mb-2">
                  {msg.imageUris.map((uri, i) => (
                    <Image key={i} source={{ uri }} style={{ width: 140, height: 140, borderRadius: 12 }} resizeMode="cover" />
                  ))}
                </View>
              )}
              {text ? <RNText className="text-[15px] leading-[22px] text-primary-foreground tracking-wide" selectable>{text}</RNText> : null}
            </View>
          ) : (
            <Pressable onLongPress={handleCopy} className="bg-card rounded-2xl rounded-bl-md px-3.5 py-2.5 border border-border" accessibilityHint="길게 눌러 복사">
              {text ? (
                <Markdown>{text}</Markdown>
              ) : msg.streaming ? (
                <PulseDots />
              ) : null}

              {media.map((m, i) =>
                m.type === "image" ? (
                  <TouchableOpacity key={i} onPress={() => Linking.openURL(m.url)} activeOpacity={0.8}>
                    <Image source={{ uri: m.url }} style={{ width: "100%" as any, height: 200, borderRadius: 12, marginTop: 10 }} resizeMode="contain" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity key={i} onPress={() => Linking.openURL(m.url)} activeOpacity={0.7}>
                    <RNText className="text-sm text-primary mt-1.5 underline">{m.url.split("/").pop()}</RNText>
                  </TouchableOpacity>
                )
              )}

              {msg.toolCalls.length > 0 && (
                <View className="mt-2.5">
                  {msg.toolCalls.map((tc) => (
                    <ToolCallCard key={tc.callId} toolCall={tc} />
                  ))}
                </View>
              )}
            </Pressable>
          )}

          {!isUser && copied && (
            <View className="flex-row items-center gap-1 mt-1.5 pl-0.5">
              <Check size={10} color="#10B981" strokeWidth={3} />
              <RNText className="text-[11px] font-semibold text-green-500">복사됨</RNText>
            </View>
          )}
        </View>
      </Animated.View>
    </>
  );
});
