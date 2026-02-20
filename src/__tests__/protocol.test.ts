import { describe, it, expect } from "vitest";
import { makeReq, parseFrame } from "@/lib/gateway/protocol";
import type {
  ReqFrame, ResFrame, EventFrame, ErrorShape, ConnectParams,
  HelloOkPayload, GatewayAgentEvent, ChatSendParams, ChatHistoryParams,
  ChatEvent, StateVersion,
} from "@/lib/gateway/protocol";

describe("protocol", () => {
  describe("makeReq", () => {
    it("creates a request frame with type, id, method", () => {
      const frame = makeReq("chat.send", { message: "hello" });
      expect(frame.type).toBe("req");
      expect(frame.id).toBeTruthy();
      expect(frame.method).toBe("chat.send");
      expect(frame.params).toEqual({ message: "hello" });
    });

    it("generates unique ids", () => {
      const a = makeReq("test");
      const b = makeReq("test");
      expect(a.id).not.toBe(b.id);
    });

    it("works without params", () => {
      const frame = makeReq("health");
      expect(frame.params).toBeUndefined();
    });
  });

  describe("parseFrame", () => {
    it("parses a valid request frame", () => {
      const frame = parseFrame('{"type":"req","id":"1","method":"test"}');
      expect(frame).toEqual({ type: "req", id: "1", method: "test" });
    });

    it("parses a valid response frame", () => {
      const frame = parseFrame('{"type":"res","id":"1","ok":true,"payload":{"key":"val"}}');
      expect(frame?.type).toBe("res");
    });

    it("parses a valid event frame", () => {
      const frame = parseFrame('{"type":"event","event":"agent","payload":{"stream":"assistant"}}');
      expect(frame?.type).toBe("event");
    });

    it("returns null for invalid JSON", () => {
      expect(parseFrame("not json")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parseFrame("")).toBeNull();
    });
  });

  // --- Protocol v3 spec-aligned type tests ---

  describe("frame structures (Protocol v3)", () => {
    it("ReqFrame matches spec: {type:'req', id, method, params?}", () => {
      const frame: ReqFrame = { type: "req", id: "abc-123", method: "chat.send", params: { sessionKey: "s" } };
      expect(frame.type).toBe("req");
      expect(frame.id).toBeDefined();
      expect(frame.method).toBeDefined();
    });

    it("ResFrame success matches spec: {type:'res', id, ok:true, payload}", () => {
      const frame: ResFrame = { type: "res", id: "abc-123", ok: true, payload: { type: "hello-ok" } };
      expect(frame.ok).toBe(true);
      expect(frame.error).toBeUndefined();
    });

    it("ResFrame error matches spec: {type:'res', id, ok:false, error:{code,message,...}}", () => {
      const err: ErrorShape = {
        code: "PROTOCOL_MISMATCH",
        message: "Unsupported protocol version",
        retryable: false,
      };
      const frame: ResFrame = { type: "res", id: "abc-123", ok: false, error: err };
      expect(frame.ok).toBe(false);
      expect(frame.error?.code).toBe("PROTOCOL_MISMATCH");
      expect(frame.error?.message).toBe("Unsupported protocol version");
      expect(frame.error?.retryable).toBe(false);
    });

    it("ErrorShape supports retryAfterMs", () => {
      const err: ErrorShape = {
        code: "RATE_LIMITED",
        message: "Too many requests",
        retryable: true,
        retryAfterMs: 5000,
      };
      expect(err.retryAfterMs).toBe(5000);
    });

    it("EventFrame matches spec: {type:'event', event, payload?, seq?, stateVersion?}", () => {
      const sv: StateVersion = { presence: 42, health: 7 };
      const frame: EventFrame = {
        type: "event",
        event: "system.presence",
        payload: { entries: [] },
        seq: 100,
        stateVersion: sv,
      };
      expect(frame.seq).toBe(100);
      expect(frame.stateVersion?.presence).toBe(42);
      expect(frame.stateVersion?.health).toBe(7);
    });
  });

  describe("connect handshake (Protocol v3)", () => {
    it("ConnectParams has correct structure for webchat-ui client", () => {
      const params: ConnectParams = {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openclaw-control-ui",
          version: "1.0.0",
          platform: "web",
          mode: "ui",
        },
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        auth: { token: "my-token" },
      };
      expect(params.minProtocol).toBe(3);
      expect(params.maxProtocol).toBe(3);
      expect(params.client.id).toBe("openclaw-control-ui");
      expect(params.client.mode).toBe("ui");
      expect(params.auth?.token).toBe("my-token");
    });

    it("ConnectParams supports node role with caps/commands/permissions", () => {
      const params: ConnectParams = {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openclaw-ios",
          version: "1.2.3",
          platform: "ios",
          mode: "node",
        },
        role: "node",
        scopes: [],
        caps: ["camera", "canvas", "screen", "location", "voice"],
        commands: ["camera.snap", "canvas.navigate", "screen.record", "location.get"],
        permissions: { "camera.capture": true, "screen.record": false },
        auth: { token: "node-token" },
        device: {
          id: "device_fingerprint",
          publicKey: "pk_abc",
          signature: "sig_xyz",
          signedAt: 1737264000000,
          nonce: "challenge-nonce",
        },
      };
      expect(params.role).toBe("node");
      expect(params.caps).toContain("camera");
      expect(params.commands).toContain("camera.snap");
      expect(params.permissions?.["camera.capture"]).toBe(true);
      expect(params.device?.id).toBe("device_fingerprint");
    });

    it("ConnectParams supports password auth", () => {
      const params: ConnectParams = {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: "openclaw-control-ui", version: "1.0.0", platform: "web", mode: "ui" },
        auth: { password: "my-password" },
      };
      expect(params.auth?.password).toBe("my-password");
      expect(params.auth?.token).toBeUndefined();
    });

    it("HelloOkPayload has full structure with server, features, snapshot, policy", () => {
      const payload: HelloOkPayload = {
        type: "hello-ok",
        protocol: 3,
        server: { version: "1.5.0", commit: "abc123f", connId: "conn-001" },
        features: {
          methods: ["chat.send", "chat.history", "chat.abort", "sessions.list", "agents.list"],
          events: ["agent", "tick", "system.presence"],
        },
        snapshot: {
          presence: [{ ts: 1737264000000, mode: "ui", deviceId: "dev-1", roles: ["operator"] }],
          health: {},
          stateVersion: { presence: 1, health: 1 },
          uptimeMs: 86400000,
          sessionDefaults: {
            defaultAgentId: "alpha",
            mainKey: "agent:alpha:main",
            mainSessionKey: "agent:alpha:main:thread:123",
          },
          authMode: "token",
        },
        policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 15000 },
      };
      expect(payload.type).toBe("hello-ok");
      expect(payload.protocol).toBe(3);
      expect(payload.server.connId).toBe("conn-001");
      expect(payload.features.methods).toContain("chat.send");
      expect(payload.snapshot.sessionDefaults?.mainSessionKey).toBe("agent:alpha:main:thread:123");
      expect(payload.policy.tickIntervalMs).toBe(15000);
    });

    it("HelloOkPayload supports optional auth with deviceToken", () => {
      const payload: HelloOkPayload = {
        type: "hello-ok",
        protocol: 3,
        server: { version: "1.5.0", connId: "conn-002" },
        features: { methods: [], events: [] },
        snapshot: { presence: [], health: {}, stateVersion: { presence: 0, health: 0 }, uptimeMs: 0 },
        policy: { maxPayload: 1048576, maxBufferedBytes: 4194304, tickIntervalMs: 15000 },
        auth: {
          deviceToken: "dt_abc123",
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          issuedAtMs: 1737264000000,
        },
      };
      expect(payload.auth?.deviceToken).toBe("dt_abc123");
      expect(payload.auth?.role).toBe("operator");
      expect(payload.auth?.scopes).toContain("operator.read");
    });
  });

  describe("agent event payload (Protocol v3)", () => {
    it("GatewayAgentEvent has runId, seq, stream, ts, data", () => {
      const ev: GatewayAgentEvent = {
        runId: "run-abc",
        seq: 5,
        stream: "assistant",
        ts: 1737264000000,
        data: { delta: "Hello" },
      };
      expect(ev.runId).toBe("run-abc");
      expect(ev.seq).toBe(5);
      expect(ev.stream).toBe("assistant");
      expect(ev.ts).toBe(1737264000000);
      expect(ev.data.delta).toBe("Hello");
    });

    it("agent event with tool-start stream", () => {
      const ev: GatewayAgentEvent = {
        runId: "run-abc",
        seq: 10,
        stream: "tool-start",
        ts: 1737264001000,
        data: { toolCallId: "tc-1", name: "web_search", args: '{"query":"test"}' },
      };
      expect(ev.stream).toBe("tool-start");
      expect(ev.data.toolCallId).toBe("tc-1");
    });

    it("agent event with lifecycle stream", () => {
      const ev: GatewayAgentEvent = {
        runId: "run-abc",
        seq: 20,
        stream: "lifecycle",
        ts: 1737264005000,
        data: { phase: "end", endedAt: 1737264005000 },
      };
      expect(ev.stream).toBe("lifecycle");
      expect(ev.data.phase).toBe("end");
    });
  });

  describe("chat.send params (Protocol v3)", () => {
    it("ChatSendParams requires sessionKey, message, idempotencyKey", () => {
      const params: ChatSendParams = {
        sessionKey: "agent:alpha:main:thread:123",
        message: "Hello, how are you?",
        idempotencyKey: "awf-1737264000000-abc123",
      };
      expect(params.sessionKey).toBeDefined();
      expect(params.message).toBeDefined();
      expect(params.idempotencyKey).toBeDefined();
    });

    it("ChatSendParams supports optional thinking, deliver, attachments, timeoutMs", () => {
      const params: ChatSendParams = {
        sessionKey: "agent:alpha:main",
        message: "Think hard about this",
        idempotencyKey: "key-1",
        thinking: "high",
        deliver: true,
        attachments: [{ type: "image", url: "https://example.com/img.png" }],
        timeoutMs: 60000,
      };
      expect(params.thinking).toBe("high");
      expect(params.deliver).toBe(true);
      expect(params.attachments).toHaveLength(1);
      expect(params.timeoutMs).toBe(60000);
    });
  });

  describe("chat.history params (Protocol v3)", () => {
    it("ChatHistoryParams requires sessionKey with optional limit", () => {
      const params: ChatHistoryParams = {
        sessionKey: "agent:alpha:main",
        limit: 100,
      };
      expect(params.sessionKey).toBe("agent:alpha:main");
      expect(params.limit).toBe(100);
    });
  });

  describe("chat event (Protocol v3)", () => {
    it("ChatEvent has runId, sessionKey, seq, state", () => {
      const ev: ChatEvent = {
        runId: "run-xyz",
        sessionKey: "agent:alpha:main",
        seq: 1,
        state: "delta",
        message: { role: "assistant", content: [{ type: "text", text: "Hi" }] },
      };
      expect(ev.state).toBe("delta");
      expect(ev.runId).toBe("run-xyz");
    });

    it("ChatEvent supports error state with errorMessage", () => {
      const ev: ChatEvent = {
        runId: "run-xyz",
        sessionKey: "agent:alpha:main",
        seq: 5,
        state: "error",
        errorMessage: "Context limit exceeded",
      };
      expect(ev.state).toBe("error");
      expect(ev.errorMessage).toBe("Context limit exceeded");
    });

    it("ChatEvent supports final state with usage and stopReason", () => {
      const ev: ChatEvent = {
        runId: "run-xyz",
        sessionKey: "agent:alpha:main",
        seq: 10,
        state: "final",
        usage: { inputTokens: 500, outputTokens: 200 },
        stopReason: "end_turn",
      };
      expect(ev.state).toBe("final");
      expect(ev.stopReason).toBe("end_turn");
    });

    it("ChatEvent supports aborted state", () => {
      const ev: ChatEvent = {
        runId: "run-xyz",
        sessionKey: "agent:alpha:main",
        seq: 3,
        state: "aborted",
      };
      expect(ev.state).toBe("aborted");
    });
  });

  describe("lifecycle events (Protocol v3)", () => {
    it("tick event has ts field", () => {
      const frame = parseFrame('{"type":"event","event":"tick","payload":{"ts":1737264000000}}');
      expect(frame?.type).toBe("event");
      const ev = frame as EventFrame;
      expect(ev.event).toBe("tick");
      expect((ev.payload as {ts:number}).ts).toBe(1737264000000);
    });

    it("shutdown event has reason and optional restartExpectedMs", () => {
      const frame = parseFrame('{"type":"event","event":"shutdown","payload":{"reason":"upgrade","restartExpectedMs":5000}}');
      const ev = frame as EventFrame;
      expect(ev.event).toBe("shutdown");
      const p = ev.payload as {reason:string; restartExpectedMs?:number};
      expect(p.reason).toBe("upgrade");
      expect(p.restartExpectedMs).toBe(5000);
    });

    it("connect.challenge event has nonce and ts", () => {
      const frame = parseFrame('{"type":"event","event":"connect.challenge","payload":{"nonce":"abc123","ts":1737264000000}}');
      const ev = frame as EventFrame;
      expect(ev.event).toBe("connect.challenge");
      const p = ev.payload as {nonce:string; ts:number};
      expect(p.nonce).toBe("abc123");
      expect(p.ts).toBe(1737264000000);
    });
  });
});
