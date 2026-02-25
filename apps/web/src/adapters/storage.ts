/**
 * LocalStorageAdapter — StorageAdapter implementation using browser localStorage.
 */

import type { StorageAdapter } from "@intelli-claw/shared";

export class LocalStorageAdapter implements StorageAdapter {
  async getItem(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async setItem(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async removeItem(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
}
