import "react-native-get-random-values";
import "react-native-gesture-handler";

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ChannelProvider, type ChannelConfig } from "@intelli-claw/shared";

import { channelStorage } from "../src/storage";
import {
  clearChannelConfig,
  loadChannelConfig,
  saveChannelConfig,
  type SecureChannelConfig,
} from "../src/secure-config";
import { PairingScreen } from "../src/pairing-screen";

export const ConfigContext = {
  reset: async () => {},
};

export default function RootLayout() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<SecureChannelConfig | null>(null);

  useEffect(() => {
    void loadChannelConfig().then((saved) => {
      setConfig(saved);
      setLoading(false);
    });
  }, []);

  const handlePaired = useCallback(async (next: SecureChannelConfig) => {
    await saveChannelConfig(next);
    setConfig(next);
  }, []);

  const handleConfigChange = useCallback((next: ChannelConfig) => {
    void saveChannelConfig({ url: next.url, token: next.token ?? "" });
  }, []);

  const handleReset = useCallback(async () => {
    await clearChannelConfig();
    setConfig(null);
  }, []);

  ConfigContext.reset = handleReset;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!config) {
    return (
      <SafeAreaProvider>
        <GestureHandlerRootView style={styles.flex}>
          <StatusBar style="light" />
          <PairingScreen onPaired={handlePaired} />
        </GestureHandlerRootView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.flex}>
        <StatusBar style="light" />
        <ChannelProvider
          url={config.url}
          token={config.token || undefined}
          storage={channelStorage}
          onConfigChange={handleConfigChange}
        >
          <Slot />
        </ChannelProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#09090b",
  },
});
