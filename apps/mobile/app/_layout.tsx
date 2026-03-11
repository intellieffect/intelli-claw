import "../global.css";
import "react-native-get-random-values"; // polyfill crypto.getRandomValues for uuid
import "react-native-gesture-handler";
import { useState, useCallback, useEffect } from "react";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import Constants from "expo-constants";
import {
  GatewayProvider,
  initCryptoAdapter,
  GATEWAY_CONFIG_STORAGE_KEY,
  DEFAULT_GATEWAY_URL,
  type GatewayConfig,
} from "@intelli-claw/shared";
import { ExpoCryptoAdapter } from "../src/adapters/crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { mmkvStorage, loadStorageCache } from "../src/adapters/storage";
import { SessionContext } from "../src/stores/sessionStore";
import { ChatStateProvider } from "../src/stores/ChatStateProvider";
import { useDeepLink } from "../src/hooks/useDeepLink";

// Initialize crypto adapter (must be called once before gateway connects)
initCryptoAdapter(new ExpoCryptoAdapter());

// --- Config persistence ---

function loadGatewayConfig(): GatewayConfig {
  try {
    const saved = mmkvStorage.getString(GATEWAY_CONFIG_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<GatewayConfig>;
      // Trust storage if: (a) URL is non-default (user explicitly configured), or (b) token is set.
      // Stale entries with default URL + empty token should fall through to env/extra vars.
      if (parsed.url && (parsed.token || parsed.url !== DEFAULT_GATEWAY_URL)) {
        return { url: parsed.url, token: parsed.token ?? "" } as GatewayConfig;
      }
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
  const data = JSON.stringify({ url, token });
  mmkvStorage.set(GATEWAY_CONFIG_STORAGE_KEY, data);
  // Verify in-memory cache persistence
  const stored = mmkvStorage.getString(GATEWAY_CONFIG_STORAGE_KEY);
  if (stored !== data) {
    console.warn("[GW] Config save verification failed — stored value does not match");
  }
}

// --- Root Layout ---

// Session picker callback ref — set by ChatScreen, called by ChatHeader
let _openSessionPicker: (() => void) | null = null;
export function registerSessionPicker(fn: () => void) { _openSessionPicker = fn; }
export function unregisterSessionPicker() { _openSessionPicker = null; }

/** Inner component that uses hooks requiring GatewayProvider context */
function DeepLinkHandler({ children }: { children: React.ReactNode }) {
  useDeepLink();
  return <>{children}</>;
}

const ACTIVE_SESSION_KEY = "intelli-claw:activeSessionKey";

export default function RootLayout() {
  const [cacheReady, setCacheReady] = useState(false);
  const [activeSessionKey, setActiveSessionKeyRaw] = useState<string | null>(null);

  // Pre-load AsyncStorage → memCache before reading gateway config
  useEffect(() => {
    loadStorageCache([GATEWAY_CONFIG_STORAGE_KEY]).then(() => setCacheReady(true));
  }, []);

  const config = cacheReady ? loadGatewayConfig() : null;

  // Restore persisted session on mount
  useEffect(() => {
    AsyncStorage.getItem(ACTIVE_SESSION_KEY).then((v) => {
      if (v) setActiveSessionKeyRaw(v);
    }).catch(() => {});
  }, []);

  const setActiveSessionKey = useCallback((key: string | null) => {
    setActiveSessionKeyRaw(key);
    if (key) AsyncStorage.setItem(ACTIVE_SESSION_KEY, key).catch(() => {});
    else AsyncStorage.removeItem(ACTIVE_SESSION_KEY).catch(() => {});
  }, []);

  const openSessionPicker = useCallback(() => {
    _openSessionPicker?.();
  }, []);

  // Wait for storage cache before rendering GatewayProvider
  if (!config) {
    return (
      <GestureHandlerRootView className="flex-1">
        <SafeAreaProvider>
          <StatusBar style="auto" />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaProvider>
        <SessionContext.Provider value={{ activeSessionKey, setActiveSessionKey, openSessionPicker }}>
          <GatewayProvider
            url={config.url}
            token={config.token}
            onConfigChange={saveConfig}
          >
            <DeepLinkHandler>
              <ChatStateProvider>
                <StatusBar style="auto" />
                <Slot />
              </ChatStateProvider>
            </DeepLinkHandler>
          </GatewayProvider>
        </SessionContext.Provider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
