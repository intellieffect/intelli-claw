import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayClient } from "@/lib/gateway/client";

// Mock device-identity module
vi.mock("@intelli-claw/shared/gateway/device-identity", () => ({
  signChallenge: vi.fn(async (nonce: string) => ({
    id: "test-device-id",
    publicKey: "dGVzdC1wdWJsaWMta2V5",
    signature: "dGVzdC1zaWduYXR1cmU",
    signedAt: 1700000000000,
    nonce,
  })),
  initCryptoAdapter: vi.fn(),
  getCryptoAdapter: vi.fn(() => null), // No crypto adapter for simpler tests
  clearDeviceIdentity: vi.fn(),
}));

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
}

describe("GatewayClient with options (node role)", () => {
  let originalWebSocket: typeof globalThis.WebSocket;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    // @ts-expect-error mock
    globalThis.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  it("uses default operator options when no options provided", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "" },
    }));

    await new Promise((r) => setTimeout(r, 10));

    const frame = JSON.parse(ws.sent[0]);
    expect(frame.method).toBe("connect");
    expect(frame.params.role).toBe("operator");
    expect(frame.params.client.id).toBe("openclaw-control-ui");
    expect(frame.params.client.mode).toBe("ui");
    expect(frame.params.scopes).toEqual(["operator.read", "operator.write", "operator.admin"]);
    expect(frame.params.caps).toBeUndefined();
    expect(frame.params.commands).toBeUndefined();

    client.disconnect();
  });

  it("uses node options when provided", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token", {
      role: "node",
      clientId: "openclaw-control-ui",
      clientMode: "node",
      caps: ["canvas"],
      commands: ["canvas.present", "canvas.hide"],
    });
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "" },
    }));

    await new Promise((r) => setTimeout(r, 10));

    const frame = JSON.parse(ws.sent[0]);
    expect(frame.params.role).toBe("node");
    expect(frame.params.client.mode).toBe("node");
    expect(frame.params.caps).toEqual(["canvas"]);
    expect(frame.params.commands).toEqual(["canvas.present", "canvas.hide"]);

    client.disconnect();
  });

  it("dispatches node.invoke.request to onInvoke callback", async () => {
    const invokeHandler = vi.fn().mockResolvedValue({ result: "hello" });

    const client = new GatewayClient("ws://localhost:18789", "test-token", {
      role: "node",
      clientMode: "node",
      onInvoke: invokeHandler,
    });
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    // Simulate challenge + hello-ok to reach connected state
    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "" },
    }));
    await new Promise((r) => setTimeout(r, 10));

    const connectFrame = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "res",
      id: connectFrame.id,
      ok: true,
      payload: { type: "hello-ok", server: { version: "1.0", connId: "c1" }, snapshot: {}, features: { methods: [], events: [] }, policy: { maxPayload: 0, maxBufferedBytes: 0, tickIntervalMs: 0 } },
    }));
    await new Promise((r) => setTimeout(r, 10));

    ws.sent = [];

    // Simulate node.invoke.request
    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "node.invoke.request",
      payload: {
        id: "invoke-1",
        command: "canvas.present",
        params: { url: "https://example.com" },
      },
    }));

    await new Promise((r) => setTimeout(r, 10));

    expect(invokeHandler).toHaveBeenCalledWith(
      "invoke-1",
      "canvas.present",
      { url: "https://example.com" },
    );

    // Check that result was sent back
    expect(ws.sent.length).toBe(1);
    const resultFrame = JSON.parse(ws.sent[0]);
    expect(resultFrame.method).toBe("node.invoke.result");
    expect(resultFrame.params.id).toBe("invoke-1");
    expect(resultFrame.params.ok).toBe(true);

    client.disconnect();
  });

  it("sends error result when onInvoke throws", async () => {
    const invokeHandler = vi.fn().mockRejectedValue(new Error("Canvas not available"));

    const client = new GatewayClient("ws://localhost:18789", "test-token", {
      role: "node",
      clientMode: "node",
      onInvoke: invokeHandler,
    });
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "" },
    }));
    await new Promise((r) => setTimeout(r, 10));

    const connectFrame = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "res",
      id: connectFrame.id,
      ok: true,
      payload: { type: "hello-ok", server: { version: "1.0", connId: "c1" }, snapshot: {}, features: { methods: [], events: [] }, policy: { maxPayload: 0, maxBufferedBytes: 0, tickIntervalMs: 0 } },
    }));
    await new Promise((r) => setTimeout(r, 10));

    ws.sent = [];

    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "node.invoke.request",
      payload: { id: "invoke-2", command: "canvas.eval", params: { js: "1+1" } },
    }));

    await new Promise((r) => setTimeout(r, 10));

    const resultFrame = JSON.parse(ws.sent[0]);
    expect(resultFrame.method).toBe("node.invoke.result");
    expect(resultFrame.params.id).toBe("invoke-2");
    expect(resultFrame.params.ok).toBe(false);
    expect(resultFrame.params.error.code).toBe("INVOKE_ERROR");
    expect(resultFrame.params.error.message).toBe("Canvas not available");

    client.disconnect();
  });

  it("stores canvasHostUrl from hello-ok payload", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token", {
      role: "node",
      clientMode: "node",
    });
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "" },
    }));
    await new Promise((r) => setTimeout(r, 10));

    const connectFrame = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "res",
      id: connectFrame.id,
      ok: true,
      payload: {
        type: "hello-ok",
        server: { version: "1.0", connId: "c1" },
        snapshot: {},
        features: { methods: [], events: [] },
        policy: { maxPayload: 0, maxBufferedBytes: 0, tickIntervalMs: 0 },
        canvasHostUrl: "https://canvas.example.com",
      },
    }));
    await new Promise((r) => setTimeout(r, 10));

    expect(client.canvasHostUrl).toBe("https://canvas.example.com");

    client.disconnect();
  });

  it("ignores node.invoke.request when no onInvoke handler", async () => {
    const client = new GatewayClient("ws://localhost:18789", "test-token");
    const eventHandler = vi.fn();
    client.onEvent(eventHandler);
    client.connect();
    await new Promise((r) => setTimeout(r, 10));

    // @ts-expect-error accessing private
    const ws = client.ws as MockWebSocket;

    // Simulate challenge + hello-ok
    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: { nonce: "" },
    }));
    await new Promise((r) => setTimeout(r, 10));

    const connectFrame = JSON.parse(ws.sent[0]);
    ws.simulateMessage(JSON.stringify({
      type: "res",
      id: connectFrame.id,
      ok: true,
      payload: { type: "hello-ok", server: { version: "1.0", connId: "c1" }, snapshot: {}, features: { methods: [], events: [] }, policy: { maxPayload: 0, maxBufferedBytes: 0, tickIntervalMs: 0 } },
    }));
    await new Promise((r) => setTimeout(r, 10));

    ws.sent = [];

    // node.invoke.request without onInvoke → should be passed to generic event handlers
    ws.simulateMessage(JSON.stringify({
      type: "event",
      event: "node.invoke.request",
      payload: { id: "invoke-3", command: "canvas.present" },
    }));
    await new Promise((r) => setTimeout(r, 10));

    // No result sent (no onInvoke handler)
    expect(ws.sent.length).toBe(0);
    // Event was forwarded to generic handlers
    expect(eventHandler).toHaveBeenCalledWith(
      expect.objectContaining({ event: "node.invoke.request" }),
    );

    client.disconnect();
  });
});
