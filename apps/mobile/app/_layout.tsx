import "react-native-get-random-values"; // polyfill crypto.getRandomValues for uuid
import { useState, useCallback } from "react";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Constants from "expo-constants";
import {
  GatewayProvider,
  initCryptoAdapter,
  GATEWAY_CONFIG_STORAGE_KEY,
  DEFAULT_GATEWAY_URL,
  type GatewayConfig,
} from "@intelli-claw/shared";
import { ExpoCryptoAdapter } from "../src/adapters/crypto";
import { mmkvStorage } from "../src/adapters/storage";
import { SessionContext } from "../src/stores/sessionStore";

// Initialize crypto adapter (must be called once before gateway connects)
initCryptoAdapter(new ExpoCryptoAdapter());

// --- Config persistence ---

function loadGatewayConfig(): GatewayConfig {
  try {
    const saved = mmkvStorage.getString(GATEWAY_CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<GatewayConfig>;
      if (parsed.url && parsed.token) return parsed as GatewayConfig;
    }
  } catch {
    /* ignore */
  }
  const extra = Constants.expoConfig?.extra;
  return {
    url: (extra?.gatewayUrl as string) || DEFAULT_GATEWAY_URL,
    token: (extra?.gatewayToken as string) || "",
  };
}

function saveConfig(url: string, token: string): void {
  mmkvStorage.set(GATEWAY_CONFIG_STORAGE_KEY, JSON.stringify({ url, token }));
}

// --- Root Layout ---

// Session picker callback ref — set by ChatScreen, called by ChatHeader
let _openSessionPicker: (() => void) | null = null;
export function registerSessionPicker(fn: () => void) { _openSessionPicker = fn; }
export function unregisterSessionPicker() { _openSessionPicker = null; }

export default function RootLayout() {
  const config = loadGatewayConfig();
  const [activeSessionKey, setActiveSessionKey] = useState<string | null>(null);

  const openSessionPicker = useCallback(() => {
    _openSessionPicker?.();
  }, []);

  return (
    <SafeAreaProvider>
      <SessionContext.Provider value={{ activeSessionKey, setActiveSessionKey, openSessionPicker }}>
        <GatewayProvider
          url={config.url}
          token={config.token}
          onConfigChange={saveConfig}
        >
          <StatusBar style="auto" />
          <Slot />
        </GatewayProvider>
      </SessionContext.Provider>
    </SafeAreaProvider>
  );
}
