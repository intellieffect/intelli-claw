/**
 * issue-187-compaction-display.test.ts
 *
 * TDD tests for detecting compaction/system-injected messages
 * that arrive with role="user" from OpenClaw gateway.
 */
import { describe, it, expect } from "vitest";
import {
  detectSystemInjectedType,
  type SystemInjectedType,
} from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// detectSystemInjectedType(role, content)
// Returns null for normal messages, or a SystemInjectedType for system-injected
// ---------------------------------------------------------------------------
describe("detectSystemInjectedType", () => {
  // --- Should NOT detect as system-injected ---
  describe("normal user messages", () => {
    it("returns null for regular user text", () => {
      expect(detectSystemInjectedType("user", "안녕하세요")).toBeNull();
    });

    it("returns null for assistant messages", () => {
      expect(detectSystemInjectedType("assistant", "[System Message] test")).toBeNull();
    });

    it("returns null for user message containing 'summary' mid-text", () => {
      expect(detectSystemInjectedType("user", "Here is a summary of today")).toBeNull();
    });

    it("returns null for user message mentioning 'compacted' mid-text", () => {
      expect(detectSystemInjectedType("user", "I compacted the data yesterday")).toBeNull();
    });

    it("returns null for empty content", () => {
      expect(detectSystemInjectedType("user", "")).toBeNull();
    });

    it("returns null for user message starting with 'The' but not compaction", () => {
      expect(detectSystemInjectedType("user", "The weather is nice today")).toBeNull();
    });
  });

  // --- Existing patterns (must keep working) ---
  describe("existing system-injected patterns", () => {
    it("detects [System Message] prefix", () => {
      expect(detectSystemInjectedType("user", "[System Message] Session reset")).toBe("generic");
    });

    it("detects [sessionId: ...] prefix", () => {
      expect(detectSystemInjectedType("user", "[sessionId:abc123] some context")).toBe("generic");
    });

    it("detects System: [ prefix", () => {
      expect(detectSystemInjectedType("user", "System: [timestamp] event")).toBe("generic");
    });
  });

  // --- Compaction summary patterns ---
  describe("compaction summary detection", () => {
    it("detects compaction header line", () => {
      const content = "The conversation history before this point was compacted into the following summary:\n<summary>\nUser asked about weather.\n</summary>";
      expect(detectSystemInjectedType("user", content)).toBe("compaction");
    });

    it("detects compaction with slight wording variation", () => {
      const content = "The conversation history before this point was compacted into the following summary:\n\nSome summary text";
      expect(detectSystemInjectedType("user", content)).toBe("compaction");
    });

    it("detects content starting with <summary> tag", () => {
      const content = "<summary>\nThe user discussed project architecture.\n</summary>";
      expect(detectSystemInjectedType("user", content)).toBe("compaction");
    });
  });

  // --- Pre-compaction memory flush ---
  describe("memory flush detection", () => {
    it("detects pre-compaction memory flush", () => {
      const content = "Pre-compaction memory flush.\nKey decisions: use Redis for caching.";
      expect(detectSystemInjectedType("user", content)).toBe("memory-flush");
    });

    it("detects pre-compaction memory flush (exact match)", () => {
      expect(detectSystemInjectedType("user", "Pre-compaction memory flush.")).toBe("memory-flush");
    });
  });

  // --- Edge cases ---
  describe("edge cases", () => {
    it("handles multiline content correctly (compaction header on first line)", () => {
      const content = "The conversation history before this point was compacted into the following summary:\n<summary>short</summary>\n\nMore stuff";
      expect(detectSystemInjectedType("user", content)).toBe("compaction");
    });

    it("does not false-positive on assistant role even with compaction text", () => {
      const content = "The conversation history before this point was compacted into the following summary:";
      expect(detectSystemInjectedType("assistant", content)).toBeNull();
    });

    it("handles system role — returns null (already handled separately)", () => {
      expect(detectSystemInjectedType("system", "anything")).toBeNull();
    });
  });
});
