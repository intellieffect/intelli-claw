/**
 * chat-stream-core.ts — Platform-independent chat streaming utilities.
 *
 * Shared between web (hooks.tsx) and mobile (chatStateManager.ts).
 * Contains message filtering, content sanitization, and command detection.
 */

// ── Hidden message patterns ──

/**
 * Patterns for messages that should be hidden from the chat UI.
 * Used in streaming completion, history load, and display-layer filtering.
 */
export const HIDDEN_REPLY_RE =
  /^(NO_REPLY|REPLY_SKIP|HEARTBEAT_OK|NO_?)\s*$|Pre-compaction memory flush|^Read HEARTBEAT\.md|reply with NO_REPLY|Store durable memories now|(?:\[System\]|\(System\)|System:)\s*이전 세션이 컨텍스트 한도로 갱신|^이전 세션이 컨텍스트 한도로 갱신되었습니다\.\s*아래는 최근 대화 요약입니다\.|\[이전 세션 맥락\]/;

/**
 * Internal orchestration messages that should be hidden from the main chat.
 * These are subagent task prompts, coordination messages, etc. injected by
 * the gateway into the session history as user messages.
 */
export const INTERNAL_PROMPT_RE =
  /\[Subagent Context\]|\[Subagent Task\]|\[Request interrupted by user\]|You are running as a subagent/;

/** Strip trailing control tokens from message content for display */
export const TRAILING_CONTROL_TOKEN_RE =
  /\n{1,2}(REPLY_SKIP|NO_REPLY|HEARTBEAT_OK)\s*$/;

export function stripTrailingControlTokens(text: string): string {
  return text.replace(TRAILING_CONTROL_TOKEN_RE, "").trim();
}

// ── Content sanitization ──

/**
 * Strip gateway-injected metadata from inbound message text.
 * Removes: conversation info blocks, sender blocks, runtime context, timestamp prefixes.
 */
export function stripInboundMeta(text: string): string {
  let cleaned = text.replace(
    /Conversation info \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g,
    "",
  );
  cleaned = cleaned.replace(
    /Sender \(untrusted metadata\):\s*```json\s*\{[\s\S]*?\}\s*```\s*/g,
    "",
  );
  cleaned = cleaned.replace(
    /OpenClaw runtime context \(internal\):[\s\S]*$/g,
    "",
  );
  // Only strip gateway-injected timestamp prefixes like [2024-01-15 10:30:45+09:00]
  // Also handles day-prefixed format like [Sun 2026-03-08 10:45 GMT+9]
  // Do NOT strip arbitrary bracketed text like [important], [TODO], etc. (#55)
  cleaned = cleaned.replace(
    /^\[(?:\w{3}\s+)?\d{4}-\d{2}-\d{2}[\w\s\-:+]*\]\s*/g,
    "",
  );
  return cleaned.trim();
}

// ── Message visibility ──

/**
 * Check if a message should be hidden from the UI based on role and content.
 * Consolidates HIDDEN_REPLY_RE + INTERNAL_PROMPT_RE checks.
 */
export function isHiddenMessage(
  role: string,
  text: string,
): boolean {
  const trimmed = text.trim();
  if (HIDDEN_REPLY_RE.test(trimmed)) return true;
  if (role === "user" && INTERNAL_PROMPT_RE.test(trimmed)) return true;
  return false;
}

/**
 * Suppress short control-token prefixes during streaming to avoid transient
 * flashes like "N" or "NO" before hidden-message filtering fully resolves.
 */
export function shouldSuppressStreamingPreview(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (HIDDEN_REPLY_RE.test(t)) return true;
  return /^(N|NO|NO_|NO_R|NO_RE|NO_REP|NO_REPL|NO_REPLY|H|HE|HEA|HEAR|HEART|HEARTB|HEARTBE|HEARTBEA|HEARTBEAT|HEARTBEAT_|HEARTBEAT_O|HEARTBEAT_OK|R|RE|REP|REPL|REPLY|REPLY_|REPLY_S|REPLY_SK|REPLY_SKI|REPLY_SKIP)$/i.test(
    t,
  );
}

// ── Template variable stripping ──

/** Strip [[var]] template placeholders from message content. */
export function stripTemplateVars(text: string): string {
  return text.replace(/\[\[[^\]]+\]\]\s*/g, "").trim();
}

// ── Chat commands ──

/** Check if user input is a stop/abort command. */
export function isChatStopCommand(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return t === "/stop" || t === "stop" || t === "abort" || t === "/abort";
}

/** Check if user input is a session reset command. Returns message text after command if present. */
export function isChatResetCommand(
  text: string,
): { reset: boolean; message?: string } {
  const t = text.trim();
  if (!t) return { reset: false };
  if (/^\/new(\s|$)/i.test(t))
    return { reset: true, message: t.slice(4).trim() || undefined };
  if (/^\/reset(\s|$)/i.test(t))
    return { reset: true, message: t.slice(6).trim() || undefined };
  return { reset: false };
}
