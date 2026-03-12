import { describe, it, expect } from "vitest";
import {
  extractThinking,
  type ThinkingBlock,
  type ExtractedContent,
} from "@intelli-claw/shared";

describe("extractThinking", () => {
  // --- String input: <think> tag parsing ---

  it("extracts a single <think> block from a string", () => {
    const input = "<think>Let me reason about this.</think>Here is the answer.";
    const result = extractThinking(input);
    expect(result.visibleText).toBe("Here is the answer.");
    expect(result.thinkingBlocks).toHaveLength(1);
    expect(result.thinkingBlocks[0]).toEqual({
      type: "thinking",
      text: "Let me reason about this.",
    });
  });

  it("extracts multiple <think> blocks from a string", () => {
    const input =
      "<think>First thought.</think>Some text.<think>Second thought.</think>More text.";
    const result = extractThinking(input);
    expect(result.visibleText).toBe("Some text.More text.");
    expect(result.thinkingBlocks).toHaveLength(2);
    expect(result.thinkingBlocks[0].text).toBe("First thought.");
    expect(result.thinkingBlocks[1].text).toBe("Second thought.");
  });

  it("handles multiline <think> blocks", () => {
    const input = `<think>
Line 1
Line 2
</think>The answer is 42.`;
    const result = extractThinking(input);
    expect(result.visibleText).toBe("The answer is 42.");
    expect(result.thinkingBlocks).toHaveLength(1);
    expect(result.thinkingBlocks[0].text).toBe("\nLine 1\nLine 2\n");
  });

  it("returns no thinking blocks when there are no <think> tags", () => {
    const input = "Just a regular message with no thinking.";
    const result = extractThinking(input);
    expect(result.visibleText).toBe("Just a regular message with no thinking.");
    expect(result.thinkingBlocks).toHaveLength(0);
  });

  it("filters out empty <think> blocks from a string", () => {
    const input = "<think></think>Hello<think>   </think> world";
    const result = extractThinking(input);
    expect(result.visibleText).toBe("Hello world");
    expect(result.thinkingBlocks).toHaveLength(0);
  });

  it("handles <think> block at the end of string", () => {
    const input = "Answer first.<think>Reasoning after.</think>";
    const result = extractThinking(input);
    expect(result.visibleText).toBe("Answer first.");
    expect(result.thinkingBlocks).toHaveLength(1);
    expect(result.thinkingBlocks[0].text).toBe("Reasoning after.");
  });

  // --- Content block array input ---

  it("extracts thinking blocks from content block array", () => {
    const content = [
      { type: "thinking", text: "Let me think about this..." },
      { type: "text", text: "Here is my answer." },
    ];
    const result = extractThinking(content);
    expect(result.visibleText).toBe("Here is my answer.");
    expect(result.thinkingBlocks).toHaveLength(1);
    expect(result.thinkingBlocks[0]).toEqual({
      type: "thinking",
      text: "Let me think about this...",
    });
  });

  it("concatenates multiple text blocks", () => {
    const content = [
      { type: "thinking", text: "Reasoning..." },
      { type: "text", text: "Part 1. " },
      { type: "text", text: "Part 2." },
    ];
    const result = extractThinking(content);
    expect(result.visibleText).toBe("Part 1. Part 2.");
    expect(result.thinkingBlocks).toHaveLength(1);
  });

  it("handles content array with no thinking blocks", () => {
    const content = [
      { type: "text", text: "Just text." },
      { type: "image_url", image_url: { url: "https://example.com/img.png" } },
    ];
    const result = extractThinking(content);
    expect(result.visibleText).toBe("Just text.");
    expect(result.thinkingBlocks).toHaveLength(0);
  });

  it("filters empty thinking blocks from content array", () => {
    const content = [
      { type: "thinking", text: "" },
      { type: "thinking", text: "   " },
      { type: "thinking", text: "Valid thought." },
      { type: "text", text: "Answer." },
    ];
    const result = extractThinking(content);
    expect(result.visibleText).toBe("Answer.");
    expect(result.thinkingBlocks).toHaveLength(1);
    expect(result.thinkingBlocks[0].text).toBe("Valid thought.");
  });

  it("handles mixed content with thinking + text + thinking + text", () => {
    const content = [
      { type: "thinking", text: "First reasoning" },
      { type: "text", text: "First answer. " },
      { type: "thinking", text: "More reasoning" },
      { type: "text", text: "Second answer." },
    ];
    const result = extractThinking(content);
    expect(result.visibleText).toBe("First answer. Second answer.");
    expect(result.thinkingBlocks).toHaveLength(2);
    expect(result.thinkingBlocks[0].text).toBe("First reasoning");
    expect(result.thinkingBlocks[1].text).toBe("More reasoning");
  });

  it("handles content array with only thinking blocks", () => {
    const content = [
      { type: "thinking", text: "Just thinking..." },
    ];
    const result = extractThinking(content);
    expect(result.visibleText).toBe("");
    expect(result.thinkingBlocks).toHaveLength(1);
  });

  // --- Edge cases ---

  it("handles empty string", () => {
    const result = extractThinking("");
    expect(result.visibleText).toBe("");
    expect(result.thinkingBlocks).toHaveLength(0);
  });

  it("handles empty array", () => {
    const result = extractThinking([]);
    expect(result.visibleText).toBe("");
    expect(result.thinkingBlocks).toHaveLength(0);
  });

  it("preserves whitespace in visible text between think blocks", () => {
    const input = "Before <think>thought</think> after";
    const result = extractThinking(input);
    expect(result.visibleText).toBe("Before  after");
    expect(result.thinkingBlocks).toHaveLength(1);
  });

  it("handles thinking blocks with special characters", () => {
    const content = [
      { type: "thinking", text: "Consider x < y && z > w" },
      { type: "text", text: "Result: true" },
    ];
    const result = extractThinking(content);
    expect(result.thinkingBlocks[0].text).toBe("Consider x < y && z > w");
    expect(result.visibleText).toBe("Result: true");
  });

  it("handles content blocks where thinking has no text field", () => {
    const content = [
      { type: "thinking" },
      { type: "text", text: "Answer." },
    ];
    const result = extractThinking(content as any);
    expect(result.visibleText).toBe("Answer.");
    expect(result.thinkingBlocks).toHaveLength(0);
  });

  it("trims leading/trailing whitespace from visible text after extraction", () => {
    const input = "  <think>thought</think>  Hello world  ";
    const result = extractThinking(input);
    // We trim the visible text to avoid leading/trailing spaces from tag removal
    expect(result.visibleText).toBe("Hello world");
  });
});
