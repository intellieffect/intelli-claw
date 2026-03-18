/**
 * tool-stream.ts — OpenClaw 3-buffer streaming architecture (platform-independent).
 *
 * Ported from OpenClaw's app-tool-stream.ts (Lit) → React refs → shared.
 * Separates streaming state into three independent buffers:
 *   1. chatStream — current assistant text being streamed (replace-only)
 *   2. chatStreamSegments — committed text segments (frozen before tool calls)
 *   3. toolStream — active tool calls by ID with ordered display
 *
 * The key insight: when a tool-start event arrives, the current chatStream
 * is committed to segments so it renders ABOVE the tool card. After the tool
 * completes, new chatStream text appears BELOW the tool card.
 *
 * Uses MutableRef<T> (= { current: T }) instead of React.MutableRefObject
 * so both React refs and plain objects work.
 */

import type { ToolCall } from "./protocol";
import type { ToolStreamRefs, ToolStreamEntry } from "./chat-stream-types";

// ── Factory ────────────────────────────────────────────────────────────

/** Create a fresh ToolStreamRefs with all fields initialized. */
export function createToolStreamRefs(): ToolStreamRefs {
  return {
    chatStream: { current: null },
    chatStreamId: { current: null },
    chatStreamStartedAt: { current: null },
    chatStreamSegments: { current: [] },
    toolStreamById: { current: new Map() },
    toolStreamOrder: { current: [] },
  };
}

// ── Core operations ────────────────────────────────────────────────────

/**
 * Reset all streaming refs to their initial state.
 * Called on: session switch, finalize, abort, error, reconnect safety timeout.
 */
export function resetAllStreamRefs(refs: ToolStreamRefs): void {
  refs.chatStream.current = null;
  refs.chatStreamId.current = null;
  refs.chatStreamStartedAt.current = null;
  refs.chatStreamSegments.current = [];
  refs.toolStreamById.current = new Map();
  refs.toolStreamOrder.current = [];
}

/**
 * Commit the current chatStream text to segments.
 * Called before a tool-start event so the text renders above the tool card.
 *
 * Mirrors OpenClaw app-tool-stream.ts:438-444
 */
export function commitChatStreamToSegment(refs: ToolStreamRefs): void {
  if (refs.chatStream.current && refs.chatStream.current.trim().length > 0) {
    refs.chatStreamSegments.current = [
      ...refs.chatStreamSegments.current,
      { text: refs.chatStream.current, ts: Date.now() },
    ];
    refs.chatStream.current = null;
    refs.chatStreamStartedAt.current = null;
  }
}

/**
 * Check whether any streaming state is active (text or tools).
 * Replaces `streamBuf.current !== null` checks.
 */
export function hasActiveStream(refs: ToolStreamRefs): boolean {
  return (
    refs.chatStreamId.current !== null ||
    refs.chatStream.current !== null ||
    refs.toolStreamById.current.size > 0
  );
}

/**
 * Build the full content string from segments + current chatStream.
 * Used in rAF render callbacks and finalization.
 */
export function buildStreamContent(refs: ToolStreamRefs): string {
  const segments = refs.chatStreamSegments.current;
  const currentText = refs.chatStream.current || "";
  const parts = [...segments.map((s) => s.text), currentText].filter(Boolean);
  return parts.join("\n\n");
}

/**
 * Build ToolCall[] from the toolStreamById map (for DisplayMessage.toolCalls).
 */
export function buildStreamToolCalls(refs: ToolStreamRefs): ToolCall[] {
  return Array.from(refs.toolStreamById.current.values()).map((e) => ({
    callId: e.toolCallId,
    name: e.name,
    args: e.args,
    status: (e.output ? "done" : "running") as "done" | "running",
    result: e.output,
  }));
}
