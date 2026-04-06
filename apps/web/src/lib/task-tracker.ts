/**
 * task-tracker.ts — #284
 *
 * Lightweight helpers to summarise "what is this chat working on" for the
 * session manager panel. Pure functions so they can be unit-tested without
 * touching IndexedDB or React state.
 *
 * The input model is minimal on purpose — the caller (session-manager-panel)
 * already has access to sessions + the last rendered message per key, so we
 * only need the snippet and a timestamp.
 */

export interface TaskSummaryInput {
  /** The user-set or auto-generated topic/thread label, if any. */
  label?: string;
  /** The most recent user message text for this session, if any. */
  lastUserMessage?: string;
  /** The most recent assistant message text for this session, if any. */
  lastAssistantMessage?: string;
  /** Last activity timestamp (ms). */
  updatedAt?: number;
}

export interface TaskSummary {
  /** One-line headline that identifies the task. */
  headline: string;
  /** Optional longer hint (e.g. the user's last question). */
  hint?: string;
  /** `true` when neither label nor messages were available. */
  isEmpty: boolean;
}

/** Maximum characters for a summary headline before truncation. */
export const TASK_HEADLINE_MAX_LEN = 72;

/**
 * Build a task summary for a session.
 *
 * Priority:
 *   1. Explicit `label` when present and non-empty
 *   2. First sentence of the last user message
 *   3. First sentence of the last assistant message
 *   4. Empty summary (flag `isEmpty`)
 *
 * The returned `hint` is the next-best piece of context (e.g. the last user
 * message when the headline came from the label). It is always distinct
 * from the headline.
 */
export function buildTaskSummary(input: TaskSummaryInput): TaskSummary {
  const label = cleanup(input.label);
  const userMsg = cleanup(input.lastUserMessage);
  const asstMsg = cleanup(input.lastAssistantMessage);

  if (label) {
    return {
      headline: truncate(label, TASK_HEADLINE_MAX_LEN),
      hint: userMsg ? truncate(userMsg, TASK_HEADLINE_MAX_LEN) : undefined,
      isEmpty: false,
    };
  }
  if (userMsg) {
    return {
      headline: truncate(userMsg, TASK_HEADLINE_MAX_LEN),
      hint: asstMsg ? truncate(asstMsg, TASK_HEADLINE_MAX_LEN) : undefined,
      isEmpty: false,
    };
  }
  if (asstMsg) {
    return {
      headline: truncate(asstMsg, TASK_HEADLINE_MAX_LEN),
      isEmpty: false,
    };
  }
  return { headline: "", isEmpty: true };
}

/**
 * Compare two sessions for "recently active" ordering. Newer `updatedAt`
 * wins; ties break on alphabetical label so the order is deterministic.
 */
export function compareByRecency(
  a: { updatedAt?: number; label?: string },
  b: { updatedAt?: number; label?: string },
): number {
  const at = a.updatedAt ?? 0;
  const bt = b.updatedAt ?? 0;
  if (at !== bt) return bt - at;
  return (a.label ?? "").localeCompare(b.label ?? "");
}

// ─── Internal ────────────────────────────────────────────────────────────

function cleanup(text: string | undefined): string {
  if (!text) return "";
  // Strip leading slash commands, control tokens, collapse whitespace, trim.
  const stripped = text
    .replace(/^\s*\/(new|reset|compact|status|help|model\b[^\s]*|think\w*)\b\s*/i, "")
    .replace(/[\u0000-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Take first sentence (., !, ?, 。) or line break.
  const sentenceEnd = stripped.search(/[.!?。\n]/);
  if (sentenceEnd > 0) {
    return stripped.slice(0, sentenceEnd).trim();
  }
  return stripped;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 1)) + "…";
}
