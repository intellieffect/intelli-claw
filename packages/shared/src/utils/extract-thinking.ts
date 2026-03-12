/**
 * Thinking block extraction for extended thinking models.
 *
 * Handles two content formats:
 * 1. Content block array with `type: "thinking"` blocks (structured)
 * 2. Plain string with `<think>...</think>` tags (inline)
 */

export interface ThinkingBlock {
  type: "thinking";
  text: string;
}

export interface ExtractedContent {
  /** The visible text content with thinking blocks removed */
  visibleText: string;
  /** Extracted thinking/reasoning blocks */
  thinkingBlocks: ThinkingBlock[];
}

/** Minimal content block shape — only what we need for extraction */
interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * Extract thinking blocks from message content.
 *
 * @param content - Either a string (may contain `<think>` tags) or a content block array
 * @returns Separated visible text and thinking blocks
 */
export function extractThinking(content: string | ContentBlock[]): ExtractedContent {
  if (typeof content === "string") {
    return extractFromString(content);
  }
  if (Array.isArray(content)) {
    return extractFromBlocks(content);
  }
  return { visibleText: "", thinkingBlocks: [] };
}

/** Extract `<think>...</think>` tags from a string (supports multiline via dotAll) */
function extractFromString(text: string): ExtractedContent {
  const thinkingBlocks: ThinkingBlock[] = [];
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;

  let match: RegExpExecArray | null;
  while ((match = thinkRegex.exec(text)) !== null) {
    const thinkText = match[1];
    // Filter empty/whitespace-only blocks
    if (thinkText.trim()) {
      thinkingBlocks.push({ type: "thinking", text: thinkText });
    }
  }

  // Remove all <think>...</think> from visible text
  const visibleText = text.replace(thinkRegex, "").trim();

  return { visibleText, thinkingBlocks };
}

/** Extract `type: "thinking"` blocks from a content block array */
function extractFromBlocks(blocks: ContentBlock[]): ExtractedContent {
  const thinkingBlocks: ThinkingBlock[] = [];
  const textParts: string[] = [];

  for (const block of blocks) {
    if (block.type === "thinking") {
      if (typeof block.text === "string" && block.text.trim()) {
        thinkingBlocks.push({ type: "thinking", text: block.text });
      }
    } else if (block.type === "text" && typeof block.text === "string") {
      textParts.push(block.text);
    }
    // Other block types (image_url, tool_use, etc.) are ignored for text extraction
  }

  return {
    visibleText: textParts.join(""),
    thinkingBlocks,
  };
}
