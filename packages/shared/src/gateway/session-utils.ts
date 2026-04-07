/**
 * Session key parsing and grouping utilities
 */

export interface ParsedSessionKey {
  agentId: string;
  type: "main" | "thread" | "cron" | "subagent" | "a2a" | "unknown";
  detail?: string;
  /** Channel the session came through (e.g. "telegram", "signal", "webchat") */
  channel?: string;
}

/**
 * Parse a session key into agent ID and type.
 * Patterns:
 * - agent:{agentId}:main
 * - agent:{agentId}:main:thread:{id}  (legacy)
 * - agent:{agentId}:main:topic:{id}   (preferred)
 * - agent:{agentId}:cron:{id}
 * - agent:{agentId}:subagent:{id}
 * - agent:{agentId}:agent:{targetAgent}:main
 */
export function parseSessionKey(key: string): ParsedSessionKey {
  const parts = key.split(":");

  if (parts[0] !== "agent" || parts.length < 3) {
    return { agentId: "unknown", type: "unknown", detail: key };
  }

  const agentId = parts[1];

  // agent:{id}:main:thread:{threadId} or agent:{id}:main:topic:{topicId}
  if (parts[2] === "main" && (parts[3] === "thread" || parts[3] === "topic") && parts[4]) {
    return { agentId, type: "thread", detail: parts[4] };
  }

  // agent:{id}:cron:{cronId}
  if (parts[2] === "cron" && parts[3]) {
    return { agentId, type: "cron", detail: parts[3] };
  }

  // agent:{id}:subagent:{subId}
  if (parts[2] === "subagent" && parts[3]) {
    return { agentId, type: "subagent", detail: parts[3] };
  }

  // agent:{id}:agent:{target}:main (A2A)
  if (parts[2] === "agent" && parts[3] && parts[4] === "main") {
    return { agentId, type: "a2a", detail: parts[3] };
  }

  // agent:{id}:main
  if (parts[2] === "main") {
    return { agentId, type: "main" };
  }

  // Channel-routed sessions: agent:{id}:{channel}:{bot}:{chatType}:{userId}:thread:{threadId}
  // or: agent:{id}:{channel}:{bot}:{chatType}:{userId}:topic:{topicId}
  // e.g. agent:main:telegram:mybot:direct:123456789:thread:001
  const threadIdx = Math.max(parts.indexOf("thread"), parts.indexOf("topic"));
  if (threadIdx > 2 && parts[threadIdx + 1]) {
    const channel = parts[2]; // telegram, signal, whatsapp, etc.
    return { agentId, type: "thread", detail: parts[threadIdx + 1], channel };
  }

  // Channel-routed main: agent:{id}:{channel}:{bot}:{chatType}:{userId}
  // (no :thread: suffix — treat as channel main)
  if (parts.length >= 4 && !["main", "cron", "subagent", "agent"].includes(parts[2])) {
    const channel = parts[2];
    return { agentId, type: "main", channel };
  }

  return { agentId, type: "unknown", detail: key };
}

const TYPE_LABELS: Record<string, string> = {
  main: "메인",
  thread: "토픽",
  cron: "크론",
  subagent: "서브에이전트",
  a2a: "A2A",
  unknown: "",
};

const CHANNEL_LABELS: Record<string, string> = {
  telegram: "텔레그램",
  signal: "시그널",
  whatsapp: "왓츠앱",
  discord: "디스코드",
  slack: "슬랙",
  webchat: "웹챗",
  imessage: "iMessage",
};

/**
 * Generate a human-friendly display name for a session
 */
export function sessionDisplayName(session: {
  key: string;
  label?: string | null;
  displayName?: string | null;
}): string {
  if (session.label) return session.label;

  const parsed = parseSessionKey(session.key);
  const typeLabel = TYPE_LABELS[parsed.type] || "";
  const channelLabel = parsed.channel ? CHANNEL_LABELS[parsed.channel] || parsed.channel : "";
  const prefix = channelLabel ? `[${channelLabel}] ` : "";

  switch (parsed.type) {
    case "main":
      return `${prefix}${parsed.agentId} ${typeLabel}`;
    case "thread":
      return `${prefix}${parsed.agentId} ${typeLabel} #${parsed.detail}`;
    case "cron":
      return `${parsed.agentId} ${typeLabel} ${parsed.detail}`;
    case "subagent":
      return `${parsed.agentId} ${typeLabel} ${parsed.detail?.slice(0, 8)}`;
    case "a2a":
      return `${parsed.agentId} → ${parsed.detail}`;
    default:
      return session.displayName || session.key;
  }
}

export interface SessionGroup {
  agentId: string;
  sessions: GatewaySession[];
}

export interface GatewaySession {
  key: string;
  kind?: string;
  label?: string | null;
  displayName?: string | null;
  channel?: string | null;
  updatedAt?: number;
  totalTokens?: number;
  model?: string;
  modelProvider?: string;
  /** Internal session UUID from gateway — changes on session reset */
  sessionId?: string;
}

// --- Topic close helpers (label-prefix convention) ---

export const CLOSED_PREFIX = "[closed] ";

/** Check if a session is closed by inspecting its label prefix */
export function isTopicClosed(session: { label?: string | null }): boolean {
  return typeof session.label === "string" && session.label.startsWith(CLOSED_PREFIX);
}

/**
 * Trailing-suffix marker added by `handleCloseTopic` when the simple
 * `[closed] {label}` form collides with another session that already owns
 * that label (gateway enforces unique labels).
 *
 * Format: ` #~abc123` — the leading `~` after `#` is the discriminator
 * that separates intelli-claw's collision marker from real chat-id-style
 * markers like Telegram's `#8224611555`. We will never accidentally strip
 * a user-meaningful suffix because `~` is essentially never present in
 * channel chat IDs.
 *
 * `getCleanLabel` strips both the `[closed] ` prefix AND this marker so
 * reopened topics return to their original human-readable label.
 */
export const CLOSED_SUFFIX_MARKER = " #~";
const CLOSED_SUFFIX_RE = /\s#~[A-Za-z0-9]{4,12}$/;

/** Get label without the [closed] prefix (and unique-collision suffix) for display */
export function getCleanLabel(session: { label?: string | null }): string {
  if (!session.label) return "";
  let label = session.label;
  if (label.startsWith(CLOSED_PREFIX)) {
    label = label.slice(CLOSED_PREFIX.length);
  }
  // Strip the collision-avoidance suffix (`{label} #~abc123`) if present.
  label = label.replace(CLOSED_SUFFIX_RE, "");
  return label;
}

/** Check if a session key represents a topic (thread/topic) session */
export function isTopicSession(key: string): boolean {
  return key.includes(":thread:") || key.includes(":topic:");
}

/**
 * Detect a *per-message dummy thread* — a session that channel adapters
 * (Telegram, etc.) generate one-per-inbound-message instead of grouping
 * into a real conversation thread.
 *
 * Distinguishing signal: in per-message dummy threads the segment IMMEDIATELY
 * after `:thread:` repeats the parent chat/user identifier. Compare:
 *
 *   Telegram (per-message dummy):
 *     `agent:main:telegram:direct:8224611555:thread:8224611555:23787`
 *                                  ^^^^^^^^^^         ^^^^^^^^^^
 *                                  parent userId      first thread segment
 *                                  (matches → dummy)
 *
 *   Slack (real conversation thread):
 *     `agent:main:slack:channel:c0apg78a5v4:thread:1774935958.629449`
 *                              ^^^^^^^^^^^         ^^^^^^^^^^^^^^^^^
 *                              channelId           Slack thread_ts
 *                              (doesn't match → real thread)
 *
 * Real Slack/Discord threads represent distinct user conversations and
 * MUST appear as separate tabs. Telegram per-message threads are noise
 * and should collapse into a single conversation tab.
 *
 * #321 (2026-04-07): the first version of this helper deduped ALL channel
 * threads, which collapsed Slack threads into a single tab. This pattern
 * test fixes that.
 */
function isPerMessageDummyThread(key: string): boolean {
  const parts = key.split(":");
  const ti = parts.indexOf("thread");
  if (ti < 0 || ti < 4) return false; // need at least `agent:{id}:{ch}:{kind}:{chatId}:thread:...`
  const parentChatId = parts[ti - 1]; // segment immediately before `:thread:`
  const firstThreadSeg = parts[ti + 1];
  if (!parentChatId || !firstThreadSeg) return false;
  return parentChatId === firstThreadSeg;
}

/**
 * Derive the *base conversation key* for a channel-routed session.
 *
 * Used to collapse Telegram-style per-message dummy threads (one session
 * per inbound message) into a single conversation tab. See
 * `isPerMessageDummyThread` for the distinguishing pattern — Slack-style
 * real threads are NOT collapsed.
 *
 * Returns:
 *   - For Telegram per-message dummies: parent key with `:thread:...` stripped
 *   - For channel `main` sessions: key unchanged (already the root)
 *   - For Slack/Discord real threads: key unchanged (each is its own conversation)
 *   - For everything else (plain main, cron, subagent, user `:topic:`):
 *     key unchanged so dedup is a no-op
 *
 * #321 (2026-04-07).
 */
export function conversationBaseKey(key: string): string {
  if (isPerMessageDummyThread(key)) {
    return key.replace(/:thread:[^:]+(:[^:]+)?$/, "");
  }
  return key;
}

/**
 * Dedupe channel-routed conversations by their base key, keeping the
 * FIRST occurrence per conversation (caller is responsible for sorting
 * by recency before invoking — typically `updatedAt` desc, with `main`
 * first if you want main pinned ahead of newer threads).
 *
 * Only Telegram-style per-message dummy threads are collapsed:
 *   - Telegram channel `main` + per-message dummy threads → 1 tab
 *   - Slack/Discord real threads → unchanged (each remains its own tab)
 *   - Plain `main`, user `:topic:`, cron, subagent → unchanged passthrough
 */
export function dedupeChannelConversations<T extends { key: string }>(
  sessions: T[],
): T[] {
  const seen = new Set<string>();
  return sessions.filter((s) => {
    const base = conversationBaseKey(s.key);
    if (seen.has(base)) return false;
    seen.add(base);
    return true;
  });
}

/**
 * Whether a session can be closed by the user (Cmd+D close-topic).
 *
 * Closable types:
 *   - `thread` — explicit topic/thread sessions (`agent:{id}:main:thread:{x}`)
 *   - `main` **with a channel** — channel-routed sessions like
 *     `agent:main:telegram:direct:{userId}`. Each channel chat is a
 *     separate `main` session as far as `parseSessionKey` is concerned,
 *     but from the user's perspective they're closable conversations.
 *
 * NOT closable:
 *   - Plain `main` (`agent:{id}:main`) — the canonical main session per
 *     agent should always remain open.
 *   - `cron` / `subagent` / `a2a` — managed by the runtime, not the user.
 *
 * Bug context (2026-04-07): Cmd+D appeared to silently fail on channel
 * sessions because the previous gate used `isTopicSession()`, which only
 * looks for `:thread:` / `:topic:` substrings. Channel-routed mains have
 * neither marker, so the gate dropped them. See PR for full trace.
 */
export function isClosableSession(key: string): boolean {
  const parsed = parseSessionKey(key);
  if (parsed.type === "thread") return true;
  if (parsed.type === "main" && parsed.channel) return true;
  return false;
}

/**
 * Group sessions by agent ID, sorted by most recent updatedAt within each group.
 * Groups are also sorted by most recent session.
 */
export function groupSessionsByAgent(sessions: GatewaySession[]): SessionGroup[] {
  const map = new Map<string, GatewaySession[]>();

  for (const s of sessions) {
    const parsed = parseSessionKey(s.key);
    const agent = parsed.agentId;
    if (!map.has(agent)) map.set(agent, []);
    map.get(agent)!.push(s);
  }

  // Sort sessions within each group by updatedAt desc
  const groups: SessionGroup[] = [];
  for (const [agentId, list] of map) {
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    groups.push({ agentId, sessions: list });
  }

  // Sort groups by most recent session
  groups.sort((a, b) => {
    const aTime = a.sessions[0]?.updatedAt || 0;
    const bTime = b.sessions[0]?.updatedAt || 0;
    return bTime - aTime;
  });

  return groups;
}
