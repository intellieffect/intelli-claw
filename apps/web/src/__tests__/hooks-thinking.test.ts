/**
 * hooks-thinking.test.ts — Tests for thinking block extraction in hooks.tsx (#222).
 *
 * Verifies that the extractThinkingFromContent helper correctly extracts
 * thinking blocks from ChatMessage content for DisplayMessage creation.
 */
import { describe, it, expect } from "vitest";
import { extractThinkingFromContent } from "@/lib/gateway/hooks";

describe("extractThinkingFromContent", () => {
  it("returns empty thinking for plain string content", () => {
    const result = extractThinkingFromContent("Hello world");
    expect(result.thinking).toEqual([]);
    expect(result.thinkingText).toBe("");
  });

  it("extracts thinking blocks from ContentPart[]", () => {
    const content = [
      { type: "thinking", text: "Let me reason..." },
      { type: "text", text: "Here is the answer." },
    ];
    const result = extractThinkingFromContent(content);
    expect(result.thinking).toEqual([{ text: "Let me reason..." }]);
    expect(result.thinkingText).toBe("");
  });

  it("extracts thinking from string with <think> tags", () => {
    const content = "<think>My reasoning</think>The answer";
    const result = extractThinkingFromContent(content);
    expect(result.thinking).toEqual([{ text: "My reasoning" }]);
    expect(result.thinkingText).toBe("");
  });

  it("handles ContentPart[] with no thinking", () => {
    const content = [
      { type: "text", text: "Just text" },
    ];
    const result = extractThinkingFromContent(content);
    expect(result.thinking).toEqual([]);
    expect(result.thinkingText).toBe("");
  });

  it("accumulates thinking text during streaming from delta content", () => {
    // During streaming, thinking blocks arrive before text blocks
    const content = [
      { type: "thinking", text: "Step 1: analyze the question\nStep 2: formulate response" },
    ];
    const result = extractThinkingFromContent(content);
    expect(result.thinking).toHaveLength(1);
    expect(result.thinking[0].text).toContain("Step 1");
  });
});
