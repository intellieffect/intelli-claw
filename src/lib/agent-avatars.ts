// Example agent avatar config — customize for your setup
/** Agent avatar map — emoji or initials for each known agent */

const AGENT_AVATARS: Record<string, { emoji: string; color: string }> = {
  karajan: { emoji: "🎼", color: "bg-violet-500/20 text-violet-400" },
  brxce: { emoji: "🧩", color: "bg-blue-500/20 text-blue-400" },
  roomfit: { emoji: "🏋️", color: "bg-green-500/20 text-green-400" },
  iponoff: { emoji: "💡", color: "bg-yellow-500/20 text-yellow-400" },
  finanz: { emoji: "💰", color: "bg-emerald-500/20 text-emerald-400" },
  obsidian: { emoji: "📝", color: "bg-purple-500/20 text-purple-400" },
  brand: { emoji: "🎨", color: "bg-pink-500/20 text-pink-400" },
  funnel: { emoji: "📊", color: "bg-cyan-500/20 text-cyan-400" },
  creator: { emoji: "✍️", color: "bg-orange-500/20 text-orange-400" },
  intelli: { emoji: "🏢", color: "bg-slate-500/20 text-slate-400" },
  newscash: { emoji: "📰", color: "bg-red-500/20 text-red-400" },
  lab: { emoji: "🧪", color: "bg-teal-500/20 text-teal-400" },
  kidsmind: { emoji: "🎹", color: "bg-indigo-500/20 text-indigo-400" },
};

const DEFAULT_AVATAR = { emoji: "🤖", color: "bg-primary/20 text-primary" };

export function getAgentAvatar(agentId?: string) {
  if (!agentId) return DEFAULT_AVATAR;
  return AGENT_AVATARS[agentId.toLowerCase()] || DEFAULT_AVATAR;
}
