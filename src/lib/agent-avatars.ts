/** Deterministic agent avatar with optional profile image from /agents/<id>.jpg */

const COLORS = [
  "bg-violet-500/20 text-violet-400",
  "bg-blue-500/20 text-blue-400",
  "bg-green-500/20 text-green-400",
  "bg-yellow-500/20 text-yellow-400",
  "bg-emerald-500/20 text-emerald-400",
  "bg-pink-500/20 text-pink-400",
  "bg-cyan-500/20 text-cyan-400",
  "bg-orange-500/20 text-orange-400",
  "bg-slate-500/20 text-slate-400",
  "bg-red-500/20 text-red-400",
  "bg-teal-500/20 text-teal-400",
  "bg-indigo-500/20 text-indigo-400",
  "bg-purple-500/20 text-purple-400",
  "bg-rose-500/20 text-rose-400",
  "bg-amber-500/20 text-amber-400",
  "bg-lime-500/20 text-lime-400",
];

export interface AgentAvatar {
  emoji: string;
  color: string;
  /** URL to agent profile image if available */
  imageUrl?: string;
}

const DEFAULT_AVATAR: AgentAvatar = { emoji: "🤖", color: "bg-primary/20 text-primary" };

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const cache = new Map<string, AgentAvatar>();

/**
 * Known agent profile images (from Telegram bot avatars).
 * Falls back to hash-based initials if not listed here.
 */
const AGENT_IMAGES: Record<string, string> = {
  main: "/agents/jarvis.jpg",
  jarvis: "/agents/jarvis.jpg",
  murim: "/agents/murim.jpg",
  mobidic: "/agents/mobidic.jpg",
  brxce: "/agents/brxce.jpg",
  tcscms: "/agents/tcscms.jpg",
  hongdon: "/agents/hongdon.jpg",
  odoo: "/agents/odoo.jpg",
  newscash: "/agents/newscash.jpg",
  seoa: "/agents/seoa.jpg",
};

export function getAgentAvatar(agentId?: string): AgentAvatar {
  if (!agentId) return DEFAULT_AVATAR;

  const key = agentId.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const h = hashCode(key);
  const initials = key.slice(0, 2).toUpperCase();
  const imageUrl = AGENT_IMAGES[key];
  const result: AgentAvatar = {
    emoji: initials,
    color: COLORS[h % COLORS.length],
    ...(imageUrl ? { imageUrl } : {}),
  };
  cache.set(key, result);
  return result;
}
