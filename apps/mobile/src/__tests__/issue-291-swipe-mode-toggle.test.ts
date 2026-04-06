/**
 * #291 — iClaw 모바일: 스와이프 전환 에이전트↔스레드 설정 토글
 *
 * Tests cover:
 *   1. Pure helpers (`coerceSwipeMode`, `getNextIndex`) — no React, no async
 *   2. Source-text wiring (toggle prop pass-through) — same pattern as #293
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import { coerceSwipeMode, getNextIndex } from "../hooks/useSwipeMode";

const ROOT = path.resolve(__dirname, "../../");
const INPUTBAR = fs.readFileSync(
  path.join(ROOT, "src/components/chat/InputBar.tsx"),
  "utf-8",
);
const AGENT_CHAT_PAGE = fs.readFileSync(
  path.join(ROOT, "src/components/chat/AgentChatPage.tsx"),
  "utf-8",
);
const TABS_INDEX = fs.readFileSync(
  path.join(ROOT, "app/(tabs)/index.tsx"),
  "utf-8",
);

// ─── Pure helpers ────────────────────────────────────────────────────────

describe("#291 — coerceSwipeMode", () => {
  it("returns 'agent' for unknown / null / undefined", () => {
    expect(coerceSwipeMode(null, 3)).toBe("agent");
    expect(coerceSwipeMode(undefined, 3)).toBe("agent");
    expect(coerceSwipeMode("nonsense", 3)).toBe("agent");
    expect(coerceSwipeMode(42, 3)).toBe("agent");
  });

  it("preserves valid values", () => {
    expect(coerceSwipeMode("agent", 3)).toBe("agent");
    expect(coerceSwipeMode("topic", 3)).toBe("topic");
  });

  it("falls back to 'topic' when agentCount <= 1", () => {
    expect(coerceSwipeMode("agent", 1)).toBe("topic");
    expect(coerceSwipeMode("agent", 0)).toBe("topic");
    // Already topic — leave alone
    expect(coerceSwipeMode("topic", 1)).toBe("topic");
    expect(coerceSwipeMode("topic", 0)).toBe("topic");
  });

  it("does not coerce when agentCount >= 2", () => {
    expect(coerceSwipeMode("agent", 2)).toBe("agent");
    expect(coerceSwipeMode("agent", 10)).toBe("agent");
  });
});

describe("#291 — getNextIndex", () => {
  it("returns 0 when total <= 1", () => {
    expect(getNextIndex(0, 0, "left")).toBe(0);
    expect(getNextIndex(0, 1, "left")).toBe(0);
    expect(getNextIndex(0, 1, "right")).toBe(0);
  });

  it("left swipe advances forward (mod total)", () => {
    expect(getNextIndex(0, 3, "left")).toBe(1);
    expect(getNextIndex(1, 3, "left")).toBe(2);
    expect(getNextIndex(2, 3, "left")).toBe(0); // wrap
  });

  it("right swipe goes backward (mod total)", () => {
    expect(getNextIndex(2, 3, "right")).toBe(1);
    expect(getNextIndex(1, 3, "right")).toBe(0);
    expect(getNextIndex(0, 3, "right")).toBe(2); // wrap
  });
});

// ─── Source-text wiring ──────────────────────────────────────────────────

describe("#291 — InputBar swipe mode wiring", () => {
  it("InputBar imports SwipeModeToggle and SwipeMode type", () => {
    expect(INPUTBAR).toMatch(/from\s+["']\.\/SwipeModeToggle["']/);
    expect(INPUTBAR).toContain("SwipeMode");
  });

  it("InputBar accepts swipeMode / onSwipeModeChange props", () => {
    expect(INPUTBAR).toContain("swipeMode?:");
    expect(INPUTBAR).toContain("onSwipeModeChange?:");
  });

  it("InputBar renders <SwipeModeToggle /> when both swipeMode and handler are provided", () => {
    expect(INPUTBAR).toContain("<SwipeModeToggle");
    expect(INPUTBAR).toMatch(/showSwipeToggle/);
  });
});

describe("#291 — AgentChatPage forwards swipe mode props", () => {
  it("declares swipeMode / onSwipeModeChange in its props type", () => {
    expect(AGENT_CHAT_PAGE).toContain("swipeMode?:");
    expect(AGENT_CHAT_PAGE).toContain("onSwipeModeChange?:");
  });

  it("forwards swipeMode + handler to <InputBar />", () => {
    const inputBarJSX = AGENT_CHAT_PAGE.match(/<InputBar[\s\S]*?\/>/);
    expect(inputBarJSX).not.toBeNull();
    expect(inputBarJSX![0]).toContain("swipeMode={swipeMode}");
    expect(inputBarJSX![0]).toContain("onSwipeModeChange={onSwipeModeChange}");
  });
});

describe("#291 — (tabs)/index.tsx wires useSwipeMode", () => {
  it("imports useSwipeMode hook", () => {
    expect(TABS_INDEX).toMatch(/from\s+["'].*useSwipeMode["']/);
  });

  it("calls useSwipeMode with sortedAgents.length", () => {
    expect(TABS_INDEX).toMatch(/useSwipeMode\(sortedAgents\.length\)/);
  });

  it("passes swipeMode + setSwipeMode through AgentChatPage", () => {
    const agentChatPageJSX = TABS_INDEX.match(/<AgentChatPage[\s\S]*?\/>/);
    expect(agentChatPageJSX).not.toBeNull();
    expect(agentChatPageJSX![0]).toContain("swipeMode={swipeMode}");
    expect(agentChatPageJSX![0]).toContain("onSwipeModeChange={setSwipeMode}");
  });
});
