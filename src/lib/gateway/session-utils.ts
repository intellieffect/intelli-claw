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
 * - agent:{agentId}:main:thread:{id}
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

  // agent:{id}:main:thread:{threadId}
  if (parts[2] === "main" && parts[3] === "thread" && parts[4]) {
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
  // e.g. agent:main:telegram:jarvis:direct:7366450954:thread:21127
  const threadIdx = parts.indexOf("thread");
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
  thread: "스레드",
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
