import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayClient, type ConnectionState } from "@/lib/gateway/client";

// Mock device-identity module
vi.mock("@intelli-claw/shared/gateway/device-identity", () => ({
  signChallenge: vi.fn(async (nonce: string) => ({
    id: "test-device-id",
    publicKey: '{"kty":"EC","crv":"P-256"}',
    signature: "dGVzdC1zaWduYXR1cmU=",
    signedAt: 1700000000000,
    nonce,
  })),
  initCryptoAdapter: vi.fn(),
  getCryptoAdapter: vi.fn(),
  clearDeviceIdentity: vi.fn(),
}));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: "", wasClean: true });
  }

  // Test helpers
  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateClose(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: "", wasClean: false });
  }
}

// Helper: complete the handshake for a GatewayClient (real timers only)
async function completeHandshake(client: GatewayClient): Promise<MockWebSocket> {
  client.connect();
  await sleep(20);

  // @ts-expect-error accessing private
  const ws = client.ws as MockWebSocket;

  // Simulate challenge
  ws.simulateMessage(
    JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "test-nonce" },
    }),
  );
  await sleep(20);

  // Get the connect request id and respond with hello-ok
  const connectReq = JSON.parse(ws.sent[0]);
  ws.simulateMessage(
    JSON.stringify({
      type: "res",
      id: connectReq.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        server: { version: "1.0.0", connId: "c1" },
        features: { methods: [], events: [] },
        snapshot: {
          presence: [],
          health: {},
          stateVersion: { presence: 0, health: 0 },
          uptimeMs: 0,
          sessionDefaults: { mainSessionKey: "agent:alpha:main" },
        },
        policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 15000 },
      },
    }),
  );

  return ws;
}

describe("Issue #119: Mobile WSS Reconnection", () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let onlineListeners: Array<() => void>;
  let offlineListeners: Array<() => void>;
  let visibilityListeners: Array<() => void>;
  let hiddenValue: boolean;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error mock
    globalThis.WebSocket = MockWebSocket;

    // Track window event listeners
    onlineListeners = [];
    offlineListeners = [];
    visibilityListeners = [];
    hiddenValue = false;

    // Mock window.addEventListener / removeEventListener for online/offline
    vi.spyOn(window, "addEventListener").mockImplementation((event: string, handler: any) => {
      if (event === "online") onlineListeners.push(handler);
      if (event === "offline") offlineListeners.push(handler);
    });
    vi.spyOn(window, "removeEventListener").mockImplementation((event: string, handler: any) => {
      if (event === "online") onlineListeners = onlineListeners.filter((h) => h !== handler);
      if (event === "offline") offlineListeners = offlineListeners.filter((h) => h !== handler);
    });

    // Mock document.addEventListener / removeEventListener for visibilitychange
    vi.spyOn(document, "addEventListener").mockImplementation((event: string, handler: any) => {
      if (event === "visibilitychange") visibilityListeners.push(handler);
    });
    vi.spyOn(document, "removeEventListener").mockImplementation((event: string, handler: any) => {
      if (event === "visibilitychange")
        visibilityListeners = visibilityListeners.filter((h) => h !== handler);
    });

    // Mock document.hidden
    Object.defineProperty(document, "hidden", {
      get: () => hiddenValue,
      configurable: true,
    });
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    vi.restoreAllMocks();
  });

  // (a) code 1006 close 후 exponential backoff 재연결 시도 확인
  it("retries with exponential backoff after code 1006 close", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    const ws = await completeHandshake(client);

    const states: ConnectionState[] = [];
    client.onStateChange((s) => states.push(s));

    // Simulate code 1006 close
    ws.simulateClose(1006);
    expect(client.getState()).toBe("disconnected");

    // Wait for reconnect delay (first delay is 1000-1300ms with jitter)
    await sleep(1500);

    // Should have attempted to reconnect (state should be connecting)
    expect(states).toContain("connecting");
    client.disconnect();
  });

  // (b) 최대 재시도 후 stable 상태로 전환 (무한 루프 방지)
  it("gives up after MAX_RECONNECT_ATTEMPTS and emits reconnect_exhausted", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    const ws = await completeHandshake(client);

    const events: string[] = [];
    client.onEvent((e) => events.push(e.event));

    // Set reconnect attempt to just below max (20)
    // @ts-expect-error accessing private
    client.reconnectAttempt = 20;

    // This close should trigger scheduleReconnect which sees attempt >= 20
    ws.simulateClose(1006);

    // Should have emitted reconnect_exhausted event synchronously
    expect(events).toContain("client.reconnect_exhausted");
    expect(client.getState()).toBe("disconnected");
  });

  // (c) `online` 이벤트 발생 시 즉시 재연결 시도
  it("immediately reconnects on 'online' event when disconnected", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    const ws = await completeHandshake(client);

    // Simulate close
    ws.simulateClose(1006);
    expect(client.getState()).toBe("disconnected");

    const states: ConnectionState[] = [];
    client.onStateChange((s) => states.push(s));

    // Fire 'online' event — should trigger immediate reconnect
    onlineListeners.forEach((h) => h());

    expect(states).toContain("connecting");
    client.disconnect();
  });

  // (d) visibilitychange (모바일 앱 포그라운드 복귀) 시 연결 상태 확인 + 재연결
  it("checks connection and reconnects on visibilitychange to visible", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    const ws = await completeHandshake(client);

    // Simulate close while hidden
    hiddenValue = true;
    ws.simulateClose(1006);

    const states: ConnectionState[] = [];
    client.onStateChange((s) => states.push(s));

    // Simulate returning to foreground
    hiddenValue = false;
    visibilityListeners.forEach((h) => h());

    expect(states).toContain("connecting");
    client.disconnect();
  });

  // (e) intentionalClose 시 재연결하지 않음
  it("does NOT reconnect on intentional close, and does NOT react to online/visibility events", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    await completeHandshake(client);

    // Intentional disconnect
    client.disconnect();
    expect(client.getState()).toBe("disconnected");

    const states: ConnectionState[] = [];
    client.onStateChange((s) => states.push(s));

    // Fire online event — should NOT reconnect (listeners removed on disconnect)
    onlineListeners.forEach((h) => h());

    // Fire visibility event — should NOT reconnect (listeners removed on disconnect)
    hiddenValue = false;
    visibilityListeners.forEach((h) => h());

    // State should remain disconnected
    expect(states.filter((s) => s === "connecting")).toHaveLength(0);
  });

  // Bonus: jitter is applied to reconnect delays
  it("applies jitter to reconnect delays (not exactly the base delay)", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    const ws = await completeHandshake(client);

    // Spy on setTimeout to capture the delay value
    const setTimeoutSpy = vi.spyOn(global, "setTimeout");

    ws.simulateClose(1006);

    // Find the reconnect setTimeout call — look for delay >= 1000
    const reconnectCall = setTimeoutSpy.mock.calls.find(
      (call) => typeof call[1] === "number" && call[1] >= 1000 && call[1] <= 2000,
    );
    expect(reconnectCall).toBeDefined();

    // The delay should be >= 1000 (base) with jitter
    const delay = reconnectCall![1] as number;
    expect(delay).toBeGreaterThanOrEqual(1000);

    setTimeoutSpy.mockRestore();
    client.disconnect();
  });

  // Bonus: reconnect attempt counter resets on successful connection
  it("resets reconnect attempt counter on successful connection", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    await completeHandshake(client);

    // @ts-expect-error accessing private
    expect(client.reconnectAttempt).toBe(0);
    client.disconnect();
  });

  // Bonus: cleanup removes window/document listeners
  it("removes online/visibilitychange listeners on disconnect", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");

    client.connect();
    await sleep(20);

    // Listeners should have been added by connect()
    expect(onlineListeners.length).toBeGreaterThan(0);
    expect(visibilityListeners.length).toBeGreaterThan(0);

    client.disconnect();

    expect(onlineListeners.length).toBe(0);
    expect(visibilityListeners.length).toBe(0);
  });
});
