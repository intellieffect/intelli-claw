/**
 * Session reset reason inference (#156)
 *
 * Since the OpenClaw Gateway does not yet provide a `resetReason` field
 * in `sessions.list`, we infer the reason from available context:
 *
 * - Token usage ratio → context_overflow
 * - Time of day + date change → daily reset
 * - Long inactivity → idle reset
 * - Explicit user action → manual
 *
 * When Gateway eventually adds `resetReason`, it takes precedence
 * via the `gatewayReason` field (future-proof).
 */

export type ResetReason =
  | "context_overflow"
  | "daily"
  | "idle"
  | "manual"
  | "unknown";

export interface ResetReasonContext {
  /** Token count at time of reset (old session's final state) */
  totalTokens?: number;
  /** Context window size for the model */
  contextTokens?: number;
  /** Pre-computed percent used (0-100) */
  percentUsed?: number;
  /** Timestamp of last user activity before reset */
  lastActiveAt?: number;
  /** Whether the user triggered this reset manually (/new, /reset) */
  isManual?: boolean;
  /** Gateway-provided reason (future-proof — takes precedence if present) */
  gatewayReason?: ResetReason;
  /** Configured daily reset hour (default: 4) */
  dailyResetHour?: number;
}

/** Threshold: token usage >= this % is considered context overflow */
const CONTEXT_OVERFLOW_THRESHOLD = 0.80;

/** Threshold: inactivity >= this duration (ms) is considered idle reset */
const IDLE_THRESHOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Infer the reason a session was reset from available context.
 *
 * Priority:
 * 1. Gateway-provided reason (future-proof)
 * 2. Manual flag
 * 3. Context overflow (token usage >= 80%)
 * 4. Daily reset (near daily reset hour, date changed or low usage)
 * 5. Idle reset (long inactivity)
 * 6. Unknown
 */
export function inferResetReason(ctx: ResetReasonContext): ResetReason {
  // 1. Gateway-provided reason always wins
  if (ctx.gatewayReason) {
    return ctx.gatewayReason;
  }

  // 2. Manual
  if (ctx.isManual) {
    return "manual";
  }

  // 3. Context overflow
  const usageRatio = computeUsageRatio(ctx);
  if (usageRatio !== null && usageRatio >= CONTEXT_OVERFLOW_THRESHOLD) {
    return "context_overflow";
  }

  // 4. Daily reset — check if we're near the daily reset hour
  const dailyHour = ctx.dailyResetHour ?? 4;
  const now = Date.now();
  const nowDate = new Date(now);
  const currentHour = nowDate.getHours();

  // Within ±1 hour of daily reset hour and token usage is low
  const nearDailyHour = Math.abs(currentHour - dailyHour) <= 1 ||
    (dailyHour === 0 && currentHour === 23) ||
    (dailyHour === 23 && currentHour === 0);

  if (nearDailyHour && (usageRatio === null || usageRatio < CONTEXT_OVERFLOW_THRESHOLD)) {
    return "daily";
  }

  // Also daily if date changed (last active on different day) and usage is low
  if (ctx.lastActiveAt) {
    const lastDate = new Date(ctx.lastActiveAt);
    const dateChanged =
      lastDate.getFullYear() !== nowDate.getFullYear() ||
      lastDate.getMonth() !== nowDate.getMonth() ||
      lastDate.getDate() !== nowDate.getDate();

    if (dateChanged && (usageRatio === null || usageRatio < CONTEXT_OVERFLOW_THRESHOLD)) {
      return "daily";
    }
  }

  // 5. Idle reset — long inactivity
  if (ctx.lastActiveAt) {
    const idleDuration = now - ctx.lastActiveAt;
    if (idleDuration >= IDLE_THRESHOLD_MS) {
      return "idle";
    }
  }

  // 6. Unknown
  return "unknown";
}

function computeUsageRatio(ctx: ResetReasonContext): number | null {
  if (ctx.percentUsed != null) {
    return ctx.percentUsed / 100;
  }
  if (ctx.totalTokens != null && ctx.contextTokens != null && ctx.contextTokens > 0) {
    return ctx.totalTokens / ctx.contextTokens;
  }
  return null;
}

// ---- UI Labels ----

export interface ResetReasonLabel {
  icon: string;
  text: string;
}

const LABELS: Record<ResetReason, ResetReasonLabel> = {
  context_overflow: { icon: "🔄", text: "세션 갱신됨 (컨텍스트 한도 도달)" },
  daily:           { icon: "🌅", text: "새로운 하루, 새 세션이 시작되었습니다" },
  idle:            { icon: "💤", text: "장시간 미활동으로 세션이 초기화되었습니다" },
  manual:          { icon: "🔄", text: "새 세션이 시작되었습니다" },
  unknown:         { icon: "🔄", text: "세션 갱신됨" },
};

export function resetReasonLabel(reason: ResetReason): ResetReasonLabel {
  return LABELS[reason] || LABELS.unknown;
}
