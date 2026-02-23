import { makeReq, parseFrame, type Frame, type ResFrame, type EventFrame, type ErrorShape, type DeviceIdentity } from "./protocol";
import { signChallenge } from "./device-identity";

export type ConnectionState = "disconnected" | "connecting" | "authenticating" | "connected";
type EventHandler = (event: EventFrame) => void;
type StateHandler = (state: ConnectionState) => void;
type PendingReq = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT = 30_000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000];

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
  private intentionalClose = false;
  public mainSessionKey = "";

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  // --- Public API ---

  connect(): void {
    if (this.ws && this.state !== "disconnected") return;
    this.intentionalClose = false;
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

  // --- Private ---

  private send(frame: Frame): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.stateHandlers.forEach((h) => h(state));
  }

  private handleOpen(): void {
    this.setState("authenticating");
    // Wait for connect.challenge
  }

  private handleMessage(e: MessageEvent): void {
    const frame = parseFrame(typeof e.data === "string" ? e.data : "");
    if (!frame) return;

    switch (frame.type) {
      case "event":
        this.handleEvent(frame as EventFrame);
        break;
      case "res":
        this.handleResponse(frame as ResFrame);
        break;
    }
  }

  private async handleEvent(frame: EventFrame): Promise<void> {
    if (frame.event === "connect.challenge") {
      // Resolve device identity from Web Crypto + IndexedDB
      const payload = frame.payload as { nonce?: string } | undefined;
      const nonce = payload?.nonce || "";

      let device: DeviceIdentity | undefined;
      try {
        device = await signChallenge(nonce);
      } catch (err) {
        console.warn("[AWF] device identity unavailable, connecting without it:", err);
      }

      // Respond with Protocol v3 connect handshake
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
        device,
        auth: { token: this.token },
      });
      this.send(authFrame);
      return;
    }

    // Forward all other events
    console.log("[AWF] Event:", frame.event, JSON.stringify(frame.payload).slice(0, 200));
    this.eventHandlers.forEach((h) => h(frame));
  }

  private handleResponse(frame: ResFrame): void {
    // Check if this is the connect response (hello-ok)
    const payload = frame.payload as Record<string, unknown> | undefined;
    if (frame.ok && payload?.type === "hello-ok") {
      const snapshot = payload.snapshot as Record<string, unknown> | undefined;
      const sessionDefaults = snapshot?.sessionDefaults as Record<string, unknown> | undefined;
      this.mainSessionKey = (sessionDefaults?.mainSessionKey as string) || "";
      console.log("[AWF] hello-ok: mainSessionKey=", this.mainSessionKey, "auth=", JSON.stringify(payload.auth));
      this.reconnectAttempt = 0;
      this.setState("connected");
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
    this.ws = null;
    this.rejectAll("Connection closed");
    this.setState("disconnected");

    if (!this.intentionalClose) {
      this.scheduleReconnect();
    }
  }

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

  private rejectAll(reason: string): void {
    this.pending.forEach((p) => {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    });
    this.pending.clear();
  }
}
