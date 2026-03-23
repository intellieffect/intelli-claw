import { describe, it, expect } from "vitest";
import { extractThinking, type ThinkingBlock } from "@intelli-claw/shared";
import type { ContentPart } from "@intelli-claw/shared";

describe("extractThinking", () => {
  it("returns empty thinking for plain string content", () => {
    const result = extractThinking("Hello world");
    expect(result.thinking).toEqual([]);
    expect(result.cleanContent).toBe("Hello world");
  });

  it("extracts thinking from ContentPart[] with type:'thinking'", () => {
    const content: ContentPart[] = [
      { type: "thinking", text: "Let me reason about this..." },
      { type: "text", text: "Here is my answer." },
    ];
    const result = extractThinking(content);
    expect(result.thinking).toEqual([{ text: "Let me reason about this..." }]);
    expect(result.cleanContent).toBe("Here is my answer.");
  });

  it("handles multiple thinking blocks", () => {
    const content: ContentPart[] = [
      { type: "thinking", text: "First thought" },
      { type: "text", text: "Part 1. " },
      { type: "thinking", text: "Second thought" },
      { type: "text", text: "Part 2." },
    ];
    const result = extractThinking(content);
    expect(result.thinking).toHaveLength(2);
    expect(result.thinking[0].text).toBe("First thought");
    expect(result.thinking[1].text).toBe("Second thought");
    expect(result.cleanContent).toBe("Part 1. Part 2.");
  });

  it("filters out empty thinking blocks", () => {
    const content: ContentPart[] = [
      { type: "thinking", text: "" },
      { type: "thinking", text: "  " },
      { type: "thinking", text: "Real thought" },
      { type: "text", text: "Answer" },
    ];
    const result = extractThinking(content);
    expect(result.thinking).toHaveLength(1);
    expect(result.thinking[0].text).toBe("Real thought");
  });

  it("parses inline <think> tags from string content", () => {
    const content = "<think>My reasoning here</think>The actual answer.";
    const result = extractThinking(content);
    expect(result.thinking).toEqual([{ text: "My reasoning here" }]);
    expect(result.cleanContent).toBe("The actual answer.");
  });

  it("parses multiple <think> tags", () => {
    const content = "<think>Thought 1</think>Part A<think>Thought 2</think>Part B";
    const result = extractThinking(content);
    expect(result.thinking).toHaveLength(2);
    expect(result.cleanContent).toBe("Part APart B");
  });

  it("handles content with no thinking at all", () => {
    const content: ContentPart[] = [
      { type: "text", text: "Just text" },
    ];
    const result = extractThinking(content);
    expect(result.thinking).toEqual([]);
    expect(result.cleanContent).toBe("Just text");
  });

  it("returns cached result for same array reference", () => {
    const content: ContentPart[] = [
      { type: "thinking", text: "Cached thought" },
      { type: "text", text: "Cached answer" },
    ];
    const result1 = extractThinking(content);
    const result2 = extractThinking(content);
    expect(result1).toBe(result2); // same reference = cached
  });

  it("handles thinking blocks with undefined text", () => {
    const content: ContentPart[] = [
      { type: "thinking" }, // no text field
      { type: "text", text: "Answer" },
    ];
    const result = extractThinking(content);
    expect(result.thinking).toEqual([]);
    expect(result.cleanContent).toBe("Answer");
  });

  it("trims whitespace from cleanContent after removing think tags", () => {
    const content = "  <think>reasoning</think>  The answer  ";
    const result = extractThinking(content);
    expect(result.cleanContent).toBe("The answer");
  });
});
