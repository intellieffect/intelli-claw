/**
 * message-utils.ts — Platform-independent message processing utilities.
 *
 * Shared between web (hooks.tsx) and mobile for deduplication,
 * normalization, and consecutive-message merging.
 */

import type { DisplayMessage, DisplayAttachment } from "./chat-stream-types";

// ── Content normalization ──

/**
 * Image placeholder variants treated as equivalent for dedup (#115).
 * Optimistic UI may use "(첨부 파일)" while gateway stores "(image)".
 */
const IMAGE_PLACEHOLDERS_DEDUP = new Set([
  "(image)",
  "(첨부 파일)",
  "(이미지)",
  "",
]);

/**
 * Fast non-cryptographic hash for dedup fingerprinting (#155).
 * DJB2 variant — deterministic, collision-resistant enough for UI dedup.
 */
export function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function normalizeContentForDedup(content: string): string {
  // Keep normalization aligned across history merge + final dedup.
  // #243: Strip MEDIA: markers before whitespace normalization so that
  // streaming (already extracted) and inbound (raw) versions match.
  let normalized = content
    .replace(/MEDIA:\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Normalize gateway-injected timestamp prefix on user messages
  // e.g. "[2026-03-03 15:10:00+09:00] 질문" -> "질문"
  normalized = normalized.replace(
    /^\[\d{4}-\d{2}-\d{2}[\w\s\-:+]*\]\s*/i,
    "",
  );

  // Normalize bridge/system wrappers that may vary by source
  // e.g. "[System] ..." / "(System) ..." / "System: ..."
  normalized = normalized.replace(
    /^\s*(?:\[System\]|\(System\)|System:)\s*/i,
    "",
  );

  // #243: Normalize spacing after punctuation — prevents dedup failure
  // when line breaks vs spaces differ between streaming and inbound
  normalized = normalized.replace(/([.!?。])\s*/g, "$1 ").trim();

  if (IMAGE_PLACEHOLDERS_DEDUP.has(normalized)) return "(image)";

  // #155: Use full content instead of truncating to 200 chars.
  // Short messages use the normalized string directly.
  // Long messages use a fast hash to keep comparison cost low
  // while still distinguishing messages that share a 200-char prefix.
  if (normalized.length <= 200) return normalized;
  return `${normalized.slice(0, 120)}|H:${simpleHash(normalized)}|L:${normalized.length}`;
}

// ── Deduplication ──

/**
 * Build an attachment fingerprint for dedup comparison.
 * Uses attachment count + first dataUrl prefix (to distinguish different images)
 * while still matching optimistic vs server echo of the same image.
 * Returns empty string for messages with no attachments.
 */
export function attachmentFingerprint(attachments?: DisplayAttachment[]): string {
  if (!attachments || attachments.length === 0) return "";
  // Use count + sorted first 80 chars of each dataUrl/downloadUrl for identity
  const keys = attachments
    .map((a) => (a.dataUrl || a.downloadUrl || a.fileName || "").slice(0, 80))
    .sort();
  return `[${attachments.length}]${keys.join("|")}`;
}

/**
 * Deduplicate messages by role + normalized content + timestamp proximity.
 * Keeps the first occurrence (gateway messages should come first in the array).
 * Two messages are considered duplicates if they have the same role, similar
 * content (first 200 chars after normalization), and timestamps within 60s.
 * Image placeholder variants are normalized to prevent optimistic UI duplicates (#115).
 */
export function deduplicateMessages<
  T extends {
    id: string;
    role: string;
    content: string;
    timestamp: string;
    attachments?: DisplayAttachment[];
  },
>(msgs: T[]): T[] {
  const seen: Array<{
    role: string;
    contentKey: string;
    attKey: string;
    ts: number;
  }> = [];
  return msgs.filter((m) => {
    // Always keep session boundaries
    if (m.role === "session-boundary") return true;
    const contentKey = normalizeContentForDedup(m.content);
    const attKey = attachmentFingerprint(m.attachments);
    const ts = new Date(m.timestamp).getTime();
    // For image placeholders (#115): if the current message OR a seen message
    // has no attachments, it's likely an optimistic vs server echo mismatch.
    // In that case, skip attachment comparison. If BOTH have attachments,
    // still compare them to distinguish genuinely different images.
    const isImagePlaceholder = IMAGE_PLACEHOLDERS_DEDUP.has(
      m.content.replace(/\s+/g, " ").trim(),
    );
    const isDup = seen.some((s) => {
      if (s.role !== m.role || s.contentKey !== contentKey) return false;
      if (Math.abs(s.ts - ts) >= 60_000) return false;
      // For image placeholders: skip att comparison if either side has no attachments
      if (isImagePlaceholder && (!attKey || !s.attKey)) return true;
      return s.attKey === attKey;
    });
    if (isDup) return false;
    seen.push({ role: m.role, contentKey, attKey, ts });
    return true;
  });
}

// ── Consecutive assistant merging ──

/**
 * Merge consecutive assistant messages into a single message per turn (#189).
 *
 * Gateway chat.history returns a single agent turn as multiple assistant messages
 * (text segments between tool_use blocks), but streaming produces one merged message.
 * This ensures history matches streaming behavior, preventing duplicate display.
 */
export function mergeConsecutiveAssistant(
  msgs: DisplayMessage[],
): DisplayMessage[] {
  if (msgs.length === 0) return [];
  const result: DisplayMessage[] = [];
  let accumulator: DisplayMessage | null = null;

  for (const m of msgs) {
    if (
      m.role === "assistant" &&
      accumulator &&
      accumulator.role === "assistant"
    ) {
      // #255: Detect overlapping/cumulative content before merging.
      // Gateway may return messages where each includes prior content (cumulative).
      // Naive join("\n\n") would produce "A\n\nA B\n\nA B C" duplication.
      const accTrimmed = accumulator.content.trimEnd();
      const mTrimmed = m.content.trimEnd();
      let mergedContent: string;
      if (mTrimmed.startsWith(accTrimmed)) {
        // New message is a superset of accumulator — use it directly
        mergedContent = m.content;
      } else if (accTrimmed.startsWith(mTrimmed)) {
        // Accumulator already contains everything — keep it
        mergedContent = accumulator.content;
      } else {
        // Truly separate content — join with separator
        const parts = [accumulator.content, m.content].filter(
          (s) => s.length > 0,
        );
        mergedContent = parts.join("\n\n");
      }
      const acc: DisplayMessage = accumulator!;
      accumulator = {
        ...acc,
        content: mergedContent,
        toolCalls: [...acc.toolCalls, ...m.toolCalls],
        attachments:
          acc.attachments || m.attachments
            ? [
                ...(acc.attachments || []),
                ...(m.attachments || []),
              ]
            : undefined,
      };
    } else {
      if (accumulator) result.push(accumulator);
      accumulator = { ...m };
    }
  }
  if (accumulator) result.push(accumulator);
  return result;
}
