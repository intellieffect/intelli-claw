/**
 * Test fixtures — message factories for consistent test data creation.
 */
import type { EventFrame, ChatMessage, ToolCall } from "@intelli-claw/shared";
import type { DisplayMessage, DisplayAttachment } from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// DisplayMessage factory
// ---------------------------------------------------------------------------

let _idCounter = 0;

/** Create a DisplayMessage with sensible defaults */
export function makeDisplayMessage(
  overrides: Partial<DisplayMessage> = {},
): DisplayMessage {
  _idCounter++;
  return {
    id: `msg-${_idCounter}`,
    role: "assistant",
    content: `Test message ${_idCounter}`,
    timestamp: new Date(Date.now() + _idCounter * 1000).toISOString(),
    toolCalls: [],
    ...overrides,
  };
}

/** Shorthand: create a user DisplayMessage */
export function makeUserMessage(
  content: string,
  overrides: Partial<DisplayMessage> = {},
): DisplayMessage {
  return makeDisplayMessage({ role: "user", content, ...overrides });
}

/** Shorthand: create an assistant DisplayMessage */
export function makeAssistantMessage(
  content: string,
  overrides: Partial<DisplayMessage> = {},
): DisplayMessage {
  return makeDisplayMessage({ role: "assistant", content, ...overrides });
}

/** Shorthand: create a session-boundary DisplayMessage */
export function makeBoundaryMessage(
  overrides: Partial<DisplayMessage> = {},
): DisplayMessage {
  return makeDisplayMessage({
    role: "session-boundary",
    content: "",
    oldSessionId: "old-session-id",
    newSessionId: "new-session-id",
    ...overrides,
  });
}

/** Shorthand: create a streaming assistant DisplayMessage */
export function makeStreamingMessage(
  content: string,
  overrides: Partial<DisplayMessage> = {},
): DisplayMessage {
  return makeDisplayMessage({
    role: "assistant",
    content,
    streaming: true,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Gateway ChatMessage factory (server response format)
// ---------------------------------------------------------------------------

export function makeGatewayMessage(
  overrides: Partial<ChatMessage> & { timestamp?: string } = {},
): ChatMessage & { timestamp: string } {
  _idCounter++;
  return {
    role: "assistant",
    content: `Gateway message ${_idCounter}`,
    timestamp: new Date(Date.now() + _idCounter * 1000).toISOString(),
    toolCalls: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// StoredMessage factory (IndexedDB format)
// ---------------------------------------------------------------------------

export interface StoredMessageFixture {
  sessionKey: string;
  id: string;
  role: string;
  content: string;
  timestamp: string;
  toolCalls?: ToolCall[];
  attachments?: DisplayAttachment[];
  oldSessionId?: string;
  newSessionId?: string;
}

export function makeStoredMessage(
  overrides: Partial<StoredMessageFixture> = {},
): StoredMessageFixture {
  _idCounter++;
  return {
    sessionKey: "test:agent",
    id: `stored-${_idCounter}`,
    role: "assistant",
    content: `Stored message ${_idCounter}`,
    timestamp: new Date(Date.now() + _idCounter * 1000).toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// EventFrame factory
// ---------------------------------------------------------------------------

export function makeEventFrame(
  event: string,
  payload: Record<string, unknown> = {},
  seq?: number,
): EventFrame {
  return {
    type: "event",
    event,
    payload,
    ...(seq != null ? { seq } : {}),
  };
}

/** Shorthand: agent event with stream type */
export function makeAgentEvent(
  stream: string,
  data: Record<string, unknown> = {},
  extra: Record<string, unknown> = {},
): EventFrame {
  return makeEventFrame("agent", {
    stream,
    data,
    ...extra,
  });
}

/** Shorthand: assistant streaming chunk */
export function makeStreamChunk(
  delta: string,
  sessionKey?: string,
): EventFrame {
  return makeAgentEvent(
    "assistant",
    { delta },
    sessionKey ? { sessionKey } : {},
  );
}

/** Shorthand: lifecycle start event */
export function makeLifecycleStart(
  sessionKey?: string,
  runId?: string,
): EventFrame {
  return makeAgentEvent(
    "lifecycle",
    { phase: "start", ...(runId ? { runId } : {}) },
    sessionKey ? { sessionKey } : {},
  );
}

/** Shorthand: lifecycle end event */
export function makeLifecycleEnd(
  sessionKey?: string,
  runId?: string,
): EventFrame {
  return makeAgentEvent(
    "lifecycle",
    { phase: "end", ...(runId ? { runId } : {}) },
    sessionKey ? { sessionKey } : {},
  );
}

/** Shorthand: reconnect event */
export function makeReconnectEvent(): EventFrame {
  return makeEventFrame("client.reconnected");
}

// ---------------------------------------------------------------------------
// DisplayAttachment factory
// ---------------------------------------------------------------------------

export function makeAttachment(
  overrides: Partial<DisplayAttachment> = {},
): DisplayAttachment {
  return {
    fileName: "test.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,iVBOR...",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the internal ID counter (call in beforeEach if needed) */
export function resetFixtureCounter(): void {
  _idCounter = 0;
}

/** Create an array of messages with sequential timestamps */
export function makeMessageSequence(
  count: number,
  baseTime: string = "2026-01-01T00:00:00Z",
  role: DisplayMessage["role"] = "assistant",
): DisplayMessage[] {
  const base = new Date(baseTime).getTime();
  return Array.from({ length: count }, (_, i) =>
    makeDisplayMessage({
      id: `seq-${i}`,
      role,
      content: `Message ${i}`,
      timestamp: new Date(base + i * 1000).toISOString(),
    }),
  );
}
