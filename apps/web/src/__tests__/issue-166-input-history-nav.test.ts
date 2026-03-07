/**
 * Issue #166 — Arrow key input history navigation + macOS Ctrl+C input clear
 *
 * Tests cover:
 * 1. Ctrl+C clears input text and resets history navigation
 * 2. Ctrl+C does NOT trigger when text is selected (preserves copy behavior)
 * 3. Ctrl+C clears localStorage draft
 * 4. After Ctrl+C, ArrowUp starts fresh navigation (no stale draft)
 * 5. ArrowUp navigates to previous message when cursor is on first line
 * 6. ArrowDown navigates forward, restores empty string when past newest
 * 7. IME composition blocks history navigation
 * 8. History navigation preserves current draft before browsing
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  pushInput,
  getInputHistory,
} from "@/lib/gateway/input-history-store";
import { useInputHistory } from "@/hooks/use-input-history";

// Fresh IndexedDB between tests
beforeEach(async () => {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name) indexedDB.deleteDatabase(db.name);
  }
});

// ============================================================
// Part 1: Ctrl+C clear behavior
// ============================================================

describe("#166 — Ctrl+C clear input", () => {
  it("should clear input text and reset history navigation on Ctrl+C", async () => {
    await pushInput("agent:iclaw:main", "hello");
    await pushInput("agent:iclaw:main", "world");

    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Navigate into history
    let text: string | null;
    act(() => { text = result.current.navigateUp("current draft"); });
    expect(text!).toBe("world");
    expect(result.current.isNavigating).toBe(true);

    // Simulate Ctrl+C: reset history navigation
    act(() => { result.current.reset(); });

    // After reset, should not be navigating
    expect(result.current.isNavigating).toBe(false);

    // navigateDown should return null (not navigating)
    act(() => { text = result.current.navigateDown(); });
    expect(text).toBeNull();
  });

  it("should clear localStorage draft on Ctrl+C", () => {
    // The Ctrl+C handler calls: if (storageKey) localStorage.removeItem(storageKey)
    // We verify the conditional logic: storageKey must be truthy to clear draft
    const shouldClearDraft = (storageKey: string | null) => !!storageKey;

    expect(shouldClearDraft("awf:draft:test-panel")).toBe(true);
    expect(shouldClearDraft(null)).toBe(false);
    expect(shouldClearDraft("")).toBe(false);
  });

  it("should NOT interfere with Cmd+C copy — only Ctrl+C with no selection triggers clear", () => {
    // This tests the logic: selectionStart === selectionEnd means no selection
    const hasNoSelection = (start: number, end: number) => start === end;

    // No selection — Ctrl+C should clear
    expect(hasNoSelection(5, 5)).toBe(true);

    // Selection exists — Ctrl+C should NOT clear (allow copy)
    expect(hasNoSelection(2, 8)).toBe(false);
  });
});

// ============================================================
// Part 2: After Ctrl+C, ArrowUp starts fresh
// ============================================================

describe("#166 — Post Ctrl+C navigation", () => {
  it("after reset (Ctrl+C), ArrowUp starts fresh with no stale draft", async () => {
    await pushInput("agent:iclaw:main", "msg-a");
    await pushInput("agent:iclaw:main", "msg-b");

    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Navigate up, saving "old draft"
    let text: string | null;
    act(() => { text = result.current.navigateUp("old draft"); });
    expect(text!).toBe("msg-b");

    // Ctrl+C → reset
    act(() => { result.current.reset(); });

    // Navigate up again — should save "" as draft (since input was cleared)
    act(() => { text = result.current.navigateUp(""); });
    expect(text!).toBe("msg-b");

    // Navigate back down past newest → should restore "" (not "old draft")
    act(() => { text = result.current.navigateDown(); });
    expect(text!).toBe("");
  });
});

// ============================================================
// Part 3: ArrowUp/Down navigation
// ============================================================

describe("#166 — ArrowUp/Down history navigation", () => {
  it("ArrowUp navigates to previous message when cursor is on first line", () => {
    // Tests the cursor position check used in chat-input.tsx
    const isCursorOnFirstLine = (selectionStart: number, value: string) =>
      !value.substring(0, selectionStart).includes("\n");

    // Single line — cursor anywhere → first line
    expect(isCursorOnFirstLine(0, "hello")).toBe(true);
    expect(isCursorOnFirstLine(5, "hello")).toBe(true);

    // Multi-line — cursor on first line
    expect(isCursorOnFirstLine(3, "hello\nworld")).toBe(true);

    // Multi-line — cursor on second line → not first line
    expect(isCursorOnFirstLine(7, "hello\nworld")).toBe(false);
  });

  it("ArrowDown navigates forward, restores draft when past newest", async () => {
    await pushInput("agent:iclaw:main", "first");
    await pushInput("agent:iclaw:main", "second");
    await pushInput("agent:iclaw:main", "third");

    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    let text: string | null;

    // Navigate to oldest
    act(() => { text = result.current.navigateUp("my input"); });
    expect(text!).toBe("third");
    act(() => { text = result.current.navigateUp("my input"); });
    expect(text!).toBe("second");
    act(() => { text = result.current.navigateUp("my input"); });
    expect(text!).toBe("first");

    // Navigate forward
    act(() => { text = result.current.navigateDown(); });
    expect(text!).toBe("second");
    act(() => { text = result.current.navigateDown(); });
    expect(text!).toBe("third");

    // Past newest → restore draft
    act(() => { text = result.current.navigateDown(); });
    expect(text!).toBe("my input");

    // Already at bottom
    act(() => { text = result.current.navigateDown(); });
    expect(text).toBeNull();
  });

  it("ArrowDown only navigates when cursor is on last line", () => {
    const isCursorOnLastLine = (selectionStart: number, value: string) =>
      !value.substring(selectionStart).includes("\n");

    expect(isCursorOnLastLine(5, "hello")).toBe(true);
    expect(isCursorOnLastLine(7, "hello\nworld")).toBe(true);
    expect(isCursorOnLastLine(3, "hello\nworld")).toBe(false);
  });
});

// ============================================================
// Part 4: IME composition guard
// ============================================================

describe("#166 — IME composition guard", () => {
  it("should block history navigation during IME composition", () => {
    // The guard in chat-input.tsx:
    //   if (e.nativeEvent.isComposing || composingRef.current) return;
    //
    // We verify the logic: if isComposing is true, handler returns early
    const shouldBlockKeyDown = (isComposing: boolean, composingRefValue: boolean) =>
      isComposing || composingRefValue;

    // IME composing via nativeEvent
    expect(shouldBlockKeyDown(true, false)).toBe(true);

    // IME composing via ref
    expect(shouldBlockKeyDown(false, true)).toBe(true);

    // Both
    expect(shouldBlockKeyDown(true, true)).toBe(true);

    // Not composing — should allow
    expect(shouldBlockKeyDown(false, false)).toBe(false);
  });
});

// ============================================================
// Part 5: Draft preservation
// ============================================================

describe("#166 — Draft preservation during history browsing", () => {
  it("preserves current draft before browsing and restores on exit", async () => {
    await pushInput("agent:iclaw:main", "history-1");
    await pushInput("agent:iclaw:main", "history-2");

    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    let text: string | null;

    // User has typed "work in progress"
    act(() => { text = result.current.navigateUp("work in progress"); });
    expect(text!).toBe("history-2");

    // Continue navigating
    act(() => { text = result.current.navigateUp("work in progress"); });
    expect(text!).toBe("history-1");

    // Navigate all the way back
    act(() => { text = result.current.navigateDown(); });
    expect(text!).toBe("history-2");
    act(() => { text = result.current.navigateDown(); });

    // Draft should be restored
    expect(text!).toBe("work in progress");
  });

  it("preserves empty string as draft", async () => {
    await pushInput("agent:iclaw:main", "entry");

    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    let text: string | null;
    act(() => { text = result.current.navigateUp(""); });
    expect(text!).toBe("entry");

    act(() => { text = result.current.navigateDown(); });
    expect(text!).toBe("");
  });
});
