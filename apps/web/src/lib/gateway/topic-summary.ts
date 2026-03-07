/**
 * Topic Summary — pure client-side conversation summarizer.
 *
 * Extracts a short summary from user messages without LLM calls.
 * Used when closing a topic to persist a memory snapshot.
 */

import type { StoredMessage } from "./message-store";

/** Maximum number of recent user messages to consider */
const MAX_USER_MESSAGES = 5;
/** Maximum summary length in characters */
const MAX_SUMMARY_LENGTH = 120;

/**
 * Generate a short summary from conversation messages.
 *
 * Strategy:
 * 1. Take last N user messages
 * 2. Extract key phrases (first sentence or first line of each)
 * 3. Join and truncate
 *
 * No LLM calls — purely string-based extraction.
 */
export function generateTopicSummary(messages: StoredMessage[]): string {
  // Filter to user messages only
  const userMessages = messages.filter((m) => m.role === "user");

  if (userMessages.length === 0) return "";

  // Take last N user messages
  const recent = userMessages.slice(-MAX_USER_MESSAGES);

  // Extract first meaningful line from each message
  const phrases = recent
    .map((m) => extractKeyPhrase(m.content))
    .filter(Boolean);

  if (phrases.length === 0) return "";

  // Join with separator and truncate
  const joined = phrases.join(" · ");
  if (joined.length <= MAX_SUMMARY_LENGTH) return joined;
  return joined.slice(0, MAX_SUMMARY_LENGTH - 1) + "…";
}

/**
 * Extract the key phrase from a message content.
 * Takes the first sentence or first line, stripping commands and whitespace.
 */
function extractKeyPhrase(content: string): string {
  if (!content) return "";

  // Remove slash commands
  let text = content.replace(/^\/(new|reset|status|help|reasoning|model\s+\S+|think\S*|verbose\S*|stop|clear)\b[^\n]*/gi, "").trim();

  // Remove MEDIA: lines
  text = text.replace(/^MEDIA:[^\n]*/gm, "").trim();

  // Remove file attachment hints
  text = text.replace(/^📎\s*\[.*?\]\s*[^\n]*/gm, "").trim();

  if (!text) return "";

  // Take first line
  const firstLine = text.split("\n")[0].trim();

  // Take first sentence (if there's a period, question mark, or exclamation)
  const sentenceMatch = firstLine.match(/^(.+?[.?!。？！])\s/);
  const phrase = sentenceMatch ? sentenceMatch[1] : firstLine;

  // Truncate individual phrase
  if (phrase.length > 60) {
    return phrase.slice(0, 58) + "…";
  }

  return phrase;
}
