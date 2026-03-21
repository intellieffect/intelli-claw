/**
 * #220 — 연결 설정(Gateway URL/Token)이 앱 재시작 시 초기화됨
 *
 * 검증 대상:
 * 1. localStorage에 저장된 config가 loadGatewayConfig에서 올바르게 반환되는지
 * 2. 빈 token + non-default URL 조합이 유효한 config로 취급되는지
 * 3. env var 충돌 시 localStorage가 부적절하게 삭제되지 않는지
 * 4. saveConfig 후 verify 로직 동작
 * 5. DEFAULT_GATEWAY_URL과 동일한 stale entry가 fallthrough되는지
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadGatewayConfig, GATEWAY_CONFIG_STORAGE_KEY, DEFAULT_GATEWAY_URL } from "@/lib/gateway/hooks";

describe("#220 — Gateway config persistence across restarts", () => {
  let store: Record<string, string>;

  beforeEach(() => {
    store = {};
    vi.stubEnv("VITE_GATEWAY_URL", "");
    vi.stubEnv("VITE_GATEWAY_TOKEN", "");
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, val: string) => { store[key] = val; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { store = {}; },
      get length() { return Object.keys(store).length; },
      key: (i: number) => Object.keys(store)[i] ?? null,
    });
  });

  it("빈 token + non-default URL: 유효한 config로 반환한다", () => {
    store[GATEWAY_CONFIG_STORAGE_KEY] = JSON.stringify({
      url: "wss://my-server.ts.net:18789",
      token: "",
    });
    const config = loadGatewayConfig();
    expect(config.url).toBe("wss://my-server.ts.net:18789");
    expect(config.token).toBe("");
  });

  it("token과 URL 모두 있는 config를 정상 반환한다", () => {
    store[GATEWAY_CONFIG_STORAGE_KEY] = JSON.stringify({
      url: "wss://custom:18789",
      token: "secret-token-123",
    });
    const config = loadGatewayConfig();
    expect(config.url).toBe("wss://custom:18789");
    expect(config.token).toBe("secret-token-123");
  });

  it("default URL + 빈 token인 stale entry는 env fallback으로 넘어간다", () => {
    store[GATEWAY_CONFIG_STORAGE_KEY] = JSON.stringify({
      url: DEFAULT_GATEWAY_URL,
      token: "",
    });
    vi.stubEnv("VITE_GATEWAY_URL", "wss://env-server:18789");
    vi.stubEnv("VITE_GATEWAY_TOKEN", "env-token");

    const config = loadGatewayConfig();
    expect(config.url).toBe("wss://env-server:18789");
    expect(config.token).toBe("env-token");
  });

  it("default URL + non-empty token은 유효한 config로 취급한다", () => {
    store[GATEWAY_CONFIG_STORAGE_KEY] = JSON.stringify({
      url: DEFAULT_GATEWAY_URL,
      token: "my-local-token",
    });
    const config = loadGatewayConfig();
    expect(config.url).toBe(DEFAULT_GATEWAY_URL);
    expect(config.token).toBe("my-local-token");
  });

  it("env var가 non-default이고 localStorage URL과 다르면 env가 우선한다", () => {
    store[GATEWAY_CONFIG_STORAGE_KEY] = JSON.stringify({
      url: "wss://old-server:18789",
      token: "old-token",
    });
    vi.stubEnv("VITE_GATEWAY_URL", "wss://new-deploy:18789");
    vi.stubEnv("VITE_GATEWAY_TOKEN", "new-token");

    const config = loadGatewayConfig();
    expect(config.url).toBe("wss://new-deploy:18789");
    expect(config.token).toBe("new-token");
    // localStorage should be cleared
    expect(store[GATEWAY_CONFIG_STORAGE_KEY]).toBeUndefined();
  });

  it("env var가 default URL이면 localStorage를 삭제하지 않는다", () => {
    store[GATEWAY_CONFIG_STORAGE_KEY] = JSON.stringify({
      url: "wss://user-configured:18789",
      token: "user-token",
    });
    // env is default — should NOT override user's localStorage
    vi.stubEnv("VITE_GATEWAY_URL", DEFAULT_GATEWAY_URL);

    const config = loadGatewayConfig();
    expect(config.url).toBe("wss://user-configured:18789");
    expect(config.token).toBe("user-token");
    expect(store[GATEWAY_CONFIG_STORAGE_KEY]).toBeDefined();
  });

  it("env var와 localStorage URL이 동일하면 localStorage를 유지한다", () => {
    store[GATEWAY_CONFIG_STORAGE_KEY] = JSON.stringify({
      url: "wss://same-server:18789",
      token: "stored-token",
    });
    vi.stubEnv("VITE_GATEWAY_URL", "wss://same-server:18789");
    vi.stubEnv("VITE_GATEWAY_TOKEN", "env-token-different");

    const config = loadGatewayConfig();
    // localStorage wins when URLs match
    expect(config.url).toBe("wss://same-server:18789");
    expect(config.token).toBe("stored-token");
  });

  it("localStorage가 비었고 env도 비었으면 DEFAULT_GATEWAY_URL을 반환한다", () => {
    const config = loadGatewayConfig();
    expect(config.url).toBe(DEFAULT_GATEWAY_URL);
    expect(config.token).toBe("");
  });

  it("localStorage에 유효하지 않은 JSON이면 env fallback", () => {
    store[GATEWAY_CONFIG_STORAGE_KEY] = "{broken json}}";
    vi.stubEnv("VITE_GATEWAY_URL", "wss://fallback:18789");

    const config = loadGatewayConfig();
    expect(config.url).toBe("wss://fallback:18789");
  });

  it("localStorage에 url 필드가 없으면 env fallback", () => {
    store[GATEWAY_CONFIG_STORAGE_KEY] = JSON.stringify({ token: "orphan-token" });
    const config = loadGatewayConfig();
    expect(config.url).toBe(DEFAULT_GATEWAY_URL);
  });
});
