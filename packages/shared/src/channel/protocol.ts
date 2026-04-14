/**
 * Wire protocol for the intelli-claw-channel plugin.
 *
 * The shapes here must stay byte-identical to `plugins/intelli-claw-channel/server.ts`
 * (the same `Wire` union). If you change one, change the other.
 */

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface ChannelConfig {
  /** Base URL of the plugin's loopback HTTP+WS server (e.g. `http://127.0.0.1:8790`). */
  url: string;
  /** Optional bearer token for LAN/pairing mode. Loopback uses no token. */
  token?: string;
}

export interface ChannelMsg {
  id: string;
  from: "user" | "assistant";
  text: string;
  ts: number;
  sessionId: string;
  replyTo?: string;
  file?: { url: string; name: string };
}

export type ChannelWire =
  | ({ type: "msg" } & ChannelMsg)
  | { type: "edit"; id: string; text: string }
  | { type: "session"; sessionId: string; note?: string };

export interface ChannelInfo {
  status: "ok";
  plugin: string;
  version: string;
  port: number;
  activeSessionId: string;
  tools: string[];
}

export interface SendPayload {
  id: string;
  text: string;
  sessionId?: string;
}

export interface UploadPayload extends SendPayload {
  file: File;
}

export function nextClientId(): string {
  return `u${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function parseChannelWire(raw: string): ChannelWire | null {
  try {
    const obj = JSON.parse(raw) as ChannelWire;
    if (obj && typeof obj === "object" && "type" in obj) return obj;
    return null;
  } catch {
    return null;
  }
}
