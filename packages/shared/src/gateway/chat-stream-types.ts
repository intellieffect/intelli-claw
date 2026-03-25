/**
 * chat-stream-types.ts — Shared types for chat streaming across platforms.
 *
 * These types are used by both web (React hooks) and mobile (ChatStateManager)
 * to process OpenClaw gateway streaming events.
 */

import type { ToolCall } from "./protocol";

// ── Generic ref container (platform-independent alternative to React.MutableRefObject) ──

/** A mutable container holding a `.current` value — compatible with React refs and plain objects. */
export type MutableRef<T> = { current: T };

// ── Display types ──

export interface DisplayAttachment {
  fileName: string;
  mimeType: string;
  dataUrl?: string;
  downloadUrl?: string;
  textContent?: string;
}

export interface ReplyTo {
  id: string;
  content: string;
  role: string;
}

/** Type of system-injected message detected from user-role content */
export type SystemInjectedType = "compaction" | "memory-flush" | "generic";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system" | "session-boundary";
  content: string;
  timestamp: string;
  toolCalls: ToolCall[];
  streaming?: boolean;
  queued?: boolean;
  attachments?: DisplayAttachment[];
  oldSessionId?: string;
  newSessionId?: string;
  /** Why the session was reset */
  resetReason?: string;
  replyTo?: ReplyTo;
  /** Type of system-injected message (for distinct rendering) */
  systemType?: SystemInjectedType;
  /** True when this message represents an error/timeout notification */
  isError?: boolean;
  /** Local image URIs for user-sent attachments (mobile display only) */
  imageUris?: string[];
  /** #222: Extracted thinking/reasoning blocks from the model */
  thinking?: Array<{ text: string }>;
  /** #231: Ordered segments preserving text↔tool interleave */
  segments?: MessageSegment[];
}

/** #231: A single segment in an interleaved text↔tool response */
export type MessageSegment =
  | { type: "text"; text: string }
  | { type: "tool"; toolCall: ToolCall };

export type AgentStatus =
  | { phase: "idle" }
  | { phase: "thinking" }
  | { phase: "writing" }
  | { phase: "tool"; toolName: string }
  | { phase: "waiting" };

// ── Tool stream types ──

export type ToolStreamEntry = {
  toolCallId: string;
  runId?: string;
  sessionKey?: string;
  name: string;
  args?: string;
  output?: string;
  startedAt: number;
  updatedAt: number;
};

/** The 6-ref structure for 3-buffer streaming architecture. */
export type ToolStreamRefs = {
  /** Current in-flight assistant text (replace-only from chat delta). */
  chatStream: MutableRef<string | null>;
  /** ID of the streaming assistant message. */
  chatStreamId: MutableRef<string | null>;
  /** Timestamp when current chat stream started. */
  chatStreamStartedAt: MutableRef<number | null>;
  /** Committed text segments — frozen when a tool starts. */
  chatStreamSegments: MutableRef<Array<{ text: string; ts: number }>>;
  /** Tool calls indexed by toolCallId. */
  toolStreamById: MutableRef<Map<string, ToolStreamEntry>>;
  /** Ordered list of toolCallIds for display. */
  toolStreamOrder: MutableRef<string[]>;
};
