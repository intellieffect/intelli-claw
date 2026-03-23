import type { ContentPart } from "../gateway/protocol";

export interface ThinkingBlock {
  text: string;
}

export interface ExtractThinkingResult {
  thinking: ThinkingBlock[];
  cleanContent: string;
}

const THINK_TAG_RE = /<think>([\s\S]*?)<\/think>/g;

/** WeakMap cache for array-based content (same reference → same result) */
const arrayCache = new WeakMap<ContentPart[], ExtractThinkingResult>();

/** Map cache for string-based content */
const stringCache = new Map<string, ExtractThinkingResult>();
const STRING_CACHE_MAX = 200;

/**
 * Extract thinking blocks from message content.
 * Supports both ContentPart[] (type:"thinking") and inline <think> tags in strings.
 */
export function extractThinking(content: string | ContentPart[]): ExtractThinkingResult {
  if (Array.isArray(content)) {
    const cached = arrayCache.get(content);
    if (cached) return cached;

    const thinking: ThinkingBlock[] = [];
    let cleanContent = "";

    for (const part of content) {
      if (part.type === "thinking") {
        const text = part.text;
        if (text && text.trim()) {
          thinking.push({ text });
        }
      } else if (part.type === "text" && typeof part.text === "string") {
        cleanContent += part.text;
      }
    }

    const result: ExtractThinkingResult = { thinking, cleanContent };
    arrayCache.set(content, result);
    return result;
  }

  // String content — parse <think> tags
  const cached = stringCache.get(content);
  if (cached) return cached;

  const thinking: ThinkingBlock[] = [];
  let match: RegExpExecArray | null;
  const re = new RegExp(THINK_TAG_RE.source, THINK_TAG_RE.flags);

  while ((match = re.exec(content)) !== null) {
    const text = match[1];
    if (text && text.trim()) {
      thinking.push({ text });
    }
  }

  const cleanContent = content.replace(THINK_TAG_RE, "").trim();

  const result: ExtractThinkingResult = { thinking, cleanContent };

  // Evict oldest entries if cache grows too large
  if (stringCache.size >= STRING_CACHE_MAX) {
    const firstKey = stringCache.keys().next().value;
    if (firstKey !== undefined) stringCache.delete(firstKey);
  }
  stringCache.set(content, result);

  return result;
}
