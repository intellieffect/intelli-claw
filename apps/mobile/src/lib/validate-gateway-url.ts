/**
 * validate-gateway-url.ts — #268
 *
 * Defensive guards for Gateway URL values arriving from external sources
 * (QR scans, deep links, pasted config). Without these, a URL with stray
 * whitespace or a missing scheme reaches `new WebSocket(url)` and throws
 * a hard error that the user sees as a silent connection failure.
 */

export interface GatewayUrlValidation {
  ok: boolean;
  /** Sanitised URL safe to pass to `new WebSocket(...)`. Only set when ok. */
  url?: string;
  /** Human-readable Korean error when `ok` is false. */
  error?: string;
}

/**
 * Validate and normalise a user-supplied Gateway URL.
 *
 * Accepts only `ws://` or `wss://` schemes. Leading/trailing whitespace is
 * trimmed. Empty input returns a specific error so the UI can show a useful
 * message instead of a generic failure.
 */
export function validateGatewayUrl(raw: unknown): GatewayUrlValidation {
  if (typeof raw !== "string") {
    return { ok: false, error: "Gateway URL이 문자열이 아닙니다." };
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return { ok: false, error: "Gateway URL이 비어 있습니다." };
  }
  if (!/^wss?:\/\//i.test(trimmed)) {
    return {
      ok: false,
      error: "Gateway URL은 wss:// 또는 ws:// 로 시작해야 합니다.",
    };
  }
  // Try the native URL parser as a final sanity check — this catches
  // malformed hosts (e.g. "wss://:18789", "wss:// ", encoding issues).
  try {
    // eslint-disable-next-line no-new
    new URL(trimmed);
  } catch {
    return {
      ok: false,
      error: "Gateway URL 형식이 잘못되었습니다.",
    };
  }
  return { ok: true, url: trimmed };
}

/**
 * Normalise an optional token field — coerces `undefined`/`null`/non-string
 * to empty string and trims whitespace. Tokens frequently pick up trailing
 * newlines from QR encoders.
 */
export function normalizeToken(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim();
}
