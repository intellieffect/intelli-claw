/**
 * StorageAdapter — platform-agnostic key-value storage interface.
 *
 * Implementations:
 * - Web/Electron: IndexedDB or localStorage
 * - Mobile: MMKV or AsyncStorage
 */
export interface StorageAdapter {
  /** Get a value by key. Returns null if not found. */
  getItem(key: string): Promise<string | null>;

  /** Set a value by key. */
  setItem(key: string, value: string): Promise<void>;

  /** Remove a value by key. */
  removeItem(key: string): Promise<void>;
}
