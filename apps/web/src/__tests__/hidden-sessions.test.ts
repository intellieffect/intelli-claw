import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const STORAGE_KEY = "awf:hidden-sessions";

// localStorage mock (jsdom 28 does not provide standard methods)
let lsStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => lsStore[key] ?? null,
  setItem: (key: string, value: string) => {
    lsStore[key] = value;
  },
  removeItem: (key: string) => {
    delete lsStore[key];
  },
};

describe("hidden-sessions", () => {
  beforeEach(() => {
    lsStore = {};
    vi.stubGlobal("localStorage", mockLocalStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Dynamic import to pick up mocked localStorage
  async function loadModule() {
    // Clear module cache so each test gets fresh module with mocked localStorage
    const mod = await import("@/lib/gateway/hidden-sessions");
    return mod;
  }

  it("getHiddenSessions returns empty Set initially", async () => {
    const { getHiddenSessions } = await loadModule();
    const result = getHiddenSessions();
    expect(result).toBeInstanceOf(Set);
    expect(result.size).toBe(0);
  });

  it("hideSession makes isSessionHidden return true", async () => {
    const { hideSession, isSessionHidden } = await loadModule();
    hideSession("agent:alpha:main");
    expect(isSessionHidden("agent:alpha:main")).toBe(true);
  });

  it("hideSession deduplicates — same key twice stores only once", async () => {
    const { hideSession } = await loadModule();
    hideSession("agent:alpha:main");
    hideSession("agent:alpha:main");
    const raw = JSON.parse(lsStore[STORAGE_KEY]!);
    expect(raw).toEqual(["agent:alpha:main"]);
  });

  it("unhideSession removes key and isSessionHidden returns false", async () => {
    const { hideSession, unhideSession, isSessionHidden } = await loadModule();
    hideSession("agent:alpha:main");
    expect(isSessionHidden("agent:alpha:main")).toBe(true);
    unhideSession("agent:alpha:main");
    expect(isSessionHidden("agent:alpha:main")).toBe(false);
  });

  it("unhideSession on non-existent key does not throw", async () => {
    const { unhideSession } = await loadModule();
    expect(() => unhideSession("nonexistent")).not.toThrow();
  });

  it("getHiddenSessions returns correct Set for multiple keys", async () => {
    const { hideSession, getHiddenSessions } = await loadModule();
    hideSession("a");
    hideSession("b");
    hideSession("c");
    const result = getHiddenSessions();
    expect(result.size).toBe(3);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.has("c")).toBe(true);
  });

  it("returns empty when localStorage contains corrupted JSON", async () => {
    const { isSessionHidden, getHiddenSessions } = await loadModule();
    lsStore[STORAGE_KEY] = "{not-valid-json";
    expect(isSessionHidden("anything")).toBe(false);
    expect(getHiddenSessions().size).toBe(0);
  });

  it("returns empty when localStorage value is null", async () => {
    const { getHiddenSessions, isSessionHidden } = await loadModule();
    delete lsStore[STORAGE_KEY];
    expect(getHiddenSessions().size).toBe(0);
    expect(isSessionHidden("anything")).toBe(false);
  });
});
