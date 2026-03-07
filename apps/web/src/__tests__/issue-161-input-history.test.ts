/**
 * Issue #161 — 채팅 입력 내용 히스토리 기억 (세션별 저장)
 *
 * Tests cover:
 * 1. InputHistoryStore: push, dedup, cap, session isolation, clear
 * 2. useInputHistory hook: navigation (up/down), draft preservation, reset, session change
 * 3. Cursor-position utilities for ArrowUp/Down integration
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  pushInput,
  getInputHistory,
  clearInputHistory,
  MAX_ENTRIES_PER_SESSION,
} from "@/lib/gateway/input-history-store";
import { useInputHistory } from "@/hooks/use-input-history";

// Fresh IndexedDB between tests (same pattern as message-store.test.ts)
beforeEach(async () => {
  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name) indexedDB.deleteDatabase(db.name);
  }
});

// ============================================================
// Part 1: InputHistoryStore
// ============================================================

describe("#161 — InputHistoryStore", () => {
  it("should push and retrieve input history for a session", async () => {
    await pushInput("agent:iclaw:main", "hello");
    await pushInput("agent:iclaw:main", "world");

    const entries = await getInputHistory("agent:iclaw:main");
    expect(entries).toHaveLength(2);
    expect(entries[0].text).toBe("hello");
    expect(entries[1].text).toBe("world");
  });

  it("should skip empty/whitespace-only inputs", async () => {
    await pushInput("agent:iclaw:main", "");
    await pushInput("agent:iclaw:main", "   ");
    await pushInput("agent:iclaw:main", "\n\t  ");

    const entries = await getInputHistory("agent:iclaw:main");
    expect(entries).toHaveLength(0);
  });

  it("should skip consecutive duplicate inputs", async () => {
    await pushInput("agent:iclaw:main", "hello");
    await pushInput("agent:iclaw:main", "hello");
    await pushInput("agent:iclaw:main", "hello");

    const entries = await getInputHistory("agent:iclaw:main");
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe("hello");
  });

  it("should allow non-consecutive duplicates", async () => {
    await pushInput("agent:iclaw:main", "hello");
    await pushInput("agent:iclaw:main", "world");
    await pushInput("agent:iclaw:main", "hello");

    const entries = await getInputHistory("agent:iclaw:main");
    expect(entries).toHaveLength(3);
  });

  it("should enforce MAX_ENTRIES_PER_SESSION cap", async () => {
    for (let i = 0; i < MAX_ENTRIES_PER_SESSION + 10; i++) {
      await pushInput("agent:iclaw:main", `msg-${i}`);
    }

    const entries = await getInputHistory("agent:iclaw:main");
    expect(entries).toHaveLength(MAX_ENTRIES_PER_SESSION);
    // Should keep the newest entries
    expect(entries[entries.length - 1].text).toBe(
      `msg-${MAX_ENTRIES_PER_SESSION + 9}`
    );
    // Oldest should be trimmed
    expect(entries[0].text).toBe(`msg-10`);
  });

  it("should isolate history between sessions", async () => {
    await pushInput("agent:iclaw:main", "iclaw-msg");
    await pushInput("agent:jarvis:main", "jarvis-msg");

    const iclawEntries = await getInputHistory("agent:iclaw:main");
    const jarvisEntries = await getInputHistory("agent:jarvis:main");

    expect(iclawEntries).toHaveLength(1);
    expect(iclawEntries[0].text).toBe("iclaw-msg");
    expect(jarvisEntries).toHaveLength(1);
    expect(jarvisEntries[0].text).toBe("jarvis-msg");
  });

  it("should clear history for a specific session only", async () => {
    await pushInput("agent:iclaw:main", "msg1");
    await pushInput("agent:iclaw:main", "msg2");
    await pushInput("agent:jarvis:main", "keep-me");

    await clearInputHistory("agent:iclaw:main");

    const iclawEntries = await getInputHistory("agent:iclaw:main");
    const jarvisEntries = await getInputHistory("agent:jarvis:main");
    expect(iclawEntries).toHaveLength(0);
    expect(jarvisEntries).toHaveLength(1);
  });

  it("should trim whitespace from stored text", async () => {
    await pushInput("agent:iclaw:main", "  hello world  ");
    const entries = await getInputHistory("agent:iclaw:main");
    expect(entries[0].text).toBe("hello world");
  });

  it("should return empty for undefined/empty sessionKey", async () => {
    await pushInput("", "should-not-store");
    const entries = await getInputHistory("");
    expect(entries).toHaveLength(0);
  });
});

// ============================================================
// Part 2: useInputHistory hook
// ============================================================

describe("#161 — useInputHistory hook", () => {
  it("should navigate up through history", async () => {
    await pushInput("agent:iclaw:main", "first");
    await pushInput("agent:iclaw:main", "second");
    await pushInput("agent:iclaw:main", "third");

    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));

    // Wait for async load
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    let text: string | null;
    act(() => { text = result.current.navigateUp("current draft"); });
    expect(text!).toBe("third");

    act(() => { text = result.current.navigateUp("current draft"); });
    expect(text!).toBe("second");

    act(() => { text = result.current.navigateUp("current draft"); });
    expect(text!).toBe("first");

    // At top — should return null
    act(() => { text = result.current.navigateUp("current draft"); });
    expect(text).toBeNull();
  });

  it("should navigate down and restore draft", async () => {
    await pushInput("agent:iclaw:main", "first");
    await pushInput("agent:iclaw:main", "second");

    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    let text: string | null;
    act(() => { text = result.current.navigateUp("my draft"); });
    expect(text!).toBe("second");

    act(() => { text = result.current.navigateUp("my draft"); });
    expect(text!).toBe("first");

    // Navigate down
    act(() => { text = result.current.navigateDown(); });
    expect(text!).toBe("second");

    // Navigate down past end → restore draft
    act(() => { text = result.current.navigateDown(); });
    expect(text!).toBe("my draft");

    // Navigate down when not navigating → null
    act(() => { text = result.current.navigateDown(); });
    expect(text).toBeNull();
  });

  it("should save draft only on first navigateUp call", async () => {
    await pushInput("agent:iclaw:main", "history-entry");

    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    let text: string | null;
    act(() => { text = result.current.navigateUp("original text"); });
    expect(text!).toBe("history-entry");

    // Navigate down → should restore "original text"
    act(() => { text = result.current.navigateDown(); });
    expect(text!).toBe("original text");
  });

  it("should reset navigation state after push", async () => {
    await pushInput("agent:iclaw:main", "old-entry");

    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Navigate into history
    act(() => { result.current.navigateUp(""); });

    // Push new entry → should reset
    act(() => { result.current.push("new-entry"); });

    // navigateDown should return null (not navigating)
    let text: string | null;
    act(() => { text = result.current.navigateDown(); });
    expect(text).toBeNull();

    // navigateUp should show the newly pushed entry
    act(() => { text = result.current.navigateUp(""); });
    expect(text!).toBe("new-entry");
  });

  it("should return null for empty history", async () => {
    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    let text: string | null;
    act(() => { text = result.current.navigateUp("draft"); });
    expect(text).toBeNull();
  });

  it("should reset cursor when session changes", async () => {
    await pushInput("agent:iclaw:main", "iclaw-msg");
    await pushInput("agent:jarvis:main", "jarvis-msg");

    const { result, rerender } = renderHook(
      ({ sk }) => useInputHistory(sk),
      { initialProps: { sk: "agent:iclaw:main" } },
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    let text: string | null;
    act(() => { text = result.current.navigateUp(""); });
    expect(text!).toBe("iclaw-msg");

    // Switch to jarvis
    rerender({ sk: "agent:jarvis:main" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Should not be navigating anymore
    act(() => { text = result.current.navigateDown(); });
    expect(text).toBeNull();

    // Navigate up should show jarvis history
    act(() => { text = result.current.navigateUp(""); });
    expect(text!).toBe("jarvis-msg");
  });

  it("should optimistically add to in-memory cache on push", async () => {
    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    act(() => { result.current.push("optimistic-entry"); });

    // Should be immediately navigable without waiting for IndexedDB
    let text: string | null;
    act(() => { text = result.current.navigateUp(""); });
    expect(text!).toBe("optimistic-entry");
  });

  it("should skip duplicate consecutive pushes in memory", async () => {
    const { result } = renderHook(() => useInputHistory("agent:iclaw:main"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    act(() => {
      result.current.push("same");
      result.current.push("same");
      result.current.push("same");
    });

    let text: string | null;
    act(() => { text = result.current.navigateUp(""); });
    expect(text!).toBe("same");

    // No more entries
    act(() => { text = result.current.navigateUp(""); });
    expect(text).toBeNull();
  });
});

// ============================================================
// Part 3: Cursor position utilities for ArrowUp/Down
// ============================================================

describe("#161 — cursor position utilities", () => {
  it("isCursorOnFirstLine: detects first line correctly", () => {
    const isCursorOnFirstLine = (selectionStart: number, value: string): boolean => {
      return !value.substring(0, selectionStart).includes("\n");
    };

    expect(isCursorOnFirstLine(5, "hello")).toBe(true);
    expect(isCursorOnFirstLine(0, "hello")).toBe(true);
    expect(isCursorOnFirstLine(3, "hello\nworld")).toBe(true);
    expect(isCursorOnFirstLine(7, "hello\nworld")).toBe(false);
    expect(isCursorOnFirstLine(0, "")).toBe(true);
  });

  it("isCursorOnLastLine: detects last line correctly", () => {
    const isCursorOnLastLine = (selectionStart: number, value: string): boolean => {
      return !value.substring(selectionStart).includes("\n");
    };

    expect(isCursorOnLastLine(5, "hello")).toBe(true);
    expect(isCursorOnLastLine(7, "hello\nworld")).toBe(true);
    expect(isCursorOnLastLine(3, "hello\nworld")).toBe(false);
    expect(isCursorOnLastLine(0, "")).toBe(true);
  });
});
