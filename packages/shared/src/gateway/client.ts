import { makeReq, parseFrame, type Frame, type ReqFrame, type ResFrame, type EventFrame, type ErrorShape, type ClientId, type ClientMode } from "./protocol";
import { getCryptoAdapter } from "./device-identity";

export type ConnectionState = "disconnected" | "connecting" | "authenticating" | "connected";
type EventHandler = (event: EventFrame) => void;
type StateHandler = (state: ConnectionState, error?: ErrorShape | null) => void;

export type InvokeHandler = (id: string, command: string, params: unknown) => Promise<unknown>;

export interface GatewayClientOptions {
  role?: "operator" | "node";
  clientId?: ClientId;
  clientMode?: ClientMode;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  scopes?: string[];
  displayName?: string;
  onInvoke?: InvokeHandler;
}
type PendingReq = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const REQUEST_TIMEOUT = 30_000;
const AUTH_TIMEOUT = 10_000;
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000, 60000];
const MAX_RECONNECT_DELAY = 60_000;
const RECONNECT_JITTER = 0.3; // ±30% jitter on delays
const MAX_RECONNECT_ATTEMPTS = 20;
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
  private pingIds = new Set<string>();
  private intentionalClose = false;
  private wasConnected = false;
  private networkCleanup: (() => void) | null = null;
  public mainSessionKey = "";
  public serverVersion = "";
  public serverCommit = "";
  public lastError: ErrorShape | null = null;
  public canvasHostUrl = "";
  private options: GatewayClientOptions;

  private handleOnline = (): void => {
    // Network came back — if we're disconnected (not intentionally), reconnect immediately
    if (this.state === "disconnected" && !this.intentionalClose && this.wasConnected) {
      this.clearReconnect();
      this.reconnectAttempt = 0; // reset — network change is a fresh start
      this.connect();
    }
  };

  private handleVisibilityChange = (): void => {
    if (
      typeof document !== "undefined" &&
      !document.hidden &&
      this.state === "disconnected" &&
      !this.intentionalClose &&
      this.wasConnected
    ) {
      this.clearReconnect();
      this.reconnectAttempt = 0;
      this.connect();
    }
  };

  constructor(url: string, token: string, options?: GatewayClientOptions) {
    this.url = url;
    this.token = token;
    this.options = {
      role: "operator",
      clientId: "openclaw-control-ui",
      clientMode: "ui",
      scopes: ["operator.read", "operator.write", "operator.admin"],
      ...options,
    };
  }

  // --- Public API ---

  connect(): void {
    if (this.ws && this.state !== "disconnected") return;
    this.intentionalClose = false;
    this.lastError = null;
    this.setupNetworkListeners();
    this.setState("connecting");
    this.addBrowserListeners();

    try {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (e) => this.handleMessage(e);
      this.ws.onclose = (e: any) => { console.error("[GW] ws closed code:", e?.code, "reason:", e?.reason, "clean:", e?.wasClean); this.handleClose(); };
      this.ws.onerror = (e: any) => { console.error("[GW] ws error:", e?.message || e?.type || JSON.stringify(e), "url:", this.url); };
    } catch {
      this.handleClose();
    }
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnect();
    this.clearAuthTimer();
    this.stopPing();
    this.teardownNetworkListeners();
    this.removeBrowserListeners();
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

  private buildConnectParams(): Record<string, unknown> {
    const opts = this.options;
    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: opts.clientId,
        version: "1.0.0",
        platform: "web",
        mode: opts.clientMode,
        ...(opts.displayName && { displayName: opts.displayName }),
      },
      role: opts.role,
      scopes: opts.scopes,
      auth: { token: this.token },
    };
    if (opts.caps?.length) params.caps = opts.caps;
    if (opts.commands?.length) params.commands = opts.commands;
    if (opts.permissions) params.permissions = opts.permissions;
    return params;
  }

  private async handleEvent(frame: EventFrame): Promise<void> {
    if (frame.event === "connect.challenge") {
      const challenge = frame.payload as { nonce?: string } | undefined;
      const nonce = challenge?.nonce || "";
      const opts = this.options;
      const connectParams = this.buildConnectParams();

      // Add device identity if crypto adapter is available
      const cryptoAdapter = getCryptoAdapter();
      if (cryptoAdapter && nonce) {
        try {
          const keyPair = await cryptoAdapter.getOrCreateKeyPair("primary");
          const signedAt = Date.now();

          // v3 signature payload (pipe-delimited)
          const payload = [
            "v3",
            keyPair.id,
            String(opts.clientId),
            String(opts.clientMode),
            String(opts.role),
            (opts.scopes || []).join(","),
            String(signedAt),
            this.token,
            nonce,
            "web",
            "",
          ].join("|");

          const signature = await cryptoAdapter.sign("primary", payload);
          connectParams.device = {
            id: keyPair.id,
            publicKey: keyPair.publicKey,
            signature,
            signedAt,
            nonce,
          };
        } catch (err) {
          console.error("[AWF] Device identity signing failed:", err);
        }
      }

      const authFrame = makeReq("connect", connectParams);
      this.send(authFrame);
      return;
    }

    // Handle node invoke requests from gateway
    if (frame.event === "node.invoke.request" && this.options.onInvoke) {
      const req = frame.payload as { id: string; command: string; params?: unknown } | undefined;
      if (req?.id && req?.command) {
        try {
          const result = await this.options.onInvoke(req.id, req.command, req.params);
          this.send(makeReq("node.invoke.result", { id: req.id, ok: true, payload: result }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.send(makeReq("node.invoke.result", { id: req.id, ok: false, error: { code: "INVOKE_ERROR", message: msg } }));
        }
      }
      return;
    }

    console.log("[AWF] Event:", frame.event, JSON.stringify(frame.payload).slice(0, 200));
    this.eventHandlers.forEach((h) => h(frame));
  }

  private handleResponse(frame: ResFrame): void {
    // Ignore ping responses — don't let ping errors pollute lastError
    if (this.pingIds.has(frame.id)) {
      this.pingIds.delete(frame.id);
      return;
    }

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
      this.canvasHostUrl = (payload?.canvasHostUrl as string) || "";
      const isReconnect = this.wasConnected;
      console.log("[AWF] hello-ok: mainSessionKey=", this.mainSessionKey, "version=", this.serverVersion, "commit=", this.serverCommit, isReconnect ? "(reconnect)" : "(initial)");
      this.reconnectAttempt = 0;
      this.lastError = null;
      this.wasConnected = true;
      this.setState("connected");
      // Enable heartbeat to detect stale connections (#154).
      // Even if the gateway ignores the ping frame, sending data over a stale
      // WebSocket triggers the browser's TCP stack to detect the broken pipe.
      // If no data arrives within PONG_TIMEOUT after a ping, we close and reconnect.
      this.startPing();

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
        const pingFrame = makeReq("ping");
        this.pingIds.add(pingFrame.id);
        this.send(pingFrame);
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
    this.pingIds.clear();
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

    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.warn("[GW] Max reconnect attempts reached, giving up");
      this.lastError = {
        code: "reconnect_exhausted",
        message: `Failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`,
      };
      this.stateHandlers.forEach((h) => h(this.state, this.lastError));
      // Emit event so UI can prompt user
      const exhaustedFrame: EventFrame = {
        type: "event",
        event: "client.reconnect_exhausted",
        payload: { attempts: MAX_RECONNECT_ATTEMPTS },
      };
      this.eventHandlers.forEach((h) => h(exhaustedFrame));
      return;
    }

    const baseDelay = RECONNECT_DELAYS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS.length - 1)];
    const jitter = baseDelay * RECONNECT_JITTER * Math.random();
    const delay = baseDelay + jitter;
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  /**
   * Listen for network/visibility changes to trigger reconnect (#119).
   * On mobile, WiFi↔5G transitions and app backgrounding cause code 1006 closes.
   */
  private setupNetworkListeners(): void {
    if (this.networkCleanup) return; // already set up
    const handleOnline = () => {
      if (this.state === "disconnected" && !this.intentionalClose) {
        console.log("[GW] Network online — triggering reconnect");
        this.reconnectAttempt = 0; // Reset backoff on network change
        this.clearReconnect();
        this.connect();
      }
    };
    const handleVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        if (this.state === "disconnected" && !this.intentionalClose) {
          console.log("[GW] Page visible — triggering reconnect");
          this.reconnectAttempt = 0;
          this.clearReconnect();
          this.connect();
        }
      }
    };
    const hasWindowEvents = typeof window !== "undefined" && typeof window.addEventListener === "function";
    const hasDocumentEvents = typeof document !== "undefined" && typeof document.addEventListener === "function";
    if (hasWindowEvents) {
      window.addEventListener("online", handleOnline);
    }
    if (hasDocumentEvents) {
      document.addEventListener("visibilitychange", handleVisibility);
    }
    this.networkCleanup = () => {
      if (hasWindowEvents) window.removeEventListener("online", handleOnline);
      if (hasDocumentEvents) document.removeEventListener("visibilitychange", handleVisibility);
    };
  }

  private teardownNetworkListeners(): void {
    this.networkCleanup?.();
    this.networkCleanup = null;
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

  // --- Browser event listeners for mobile reconnection ---

  private browserListenersAdded = false;

  private addBrowserListeners(): void {
    if (this.browserListenersAdded) return;
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", this.handleOnline);
      window.addEventListener("offline", () => {}); // reserved for future offline handling
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.browserListenersAdded = true;
  }

  private removeBrowserListeners(): void {
    if (!this.browserListenersAdded) return;
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("online", this.handleOnline);
    }
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.browserListenersAdded = false;
  }
}
