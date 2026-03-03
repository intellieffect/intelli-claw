/**
 * issue-118-reply.test.ts — Reply/quote feature for messages (#118)
 *
 * TDD tests for:
 * - DisplayMessage replyTo field
 * - Reply message preservation of replyTo info
 * - Quote content truncation for preview
 * - Graceful fallback when replyTo target is deleted
 * - HIDDEN_REPLY_RE messages excluded from reply targets
 * - setReplyTo/clearReplyTo state management
 */
import { describe, it, expect } from "vitest";
import {
  HIDDEN_REPLY_RE,
  truncateForPreview,
  canBeReplyTarget,
  buildReplyTo,
} from "@/lib/gateway/hooks";
import type { DisplayMessage } from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Issue #118: Reply/Quote Feature", () => {
  describe("DisplayMessage replyTo field", () => {
    it("should allow replyTo field on DisplayMessage", () => {
      const msg: DisplayMessage = {
        id: "msg-1",
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
        toolCalls: [],
        replyTo: { id: "msg-0", content: "Original message", role: "assistant" },
      };
      expect(msg.replyTo).toBeDefined();
      expect(msg.replyTo!.id).toBe("msg-0");
      expect(msg.replyTo!.content).toBe("Original message");
      expect(msg.replyTo!.role).toBe("assistant");
    });

    it("should allow DisplayMessage without replyTo (backward compatible)", () => {
      const msg: DisplayMessage = {
        id: "msg-1",
        role: "user",
        content: "Hello",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      expect(msg.replyTo).toBeUndefined();
    });
  });

  describe("Reply message replyTo info preservation", () => {
    it("should preserve replyTo info when creating a reply message", () => {
      const original: DisplayMessage = {
        id: "orig-1",
        role: "assistant",
        content: "This is the original message",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };

      const replyTo = buildReplyTo(original);
      expect(replyTo).not.toBeNull();

      const reply: DisplayMessage = {
        id: "reply-1",
        role: "user",
        content: "My reply",
        timestamp: new Date().toISOString(),
        toolCalls: [],
        replyTo: replyTo!,
      };

      expect(reply.replyTo!.id).toBe("orig-1");
      expect(reply.replyTo!.content).toBe("This is the original message");
      expect(reply.replyTo!.role).toBe("assistant");
    });
  });

  describe("Quote content truncation for preview", () => {
    it("should not truncate short content", () => {
      expect(truncateForPreview("Short message")).toBe("Short message");
    });

    it("should truncate long content with ellipsis", () => {
      const long = "A".repeat(150);
      const preview = truncateForPreview(long);
      expect(preview.length).toBe(100);
      expect(preview.endsWith("…")).toBe(true);
    });

    it("should collapse newlines to spaces", () => {
      const multiline = "Line 1\nLine 2\nLine 3";
      expect(truncateForPreview(multiline)).toBe("Line 1 Line 2 Line 3");
    });

    it("should handle empty content", () => {
      expect(truncateForPreview("")).toBe("");
    });

    it("should handle content exactly at max length", () => {
      const exact = "B".repeat(100);
      expect(truncateForPreview(exact)).toBe(exact);
    });
  });

  describe("Graceful fallback when replyTo target is deleted", () => {
    it("should render reply even if original message is not in list", () => {
      const messages: DisplayMessage[] = [
        {
          id: "reply-1",
          role: "user",
          content: "My reply",
          timestamp: new Date().toISOString(),
          toolCalls: [],
          replyTo: { id: "deleted-msg", content: "This was deleted", role: "assistant" },
        },
      ];

      // The reply message should still have its replyTo info for rendering
      const replyMsg = messages.find((m) => m.replyTo);
      expect(replyMsg).toBeDefined();
      expect(replyMsg!.replyTo!.id).toBe("deleted-msg");
      expect(replyMsg!.replyTo!.content).toBe("This was deleted");

      // Original not in the list
      const original = messages.find((m) => m.id === "deleted-msg");
      expect(original).toBeUndefined();
    });
  });

  describe("HIDDEN_REPLY_RE messages excluded from reply targets", () => {
    it("should exclude NO_REPLY messages", () => {
      const msg: DisplayMessage = {
        id: "hidden-1",
        role: "assistant",
        content: "NO_REPLY",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      expect(canBeReplyTarget(msg)).toBe(false);
    });

    it("should exclude HEARTBEAT_OK messages", () => {
      const msg: DisplayMessage = {
        id: "hidden-2",
        role: "assistant",
        content: "HEARTBEAT_OK",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      expect(canBeReplyTarget(msg)).toBe(false);
    });

    it("should exclude system role messages", () => {
      const msg: DisplayMessage = {
        id: "sys-1",
        role: "system",
        content: "System notification",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      expect(canBeReplyTarget(msg)).toBe(false);
    });

    it("should exclude session-boundary messages", () => {
      const msg: DisplayMessage = {
        id: "boundary-1",
        role: "session-boundary",
        content: "",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      expect(canBeReplyTarget(msg)).toBe(false);
    });

    it("should allow normal user messages", () => {
      const msg: DisplayMessage = {
        id: "user-1",
        role: "user",
        content: "Hello there!",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      expect(canBeReplyTarget(msg)).toBe(true);
    });

    it("should allow normal assistant messages", () => {
      const msg: DisplayMessage = {
        id: "asst-1",
        role: "assistant",
        content: "Here is the answer",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      expect(canBeReplyTarget(msg)).toBe(true);
    });
  });

  describe("setReplyTo / clearReplyTo state management", () => {
    it("should set and clear replyTo state", () => {
      // Simulate the state management that useChat will provide
      let replyingTo: { id: string; content: string; role: string } | null = null;

      const setReplyTo = (msg: DisplayMessage) => {
        replyingTo = buildReplyTo(msg);
      };

      const clearReplyTo = () => {
        replyingTo = null;
      };

      expect(replyingTo).toBeNull();

      // Set reply target
      const target: DisplayMessage = {
        id: "target-1",
        role: "assistant",
        content: "Target message content",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      setReplyTo(target);
      expect(replyingTo).not.toBeNull();
      expect(replyingTo!.id).toBe("target-1");
      expect(replyingTo!.content).toBe("Target message content");

      // Clear
      clearReplyTo();
      expect(replyingTo).toBeNull();
    });

    it("should not set replyTo for hidden messages", () => {
      let replyingTo: { id: string; content: string; role: string } | null = null;

      const setReplyTo = (msg: DisplayMessage) => {
        replyingTo = buildReplyTo(msg);
      };

      const hiddenMsg: DisplayMessage = {
        id: "hidden-1",
        role: "assistant",
        content: "NO_REPLY",
        timestamp: new Date().toISOString(),
        toolCalls: [],
      };
      setReplyTo(hiddenMsg);
      expect(replyingTo).toBeNull();
    });
  });
});
