/**
 * ClaudeCodeClient — WebSocket client for Claude Code webchat channel.
 *
 * Connects to the webchat channel plugin's WebSocket (port 4002),
 * which is loaded into a live Claude Code session.
 */

export type BridgeStatus = "disconnected" | "connecting" | "ready" | "error";

export interface WebChatEvent {
  type: "assistant" | "bridge:status" | "user_ack";
  content?: string;
  replyTo?: string;
  timestamp?: string;
  id?: string;
  status?: string;
  [key: string]: unknown;
}

type EventHandler = (event: WebChatEvent) => void;
type StatusHandler = (status: BridgeStatus, error?: string) => void;

export class ClaudeCodeClient {
  private ws: WebSocket | null = null;
  private eventHandlers = new Set<EventHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private _status: BridgeStatus = "disconnected";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(private wsUrl: string) {}

  get status() {
    return this._status;
  }

  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.setStatus("connecting");
    this.ws = new WebSocket(this.wsUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (ev) => {
      try {
        const event: WebChatEvent = JSON.parse(ev.data as string);

        if (event.type === "bridge:status") {
          this.setStatus(event.status as BridgeStatus);
          return;
        }

        for (const handler of this.eventHandlers) {
          handler(event);
        }
      } catch {
        // skip
      }
    };

    this.ws.onerror = () => {
      this.setStatus("error", "WebSocket error");
    };

    this.ws.onclose = () => {
      this.ws = null;
      if (this._status !== "disconnected") {
        this.setStatus("disconnected");
        this.tryReconnect();
      }
    };
  }

  disconnect() {
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  sendMessage(message: string) {
    this.send({ type: "send", message });
  }

  onEvent(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => this.statusHandlers.delete(handler);
  }

  private send(data: Record<string, unknown>) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private setStatus(status: BridgeStatus, error?: string) {
    this._status = status;
    for (const handler of this.statusHandlers) {
      handler(status, error);
    }
  }

  private tryReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts - 1), 10000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
