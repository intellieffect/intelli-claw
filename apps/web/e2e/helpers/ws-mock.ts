/**
 * WebSocket mock helpers for Playwright e2e tests.
 *
 * Instead of connecting to a real gateway, we intercept WebSocket connections
 * and simulate gateway protocol responses using Playwright's route API.
 */
import type { Page, Route } from "@playwright/test";

export interface MockGatewayOptions {
  /** Default agent ID */
  agentId?: string;
  /** Predefined chat history messages */
  historyMessages?: MockChatMessage[];
  /** Sessions to return from sessions.list */
  sessions?: MockSession[];
}

export interface MockChatMessage {
  role: "user" | "assistant" | "system";
  content: string | Array<Record<string, unknown>>;
  timestamp?: string;
  toolCalls?: Array<{ callId: string; name: string; status: string }>;
  attachments?: Array<Record<string, unknown>>;
}

export interface MockSession {
  key: string;
  label?: string;
  agentId?: string;
  sessionId?: string;
  updatedAt?: number;
  model?: string;
  totalTokens?: number;
}

/**
 * Set up a mock gateway that intercepts WebSocket connections.
 * Uses page.evaluate to inject a mock WebSocket server into the browser context.
 */
export async function setupMockGateway(page: Page, options: MockGatewayOptions = {}) {
  const { historyMessages = [], sessions = [], agentId = "default" } = options;

  // Inject mock before the page loads
  await page.addInitScript({
    content: `
      window.__mockGatewayMessages = ${JSON.stringify(historyMessages)};
      window.__mockGatewaySessions = ${JSON.stringify(sessions)};
      window.__mockGatewayAgentId = ${JSON.stringify(agentId)};
      window.__mockGatewayEventQueue = [];
      window.__mockGatewayWs = null;

      // Override WebSocket
      const OriginalWebSocket = window.WebSocket;
      window.WebSocket = class MockWebSocket extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;

        readyState = MockWebSocket.CONNECTING;
        url;
        protocol = '';
        extensions = '';
        bufferedAmount = 0;
        binaryType = 'blob';
        onopen = null;
        onmessage = null;
        onclose = null;
        onerror = null;

        constructor(url, protocols) {
          super();
          this.url = url;
          window.__mockGatewayWs = this;

          // Simulate connection
          setTimeout(() => {
            this.readyState = MockWebSocket.OPEN;
            const evt = new Event('open');
            this.onopen?.(evt);
            this.dispatchEvent(evt);

            // Send connect.challenge
            this._deliver({
              type: 'event',
              event: 'connect.challenge',
              payload: { nonce: 'test-nonce-123' }
            });
          }, 50);
        }

        send(data) {
          try {
            const frame = JSON.parse(data);
            this._handleFrame(frame);
          } catch {}
        }

        close() {
          this.readyState = MockWebSocket.CLOSED;
          const evt = new CloseEvent('close', { code: 1000, reason: 'Normal' });
          this.onclose?.(evt);
          this.dispatchEvent(evt);
        }

        _deliver(frame) {
          const data = JSON.stringify(frame);
          const evt = new MessageEvent('message', { data });
          this.onmessage?.(evt);
          this.dispatchEvent(evt);
        }

        _handleFrame(frame) {
          if (frame.type !== 'req') return;

          // Connect handshake
          if (frame.method === 'connect') {
            this._deliver({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: {
                type: 'hello-ok',
                protocol: 3,
                server: { version: '1.0.0-test', commit: 'abc1234', connId: 'test-conn' },
                features: { methods: ['chat.send', 'chat.history', 'sessions.list', 'agents.list'], events: ['agent'] },
                snapshot: {
                  presence: [],
                  health: {},
                  stateVersion: { presence: 1, health: 1 },
                  uptimeMs: 1000,
                  sessionDefaults: {
                    defaultAgentId: window.__mockGatewayAgentId,
                    mainKey: 'agent:' + window.__mockGatewayAgentId + ':main',
                    mainSessionKey: 'agent:' + window.__mockGatewayAgentId + ':main',
                  }
                },
                policy: { maxPayload: 1048576, maxBufferedBytes: 10485760, tickIntervalMs: 30000 }
              }
            });
            return;
          }

          // Chat history
          if (frame.method === 'chat.history') {
            this._deliver({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: { messages: window.__mockGatewayMessages }
            });
            return;
          }

          // Sessions list
          if (frame.method === 'sessions.list') {
            this._deliver({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: { sessions: window.__mockGatewaySessions }
            });
            return;
          }

          // Agents list
          if (frame.method === 'agents.list') {
            this._deliver({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: {
                agents: [
                  { id: window.__mockGatewayAgentId, name: 'Test Agent', model: 'test-model' }
                ]
              }
            });
            return;
          }

          // Sessions patch — update mock session state
          if (frame.method === 'sessions.patch') {
            const params = frame.params || {};
            const sessions = window.__mockGatewaySessions;
            const idx = sessions.findIndex(s => s.key === params.key);
            if (idx >= 0) {
              if (params.label !== undefined) sessions[idx].label = params.label;
              if (params.model !== undefined) sessions[idx].model = params.model;
            }
            this._deliver({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: {}
            });
            return;
          }

          // Chat send
          if (frame.method === 'chat.send') {
            this._deliver({
              type: 'res',
              id: frame.id,
              ok: true,
              payload: {}
            });

            // Queue any pending events
            const events = window.__mockGatewayEventQueue.splice(0);
            let seq = 0;
            for (const evt of events) {
              setTimeout(() => {
                this._deliver({
                  type: 'event',
                  event: 'agent',
                  seq: seq++,
                  payload: {
                    sessionKey: frame.params?.sessionKey,
                    ...evt
                  }
                });
              }, evt._delay || (seq * 50));
            }
            return;
          }

          // Default: ok response
          this._deliver({
            type: 'res',
            id: frame.id,
            ok: true,
            payload: {}
          });
        }
      };
    `,
  });
}

/**
 * Queue agent events to be sent after the next chat.send.
 * Call this BEFORE the user sends a message.
 */
export async function queueAgentResponse(page: Page, text: string, options?: { delay?: number }) {
  await page.evaluate(
    ({ text, delay }) => {
      const events = [
        { stream: "lifecycle", data: { phase: "start" }, runId: "run-" + Date.now(), _delay: delay || 0 },
        { stream: "assistant", data: { delta: text }, runId: "run-" + Date.now(), _delay: (delay || 0) + 50 },
        { stream: "lifecycle", data: { phase: "end" }, runId: "run-" + Date.now(), _delay: (delay || 0) + 100 },
      ];
      (window as any).__mockGatewayEventQueue.push(...events);
    },
    { text, delay: options?.delay || 0 }
  );
}

/**
 * Queue multiple separate agent messages (each with its own lifecycle).
 */
export async function queueMultipleAgentMessages(page: Page, messages: string[]) {
  await page.evaluate(
    (msgs) => {
      let offset = 0;
      for (const text of msgs) {
        const runId = "run-" + Date.now() + "-" + offset;
        (window as any).__mockGatewayEventQueue.push(
          { stream: "lifecycle", data: { phase: "start" }, runId, _delay: offset },
          { stream: "assistant", data: { delta: text }, runId, _delay: offset + 50 },
          { stream: "lifecycle", data: { phase: "end" }, runId, _delay: offset + 100 },
        );
        offset += 200;
      }
    },
    messages
  );
}

/**
 * Send an agent event directly (e.g., for simulating messages from other surfaces).
 */
export async function sendAgentEvent(page: Page, event: Record<string, unknown>) {
  await page.evaluate((evt) => {
    const ws = (window as any).__mockGatewayWs;
    if (ws) {
      ws._deliver({
        type: "event",
        event: "agent",
        seq: Date.now(),
        payload: evt,
      });
    }
  }, event);
}

/**
 * Update mock history messages (useful for testing reload behavior).
 */
export async function updateMockHistory(page: Page, messages: MockChatMessage[]) {
  await page.evaluate((msgs) => {
    (window as any).__mockGatewayMessages = msgs;
  }, messages);
}
