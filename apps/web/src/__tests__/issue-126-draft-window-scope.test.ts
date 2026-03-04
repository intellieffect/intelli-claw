/**
 * Issue #126 — Electron 멀티 윈도우: 입력창 draft가 모든 창에서 공유되는 이슈
 *
 * chat-input.tsx의 draft 저장 키에 windowStoragePrefix()가 누락되어,
 * 모든 Electron 창이 동일한 localStorage 키를 사용하는 버그.
 *
 * TDD: 이 테스트는 수정 전에는 실패해야 함.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// --- Test subject: the draft storage key generation logic ---
// We extract and test the key generation pattern directly,
// then verify it matches what chat-input.tsx actually uses.

/**
 * Simulates windowStoragePrefix() for a given windowId.
 * This mirrors the real implementation in lib/utils.ts.
 */
function simulateWindowStoragePrefix(windowId: number | undefined): string {
  if (windowId === undefined || windowId === 0) return "";
  return `w${windowId}:`;
}

describe("Issue #126: Draft storage key window scoping", () => {
  beforeEach(() => {
    // jsdom의 localStorage.clear()가 없을 수 있으므로 수동 정리
    try {
      localStorage.clear();
    } catch {
      const keys = Object.keys(localStorage);
      keys.forEach((k) => localStorage.removeItem(k));
    }
  });

  describe("windowStoragePrefix() isolation", () => {
    it("should return empty string for window 0 (backward compat)", () => {
      expect(simulateWindowStoragePrefix(0)).toBe("");
    });

    it("should return 'w1:' for window 1", () => {
      expect(simulateWindowStoragePrefix(1)).toBe("w1:");
    });

    it("should return 'w2:' for window 2", () => {
      expect(simulateWindowStoragePrefix(2)).toBe("w2:");
    });
  });

  describe("Draft key must include windowStoragePrefix", () => {
    it("window 0 draft key should be 'awf:draft:panel-1'", () => {
      const prefix = simulateWindowStoragePrefix(0);
      const key = `awf:${prefix}draft:panel-1`;
      expect(key).toBe("awf:draft:panel-1");
    });

    it("window 1 draft key should be 'awf:w1:draft:panel-1'", () => {
      const prefix = simulateWindowStoragePrefix(1);
      const key = `awf:${prefix}draft:panel-1`;
      expect(key).toBe("awf:w1:draft:panel-1");
    });

    it("window 2 draft key should be 'awf:w2:draft:panel-1'", () => {
      const prefix = simulateWindowStoragePrefix(2);
      const key = `awf:${prefix}draft:panel-1`;
      expect(key).toBe("awf:w2:draft:panel-1");
    });

    it("different windows must NOT share the same draft key for same panelId", () => {
      const key0 = `awf:${simulateWindowStoragePrefix(0)}draft:panel-1`;
      const key1 = `awf:${simulateWindowStoragePrefix(1)}draft:panel-1`;
      const key2 = `awf:${simulateWindowStoragePrefix(2)}draft:panel-1`;
      expect(key0).not.toBe(key1);
      expect(key1).not.toBe(key2);
      expect(key0).not.toBe(key2);
    });
  });

  describe("Draft isolation simulation (Map-based storage)", () => {
    /**
     * jsdom의 localStorage가 불완전할 수 있으므로,
     * 실제 동작과 동일한 Map 기반으로 키 격리를 검증한다.
     */
    it("writing draft in window 1 should not affect window 2 draft", () => {
      const store = new Map<string, string>();
      const key1 = `awf:${simulateWindowStoragePrefix(1)}draft:panel-1`;
      const key2 = `awf:${simulateWindowStoragePrefix(2)}draft:panel-1`;

      store.set(key1, "창1의 메시지");
      store.set(key2, "창2의 메시지");

      expect(store.get(key1)).toBe("창1의 메시지");
      expect(store.get(key2)).toBe("창2의 메시지");
    });

    it("clearing window 1 draft should not clear window 0 draft", () => {
      const store = new Map<string, string>();
      const key0 = `awf:${simulateWindowStoragePrefix(0)}draft:panel-1`;
      const key1 = `awf:${simulateWindowStoragePrefix(1)}draft:panel-1`;

      store.set(key0, "메인 창 draft");
      store.set(key1, "서브 창 draft");

      store.delete(key1);

      expect(store.get(key0)).toBe("메인 창 draft");
      expect(store.get(key1)).toBeUndefined();
    });
  });

  describe("Source code verification: chat-input.tsx uses windowStoragePrefix", () => {
    /**
     * This test reads the actual source code to verify the fix is applied.
     * It ensures the storageKey line includes windowStoragePrefix.
     */
    it("storageKey in chat-input.tsx must include windowStoragePrefix()", async () => {
      // Import the actual source as text to verify the pattern
      const fs = await import("fs");
      const path = await import("path");
      const srcPath = path.resolve(
        __dirname,
        "../components/chat/chat-input.tsx"
      );
      const source = fs.readFileSync(srcPath, "utf-8");

      // The storageKey line must use windowStoragePrefix()
      // Correct:  `awf:${windowStoragePrefix()}draft:${panelId}`
      // Wrong:    `awf:draft:${panelId}`
      const storageKeyLine = source
        .split("\n")
        .find((line) => line.includes("storageKey") && line.includes("awf:") && line.includes("draft:"));

      expect(storageKeyLine).toBeDefined();
      expect(storageKeyLine).toContain("windowStoragePrefix()");
    });

    it("chat-input.tsx must import windowStoragePrefix from utils", async () => {
      const fs = await import("fs");
      const path = await import("path");
      const srcPath = path.resolve(
        __dirname,
        "../components/chat/chat-input.tsx"
      );
      const source = fs.readFileSync(srcPath, "utf-8");

      expect(source).toContain("windowStoragePrefix");
      // Verify it's imported, not just referenced in a comment
      const importLine = source
        .split("\n")
        .find(
          (line) =>
            line.includes("import") && line.includes("windowStoragePrefix")
        );
      expect(importLine).toBeDefined();
    });
  });
});
