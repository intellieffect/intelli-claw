/**
 * TDD tests for issue #117: Agent sends bare "NO" messages to chat
 *
 * The HIDDEN_REPLY_RE regex fails to match "NO" (without trailing underscore).
 * This happens when NO_REPLY gets truncated to just "NO".
 */
import { describe, it, expect } from "vitest";
import { HIDDEN_REPLY_RE } from "@/lib/gateway/hooks";

// ---------------------------------------------------------------------------
// Direct regex matching tests
// ---------------------------------------------------------------------------
describe("#117 — HIDDEN_REPLY_RE must filter bare 'NO' messages", () => {
  describe("should match (hidden messages)", () => {
    it.each([
      ["NO", "bare NO"],
      ["NO ", "NO with trailing space"],
      ["NO\n", "NO with trailing newline"],
      ["NO  ", "NO with multiple trailing spaces"],
      ["NO_REPLY", "standard NO_REPLY"],
      ["NO_REPLY ", "NO_REPLY with trailing space"],
      ["NO_", "NO_ prefix"],
      ["HEARTBEAT_OK", "heartbeat"],
      ["HEARTBEAT_OK ", "heartbeat with trailing space"],
    ])("matches %j (%s)", (input) => {
      expect(HIDDEN_REPLY_RE.test(input.trim())).toBe(true);
    });
  });

  describe("should NOT match (legitimate messages)", () => {
    it.each([
      ["NO problem", "starts with NO but has more content"],
      ["I say NO to that", "NO in middle of sentence"],
      ["NOPE", "word starting with NO"],
      ["NOTHING to report", "word starting with NO"],
      ["Hello World!", "normal message"],
      ["Say no more", "lowercase no in sentence"],
      ["NOTICE: something happened", "word starting with NO"],
    ])("does not match %j (%s)", (input) => {
      expect(HIDDEN_REPLY_RE.test(input.trim())).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration-style: lifecycle end with "NO" content should be filtered
// ---------------------------------------------------------------------------
describe("#117 — lifecycle end filtering of bare 'NO'", () => {
  it("isHiddenReply helper filters 'NO' content", () => {
    // Reproduce the inline check from hooks.tsx line ~870
    const isHidden = (text: string) => HIDDEN_REPLY_RE.test(text.trim());

    expect(isHidden("NO")).toBe(true);
    expect(isHidden("NO ")).toBe(true);
    expect(isHidden("NO\n")).toBe(true);
    expect(isHidden(" NO ")).toBe(true);
    expect(isHidden("NO_REPLY")).toBe(true);

    // Legitimate messages must pass through
    expect(isHidden("NO problem")).toBe(false);
    expect(isHidden("I say NO to that")).toBe(false);
  });
});
