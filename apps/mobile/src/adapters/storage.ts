/**
 * AsyncStorageAdapter — StorageAdapter using @react-native-async-storage/async-storage.
 * Compatible with Expo Go (no native module build required).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { StorageAdapter } from "@intelli-claw/shared";

/**
 * Synchronous-like in-memory cache for startup config reads.
 * Populated via loadCache() at app startup.
 */
const memCache = new Map<string, string>();
let cacheLoaded = false;

export const mmkvStorage = {
  getString(key: string): string | undefined {
    return memCache.get(key);
  },
  set(key: string, value: string) {
    memCache.set(key, value);
    AsyncStorage.setItem(key, value).catch(() => {});
  },
  delete(key: string) {
    memCache.delete(key);
    AsyncStorage.removeItem(key).catch(() => {});
  },
};

/** Pre-load known keys into in-memory cache (call once at startup) */
export async function loadStorageCache(keys: string[]): Promise<void> {
  if (cacheLoaded) return;
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    for (const [k, v] of pairs) {
      if (v != null) memCache.set(k, v);
    }
  } catch {}
  cacheLoaded = true;
}

/** Async wrapper implementing StorageAdapter interface */
export class AsyncStorageAdapter implements StorageAdapter {
  async getItem(key: string): Promise<string | null> {
    return AsyncStorage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    memCache.set(key, value);
    await AsyncStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    memCache.delete(key);
    await AsyncStorage.removeItem(key);
  }
}
