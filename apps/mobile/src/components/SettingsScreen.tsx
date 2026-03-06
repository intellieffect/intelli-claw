import { useState, useEffect, useRef } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Alert } from "react-native";
import { useGateway } from "@intelli-claw/shared";
import Constants from "expo-constants";

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between py-3">
      <Text className="text-[15px] text-muted-foreground">{label}</Text>
      <Text
        className="text-[15px] text-foreground font-mono max-w-[60%] text-right"
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="bg-card rounded-2xl p-5 mb-5">
      <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">
        {title}
      </Text>
      {children}
    </View>
  );
}

// --- Debug Log ---
type LogEntry = { ts: string; msg: string; level: "info" | "warn" | "error" };
const debugLogs: LogEntry[] = [];
const MAX_LOGS = 100;

function pushLog(msg: string, level: LogEntry["level"] = "info") {
  const ts = new Date().toLocaleTimeString("ko-KR", { hour12: false });
  debugLogs.unshift({ ts, msg, level });
  if (debugLogs.length > MAX_LOGS) debugLogs.pop();
}

// Patch console to capture logs
const origConsoleError = console.error;
const origConsoleWarn = console.warn;
console.error = (...args: unknown[]) => {
  pushLog(args.map(String).join(" "), "error");
  origConsoleError(...args);
};
console.warn = (...args: unknown[]) => {
  pushLog(args.map(String).join(" "), "warn");
  origConsoleWarn(...args);
};

export default function SettingsScreen() {
  const { state, error, gatewayUrl, serverVersion, serverCommit, updateConfig } = useGateway();
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState(gatewayUrl || "");
  const [token, setToken] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [, forceUpdate] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Track state changes in debug log
  useEffect(() => {
    pushLog(`state → ${state}${error ? ` | error: ${error.code} ${error.message}` : ""}`, error ? "error" : "info");
  }, [state, error]);

  // Auto-refresh debug panel
  useEffect(() => {
    if (showDebug) {
      intervalRef.current = setInterval(() => forceUpdate((n) => n + 1), 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [showDebug]);

  const handleSave = () => {
    if (!url.trim()) { Alert.alert("오류", "Gateway URL을 입력하세요"); return; }
    pushLog(`config change → ${url.trim()}`);
    updateConfig(url.trim(), token.trim());
    setEditing(false);
    Alert.alert("저장됨", "Gateway 설정이 변경되었습니다. 재연결 중...");
  };

  const levelColor = (l: LogEntry["level"]) =>
    l === "error" ? "text-destructive" : l === "warn" ? "text-warning" : "text-muted-foreground";

  return (
    <ScrollView className="flex-1 bg-background p-5" keyboardShouldPersistTaps="handled">
      <Section title="Gateway 연결">
        {editing ? (
          <>
            <Text className="text-sm text-muted-foreground mb-1.5">URL</Text>
            <TextInput
              className="h-12 px-4 bg-background border border-border rounded-xl text-[15px] text-foreground mb-4"
              value={url}
              onChangeText={setUrl}
              placeholder="wss://your-gateway:18789"
              placeholderTextColor="#444444"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Text className="text-sm text-muted-foreground mb-1.5">Token</Text>
            <TextInput
              className="h-12 px-4 bg-background border border-border rounded-xl text-[15px] text-foreground mb-4"
              value={token}
              onChangeText={setToken}
              placeholder="인증 토큰"
              placeholderTextColor="#444444"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <View className="flex-row gap-3">
              <Pressable
                className="flex-1 py-3 rounded-xl bg-info items-center active:opacity-80"
                onPress={handleSave}
              >
                <Text className="text-[15px] font-medium text-white">저장</Text>
              </Pressable>
              <Pressable
                className="flex-1 py-3 rounded-xl bg-border items-center active:opacity-80"
                onPress={() => { setUrl(gatewayUrl || ""); setToken(""); setEditing(false); }}
              >
                <Text className="text-[15px] font-medium text-card-foreground/80">취소</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <InfoRow label="Status" value={state} />
            <InfoRow label="URL" value={gatewayUrl || "-"} />
            {error && (
              <InfoRow label="Error" value={`${error.code || "?"}: ${error.message || "unknown"}`} />
            )}
            <InfoRow label="Server" value={serverVersion || "-"} />
            <InfoRow label="Commit" value={serverCommit?.slice(0, 8) || "-"} />
            <Pressable
              className="mt-3 py-3 rounded-xl bg-border items-center active:opacity-80"
              onPress={() => { setUrl(gatewayUrl || ""); setEditing(true); }}
            >
              <Text className="text-[15px] font-medium text-card-foreground/80">연결 설정 변경</Text>
            </Pressable>
          </>
        )}
      </Section>

      <Section title="앱 정보">
        <InfoRow label="Version" value={Constants.expoConfig?.version || "0.1.0"} />
        <InfoRow label="SDK" value={`Expo ${Constants.expoConfig?.sdkVersion || "?"}`} />
        <InfoRow label="Platform" value="React Native" />
      </Section>

      {/* Debug Panel */}
      <Pressable
        className="bg-card rounded-2xl p-5 mb-5 active:opacity-80"
        onPress={() => setShowDebug(!showDebug)}
      >
        <View className="flex-row justify-between items-center">
          <Text className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
            🐛 Debug Log
          </Text>
          <Text className="text-xs text-muted-foreground">{showDebug ? "▲ 접기" : "▼ 펼치기"}</Text>
        </View>
        {showDebug && (
          <View className="mt-4">
            <View className="flex-row justify-between mb-3">
              <Text className="text-xs text-muted-foreground">{debugLogs.length} entries</Text>
              <Pressable onPress={() => { debugLogs.length = 0; forceUpdate((n) => n + 1); }}>
                <Text className="text-xs text-destructive">Clear</Text>
              </Pressable>
            </View>
            {debugLogs.slice(0, 30).map((log, i) => (
              <View key={`${log.ts}-${i}`} className="mb-2">
                <Text className={`text-xs font-mono ${levelColor(log.level)}`} numberOfLines={3}>
                  <Text className="text-muted-foreground">{log.ts}</Text> {log.msg}
                </Text>
              </View>
            ))}
            {debugLogs.length === 0 && (
              <Text className="text-xs text-muted-foreground text-center py-4">로그 없음</Text>
            )}
          </View>
        )}
      </Pressable>
    </ScrollView>
  );
}
