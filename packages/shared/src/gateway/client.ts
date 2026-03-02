import { makeReq, parseFrame, type Frame, type ResFrame, type EventFrame, type ErrorShape } from "./protocol";
import { signChallenge } from "./device-identity";

export type ConnectionState = "disconnected" | "connecting" | "authenticating" | "connected";
type EventHandler = (event: EventFrame) => void;
type StateHandler = (state: ConnectionState, error?: ErrorShape | null) => void;
type PendingReq = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT = 30_000;
const AUTH_TIMEOUT = 10_000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];
const PING_INTERVAL = 25_000;
const PONG_TIMEOUT = 10_000;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private state: ConnectionState = "disconnected";
  private pending = new Map<string, PendingReq>();
  private eventHandlers = new Set<EventHandler>();
  private stateHandlers = new Set<StateHandler>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private wasConnected = false;
  public mainSessionKey = "";
  public serverVersion = "";
  public serverCommit = "";
  public lastError: ErrorShape | null = null;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  // --- Public API ---

  connect(): void {
    if (this.ws && this.state !== "disconnected") return;
    this.intentionalClose = false;
    this.lastError = null;
    this.setState("connecting");

    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (e) => this.handleMessage(e);
      this.ws.onclose = () => this.handleClose();
      this.ws.onerror = () => {}; // onclose will fire
    } catch {
      this.handleClose();
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    this.clearAuthTimer();
    this.stopPing();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.rejectAll("Disconnected");
    this.setState("disconnected");
  }

  async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    if (this.state !== "connected") {
      throw new Error(`Not connected (state: ${this.state})`);
    }
    const frame = makeReq(method, params);
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(frame.id);
        reject(new Error(`Request timeout: ${method}`));
      }, REQUEST_TIMEOUT);

      this.pending.set(frame.id, {
        resolve: resolve as (p: unknown) => void,
        reject,
        timer,
      });
      this.send(frame);
    });
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onStateChange(handler: StateHandler): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  getState(): ConnectionState {
    return this.state;
  }

  getUrl(): string {
    return this.url;
  }

  // --- Private ---

  private send(frame: Frame): void {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private setState(state: ConnectionState, error?: ErrorShape | null): void {
    if (this.state === state && error === undefined) return;
    this.state = state;
    if (error !== undefined) this.lastError = error;
    this.stateHandlers.forEach((h) => h(state, this.lastError));
  }

  private handleOpen(): void {
    this.setState("authenticating");
    this.clearAuthTimer();
    this.authTimer = setTimeout(() => {
      console.warn("[AWF] Auth timeout – closing and reconnecting");
      this.lastError = { code: "auth_timeout", message: "Authentication timed out" };
      this.ws?.close();
    }, AUTH_TIMEOUT);
  }

  private handleMessage(e: MessageEvent): void {
    // Any message from server counts as a pong (connection is alive)
    this.clearPongTimer();

    const raw = typeof e.data === "string" ? e.data : String(e.data ?? "");

    // Handle pong response
    if (raw === '{"type":"pong"}' || raw === '"pong"') return;

    const frame = parseFrame(raw);
    if (!frame) return;

    switch (frame.type) {
      case "event":
        this.handleEvent(frame as EventFrame).catch((err) => console.error("[AWF] handleEvent error:", err));
        break;
      case "res":
        this.handleResponse(frame as ResFrame);
        break;
    }
  }

  private async handleEvent(frame: EventFrame): Promise<void> {
    if (frame.event === "connect.challenge") {
      const nonce = (frame.payload as { nonce: string })?.nonce;
      const device = nonce ? await signChallenge(nonce) : undefined;
      const authFrame = makeReq("connect", {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "openclaw-control-ui",
          version: "1.0.0",
          platform: "web",
          mode: "ui",
        },
        role: "operator",
        scopes: ["operator.read", "operator.write", "operator.admin"],
        auth: { token: this.token },
        device,
      });
      this.send(authFrame);
      return;
    }

    console.log("[AWF] Event:", frame.event, JSON.stringify(frame.payload).slice(0, 200));
    this.eventHandlers.forEach((h) => h(frame));
  }

  private handleResponse(frame: ResFrame): void {
    if (!frame.ok) {
      const errObj = frame.error as ErrorShape | undefined;
      console.error("[AWF] Server error:", errObj?.code, errObj?.message, frame.error);
      if (errObj) {
        this.lastError = errObj;
        this.stateHandlers.forEach((h) => h(this.state, this.lastError));
      }
    }

    const payload = frame.payload as Record<string, unknown> | undefined;
    if (frame.ok && payload?.type === "hello-ok") {
      this.clearAuthTimer();
      const snapshot = payload.snapshot as Record<string, unknown> | undefined;
      const sessionDefaults = snapshot?.sessionDefaults as Record<string, unknown> | undefined;
      this.mainSessionKey = (sessionDefaults?.mainSessionKey as string) || "";
      const server = payload.server as Record<string, unknown> | undefined;
      this.serverVersion = (server?.version as string) || "";
      this.serverCommit = (server?.commit as string) || "";
      const isReconnect = this.wasConnected;
      console.log("[AWF] hello-ok: mainSessionKey=", this.mainSessionKey, "version=", this.serverVersion, "commit=", this.serverCommit, isReconnect ? "(reconnect)" : "(initial)");
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.wasConnected = true;
      this.setState("connected");
      // Ping disabled — gateway doesn't support app-level ping frames
      // this.startPing();

      // Emit synthetic reconnect event so UI can reload history
      if (isReconnect) {
        const reconnectFrame: EventFrame = {
          type: "event",
          event: "client.reconnected",
          payload: {},
        };
        this.eventHandlers.forEach((h) => h(reconnectFrame));
      }
    }

    const pending = this.pending.get(frame.id);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(frame.id);

    if (frame.ok) {
      pending.resolve(frame.payload);
    } else {
      const errObj = frame.error as ErrorShape | undefined;
      const errMsg = errObj?.message || JSON.stringify(frame.error || "Request failed");
      console.error("[AWF] Request failed:", errMsg, frame.error);
      pending.reject(new Error(errMsg));
    }
  }

  private handleClose(): void {
    this.clearAuthTimer();
    this.stopPing();
    this.ws = null;
    this.rejectAll("Connection closed");
    this.setState("disconnected");

    if (!this.intentionalClose) {
      this.scheduleReconnect();
    }
  }

  // --- Ping / Pong keepalive ---

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify({ type: "ping" }));
        this.pongTimer = setTimeout(() => {
          console.warn("[AWF] Pong timeout — connection stale, closing");
          this.ws?.close();
        }, PONG_TIMEOUT);
      }
    }, PING_INTERVAL);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPongTimer();
  }

  private clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  // --- Reconnect ---

  private scheduleReconnect(): void {
    this.clearReconnect();
    const delay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearAuthTimer(): void {
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
  }

  private rejectAll(reason: string): void {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    });
    this.pending.clear();
  }
}
