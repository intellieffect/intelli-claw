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

/**
 * Non-recoverable auth error detail codes (#228).
 * When the gateway returns one of these, reconnecting won't help —
 * the user must take action (fix token, pair device, etc.).
 */
const NON_RECOVERABLE_AUTH_DETAIL_CODES: ReadonlySet<string> = new Set([
  "AUTH_TOKEN_MISSING",
  "AUTH_TOKEN_MISMATCH",
  "AUTH_PASSWORD_MISSING",
  "AUTH_PASSWORD_MISMATCH",
  "AUTH_RATE_LIMITED",
  "PAIRING_REQUIRED",
  "DEVICE_IDENTITY_REQUIRED",
]);

/**
 * Extract the detail code from an error's details object.
 * Gateway auth errors carry `{ details: { code: "AUTH_TOKEN_MISSING" } }`.
 */
function readErrorDetailCode(error: ErrorShape | null | undefined): string | null {
  if (!error?.details || typeof error.details !== "object" || Array.isArray(error.details)) {
    return null;
  }
  const code = (error.details as { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0 ? code : null;
}

/**
 * Check whether an error represents a non-recoverable auth failure (#228).
 * Returns true if the error's detail code is in the non-recoverable set.
 */
export function isNonRecoverableAuthError(error: ErrorShape | null | undefined): boolean {
  const code = readErrorDetailCode(error);
  return code !== null && NON_RECOVERABLE_AUTH_DETAIL_CODES.has(code);
}

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
  /** Whether browser event listeners (online, visibilitychange) are registered (#226) */
  private listenersRegistered = false;
  public mainSessionKey = "";
  public serverVersion = "";
  public serverCommit = "";
  public lastError: ErrorShape | null = null;
  public canvasHostUrl = "";
  private options: GatewayClientOptions;

  /** Last connect error — used by handleClose to decide if reconnect is appropriate (#228) */
  private lastConnectError: ErrorShape | null = null;

  /** Last sequence number seen from gateway event frames (#227) */
  private lastSeq: number | null = null;

  /**
   * Bound handler for the "online" window event (#226).
   * Stored as an arrow-function instance field so the same reference
   * is used for both addEventListener and removeEventListener.
   */
  private handleOnline = (): void => {
    if (this.state === "disconnected" && !this.intentionalClose && this.wasConnected) {
      this.clearReconnect();
      this.reconnectAttempt = 0;
      this.connect();
    }
  };

  /**
   * Bound handler for the "visibilitychange" document event (#226).
   */
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
    this.lastConnectError = null;
    this.setState("connecting");
    // Register browser event listeners once (#226 — deduplicated)
    this.setupBrowserListeners();

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
    this.teardownBrowserListeners();
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
    // Reset sequence tracking on new connection (#227)
    this.lastSeq = null;
    this.lastConnectError = null;

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

    // --- Sequence gap detection (#227) ---
    const seq = typeof frame.seq === "number" ? frame.seq : null;
    if (seq !== null) {
      if (this.lastSeq !== null && seq > this.lastSeq + 1) {
        // Emit synthetic gap event before the actual event
        const gapFrame: EventFrame = {
          type: "event",
          event: "client.sequence_gap",
          payload: { expected: this.lastSeq + 1, received: seq },
        };
        this.eventHandlers.forEach((h) => h(gapFrame));
      }
      this.lastSeq = seq;
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
        // Track connect errors for non-recoverable auth classification (#228)
        this.lastConnectError = errObj;
        this.stateHandlers.forEach((h) => h(this.state, this.lastError));

        // Emit synthetic auth_failed event if non-recoverable (#228)
        if (isNonRecoverableAuthError(errObj)) {
          const authFailedFrame: EventFrame = {
            type: "event",
            event: "client.auth_failed",
            payload: {
              code: errObj.code,
              message: errObj.message,
              detailCode: readErrorDetailCode(errObj),
            },
          };
          this.eventHandlers.forEach((h) => h(authFailedFrame));
        }
      }
    }

    const payload = frame.payload as Record<string, unknown> | undefined;
    if (frame.ok && payload?.type === "hello-ok") {
      this.clearAuthTimer();
      this.lastConnectError = null;
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
    const connectError = this.lastConnectError;
    this.ws = null;
    this.rejectAll("Connection closed");
    this.setState("disconnected");

    if (!this.intentionalClose) {
      // Skip reconnect for non-recoverable auth errors (#228)
      if (isNonRecoverableAuthError(connectError)) {
        console.warn("[GW] Non-recoverable auth error, skipping reconnect:", readErrorDetailCode(connectError));
        return;
      }
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
   * Register browser event listeners for network/visibility reconnect (#226).
   * Uses stable instance-field handlers so the same reference is used for
   * both addEventListener and removeEventListener — guaranteeing proper cleanup.
   * Only registers once; subsequent connect() calls skip if already registered.
   */
  private setupBrowserListeners(): void {
    if (this.listenersRegistered) return;
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("online", this.handleOnline);
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.listenersRegistered = true;
  }

  /**
   * Remove browser event listeners (#226).
   * Uses the same handler references that were registered in setupBrowserListeners.
   */
  private teardownBrowserListeners(): void {
    if (!this.listenersRegistered) return;
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("online", this.handleOnline);
    }
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    this.listenersRegistered = false;
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
