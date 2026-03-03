/**
 * Mock localStorage / sessionStorage for testing.
 *
 * Provides an in-memory implementation that tracks all reads/writes
 * and can be reset between tests.
 */
import { vi } from "vitest";

export interface MockStorage {
  store: Record<string, string>;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
  readonly length: number;
  key: (index: number) => string | null;
  /** Get all stored keys (inspection helper) */
  keys: () => string[];
}

export function createMockStorage(): MockStorage {
  let store: Record<string, string> = {};

  const storage: MockStorage = {
    get store() {
      return store;
    },
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    keys: () => Object.keys(store),
  };

  return storage;
}

/**
 * Install mock storage on the global window object.
 * Returns cleanup function to restore originals.
 */
export function installMockStorage(): {
  localStorage: MockStorage;
  sessionStorage: MockStorage;
  cleanup: () => void;
} {
  const mockLocal = createMockStorage();
  const mockSession = createMockStorage();

  const originalLocal = globalThis.localStorage;
  const originalSession = globalThis.sessionStorage;

  vi.stubGlobal("localStorage", mockLocal);
  vi.stubGlobal("sessionStorage", mockSession);

  return {
    localStorage: mockLocal,
    sessionStorage: mockSession,
    cleanup: () => {
      vi.stubGlobal("localStorage", originalLocal);
      vi.stubGlobal("sessionStorage", originalSession);
    },
  };
}
