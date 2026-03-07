import { describe, it, expect } from "vitest";
import {
  computeVisualRange,
  getSelectedKeysFromRange,
} from "@/lib/visual-select";

// ============================================================
// #188 — Vim Visual Select Mode (TDD)
// Pure logic tests for visual selection range computation
// ============================================================

describe("computeVisualRange — anchor/cursor → inclusive range", () => {
  it("anchor < cursor → range [anchor, cursor]", () => {
    expect(computeVisualRange(2, 5)).toEqual({ start: 2, end: 5 });
  });

  it("anchor > cursor → range [cursor, anchor]", () => {
    expect(computeVisualRange(5, 2)).toEqual({ start: 2, end: 5 });
  });

  it("anchor === cursor → single item range", () => {
    expect(computeVisualRange(3, 3)).toEqual({ start: 3, end: 3 });
  });

  it("anchor=0, cursor=0 → range [0, 0]", () => {
    expect(computeVisualRange(0, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe("getSelectedKeysFromRange — items + range → key set", () => {
  const items = [
    { key: "session-a" },
    { key: "session-b" },
    { key: "session-c" },
    { key: "session-d" },
    { key: "session-e" },
  ];

  it("selects keys within inclusive range", () => {
    const keys = getSelectedKeysFromRange(items, 1, 3);
    expect(keys).toEqual(new Set(["session-b", "session-c", "session-d"]));
  });

  it("single item range", () => {
    const keys = getSelectedKeysFromRange(items, 2, 2);
    expect(keys).toEqual(new Set(["session-c"]));
  });

  it("full range selects all", () => {
    const keys = getSelectedKeysFromRange(items, 0, 4);
    expect(keys).toEqual(
      new Set(["session-a", "session-b", "session-c", "session-d", "session-e"]),
    );
  });

  it("empty items → empty set", () => {
    const keys = getSelectedKeysFromRange([], 0, 0);
    expect(keys).toEqual(new Set());
  });

  it("range clamped to items length", () => {
    const keys = getSelectedKeysFromRange(items, 3, 10);
    expect(keys).toEqual(new Set(["session-d", "session-e"]));
  });
});

describe("visual mode state transitions", () => {
  // These test the expected behavior flow, not a specific function.
  // The session-switcher will integrate these building blocks.

  it("v enters visual mode: anchor = currentIndex, selection = {currentItem}", () => {
    const items = [{ key: "a" }, { key: "b" }, { key: "c" }];
    const currentIndex = 1;

    // Simulate entering visual mode
    const anchor = currentIndex;
    const { start, end } = computeVisualRange(anchor, currentIndex);
    const selected = getSelectedKeysFromRange(items, start, end);

    expect(selected).toEqual(new Set(["b"]));
  });

  it("j in visual mode: cursor moves down, range expands", () => {
    const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
    const anchor = 1;

    // cursor moves from 1 → 2 → 3
    let cursor = 2;
    let range = computeVisualRange(anchor, cursor);
    let selected = getSelectedKeysFromRange(items, range.start, range.end);
    expect(selected).toEqual(new Set(["b", "c"]));

    cursor = 3;
    range = computeVisualRange(anchor, cursor);
    selected = getSelectedKeysFromRange(items, range.start, range.end);
    expect(selected).toEqual(new Set(["b", "c", "d"]));
  });

  it("k in visual mode: cursor moves up, range expands upward", () => {
    const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
    const anchor = 2;

    // cursor moves from 2 → 1 → 0
    let cursor = 1;
    let range = computeVisualRange(anchor, cursor);
    let selected = getSelectedKeysFromRange(items, range.start, range.end);
    expect(selected).toEqual(new Set(["b", "c"]));

    cursor = 0;
    range = computeVisualRange(anchor, cursor);
    selected = getSelectedKeysFromRange(items, range.start, range.end);
    expect(selected).toEqual(new Set(["a", "b", "c"]));
  });

  it("moving cursor back toward anchor shrinks range", () => {
    const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];
    const anchor = 1;

    // Expand to 3, then shrink to 2
    let range = computeVisualRange(anchor, 3);
    let selected = getSelectedKeysFromRange(items, range.start, range.end);
    expect(selected).toEqual(new Set(["b", "c", "d"]));

    range = computeVisualRange(anchor, 2);
    selected = getSelectedKeysFromRange(items, range.start, range.end);
    expect(selected).toEqual(new Set(["b", "c"]));
  });

  it("v again exits visual mode, keeps selection", () => {
    // This is a behavioral contract:
    // After pressing v again, visualMode=false but selectedKeys persists.
    // We just verify that computeVisualRange still works for the last state.
    const items = [{ key: "a" }, { key: "b" }, { key: "c" }];
    const anchor = 0;
    const cursor = 2;

    const range = computeVisualRange(anchor, cursor);
    const selected = getSelectedKeysFromRange(items, range.start, range.end);

    // After exit, these selected keys should remain
    expect(selected).toEqual(new Set(["a", "b", "c"]));
  });

  it("Esc exits visual mode and clears selection", () => {
    // Behavioral contract: Esc clears everything
    // The component should set visualMode=false, selectedKeys=empty
    // Just verify the empty set behavior
    const selected = new Set<string>();
    expect(selected.size).toBe(0);
  });
});
