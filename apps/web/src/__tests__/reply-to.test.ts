/**
 * reply-to.test.ts — Tests for reply-to (quote reply) functionality (#79)
 *
 * Tests:
 * - ReplyTo type and helper functions (truncateForPreview, canBeReplyTarget, buildReplyTo)
 * - replyTo field persistence in StoredMessage
 * - DisplayMessage replyTo field
 */
import { describe, it, expect } from "vitest";
import {
  truncateForPreview,
  canBeReplyTarget,
  buildReplyTo,
  HIDDEN_REPLY_RE,
  type DisplayMessage,
  type ReplyTo,
} from "@/lib/gateway/hooks";
import type { StoredMessage, ReplyToData } from "@/lib/gateway/message-store";

// ---------------------------------------------------------------------------
// truncateForPreview
// ---------------------------------------------------------------------------
describe("truncateForPreview", () => {
  it("returns short text as-is", () => {
    expect(truncateForPreview("hello world")).toBe("hello world");
  });

  it("truncates long text with ellipsis", () => {
    const long = "a".repeat(200);
    const result = truncateForPreview(long, 100);
    expect(result.length).toBe(100);
    expect(result.endsWith("…")).toBe(true);
  });

  it("replaces newlines with spaces", () => {
    expect(truncateForPreview("line1\nline2\nline3")).toBe("line1 line2 line3");
  });

  it("handles empty string", () => {
    expect(truncateForPreview("")).toBe("");
  });

  it("uses default maxLen of 100", () => {
    const text = "x".repeat(150);
    const result = truncateForPreview(text);
    expect(result.length).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// canBeReplyTarget
// ---------------------------------------------------------------------------
describe("canBeReplyTarget", () => {
  const makeMsg = (role: string, content: string): DisplayMessage => ({
    id: "test-1",
    role: role as DisplayMessage["role"],
    content,
    timestamp: new Date().toISOString(),
    toolCalls: [],
  });

  it("allows user messages", () => {
    expect(canBeReplyTarget(makeMsg("user", "hello"))).toBe(true);
  });

  it("allows assistant messages", () => {
    expect(canBeReplyTarget(makeMsg("assistant", "hi there"))).toBe(true);
  });

  it("rejects system messages", () => {
    expect(canBeReplyTarget(makeMsg("system", "system info"))).toBe(false);
  });

  it("rejects session-boundary messages", () => {
    expect(canBeReplyTarget(makeMsg("session-boundary", ""))).toBe(false);
  });

  it("rejects hidden reply messages (NO_REPLY)", () => {
    expect(canBeReplyTarget(makeMsg("assistant", "NO_REPLY"))).toBe(false);
  });

  it("rejects HEARTBEAT_OK messages", () => {
    expect(canBeReplyTarget(makeMsg("assistant", "HEARTBEAT_OK"))).toBe(false);
  });

  it("rejects REPLY_SKIP messages", () => {
    expect(canBeReplyTarget(makeMsg("assistant", "REPLY_SKIP"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildReplyTo
// ---------------------------------------------------------------------------
describe("buildReplyTo", () => {
  const makeMsg = (id: string, role: string, content: string): DisplayMessage => ({
    id,
    role: role as DisplayMessage["role"],
    content,
    timestamp: new Date().toISOString(),
    toolCalls: [],
  });

  it("builds ReplyTo from a valid user message", () => {
    const msg = makeMsg("msg-1", "user", "What is React?");
    const reply = buildReplyTo(msg);
    expect(reply).toEqual({
      id: "msg-1",
      content: "What is React?",
      role: "user",
    });
  });

  it("builds ReplyTo from a valid assistant message", () => {
    const msg = makeMsg("msg-2", "assistant", "React is a JavaScript library.");
    const reply = buildReplyTo(msg);
    expect(reply).toEqual({
      id: "msg-2",
      content: "React is a JavaScript library.",
      role: "assistant",
    });
  });

  it("truncates long content in ReplyTo", () => {
    const longContent = "a".repeat(200);
    const msg = makeMsg("msg-3", "user", longContent);
    const reply = buildReplyTo(msg);
    expect(reply).not.toBeNull();
    expect(reply!.content.length).toBe(100);
    expect(reply!.content.endsWith("…")).toBe(true);
  });

  it("returns null for system messages", () => {
    const msg = makeMsg("msg-4", "system", "system message");
    expect(buildReplyTo(msg)).toBeNull();
  });

  it("returns null for hidden messages", () => {
    const msg = makeMsg("msg-5", "assistant", "NO_REPLY");
    expect(buildReplyTo(msg)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// StoredMessage replyTo field
// ---------------------------------------------------------------------------
describe("StoredMessage replyTo field", () => {
  it("can include replyTo data", () => {
    const replyTo: ReplyToData = {
      id: "original-msg-1",
      content: "Original question",
      role: "user",
    };

    const stored: StoredMessage = {
      sessionKey: "agent:ops:main",
      id: "reply-msg-1",
      role: "user",
      content: "This is a reply",
      timestamp: new Date().toISOString(),
      replyTo,
    };

    expect(stored.replyTo).toEqual(replyTo);
    expect(stored.replyTo!.id).toBe("original-msg-1");
    expect(stored.replyTo!.content).toBe("Original question");
    expect(stored.replyTo!.role).toBe("user");
  });

  it("replyTo is optional", () => {
    const stored: StoredMessage = {
      sessionKey: "agent:ops:main",
      id: "msg-no-reply",
      role: "assistant",
      content: "Regular message",
      timestamp: new Date().toISOString(),
    };

    expect(stored.replyTo).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// DisplayMessage replyTo field
// ---------------------------------------------------------------------------
describe("DisplayMessage replyTo integration", () => {
  it("DisplayMessage can carry replyTo", () => {
    const replyTo: ReplyTo = {
      id: "orig-1",
      content: "What is TypeScript?",
      role: "user",
    };

    const msg: DisplayMessage = {
      id: "reply-1",
      role: "assistant",
      content: "TypeScript is...",
      timestamp: new Date().toISOString(),
      toolCalls: [],
      replyTo,
    };

    expect(msg.replyTo).toEqual(replyTo);
  });

  it("multiline content is flattened in preview", () => {
    const content = "Line 1\nLine 2\nLine 3";
    const preview = truncateForPreview(content);
    expect(preview).toBe("Line 1 Line 2 Line 3");
    expect(preview).not.toContain("\n");
  });
});
