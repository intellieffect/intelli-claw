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

// Use globalThis to survive HMR without stale cache
const _g = globalThis as any;
if (!_g.__agentAvatarCache) _g.__agentAvatarCache = new Map<string, AgentAvatar>();
const cache: Map<string, AgentAvatar> = _g.__agentAvatarCache;
// Clear cache on module reload (HMR)
cache.clear();

/**
 * Agent profile images — dynamically resolved from /agents/<id>.jpg.
 * No hardcoded mapping needed; images are discovered at runtime.
 */

export function getAgentAvatar(agentId?: string): AgentAvatar {
  if (!agentId) return DEFAULT_AVATAR;

  const key = agentId.toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const h = hashCode(key);
  const initials = key.slice(0, 2).toUpperCase();
  // Try /agents/<id>.jpg — image will 404 gracefully if not present
  const imageUrl = `/agents/${key}.jpg`;
  const result: AgentAvatar = {
    emoji: initials,
    color: COLORS[h % COLORS.length],
    imageUrl,
  };
  cache.set(key, result);
  return result;
}
