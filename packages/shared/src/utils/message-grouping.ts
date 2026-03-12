/**
 * Message grouping utility (#224)
 *
 * Groups consecutive same-role messages for visual compaction:
 * - Group top: avatar displayed once
 * - Group bottom: timestamp displayed once
 * - Messages within a group have reduced vertical spacing
 *
 * Grouping break conditions:
 * - Role change
 * - system / session-boundary messages (always standalone)
 * - Messages with tool calls (standalone card)
 * - Time gap > 5 minutes between consecutive messages
 */

/** Minimal message shape that the grouping utility requires */
export interface GroupableMessage {
  id: string;
  role: string;
  content: string;
  timestamp: string;
  toolCalls: { callId: string; name: string; status: string }[];
  streaming?: boolean;
}

export interface MessageGroup {
  role: string;
  messages: GroupableMessage[];
  firstMessageId: string;
  lastTimestamp: string;
}

/** 5 minutes in milliseconds */
const TIME_GAP_MS = 5 * 60 * 1000;

/** Roles that always form standalone groups (never merged with neighbors) */
const STANDALONE_ROLES = new Set(["system", "session-boundary"]);

/**
 * Returns true if the time gap between two ISO timestamps exceeds 5 minutes.
 * Returns false if either timestamp is empty or unparseable.
 */
function exceedsTimeGap(prevTimestamp: string, curTimestamp: string): boolean {
  if (!prevTimestamp || !curTimestamp) return false;
  const prevMs = Date.parse(prevTimestamp);
  const curMs = Date.parse(curTimestamp);
  if (Number.isNaN(prevMs) || Number.isNaN(curMs)) return false;
  return curMs - prevMs > TIME_GAP_MS;
}

/** Returns true if this message should be a standalone group */
function isStandalone(msg: GroupableMessage): boolean {
  if (STANDALONE_ROLES.has(msg.role)) return true;
  if (msg.toolCalls && msg.toolCalls.length > 0) return true;
  return false;
}

/**
 * Group consecutive same-role messages for visual rendering.
 *
 * The returned `MessageGroup[]` preserves the original message order.
 * Each group contains:
 * - `role`: the shared role for the group
 * - `messages`: array of messages in display order
 * - `firstMessageId`: id of the first message (used for avatar)
 * - `lastTimestamp`: timestamp of the last message (used for time display)
 */
export function groupMessages<T extends GroupableMessage>(messages: T[]): MessageGroup[] {
  if (messages.length === 0) return [];

  const groups: MessageGroup[] = [];
  let currentGroup: MessageGroup | null = null;

  for (const msg of messages) {
    const standalone = isStandalone(msg);

    // Determine if we need to start a new group
    const needsNewGroup =
      standalone ||
      !currentGroup ||
      currentGroup.role !== msg.role ||
      // Previous group was standalone (system/tool), must start fresh
      (currentGroup.messages.length === 1 && isStandalone(currentGroup.messages[0])) ||
      // Time gap exceeded
      exceedsTimeGap(currentGroup.lastTimestamp, msg.timestamp);

    if (needsNewGroup) {
      currentGroup = {
        role: msg.role,
        messages: [msg],
        firstMessageId: msg.id,
        lastTimestamp: msg.timestamp,
      };
      groups.push(currentGroup);
    } else {
      currentGroup!.messages.push(msg);
      currentGroup!.lastTimestamp = msg.timestamp;
    }
  }

  return groups;
}
