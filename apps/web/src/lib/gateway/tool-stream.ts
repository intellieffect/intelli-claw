/**
 * tool-stream.ts — OpenClaw 3-buffer streaming architecture for React
 *
 * Ported from OpenClaw's app-tool-stream.ts (Lit) to React refs.
 * Separates streaming state into three independent buffers:
 *   1. chatStream — current assistant text being streamed (replace-only)
 *   2. chatStreamSegments — committed text segments (frozen before tool calls)
 *   3. toolStream — active tool calls by ID with ordered display
 *
 * The key insight: when a tool-start event arrives, the current chatStream
 * is committed to segments so it renders ABOVE the tool card. After the tool
 * completes, new chatStream text appears BELOW the tool card.
 */

import type { MutableRefObject } from "react";
import type { ToolCall } from "@intelli-claw/shared";

// ── Types ──────────────────────────────────────────────────────────────

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

/** The 6-ref structure replacing the old single streamBuf ref. */
export type ToolStreamRefs = {
  /** Current in-flight assistant text (replace-only from chat delta). */
  chatStream: MutableRefObject<string | null>;
  /** ID of the streaming assistant message. */
  chatStreamId: MutableRefObject<string | null>;
  /** Timestamp when current chat stream started. */
  chatStreamStartedAt: MutableRefObject<number | null>;
  /** Committed text segments — frozen when a tool starts. */
  chatStreamSegments: MutableRefObject<Array<{ text: string; ts: number }>>;
  /** Tool calls indexed by toolCallId. */
  toolStreamById: MutableRefObject<Map<string, ToolStreamEntry>>;
  /** Ordered list of toolCallIds for display. */
  toolStreamOrder: MutableRefObject<string[]>;
};

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
 * #231: Build interleaved MessageSegment[] from segments + tool calls.
 * Uses timestamps to reconstruct the original text↔tool order.
 */
export type MessageSegment =
  | { type: "text"; text: string }
  | { type: "tool"; toolCall: ToolCall };

export function buildStreamSegments(refs: ToolStreamRefs): MessageSegment[] {
  const result: MessageSegment[] = [];

  // Collect all items with timestamps for sorting
  const items: Array<{ ts: number; segment: MessageSegment }> = [];

  // Text segments (committed before tool calls)
  for (const seg of refs.chatStreamSegments.current) {
    if (seg.text.trim()) {
      items.push({ ts: seg.ts, segment: { type: "text", text: seg.text } });
    }
  }

  // Tool calls
  for (const callId of refs.toolStreamOrder.current) {
    const entry = refs.toolStreamById.current.get(callId);
    if (entry) {
      items.push({
        ts: entry.startedAt,
        segment: {
          type: "tool",
          toolCall: {
            callId: entry.toolCallId,
            name: entry.name,
            args: entry.args,
            status: (entry.output ? "done" : "running") as "done" | "running",
            result: entry.output,
          },
        },
      });
    }
  }

  // Sort by timestamp to preserve interleave order
  items.sort((a, b) => a.ts - b.ts);
  for (const item of items) {
    result.push(item.segment);
  }

  // Append current (uncommitted) chatStream text as trailing segment
  const currentText = refs.chatStream.current;
  if (currentText && currentText.trim()) {
    result.push({ type: "text", text: currentText });
  }

  return result;
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
