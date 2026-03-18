/**
 * Tests for client.ts robustness improvements:
 * - Non-recoverable auth error detection (isNonRecoverableAuthError)
 * - Network listener deduplication
 * - Event sequence gap detection (onGap)
 * - 1012 Service Restart close code handling
 * - hello-ok snapshot expanded fields
 *
 * Issues: #246, #251
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayClient, type ErrorShape } from "@intelli-claw/shared";

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
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e?: any) => void) | null = null;
  onerror: ((e?: any) => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
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

  simulateClose(code = 1000, reason = "") {
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }

  static reset() {
    MockWebSocket.instances = [];
  }
}

// --- Handshake helper ---
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

describe("GatewayClient – Robustness (#246, #251)", () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let originalMathRandom: typeof Math.random;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.reset();
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error mock
    globalThis.WebSocket = MockWebSocket;
    originalMathRandom = Math.random;
    Math.random = () => 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    Math.random = originalMathRandom;
  });

  // ─── 1. Non-recoverable auth error ────────────────────────

  describe("isNonRecoverableAuthError", () => {
    // Import the function dynamically to get the module-level export
    async function getChecker() {
      const mod = await import("@intelli-claw/shared/gateway/client");
      return mod.isNonRecoverableAuthError;
    }

    it("returns false for null/undefined", async () => {
      const check = await getChecker();
      expect(check(null)).toBe(false);
      expect(check(undefined)).toBe(false);
    });

    it("returns false for error without details", async () => {
      const check = await getChecker();
      expect(check({ code: "AUTH_ERROR", message: "fail" })).toBe(false);
    });

    it("returns false for non-matching detail code", async () => {
      const check = await getChecker();
      const err: ErrorShape = {
        code: "AUTH_ERROR",
        message: "fail",
        details: { code: "SOME_OTHER_CODE" },
      };
      expect(check(err)).toBe(false);
    });

    const nonRecoverableCodes = [
      "AUTH_TOKEN_MISSING",
      "AUTH_PASSWORD_MISSING",
      "AUTH_PASSWORD_MISMATCH",
      "AUTH_RATE_LIMITED",
      "PAIRING_REQUIRED",
      "DEVICE_IDENTITY_REQUIRED",
      "CONTROL_UI_DEVICE_IDENTITY_REQUIRED",
    ];

    for (const code of nonRecoverableCodes) {
      it(`returns true for ${code}`, async () => {
        const check = await getChecker();
        const err: ErrorShape = {
          code: "AUTH_ERROR",
          message: `${code} error`,
          details: { code },
        };
        expect(check(err)).toBe(true);
      });
    }
  });

  describe("handleClose suppresses reconnect for non-recoverable auth errors", () => {
    it("does not reconnect after AUTH_TOKEN_MISSING", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const ws = await completeHandshake(client);

      // Simulate auth error response
      const reqId = "fake-req";
      ws.simulateMessage(
        JSON.stringify({
          type: "res",
          id: reqId,
          ok: false,
          error: {
            code: "AUTH_ERROR",
            message: "token missing",
            details: { code: "AUTH_TOKEN_MISSING" },
          },
        }),
      );

      // Close the connection
      const instanceCount = MockWebSocket.instances.length;
      ws.simulateClose(4008, "connect failed");

      // Wait long enough for any reconnect to fire
      await vi.advanceTimersByTimeAsync(120_000);

      // No new WebSocket created = no reconnect
      expect(MockWebSocket.instances.length).toBe(instanceCount);
      expect(client.getState()).toBe("disconnected");
    });

    it("still reconnects for recoverable errors", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const ws = await completeHandshake(client);

      // Simulate a recoverable server error
      ws.simulateMessage(
        JSON.stringify({
          type: "res",
          id: "req-x",
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "server glitch" },
        }),
      );

      const instanceCount = MockWebSocket.instances.length;
      ws.simulateClose(1006, "abnormal closure");

      // Should try to reconnect within a few seconds
      await vi.advanceTimersByTimeAsync(5_000);
      expect(MockWebSocket.instances.length).toBeGreaterThan(instanceCount);
    });
  });

  // ─── 2. Network listener deduplication ────────────────────

  describe("network listener deduplication", () => {
    it("does not double-register 'online' listeners across connect cycles", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");

      const client = new GatewayClient("ws://localhost:18789", "tok");

      // First connect/disconnect cycle
      await completeHandshake(client);
      client.disconnect();

      // Second connect/disconnect cycle
      await completeHandshake(client);
      client.disconnect();

      // Count 'online' listener registrations
      const onlineCalls = addSpy.mock.calls.filter(([type]) => type === "online");
      // Each connect should register once, then disconnect cleans up.
      // So we expect exactly 2 total registrations (not 4, which would indicate duplication)
      expect(onlineCalls.length).toBe(2);
    });

    it("does not register duplicate listeners within a single connection", async () => {
      const addSpy = vi.spyOn(window, "addEventListener");
      const baseCount = addSpy.mock.calls.filter(([type]) => type === "online").length;

      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      // Should add exactly 1 'online' listener for this single connect
      const onlineCalls = addSpy.mock.calls.filter(([type]) => type === "online").length - baseCount;
      expect(onlineCalls).toBe(1);

      client.disconnect();
    });
  });

  // ─── 3. Event sequence gap detection ──────────────────────

  describe("event sequence gap detection", () => {
    it("calls onGap when seq numbers have a gap", async () => {
      const onGap = vi.fn();
      const client = new GatewayClient("ws://localhost:18789", "tok", { onGap });
      const events: any[] = [];
      client.onEvent((e) => events.push(e));

      const ws = await completeHandshake(client);

      // Sequential: 1, 2
      ws.simulateMessage(JSON.stringify({ type: "event", event: "test.a", payload: {}, seq: 1 }));
      ws.simulateMessage(JSON.stringify({ type: "event", event: "test.b", payload: {}, seq: 2 }));

      // Gap: jump from 2 to 5
      ws.simulateMessage(JSON.stringify({ type: "event", event: "test.c", payload: {}, seq: 5 }));

      expect(onGap).toHaveBeenCalledOnce();
      expect(onGap).toHaveBeenCalledWith({ expected: 3, received: 5 });

      // Should emit client.seq_gap event
      const gapEvent = events.find((e: any) => e.event === "client.seq_gap");
      expect(gapEvent).toBeDefined();
      expect(gapEvent.payload).toEqual({ expected: 3, received: 5 });

      client.disconnect();
    });

    it("does not call onGap for sequential events", async () => {
      const onGap = vi.fn();
      const client = new GatewayClient("ws://localhost:18789", "tok", { onGap });
      const ws = await completeHandshake(client);

      ws.simulateMessage(JSON.stringify({ type: "event", event: "a", payload: {}, seq: 1 }));
      ws.simulateMessage(JSON.stringify({ type: "event", event: "b", payload: {}, seq: 2 }));
      ws.simulateMessage(JSON.stringify({ type: "event", event: "c", payload: {}, seq: 3 }));

      expect(onGap).not.toHaveBeenCalled();
      client.disconnect();
    });

    it("resets seq tracking on hello-ok", async () => {
      const onGap = vi.fn();
      const client = new GatewayClient("ws://localhost:18789", "tok", { onGap });

      const ws = await completeHandshake(client);

      // Events 1, 2 in first session
      ws.simulateMessage(JSON.stringify({ type: "event", event: "a", payload: {}, seq: 1 }));
      ws.simulateMessage(JSON.stringify({ type: "event", event: "b", payload: {}, seq: 2 }));

      // Simulate reconnect: close → reconnect → new hello-ok
      ws.simulateClose();
      await vi.advanceTimersByTimeAsync(1100);

      // @ts-expect-error private access
      const ws2 = client.ws as MockWebSocket;
      ws2.simulateMessage(
        JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "r1" } }),
      );
      await vi.advanceTimersByTimeAsync(1);
      const req2 = JSON.parse(ws2.sent[0]);
      ws2.simulateMessage(
        JSON.stringify({ type: "res", id: req2.id, ok: true, payload: HELLO_OK_PAYLOAD }),
      );

      // After reconnect, seq starts fresh — seq 1 should NOT trigger gap
      ws2.simulateMessage(JSON.stringify({ type: "event", event: "c", payload: {}, seq: 1 }));
      expect(onGap).not.toHaveBeenCalled();

      client.disconnect();
    });

    it("ignores events without seq field", async () => {
      const onGap = vi.fn();
      const client = new GatewayClient("ws://localhost:18789", "tok", { onGap });
      const ws = await completeHandshake(client);

      // Events without seq should not affect tracking
      ws.simulateMessage(JSON.stringify({ type: "event", event: "no-seq", payload: {} }));
      ws.simulateMessage(JSON.stringify({ type: "event", event: "a", payload: {}, seq: 5 }));
      ws.simulateMessage(JSON.stringify({ type: "event", event: "b", payload: {}, seq: 6 }));

      expect(onGap).not.toHaveBeenCalled();
      client.disconnect();
    });
  });

  // ─── 4. 1012 Service Restart close code ───────────────────

  describe("1012 Service Restart close code", () => {
    it("reconnects immediately without error on 1012", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const ws = await completeHandshake(client);

      expect(client.getState()).toBe("connected");

      const instanceCount = MockWebSocket.instances.length;
      ws.simulateClose(1012, "Service Restart");

      // Should reconnect with reset backoff (delay=1s since attempt reset to 0)
      await vi.advanceTimersByTimeAsync(1100);
      expect(MockWebSocket.instances.length).toBeGreaterThan(instanceCount);

      // lastError should remain null (no error for service restart)
      expect(client.lastError).toBeNull();

      client.disconnect();
    });

    it("resets reconnect attempt counter on 1012 (uses base delay)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const ws = await completeHandshake(client);

      // Simulate a few failed reconnects to bump the counter
      ws.simulateClose();
      await vi.advanceTimersByTimeAsync(1100);

      // @ts-expect-error private access
      const ws2 = client.ws as MockWebSocket;
      ws2.simulateClose();
      await vi.advanceTimersByTimeAsync(2100);

      // @ts-expect-error private access
      expect(client.reconnectAttempt).toBeGreaterThan(1);

      // Now simulate 1012
      // @ts-expect-error private access
      const ws3 = client.ws as MockWebSocket;
      const instancesBefore = MockWebSocket.instances.length;
      ws3.simulateClose(1012, "Service Restart");

      // scheduleReconnect increments to 1 from reset 0, but uses base delay (1000ms)
      // @ts-expect-error private access
      expect(client.reconnectAttempt).toBe(1); // 0 reset + 1 from schedule

      // Verify it reconnects at the base delay (1000ms), not the elevated delay
      await vi.advanceTimersByTimeAsync(1100);
      expect(MockWebSocket.instances.length).toBeGreaterThan(instancesBefore);

      client.disconnect();
    });
  });

  // ─── 5. hello-ok snapshot expanded fields ─────────────────

  describe("hello-ok snapshot expanded fields", () => {
    it("stores presence, health, stateVersion from snapshot", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
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
        JSON.stringify({
          type: "res",
          id: connectReq.id,
          ok: true,
          payload: {
            type: "hello-ok",
            protocol: 3,
            server: { version: "2.0.0", commit: "abc123" },
            features: { methods: ["chat.send"], events: ["agent"] },
            snapshot: {
              presence: [
                { host: "device-1", mode: "ui", ts: 1000 },
                { host: "device-2", mode: "cli", ts: 2000 },
              ],
              health: { agents: { running: 1, total: 3 } },
              stateVersion: { presence: 5, health: 3 },
              uptimeMs: 360000,
              authMode: "token",
              sessionDefaults: { mainSessionKey: "key-1" },
            },
            canvasHostUrl: "https://canvas.test",
            updateAvailable: { version: "2.1.0", url: "https://update.test" },
            policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 15000 },
          },
        }),
      );

      expect(client.getState()).toBe("connected");
      expect(client.serverVersion).toBe("2.0.0");
      expect(client.serverCommit).toBe("abc123");
      expect(client.mainSessionKey).toBe("key-1");
      expect(client.canvasHostUrl).toBe("https://canvas.test");

      // Expanded fields
      expect(client.snapshotPresence).toEqual([
        { host: "device-1", mode: "ui", ts: 1000 },
        { host: "device-2", mode: "cli", ts: 2000 },
      ]);
      expect(client.snapshotHealth).toEqual({ agents: { running: 1, total: 3 } });
      expect(client.snapshotStateVersion).toEqual({ presence: 5, health: 3 });
      expect(client.updateAvailable).toEqual({ version: "2.1.0", url: "https://update.test" });

      client.disconnect();
    });

    it("defaults expanded fields to empty/null when not present", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      // HELLO_OK_PAYLOAD has empty presence/health={}
      expect(client.snapshotPresence).toEqual([]);
      expect(client.snapshotHealth).toEqual({});
      expect(client.snapshotStateVersion).toEqual({ presence: 0, health: 0 });
      expect(client.updateAvailable).toBeNull();

      client.disconnect();
    });
  });
});
