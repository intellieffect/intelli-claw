/**
 * Issue #297 — 내용 작성 중일 때 스크롤 작동 안되는 이슈
 *
 * When the user types a multi-line message, the chat input's textarea grows,
 * which shrinks the message list container. The ResizeObserver previously
 * interpreted this as "user scrolled up" and disabled auto-scroll.
 *
 * This test pins the fix: layout-induced resizes must NOT flip the
 * `userScrolledUp` flag from false → true. If the user was at the bottom
 * before the resize, they should stay at the bottom.
 */
import { describe, it, expect } from "vitest";
import { shouldMarkScrolledUpOnResize } from "@/components/chat/message-list";

describe("issue #297 — shouldMarkScrolledUpOnResize", () => {
  it("preserves at-bottom state when textarea growth shrinks container", () => {
    // Scenario: user was at bottom (wasAtBottom=true). Textarea grew by 100px,
    // clientHeight: 500 → 400. distanceFromBottom = 2000 - 1500 - 400 = 100.
    const result = shouldMarkScrolledUpOnResize({
      wasAtBottom: true,
      distanceFromBottom: 100,
    });
    expect(result).toBe(false);
  });

  it("preserves at-bottom state even when distance grows far past threshold", () => {
    // Large textarea expansion (e.g., pasting a long block) — container shrinks
    // dramatically but the user's intent was still "stay pinned to bottom".
    const result = shouldMarkScrolledUpOnResize({
      wasAtBottom: true,
      distanceFromBottom: 500,
    });
    expect(result).toBe(false);
  });

  it("keeps scrolled-up state when user had already scrolled up", () => {
    // If the user had genuinely scrolled up before the resize, don't undo that.
    const result = shouldMarkScrolledUpOnResize({
      wasAtBottom: false,
      distanceFromBottom: 300,
    });
    expect(result).toBe(true);
  });

  it("recovers to at-bottom when resize brings user back to bottom", () => {
    // Keyboard dismiss / textarea shrink can bring a previously-scrolled-up
    // user back to the bottom if the container now fits all content.
    const result = shouldMarkScrolledUpOnResize({
      wasAtBottom: false,
      distanceFromBottom: 40, // within threshold
    });
    expect(result).toBe(false);
  });

  it("treats at-bottom state as sticky across layout-only resizes", () => {
    // Mobile keyboard appears: clientHeight 800 → 500, scrollTop unchanged.
    // distanceFromBottom jumps from 0 to 300, but the user did not scroll.
    const result = shouldMarkScrolledUpOnResize({
      wasAtBottom: true,
      distanceFromBottom: 300,
    });
    expect(result).toBe(false);
  });
});
