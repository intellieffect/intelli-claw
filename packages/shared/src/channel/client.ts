/**
 * ChannelClient — HTTP + WebSocket client for intelli-claw-channel plugin.
 *
 * Replaces the OpenClaw Gateway WebSocket client. All traffic goes to the
 * local plugin's loopback HTTP/WS server (default http://127.0.0.1:8790).
 */

import {
  parseChannelWire,
  type ChannelConfig,
  type ChannelInfo,
  type ChannelWire,
  type ConnectionState,
  type SendPayload,
  type UploadPayload,
} from "./protocol";

export type MessageHandler = (w: ChannelWire) => void;
export type StateHandler = (s: ConnectionState, error?: Error | null) => void;

const RECONNECT_MS = 2_000;
const PING_INTERVAL_MS = 30_000;

export class ChannelClient {
  private config: ChannelConfig;
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private lastError: Error | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private stateHandlers = new Set<StateHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;

  constructor(config: ChannelConfig) {
    this.config = { ...config };
  }

  getState(): ConnectionState {
    return this.state;
  }

  getConfig(): ChannelConfig {
    return { ...this.config };
  }

  updateConfig(next: ChannelConfig): void {
    this.config = { ...next };
    if (this.ws) {
      this.intentionalClose = false;
      this.ws.close();
    }
    this.connect();
  }

  onMessage(h: MessageHandler): () => void {
    this.messageHandlers.add(h);
    return () => this.messageHandlers.delete(h);
  }

  onStateChange(h: StateHandler): () => void {
    this.stateHandlers.add(h);
    return () => this.stateHandlers.delete(h);
  }

  connect(): void {
    if (this.ws && (this.state === "connecting" || this.state === "connected")) return;
    this.intentionalClose = false;
    this.setState("connecting");
    try {
      this.ws = new WebSocket(this.wsUrl());
      this.ws.onopen = () => {
        this.setState("connected");
        this.startPing();
      };
      this.ws.onmessage = (e) => {
        const data = typeof e.data === "string" ? e.data : String(e.data ?? "");
        const frame = parseChannelWire(data);
        if (!frame) return;
        for (const h of this.messageHandlers) h(frame);
      };
      this.ws.onerror = () => {
        this.lastError = new Error("websocket error");
      };
      this.ws.onclose = () => {
        this.stopPing();
        this.ws = null;
        if (this.intentionalClose) {
          this.setState("disconnected");
          return;
        }
        this.setState("disconnected", this.lastError);
        this.scheduleReconnect();
      };
    } catch (err) {
      this.lastError = err instanceof Error ? err : new Error(String(err));
      this.setState("error", this.lastError);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    this.stopPing();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.setState("disconnected");
  }

  async fetchInfo(): Promise<ChannelInfo> {
    const res = await fetch(new URL("/config", this.config.url), {
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new Error(`channel /config ${res.status}`);
    return (await res.json()) as ChannelInfo;
  }

  async send(payload: SendPayload): Promise<void> {
    const res = await fetch(new URL("/send", this.config.url), {
      method: "POST",
      headers: { "content-type": "application/json", ...this.authHeaders() },
      body: JSON.stringify({
        id: payload.id,
        text: payload.text,
        session_id: payload.sessionId,
      }),
    });
    if (!res.ok) throw new Error(`channel /send ${res.status}`);
  }

  async upload(payload: UploadPayload): Promise<void> {
    const form = new FormData();
    form.set("id", payload.id);
    form.set("text", payload.text);
    if (payload.sessionId) form.set("session_id", payload.sessionId);
    form.set("file", payload.file);
    const res = await fetch(new URL("/upload", this.config.url), {
      method: "POST",
      headers: this.authHeaders(),
      body: form,
    });
    if (!res.ok) throw new Error(`channel /upload ${res.status}`);
  }

  // --- Internals ---

  private wsUrl(): string {
    const base = new URL(this.config.url);
    const scheme = base.protocol === "https:" ? "wss:" : "ws:";
    return `${scheme}//${base.host}/ws`;
  }

  private authHeaders(): Record<string, string> {
    return this.config.token ? { authorization: `Bearer ${this.config.token}` } : {};
  }

  private setState(next: ConnectionState, error: Error | null = null): void {
    if (this.state === next && error === null) return;
    this.state = next;
    if (error) this.lastError = error;
    for (const h of this.stateHandlers) h(next, error);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.intentionalClose) this.connect();
    }, RECONNECT_MS);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: "ping" }));
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
