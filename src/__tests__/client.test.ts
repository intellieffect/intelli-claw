import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayClient } from "@/lib/gateway/client";

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1;
  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(public url: string) {
    // Auto-trigger onopen
    setTimeout(() => this.onopen?.(), 0);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.onclose?.();
  }

  // Test helpers
  simulateMessage(data: string) {
    this.onmessage?.({ data });
  }

  simulateClose() {
    this.onclose?.();
  }
}

describe("GatewayClient", () => {
  let originalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error mock
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("starts in disconnected state", () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    expect(client.getState()).toBe("disconnected");
  });

  it("transitions to connecting then authenticating on connect", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));

    client.connect();

    // Wait for onopen to fire
    await new Promise((r) => setTimeout(r, 10));
    expect(states).toContain("connecting");
    expect(states).toContain("authenticating");
  });

  it("sends connect frame on challenge event", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    client.connect();

    await new Promise((r) => setTimeout(r, 10));

    // Get the underlying mock WS
    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    // Simulate connect.challenge
    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "abc123" },
    }));

    // Should have sent a connect request
    expect(ws.sent.length).toBe(1);
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.type).toBe("req");
    expect(sent.method).toBe("connect");
    expect(sent.params.auth.token).toBe("test-token");
    expect(sent.params.client.id).toBe("openclaw-control-ui");
  });

  it("transitions to connected on hello-ok response", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));
    client.connect();

    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    // Simulate challenge
    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "abc" },
    }));

    // Get the connect request id
    const connectReq = JSON.parse(ws.sent[0]);

    // Simulate hello-ok response (spec-aligned: includes server, features, snapshot, policy)
    ws.simulateMessage(JSON.stringify({
      type: "res",
      id: connectReq.id,
      ok: true,
      payload: {
        type: "hello-ok",
        protocol: 3,
        server: { version: "1.5.0", connId: "conn-001" },
        features: { methods: ["chat.send"], events: ["agent"] },
        snapshot: {
          presence: [],
          health: {},
          stateVersion: { presence: 1, health: 1 },
          uptimeMs: 1000,
          sessionDefaults: {
            defaultAgentId: "alpha",
            mainKey: "agent:alpha:main",
            mainSessionKey: "agent:alpha:main",
          },
        },
        policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 15000 },
      },
    }));

    expect(states).toContain("connected");
    expect(client.mainSessionKey).toBe("agent:alpha:main");
  });

  it("resolves request promises on ok response", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    // Complete handshake (spec-aligned hello-ok)
    ws.simulateMessage(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n1", ts: Date.now() } }));
    const connectReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "res", id: connectReq.id, ok: true,
      payload: {
        type: "hello-ok", protocol: 3,
        server: { version: "1.0.0", connId: "c1" },
        features: { methods: [], events: [] },
        snapshot: { presence: [], health: {}, stateVersion: { presence: 0, health: 0 }, uptimeMs: 0 },
        policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 15000 },
      },
    }));

    // Now make a request
    const promise = client.request("chat.history", { sessionKey: "test" });

    // Find the request
    const histReq = JSON.parse(ws.sent[1]);
    expect(histReq.method).toBe("chat.history");

    // Simulate response
    ws.simulateMessage(JSON.stringify({
      type: "res", id: histReq.id, ok: true,
      payload: { messages: [{ role: "user", content: "hi" }] },
    }));

    const result = await promise;
    expect(result).toEqual({ messages: [{ role: "user", content: "hi" }] });
  });

  it("rejects request promises on error response", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    // Complete handshake (spec-aligned hello-ok)
    ws.simulateMessage(JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "n2", ts: Date.now() } }));
    const connectReq = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "res", id: connectReq.id, ok: true,
      payload: {
        type: "hello-ok", protocol: 3,
        server: { version: "1.0.0", connId: "c2" },
        features: { methods: [], events: [] },
        snapshot: { presence: [], health: {}, stateVersion: { presence: 0, health: 0 }, uptimeMs: 0 },
        policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 15000 },
      },
    }));

    const promise = client.request("bad.method");
    const req = JSON.parse(ws.sent[1]);

    ws.simulateMessage(JSON.stringify({
      type: "res", id: req.id, ok: false,
      error: { code: "NOT_FOUND", message: "method not found", retryable: false },
    }));

    await expect(promise).rejects.toThrow("method not found");
  });

  it("forwards events to handlers", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    const events: unknown[] = [];
    client.onEvent((e) => events.push(e));
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    // Simulate an agent event (not connect.challenge)
    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "agent",
      payload: { stream: "assistant", data: { delta: "hi" } },
    }));

    expect(events.length).toBe(1);
    expect((events[0] as { event: string }).event).toBe("agent");
  });

  it("cleans up on disconnect", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    client.disconnect();
    expect(client.getState()).toBe("disconnected");
  });
});
