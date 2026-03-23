import { describe, it, expect, beforeEach } from "vitest";
import {
  extractThinking,
  clearThinkingCache,
} from "@intelli-claw/shared/utils/thinking-parser";
import type { ContentPart } from "@intelli-claw/shared";

beforeEach(() => {
  clearThinkingCache();
});

describe("extractThinking", () => {
  describe("ContentPart[] (structured blocks)", () => {
    it("extracts type:thinking blocks", () => {
      const parts: ContentPart[] = [
        { type: "thinking", text: "Let me analyze this problem..." },
        { type: "text", text: "Here is my answer." },
      ];
      const result = extractThinking(parts);
      expect(result.thinking).toEqual([{ text: "Let me analyze this problem..." }]);
      expect(result.cleanContent).toBe("Here is my answer.");
    });

    it("handles multiple thinking blocks", () => {
      const parts: ContentPart[] = [
        { type: "thinking", text: "First thought" },
        { type: "text", text: "Response part 1" },
        { type: "thinking", text: "Second thought" },
        { type: "text", text: "Response part 2" },
      ];
      const result = extractThinking(parts);
      expect(result.thinking).toHaveLength(2);
      expect(result.thinking[0].text).toBe("First thought");
      expect(result.thinking[1].text).toBe("Second thought");
      expect(result.cleanContent).toBe("Response part 1Response part 2");
    });

    it("filters out empty thinking blocks", () => {
      const parts: ContentPart[] = [
        { type: "thinking", text: "" },
        { type: "thinking", text: "   " },
        { type: "thinking", text: "Valid thought" },
        { type: "text", text: "Answer" },
      ];
      const result = extractThinking(parts);
      expect(result.thinking).toHaveLength(1);
      expect(result.thinking[0].text).toBe("Valid thought");
    });

    it("handles no thinking blocks", () => {
      const parts: ContentPart[] = [
        { type: "text", text: "Just a normal response." },
      ];
      const result = extractThinking(parts);
      expect(result.thinking).toHaveLength(0);
      expect(result.cleanContent).toBe("Just a normal response.");
    });

    it("handles thinking-only response (no text)", () => {
      const parts: ContentPart[] = [
        { type: "thinking", text: "Deep thought" },
      ];
      const result = extractThinking(parts);
      expect(result.thinking).toEqual([{ text: "Deep thought" }]);
      expect(result.cleanContent).toBe("");
    });

    it("ignores non-text, non-thinking types", () => {
      const parts: ContentPart[] = [
        { type: "thinking", text: "Thought" },
        { type: "image_url", image_url: { url: "http://example.com/img.png" } },
        { type: "text", text: "Answer" },
        { type: "tool_use", id: "abc", name: "search" } as any,
      ];
      const result = extractThinking(parts);
      expect(result.thinking).toEqual([{ text: "Thought" }]);
      expect(result.cleanContent).toBe("Answer");
    });

    it("caches results for the same array reference", () => {
      const parts: ContentPart[] = [
        { type: "thinking", text: "Cached thought" },
        { type: "text", text: "Cached answer" },
      ];
      const result1 = extractThinking(parts);
      const result2 = extractThinking(parts);
      expect(result1).toBe(result2); // Same reference = cached
    });

    it("extracts inline <think> tags from text parts", () => {
      const parts: ContentPart[] = [
        { type: "text", text: "<think>Inline thought</think>Here is the answer." },
      ];
      const result = extractThinking(parts);
      expect(result.thinking).toEqual([{ text: "Inline thought" }]);
      expect(result.cleanContent).toBe("Here is the answer.");
    });

    it("combines structured thinking and inline think tags", () => {
      const parts: ContentPart[] = [
        { type: "thinking", text: "Structured thought" },
        { type: "text", text: "<think>Inline thought</think>Answer" },
      ];
      const result = extractThinking(parts);
      expect(result.thinking).toHaveLength(2);
      expect(result.thinking[0].text).toBe("Structured thought");
      expect(result.thinking[1].text).toBe("Inline thought");
      expect(result.cleanContent).toBe("Answer");
    });
  });

  describe("string content (inline tags)", () => {
    it("extracts <think> tags", () => {
      const result = extractThinking("<think>My reasoning</think>The answer is 42.");
      expect(result.thinking).toEqual([{ text: "My reasoning" }]);
      expect(result.cleanContent).toBe("The answer is 42.");
    });

    it("handles multiple <think> tags", () => {
      const result = extractThinking(
        "<think>First</think>Part 1<think>Second</think>Part 2",
      );
      expect(result.thinking).toHaveLength(2);
      expect(result.thinking[0].text).toBe("First");
      expect(result.thinking[1].text).toBe("Second");
      expect(result.cleanContent).toBe("Part 1Part 2");
    });

    it("handles unclosed <think> tag", () => {
      const result = extractThinking("<think>Unclosed thought\nstill thinking...");
      expect(result.thinking).toEqual([{ text: "Unclosed thought\nstill thinking..." }]);
      expect(result.cleanContent).toBe("");
    });

    it("filters empty <think></think>", () => {
      const result = extractThinking("<think></think>Normal text");
      expect(result.thinking).toHaveLength(0);
      expect(result.cleanContent).toBe("Normal text");
    });

    it("handles no think tags", () => {
      const result = extractThinking("Just normal content.");
      expect(result.thinking).toHaveLength(0);
      expect(result.cleanContent).toBe("Just normal content.");
    });

    it("is case-insensitive for tags", () => {
      const result = extractThinking("<THINK>Upper case</THINK>Answer");
      expect(result.thinking).toEqual([{ text: "Upper case" }]);
      expect(result.cleanContent).toBe("Answer");
    });

    it("handles multiline thinking content", () => {
      const result = extractThinking(
        "<think>\nLine 1\nLine 2\nLine 3\n</think>\nFinal answer.",
      );
      expect(result.thinking).toEqual([{ text: "Line 1\nLine 2\nLine 3" }]);
      expect(result.cleanContent).toBe("Final answer.");
    });

    it("caches string results", () => {
      const content = "<think>Cached</think>Answer";
      const result1 = extractThinking(content);
      const result2 = extractThinking(content);
      expect(result1).toBe(result2);
    });
  });
});
