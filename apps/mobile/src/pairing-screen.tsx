import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChannelClient } from "@intelli-claw/shared";

import type { SecureChannelConfig } from "./secure-config";

export interface PairingScreenProps {
  onPaired: (config: SecureChannelConfig) => Promise<void>;
}

function normalizeUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace(/\/+$/, "");
}

export function PairingScreen({ onPaired }: PairingScreenProps) {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const test = async () => {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError("Channel URL을 입력하세요.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const client = new ChannelClient({
        url: normalized,
        token: token.trim() || undefined,
      });
      const info = await client.fetchInfo();
      if (info.authRequired && !token.trim()) {
        setError("이 서버는 토큰을 요구합니다. INTELLI_CLAW_TOKEN을 입력하세요.");
        return;
      }
      await onPaired({ url: normalized, token: token.trim() });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <Text style={styles.title}>intelli-claw</Text>
          <Text style={styles.subtitle}>
            Claude Code 채널에 연결
          </Text>

          <Text style={styles.label}>Channel URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="http://192.168.1.10:8790"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            editable={!busy}
            style={styles.input}
          />

          <Text style={styles.label}>Bearer Token (LAN 모드만 필요)</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="INTELLI_CLAW_TOKEN 값"
            placeholderTextColor="#52525b"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={!busy}
            style={styles.input}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            onPress={test}
            disabled={busy}
            style={({ pressed }) => [
              styles.button,
              busy && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#0a0a0a" />
            ) : (
              <Text style={styles.buttonText}>연결 테스트 후 저장</Text>
            )}
          </Pressable>

          <Text style={styles.hint}>
            플러그인을 LAN에 노출하려면 호스트 측에서
            {"\n"}
            <Text style={styles.code}>INTELLI_CLAW_HOST=0.0.0.0 INTELLI_CLAW_TOKEN=…</Text>
            {"\n"}
            환경변수로 실행하세요.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: "#09090b" },
  content: { padding: 24, gap: 12 },
  title: { color: "#fafafa", fontSize: 28, fontWeight: "700" },
  subtitle: { color: "#a1a1aa", fontSize: 14, marginBottom: 16 },
  label: { color: "#d4d4d8", fontSize: 13, marginTop: 8 },
  input: {
    backgroundColor: "#18181b",
    color: "#fafafa",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  error: { color: "#f87171", fontSize: 13, marginTop: 4 },
  button: {
    backgroundColor: "#fafafa",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: "#0a0a0a", fontSize: 15, fontWeight: "600" },
  hint: { color: "#71717a", fontSize: 12, marginTop: 16, lineHeight: 18 },
  code: { color: "#e4e4e7", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
});
