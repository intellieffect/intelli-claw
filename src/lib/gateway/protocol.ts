import { v4 as uuidv4 } from "uuid";

// --- Frame Types (aligned with OpenClaw Gateway Protocol v3) ---

export interface ReqFrame {
  type: "req";
  id: string;
  method: string;
  params?: unknown;
}

export interface ErrorShape {
  code: string;
  message: string;
  details?: unknown;
  retryable?: boolean;
  retryAfterMs?: number;
}

export interface ResFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: ErrorShape;
}

export interface StateVersion {
  presence: number;
  health: number;
}

export interface EventFrame {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: StateVersion;
}

export type Frame = ReqFrame | ResFrame | EventFrame;

// --- Connect Handshake Types ---

export type ClientId =
  | "cli" | "test" | "webchat" | "webchat-ui" | "openclaw-control-ui"
  | "gateway-client" | "openclaw-macos" | "openclaw-ios" | "openclaw-android"
  | "node-host" | "fingerprint" | "openclaw-probe";

export type ClientMode = "cli" | "node" | "ui" | "test" | "webchat" | "backend" | "probe";

export interface ConnectClient {
  id: ClientId;
  displayName?: string;
  version: string;
  platform: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode: ClientMode;
  instanceId?: string;
}

export interface DeviceIdentity {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce?: string;
}

export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: ConnectClient;
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
  pathEnv?: string;
  role?: string;
  scopes?: string[];
  device?: DeviceIdentity;
  auth?: { token?: string; password?: string };
  locale?: string;
  userAgent?: string;
}

export interface HelloOkPayload {
  type: "hello-ok";
  protocol: number;
  server: {
    version: string;
    commit?: string;
    host?: string;
    connId: string;
  };
  features: {
    methods: string[];
    events: string[];
  };
  snapshot: {
    presence: PresenceEntry[];
    health: unknown;
    stateVersion: StateVersion;
    uptimeMs: number;
    configPath?: string;
    stateDir?: string;
    sessionDefaults?: {
      defaultAgentId: string;
      mainKey: string;
      mainSessionKey: string;
      scope?: string;
    };
    authMode?: "none" | "token" | "password" | "trusted-proxy";
  };
  canvasHostUrl?: string;
  auth?: {
    deviceToken: string;
    role: string;
    scopes: string[];
    issuedAtMs?: number;
  };
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
}

export interface PresenceEntry {
  host?: string;
  ip?: string;
  version?: string;
  platform?: string;
  deviceFamily?: string;
  modelIdentifier?: string;
  mode?: string;
  lastInputSeconds?: number;
  reason?: string;
  tags?: string[];
  text?: string;
  ts: number;
  deviceId?: string;
  roles?: string[];
  scopes?: string[];
  instanceId?: string;
}

// --- Agent Event (real gateway format) ---

export interface GatewayAgentEvent {
  runId: string;
  seq: number;
  stream: string;
  ts: number;
  data: Record<string, unknown>;
}

// --- Chat Types ---

export interface ChatSendParams {
  sessionKey: string;
  message: string;
  thinking?: string;
  deliver?: boolean;
  attachments?: unknown[];
  timeoutMs?: number;
  idempotencyKey: string;
}

export interface ChatAbortParams {
  sessionKey: string;
  runId?: string;
}

export interface ChatHistoryParams {
  sessionKey: string;
  limit?: number;
}

export interface ChatEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final" | "aborted" | "error";
  message?: unknown;
  errorMessage?: string;
  usage?: unknown;
  stopReason?: string;
}

// --- Legacy Agent Event Payloads (display-layer mapping) ---

export interface AgentTextDelta {
  kind: "text-delta";
  delta: string;
  sessionKey?: string;
}

export interface AgentToolCallStart {
  kind: "tool-call-start";
  callId: string;
  name: string;
  args?: string;
  sessionKey?: string;
}

export interface AgentToolCallEnd {
  kind: "tool-call-end";
  callId: string;
  name: string;
  result?: string;
  sessionKey?: string;
}

export interface AgentDone {
  kind: "done";
  sessionKey?: string;
  text?: string;
}

export interface AgentError {
  kind: "error";
  message: string;
  sessionKey?: string;
}

export type AgentEvent =
  | AgentTextDelta
  | AgentToolCallStart
  | AgentToolCallEnd
  | AgentDone
  | AgentError;

// --- Helpers ---

export function makeReq(method: string, params?: Record<string, unknown>): ReqFrame {
  return { type: "req", id: uuidv4(), method, params };
}

export function parseFrame(data: string): Frame | null {
  try {
    return JSON.parse(data) as Frame;
  } catch {
    return null;
  }
}

// --- Data Types ---

export interface Agent {
  id: string;
  name: string;
  model?: string;
  description?: string;
  systemPrompt?: string;
}

export interface Session {
  key: string;
  agentId?: string;
  agentName?: string;
  title?: string;
  lastMessage?: string;
  updatedAt?: string;
  messageCount?: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  callId: string;
  name: string;
  args?: string;
  result?: string;
  status: "running" | "done" | "error";
}
