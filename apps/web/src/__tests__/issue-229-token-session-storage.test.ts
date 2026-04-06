/**
 * #229 — Gateway 토큰을 sessionStorage로 이동 (보안 강화)
 *
 * Previously the gateway URL + token were stored together in localStorage
 * under "awf:gateway-config". localStorage persists across tab close and is
 * readable from any same-origin script, which is a weak spot for the token.
 *
 * This PR splits the storage:
 *   - URL  → localStorage  (keeps UX — users don't re-type the URL)
 *   - Token → sessionStorage (scoped to the tab; cleared on close)
 *
 * A one-shot migration moves existing tokens out of localStorage into
 * sessionStorage and rewrites the localStorage entry to hold only the URL.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Polyfill sessionStorage / localStorage per-test so runs are hermetic.
function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear() { store.clear(); },
    getItem(k) { return store.get(k) ?? null; },
    key(i) { return Array.from(store.keys())[i] ?? null; },
    removeItem(k) { store.delete(k); },
    setItem(k, v) { store.set(k, String(v)); },
  };
}

// Import under test — these have to resolve against the real hooks module
// but we're stubbing import.meta.env via vi.stubEnv below.
import {
  loadGatewayConfig,
  GATEWAY_TOKEN_SESSION_KEY,
} from "@/lib/gateway/hooks";
import { GATEWAY_CONFIG_STORAGE_KEY } from "@intelli-claw/shared";

describe("#229 — gateway token in sessionStorage", () => {
  let localStore: Storage;
  let sessionStore: Storage;

  beforeEach(() => {
    localStore = makeStorage();
    sessionStore = makeStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: localStore,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: sessionStore,
      writable: true,
      configurable: true,
    });
    vi.stubEnv("VITE_GATEWAY_URL", "");
    vi.stubEnv("VITE_GATEWAY_TOKEN", "");
  });

  it("exports the session storage key under a stable name", () => {
    expect(typeof GATEWAY_TOKEN_SESSION_KEY).toBe("string");
    expect(GATEWAY_TOKEN_SESSION_KEY.length).toBeGreaterThan(0);
  });

  it("reads token from sessionStorage and url from localStorage (post-migration layout)", () => {
    localStore.setItem(
      GATEWAY_CONFIG_STORAGE_KEY,
      JSON.stringify({ url: "wss://host.example:18789" }),
    );
    sessionStore.setItem(GATEWAY_TOKEN_SESSION_KEY, "secret-abc");

    const cfg = loadGatewayConfig();
    expect(cfg.url).toBe("wss://host.example:18789");
    expect(cfg.token).toBe("secret-abc");
  });

  it("migrates legacy localStorage { url, token } entry — moves token to sessionStorage", () => {
    localStore.setItem(
      GATEWAY_CONFIG_STORAGE_KEY,
      JSON.stringify({
        url: "wss://legacy.example:18789",
        token: "legacy-token-123",
      }),
    );
    // sessionStorage empty on first load — migration should populate it.

    const cfg = loadGatewayConfig();
    expect(cfg.url).toBe("wss://legacy.example:18789");
    expect(cfg.token).toBe("legacy-token-123");
    // Migration side effects: sessionStorage now holds the token, and the
    // localStorage entry has been rewritten without the token field.
    expect(sessionStore.getItem(GATEWAY_TOKEN_SESSION_KEY)).toBe("legacy-token-123");
    const rewritten = JSON.parse(localStore.getItem(GATEWAY_CONFIG_STORAGE_KEY) || "{}");
    expect(rewritten.url).toBe("wss://legacy.example:18789");
    expect(rewritten.token).toBeUndefined();
  });

  it("returns empty token when neither storage has one", () => {
    localStore.setItem(
      GATEWAY_CONFIG_STORAGE_KEY,
      JSON.stringify({ url: "wss://host.example:18789" }),
    );
    const cfg = loadGatewayConfig();
    expect(cfg.url).toBe("wss://host.example:18789");
    expect(cfg.token).toBe("");
  });

  it("prefers sessionStorage token over legacy localStorage token on migration conflict", () => {
    localStore.setItem(
      GATEWAY_CONFIG_STORAGE_KEY,
      JSON.stringify({ url: "wss://host.example:18789", token: "old-token" }),
    );
    sessionStore.setItem(GATEWAY_TOKEN_SESSION_KEY, "new-token");

    const cfg = loadGatewayConfig();
    // sessionStorage wins — the user already logged in this tab with a
    // fresher token; the legacy localStorage value is stale.
    expect(cfg.token).toBe("new-token");
    // Legacy localStorage token field gets scrubbed on migration
    const rewritten = JSON.parse(localStore.getItem(GATEWAY_CONFIG_STORAGE_KEY) || "{}");
    expect(rewritten.token).toBeUndefined();
  });
});
