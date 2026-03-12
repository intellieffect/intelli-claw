/**
 * Gateway Client Stability Tests
 * Covers #226 (listener dedup), #227 (sequence gap detection), #228 (non-recoverable auth errors)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayClient } from "@/lib/gateway/client";
import type { EventFrame } from "@intelli-claw/shared/gateway/protocol";

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

describe("Gateway Client Stability", () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let originalMathRandom: typeof Math.random;
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let removeEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let docAddSpy: ReturnType<typeof vi.spyOn>;
  let docRemoveSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error mock
    globalThis.WebSocket = MockWebSocket;
    originalMathRandom = Math.random;
    Math.random = () => 0;

    // Spy on window/document event listeners
    addEventListenerSpy = vi.spyOn(window, "addEventListener");
    removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
    docAddSpy = vi.spyOn(document, "addEventListener");
    docRemoveSpy = vi.spyOn(document, "removeEventListener");
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.WebSocket = originalWebSocket;
    Math.random = originalMathRandom;
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
    docAddSpy.mockRestore();
    docRemoveSpy.mockRestore();
  });

  // ─── #226: Event Listener Deduplication ─────────────────────

  describe("#226: event listener deduplication", () => {
    it("registers 'online' listener only once across connect calls", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      // Count how many times "online" was added
      const onlineCalls = addEventListenerSpy.mock.calls.filter(
        ([event]) => event === "online",
      );

      // Should have exactly 1 "online" listener (not 2 from setupNetworkListeners + addBrowserListeners)
      expect(onlineCalls.length).toBe(1);
    });

    it("registers 'visibilitychange' listener only once across connect calls", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      const visibilityCalls = docAddSpy.mock.calls.filter(
        ([event]) => event === "visibilitychange",
      );

      expect(visibilityCalls.length).toBe(1);
    });

    it("properly removes all listeners on disconnect", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      client.disconnect();

      // "online" should have been removed
      const onlineRemoves = removeEventListenerSpy.mock.calls.filter(
        ([event]) => event === "online",
      );
      expect(onlineRemoves.length).toBeGreaterThanOrEqual(1);

      // "visibilitychange" should have been removed
      const visibilityRemoves = docRemoveSpy.mock.calls.filter(
        ([event]) => event === "visibilitychange",
      );
      expect(visibilityRemoves.length).toBeGreaterThanOrEqual(1);
    });

    it("uses the same handler reference for add/remove (proper cleanup)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      await completeHandshake(client);

      // Get the handler references that were added
      const onlineAddCalls = addEventListenerSpy.mock.calls.filter(
        ([event]) => event === "online",
      );
      const addedHandler = onlineAddCalls[0]?.[1];
      expect(addedHandler).toBeDefined();

      client.disconnect();

      // The removed handler should be the same reference
      const onlineRemoveCalls = removeEventListenerSpy.mock.calls.filter(
        ([event]) => event === "online",
      );
      const removedHandler = onlineRemoveCalls[0]?.[1];
      expect(removedHandler).toBe(addedHandler);
    });

    it("does not register new listeners on reconnect (reuses existing)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const ws = await completeHandshake(client);

      const onlineCountBefore = addEventListenerSpy.mock.calls.filter(
        ([event]) => event === "online",
      ).length;

      // Simulate unintentional close and reconnect
      ws.simulateClose();
      await vi.advanceTimersByTimeAsync(1002);

      const onlineCountAfter = addEventListenerSpy.mock.calls.filter(
        ([event]) => event === "online",
      ).length;

      // Should not have added more "online" listeners
      expect(onlineCountAfter).toBe(onlineCountBefore);
    });
  });

  // ─── #227: Sequence Gap Detection ──────────────────────────

  describe("#227: sequence gap detection", () => {
    it("detects gap when seq jumps (e.g. 1 -> 3)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const events: EventFrame[] = [];
      client.onEvent((e) => events.push(e));
      const ws = await completeHandshake(client);

      // Send event with seq 1
      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: { delta: "a" }, seq: 1 }),
      );

      // Send event with seq 3 (gap: seq 2 is missing)
      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: { delta: "b" }, seq: 3 }),
      );

      // Should have emitted a client.sequence_gap synthetic event
      const gapEvent = events.find((e) => e.event === "client.sequence_gap");
      expect(gapEvent).toBeDefined();
      expect(gapEvent!.payload).toEqual(
        expect.objectContaining({ expected: 2, received: 3 }),
      );
    });

    it("does not emit gap event for sequential events (1, 2, 3)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const events: EventFrame[] = [];
      client.onEvent((e) => events.push(e));
      const ws = await completeHandshake(client);

      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {}, seq: 1 }),
      );
      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {}, seq: 2 }),
      );
      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {}, seq: 3 }),
      );

      const gapEvents = events.filter((e) => e.event === "client.sequence_gap");
      expect(gapEvents.length).toBe(0);
    });

    it("ignores events without seq field (no gap tracking)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const events: EventFrame[] = [];
      client.onEvent((e) => events.push(e));
      const ws = await completeHandshake(client);

      // Event without seq
      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {} }),
      );

      // Event with seq 5 — no gap because lastSeq was never set
      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {}, seq: 5 }),
      );

      const gapEvents = events.filter((e) => e.event === "client.sequence_gap");
      expect(gapEvents.length).toBe(0);
    });

    it("resets lastSeq on new connection", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const events: EventFrame[] = [];
      client.onEvent((e) => events.push(e));
      const ws = await completeHandshake(client);

      // Set lastSeq to 5
      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {}, seq: 5 }),
      );

      // Simulate close and reconnect
      ws.simulateClose();
      await vi.advanceTimersByTimeAsync(1002);

      // Complete handshake on new connection
      // @ts-expect-error private access
      const ws2 = client.ws as MockWebSocket;
      ws2.simulateMessage(
        JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n2" } }),
      );
      await vi.advanceTimersByTimeAsync(1);
      const req = JSON.parse(ws2.sent[0]);
      ws2.simulateMessage(
        JSON.stringify({ type: "res", id: req.id, ok: true, payload: HELLO_OK_PAYLOAD }),
      );

      // Now send event with seq 1 — should NOT detect gap (lastSeq was reset)
      ws2.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {}, seq: 1 }),
      );

      const gapEvents = events.filter((e) => e.event === "client.sequence_gap");
      expect(gapEvents.length).toBe(0);
    });

    it("detects multiple gaps in sequence", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const events: EventFrame[] = [];
      client.onEvent((e) => events.push(e));
      const ws = await completeHandshake(client);

      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {}, seq: 1 }),
      );
      // Gap: 2 missing
      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {}, seq: 3 }),
      );
      // Gap: 4, 5 missing
      ws.simulateMessage(
        JSON.stringify({ type: "event", event: "agent", payload: {}, seq: 6 }),
      );

      const gapEvents = events.filter((e) => e.event === "client.sequence_gap");
      expect(gapEvents.length).toBe(2);
      expect((gapEvents[0].payload as any).expected).toBe(2);
      expect((gapEvents[0].payload as any).received).toBe(3);
      expect((gapEvents[1].payload as any).expected).toBe(4);
      expect((gapEvents[1].payload as any).received).toBe(6);
    });
  });

  // ─── #228: Non-Recoverable Auth Error Classification ───────

  describe("#228: non-recoverable auth error classification", () => {
    const NON_RECOVERABLE_CODES = [
      "AUTH_TOKEN_MISSING",
      "AUTH_TOKEN_MISMATCH",
      "AUTH_PASSWORD_MISSING",
      "AUTH_PASSWORD_MISMATCH",
      "AUTH_RATE_LIMITED",
      "PAIRING_REQUIRED",
      "DEVICE_IDENTITY_REQUIRED",
    ];

    it("does not schedule reconnect for non-recoverable auth errors", async () => {
      for (const code of NON_RECOVERABLE_CODES) {
        const client = new GatewayClient("ws://localhost:18789", "tok");
        client.connect();
        await vi.advanceTimersByTimeAsync(1);

        // @ts-expect-error private access
        const ws = client.ws as MockWebSocket;

        // Simulate connect.challenge
        ws.simulateMessage(
          JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n1" } }),
        );
        await vi.advanceTimersByTimeAsync(1);

        // Simulate auth error response to connect request
        const connectReq = JSON.parse(ws.sent[0]);
        ws.simulateMessage(
          JSON.stringify({
            type: "res",
            id: connectReq.id,
            ok: false,
            error: {
              code: "AUTH_FAILED",
              message: `Authentication failed: ${code}`,
              details: { code },
            },
          }),
        );

        // The auth error should cause ws close which calls handleClose
        // Simulate ws closing after auth failure
        ws.simulateClose();

        expect(client.getState()).toBe("disconnected");

        // Wait long enough for any reconnect to fire
        await vi.advanceTimersByTimeAsync(65_000);

        // Should still be disconnected — no reconnect attempt
        expect(client.getState()).toBe("disconnected");

        // Cleanup
        client.disconnect();
      }
    });

    it("schedules reconnect for recoverable errors (non-auth)", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const ws = await completeHandshake(client);

      // Simulate normal connection close (no auth error)
      ws.simulateClose();
      expect(client.getState()).toBe("disconnected");

      // After reconnect delay, should attempt reconnect
      await vi.advanceTimersByTimeAsync(1002);
      expect(client.getState()).toBe("authenticating");

      client.disconnect();
    });

    it("sets user-friendly error message for non-recoverable auth errors", async () => {
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
          ok: false,
          error: {
            code: "AUTH_FAILED",
            message: "Token missing",
            details: { code: "AUTH_TOKEN_MISSING" },
          },
        }),
      );

      ws.simulateClose();

      // lastError should be set with details
      expect(client.lastError).toBeDefined();
      expect(client.lastError!.code).toBe("AUTH_FAILED");

      client.disconnect();
    });

    it("emits client.auth_failed event for non-recoverable auth errors", async () => {
      const client = new GatewayClient("ws://localhost:18789", "tok");
      const events: EventFrame[] = [];
      client.onEvent((e) => events.push(e));
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
          ok: false,
          error: {
            code: "AUTH_FAILED",
            message: "Token missing",
            details: { code: "AUTH_TOKEN_MISSING" },
          },
        }),
      );

      ws.simulateClose();

      const authFailedEvent = events.find((e) => e.event === "client.auth_failed");
      expect(authFailedEvent).toBeDefined();
      expect((authFailedEvent!.payload as any).detailCode).toBe("AUTH_TOKEN_MISSING");

      client.disconnect();
    });
  });
});
