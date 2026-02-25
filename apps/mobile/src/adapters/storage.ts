/**
 * MMKVStorageAdapter — StorageAdapter implementation using react-native-mmkv.
 * MMKV provides synchronous high-performance key-value storage on mobile.
 */

import { MMKV } from "react-native-mmkv";
import type { StorageAdapter } from "@intelli-claw/shared";

/** Raw MMKV instance — use for synchronous reads (e.g., config loading at startup) */
export const mmkvStorage = new MMKV({ id: "intelli-claw" });

/** Async wrapper implementing StorageAdapter interface for shared package compatibility */
export class MMKVStorageAdapter implements StorageAdapter {
  async getItem(key: string): Promise<string | null> {
    return mmkvStorage.getString(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    mmkvStorage.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    mmkvStorage.delete(key);
  }
}
