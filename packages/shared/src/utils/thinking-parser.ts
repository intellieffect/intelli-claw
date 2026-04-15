/**
 * Thinking/Reasoning block parser (#222).
 *
 * Extracts thinking content from:
 * 1. type:"thinking" content blocks (structured API response)
 * 2. <think>...</think> inline tags (text-based)
 *
 * Uses WeakMap caching to avoid re-parsing the same content array.
 */

/**
 * Minimal content-part shape the parser needs. Kept local to avoid a
 * dependency on any transport-layer module (the original import was from
 * the now-removed gateway package).
 */
interface ContentPart {
  type: string;
  text?: string;
}

export interface ThinkingBlock {
  text: string;
}

export type ExtractThinkingResult = ThinkingExtractResult;

export interface ThinkingExtractResult {
  /** Extracted thinking blocks (non-empty only) */
  thinking: ThinkingBlock[];
  /** Content with thinking blocks/tags removed */
  cleanContent: string;
}

// WeakMap cache for array-based content (avoids re-parsing on re-render)
const arrayCache = new WeakMap<ContentPart[], ThinkingExtractResult>();

// Simple string cache (LRU-ish, capped at 100 entries)
const stringCache = new Map<string, ThinkingExtractResult>();
const STRING_CACHE_MAX = 100;

/**
 * Extract thinking blocks from message content.
 *
 * @param content - Raw message content (string or ContentPart array)
 * @returns Extracted thinking blocks and cleaned content string
 */
export function extractThinking(
  content: string | ContentPart[],
): ThinkingExtractResult {
  if (Array.isArray(content)) {
    return extractFromArray(content);
  }
  return extractFromString(content);
}

function extractFromArray(parts: ContentPart[]): ThinkingExtractResult {
  const cached = arrayCache.get(parts);
  if (cached) return cached;

  const thinking: ThinkingBlock[] = [];
  const textParts: string[] = [];

  for (const part of parts) {
    if (part.type === "thinking" && typeof part.text === "string") {
      const trimmed = part.text.trim();
      if (trimmed) {
        thinking.push({ text: trimmed });
      }
    } else if (part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text);
    }
    // Other types (image_url, image, tool_use, etc.) are preserved as-is
    // but not included in cleanContent string — they're handled separately.
  }

  // Also check for <think> tags in the text content
  const joinedText = textParts.join("");
  const inlineResult = extractInlineThinkTags(joinedText);

  const result: ThinkingExtractResult = {
    thinking: [...thinking, ...inlineResult.thinking],
    cleanContent: inlineResult.cleanContent,
  };

  arrayCache.set(parts, result);
  return result;
}

function extractFromString(content: string): ThinkingExtractResult {
  const cached = stringCache.get(content);
  if (cached) return cached;

  const result = extractInlineThinkTags(content);

  // Cap string cache size
  if (stringCache.size >= STRING_CACHE_MAX) {
    const firstKey = stringCache.keys().next().value;
    if (firstKey !== undefined) stringCache.delete(firstKey);
  }
  stringCache.set(content, result);
  return result;
}

/**
 * Extract <think>...</think> inline tags from text.
 * Handles:
 * - Multiple <think> blocks
 * - Unclosed <think> tags (treat rest of text as thinking)
 * - Empty <think></think> (filtered out)
 */
function extractInlineThinkTags(text: string): ThinkingExtractResult {
  const thinking: ThinkingBlock[] = [];
  // Match both closed and unclosed <think> tags
  const thinkRegex = /<think>([\s\S]*?)(?:<\/think>|$)/gi;
  let cleanContent = text;
  let match: RegExpExecArray | null;

  // Collect all matches first
  const matches: Array<{ full: string; inner: string }> = [];
  while ((match = thinkRegex.exec(text)) !== null) {
    matches.push({ full: match[0], inner: match[1] });
  }

  for (const m of matches) {
    const trimmed = m.inner.trim();
    if (trimmed) {
      thinking.push({ text: trimmed });
    }
    cleanContent = cleanContent.replace(m.full, "");
  }

  // Clean up whitespace artifacts from removal
  cleanContent = cleanContent.replace(/\n{3,}/g, "\n\n").trim();

  return { thinking, cleanContent };
}

/**
 * Clear caches (useful for testing).
 */
export function clearThinkingCache(): void {
  stringCache.clear();
  // WeakMap entries are automatically GC'd — no manual clear needed
}
