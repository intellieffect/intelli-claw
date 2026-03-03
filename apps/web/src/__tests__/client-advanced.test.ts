import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayClient } from "@/lib/gateway/client";

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

// --- MockWebSocket ---
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e?: any) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }

  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateClose() {
    this.onclose?.();
  }
}

// --- Helper: complete handshake ---
const HELLO_OK_PAYLOAD = {
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
};

async function completeHandshake(client: GatewayClient): Promise<MockWebSocket> {
  client.connect();
  await vi.advanceTimersByTimeAsync(1);

  // @ts-expect-error private access
  const ws = client.ws as MockWebSocket;

  ws.simulateMessage(
    JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n1" } }),
  );
  await vi.advanceTimersByTimeAsync(1);

  const connectReq = JSON.parse(ws.sent[0]);
  ws.simulateMessage(
    JSON.stringify({ type: "res", id: connectReq.id, ok: true, payload: HELLO_OK_PAYLOAD }),
  );

  return ws;
}

describe("GatewayClient – Advanced", () => {
  let originalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error mock
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
  });

  // ─── Reconnect Logic ───────────────────────────────────────

  describe("reconnect logic", () => {
    it("1. schedules reconnect on unintentional close", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const ws = await completeHandshake(client);
      expect(client.getState()).toBe("connected");

      // Simulate close without calling disconnect()
      ws.simulateClose();
      expect(client.getState()).toBe("disconnected");

      // After 1s, should attempt reconnect (+ 1ms for MockWebSocket onopen setTimeout)
      await vi.advanceTimersByTimeAsync(1001);
      expect(client.getState()).toBe("authenticating");
    });

    it("2. reconnect delays increase: 1s, 2s, 4s, 8s, 16s", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const ws = await completeHandshake(client);

      const expectedDelays = [1000, 2000, 4000, 8000, 16000];

      for (let i = 0; i < expectedDelays.length; i++) {
        // @ts-expect-error private access
        const currentWs = client.ws as MockWebSocket;
        currentWs.simulateClose();
        expect(client.getState()).toBe("disconnected");

        // Advance just short of the delay — should still be disconnected
        await vi.advanceTimersByTimeAsync(expectedDelays[i] - 1);
        expect(client.getState()).toBe("disconnected");

        // Advance by 1ms (reconnect fires) + 1ms (MockWebSocket onopen setTimeout)
        await vi.advanceTimersByTimeAsync(2);
        expect(client.getState()).toBe("authenticating");
      }
    });

    it("3. disconnect() does not schedule reconnect (intentionalClose=true)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      client.disconnect();
      expect(client.getState()).toBe("disconnected");

      await vi.advanceTimersByTimeAsync(20000);
      expect(client.getState()).toBe("disconnected");
    });

    it("4. reconnectAttempt resets to 0 on successful reconnect", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      // Force a few failed reconnects
      // @ts-expect-error private access
      const ws1 = client.ws as MockWebSocket;
      ws1.simulateClose(); // attempt becomes 1
      await vi.advanceTimersByTimeAsync(1000);
      // Now reconnecting; simulate close again
      // @ts-expect-error private access
      const ws2 = client.ws as MockWebSocket;
      ws2.simulateClose(); // attempt becomes 2
      await vi.advanceTimersByTimeAsync(2000);

      // Now complete handshake on this reconnect
      // @ts-expect-error private access
      const ws3 = client.ws as MockWebSocket;
      ws3.simulateMessage(
        JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "r1" } }),
      );
      await vi.advanceTimersByTimeAsync(1);
      const req = JSON.parse(ws3.sent[0]);
      ws3.simulateMessage(
        JSON.stringify({ type: "res", id: req.id, ok: true, payload: HELLO_OK_PAYLOAD }),
      );

      expect(client.getState()).toBe("connected");
      // @ts-expect-error private access
      expect(client.reconnectAttempt).toBe(0);
    });

    it("5. emits client.reconnected synthetic event on reconnect", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const events: any[] = [];
      client.onEvent((e) => events.push(e));
      await completeHandshake(client);

      // No reconnect event on initial connect
      expect(events.find((e) => e.event === "client.reconnected")).toBeUndefined();

      // Simulate disconnect and reconnect
      // @ts-expect-error private access
      const ws1 = client.ws as MockWebSocket;
      ws1.simulateClose();
      await vi.advanceTimersByTimeAsync(1000);

      // @ts-expect-error private access
      const ws2 = client.ws as MockWebSocket;
      ws2.simulateMessage(
        JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "rc1" } }),
      );
      await vi.advanceTimersByTimeAsync(1);
      const req = JSON.parse(ws2.sent[0]);
      ws2.simulateMessage(
        JSON.stringify({ type: "res", id: req.id, ok: true, payload: HELLO_OK_PAYLOAD }),
      );

      const reconnectEvent = events.find((e) => e.event === "client.reconnected");
      expect(reconnectEvent).toBeDefined();
      expect(reconnectEvent.type).toBe("event");
    });
  });

  // ─── Ping/Pong ─────────────────────────────────────────────

  describe("ping/pong", () => {
    it("6. startPing/stopPing methods exist and are callable", () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      // @ts-expect-error private access
      expect(typeof client.startPing).toBe("function");
      // @ts-expect-error private access
      expect(typeof client.stopPing).toBe("function");
    });
  });

  // ─── Auth Timeout ──────────────────────────────────────────

  describe("auth timeout", () => {
    it("7. closes connection if hello-ok not received within AUTH_TIMEOUT (10s)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      client.connect();
      await vi.advanceTimersByTimeAsync(1); // onopen fires → authenticating

      expect(client.getState()).toBe("authenticating");

      // After 10s without hello-ok, should close
      await vi.advanceTimersByTimeAsync(10000);

      // The ws.close() triggers handleClose → disconnected
      expect(client.getState()).toBe("disconnected");
      expect(client.lastError?.code).toBe("auth_timeout");
    });

    it("8. clears auth timer when hello-ok is received", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      // @ts-expect-error private access
      expect(client.authTimer).toBeNull();

      // Even after 10s, should still be connected
      await vi.advanceTimersByTimeAsync(10000);
      expect(client.getState()).toBe("connected");
    });
  });

  // ─── Request Timeout ───────────────────────────────────────

  describe("request timeout", () => {
    it("9. rejects request if no response within REQUEST_TIMEOUT (30s)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      const promise = client.request("slow.method").catch((e: Error) => e.message);

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(30_000);

      const msg = await promise;
      expect(msg).toBe("Request timeout: slow.method");
    });

    it("10. removes timed-out request from pending map", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      const promise = client.request("slow.method").catch(() => {});

      // @ts-expect-error private access
      expect(client.pending.size).toBe(1);

      await vi.advanceTimersByTimeAsync(30_000);
      await promise;

      // @ts-expect-error private access
      expect(client.pending.size).toBe(0);
    });
  });

  // ─── rejectAll ─────────────────────────────────────────────

  describe("rejectAll on disconnect", () => {
    it("11. rejects all pending requests on connection close", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const ws = await completeHandshake(client);

      const p1 = client.request("method.a").catch((e: Error) => e.message);
      const p2 = client.request("method.b").catch((e: Error) => e.message);

      ws.simulateClose();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe("Connection closed");
      expect(r2).toBe("Connection closed");
    });
  });

  // ─── Error handling ────────────────────────────────────────

  describe("error handling", () => {
    it("13. WebSocket constructor failure calls handleClose", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      // @ts-expect-error mock
      globalThis.WebSocket = class {
        constructor() {
          throw new Error("connection refused");
        }
      };
      client.connect();
      expect(client.getState()).toBe("disconnected");

      // Restore for other tests
      // @ts-expect-error mock
      globalThis.WebSocket = MockWebSocket;
    });

    it("14. server error response updates lastError and notifies stateHandlers", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const stateUpdates: { state: string; error: any }[] = [];
      client.onStateChange((s, e) => stateUpdates.push({ state: s, error: e }));
      const ws = await completeHandshake(client);

      const promise = client.request("bad.call").catch(() => {});

      const req = JSON.parse(ws.sent[ws.sent.length - 1]);
      ws.simulateMessage(
        JSON.stringify({
          type: "res",
          id: req.id,
          ok: false,
          error: { code: "FORBIDDEN", message: "no access", retryable: false },
        }),
      );

      await promise;

      expect(client.lastError?.code).toBe("FORBIDDEN");
      expect(client.lastError?.message).toBe("no access");
      // stateHandlers should be called with the error
      const errorUpdate = stateUpdates.find((u) => u.error?.code === "FORBIDDEN");
      expect(errorUpdate).toBeDefined();
    });
  });

  // ─── Pong handling ─────────────────────────────────────────

  describe("pong handling", () => {
    it('15. {"type":"pong"} is treated as pong, not forwarded as event', async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const events: any[] = [];
      client.onEvent((e) => events.push(e));
      const ws = await completeHandshake(client);

      ws.simulateMessage('{"type":"pong"}');

      expect(events.find((e) => e.event === "pong" || e.type === "pong")).toBeUndefined();
    });

    it('16. "pong" string is treated as pong, not forwarded as event', async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const events: any[] = [];
      client.onEvent((e) => events.push(e));
      const ws = await completeHandshake(client);

      ws.simulateMessage('"pong"');

      expect(events.find((e) => e.event === "pong" || e.type === "pong")).toBeUndefined();
    });
  });

  // ─── Multiple handlers ────────────────────────────────────

  describe("multiple handlers", () => {
    it("17. onEvent: multiple handlers all called", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const calls1: any[] = [];
      const calls2: any[] = [];
      client.onEvent((e) => calls1.push(e));
      client.onEvent((e) => calls2.push(e));
      const ws = await completeHandshake(client);

      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: { delta: "hi" } }),
      );

      expect(calls1.length).toBe(1);
      expect(calls2.length).toBe(1);
    });

    it("18. onEvent: unsubscribed handler not called", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const calls: any[] = [];
      const unsub = client.onEvent((e) => calls.push(e));
      const ws = await completeHandshake(client);

      unsub();

      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: { delta: "hi" } }),
      );

      expect(calls.length).toBe(0);
    });

    it("19. onStateChange: multiple handlers all called", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const states1: string[] = [];
      const states2: string[] = [];
      client.onStateChange((s) => states1.push(s));
      client.onStateChange((s) => states2.push(s));

      client.connect();
      await vi.advanceTimersByTimeAsync(1);

      expect(states1).toContain("connecting");
      expect(states1).toContain("authenticating");
      expect(states2).toContain("connecting");
      expect(states2).toContain("authenticating");
    });
  });

  // ─── Edge cases ────────────────────────────────────────────

  describe("edge cases", () => {
    it("20. connect() is ignored if already connecting/connected", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      const states: string[] = [];
      client.onStateChange((s) => states.push(s));

      // Calling connect() again should be a no-op
      client.connect();
      await vi.advanceTimersByTimeAsync(10);

      expect(states.length).toBe(0); // No state transitions
      expect(client.getState()).toBe("connected");
    });

    it("21. request() rejects when not connected", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await expect(client.request("anything")).rejects.toThrow("Not connected");
    });

    it("22. getUrl() returns the configured URL", () => {
      const client = new GatewayClient("ws://example.com:9999", "tok");
      expect(client.getUrl()).toBe("ws://example.com:9999");
    });
  });
});
