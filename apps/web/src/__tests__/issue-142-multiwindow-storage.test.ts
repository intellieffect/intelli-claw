/**
 * #142 — 멀티 윈도우 시 localStorage 키 충돌 방지
 *
 * Web 환경에서 여러 브라우저 탭을 열면 windowStoragePrefix()가 항상 ""을 반환하여
 * 모든 탭이 동일한 localStorage 키를 공유하는 문제.
 *
 * 검증 대상:
 * 1. windowStoragePrefix() — Web 탭별 고유 prefix 생성
 * 2. queueStorageKey — prefix 적용 여부
 * 3. 레거시 마이그레이션 — 기존 "" prefix → 새 prefix 이전
 * 4. 공유/격리 정책 — 전역 키는 prefix 없이 유지
 */
import { describe, it, expect, beforeEach } from "vitest";
import { windowStoragePrefix } from "@/lib/utils";
import { resolveInitialSessionState } from "@/lib/session-continuity";
import fs from "fs";
import path from "path";

// ─── windowStoragePrefix 테스트 ───────────────────────────────────

describe("#142 — windowStoragePrefix() Web 탭 격리", () => {
  beforeEach(() => {
    // Clear the window id from sessionStorage
    sessionStorage.removeItem("__iclaw_window_id__");
    delete (window as any).electronAPI;
  });

  it("should return non-empty prefix in Web environment (no electronAPI)", () => {
    const prefix = windowStoragePrefix();
    expect(prefix).not.toBe("");
    expect(prefix.length).toBeGreaterThan(0);
  });

  it("should return consistent prefix within the same tab (idempotent)", () => {
    const first = windowStoragePrefix();
    const second = windowStoragePrefix();
    expect(first).toBe(second);
  });

  it("should store tab ID in sessionStorage under __iclaw_window_id__", () => {
    windowStoragePrefix();
    const stored = sessionStorage.getItem("__iclaw_window_id__");
    expect(stored).toBeTruthy();
    expect(typeof stored).toBe("string");
  });

  it("prefix should end with colon for key namespacing", () => {
    const prefix = windowStoragePrefix();
    expect(prefix.endsWith(":")).toBe(true);
  });

  it("should return empty prefix for Electron window 0 (backward compat)", () => {
    (window as any).electronAPI = { windowId: 0 };
    const prefix = windowStoragePrefix();
    expect(prefix).toBe("");
  });

  it("should return 'wN:' prefix for Electron window N > 0", () => {
    (window as any).electronAPI = { windowId: 3 };
    const prefix = windowStoragePrefix();
    expect(prefix).toBe("w3:");
  });

  it("should generate prefix based on sessionStorage (different tabs get different IDs)", () => {
    // First "tab"
    const prefix1 = windowStoragePrefix();
    const id1 = sessionStorage.getItem("__iclaw_window_id__");

    // Simulate second tab — clear sessionStorage window ID
    sessionStorage.removeItem("__iclaw_window_id__");

    // After clearing, next call should generate a NEW id
    const prefix2 = windowStoragePrefix();
    const id2 = sessionStorage.getItem("__iclaw_window_id__");

    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id2).not.toBe(id1);
  });

  it("prefix should start with 't' for Web tabs", () => {
    const prefix = windowStoragePrefix();
    expect(prefix.startsWith("t")).toBe(true);
  });
});

// ─── queueStorageKey prefix 테스트 ────────────────────────────────

describe("#142 — queueStorageKey must include windowStoragePrefix", () => {
  it("source code should include windowStoragePrefix in queueStorageKey construction", () => {
    const hooksPath = path.resolve(__dirname, "../lib/gateway/hooks.tsx");
    const source = fs.readFileSync(hooksPath, "utf-8");

    const lines = source.split("\n");
    const queueKeyLine = lines.find(
      (line) =>
        line.includes("queueStorageKey") &&
        line.includes("awf:") &&
        line.includes("queue")
    );
    expect(queueKeyLine).toBeDefined();
    expect(queueKeyLine).toContain("windowStoragePrefix()");
  });
});

// ─── 레거시 마이그레이션 테스트 ──────────────────────────────────

describe("#142 — Legacy key migration", () => {
  beforeEach(() => {
    sessionStorage.removeItem("__iclaw_window_id__");
    delete (window as any).electronAPI;
  });

  it("should read legacy (no-prefix) key as fallback for agent-remembered session", () => {
    // Build an in-memory store simulating existing user data
    const store: Record<string, string> = {
      "awf:lastSessionKey:test-agent": "agent:test-agent:main",
    };
    const getItem = (k: string) => store[k] ?? null;

    const prefix = windowStoragePrefix();
    const state = resolveInitialSessionState({
      windowPrefix: prefix,
      defaultAgentId: "test-agent",
      getItem,
    });

    // Should find the session via agentRememberedSessionKey fallback
    expect(state.sessionKey).toBe("agent:test-agent:main");
  });

  it("should prioritize scoped key over legacy key", () => {
    const prefix = windowStoragePrefix();

    const store: Record<string, string> = {
      // Legacy agent data
      "awf:agentId": "legacy-agent",
      // Scoped agent data (should win)
      [`awf:${prefix}agentId`]: "scoped-agent",
      // Session keys for both
      "awf:lastSessionKey:scoped-agent": "agent:scoped:s1",
      "awf:lastSessionKey:legacy-agent": "agent:legacy:s1",
    };
    const getItem = (k: string) => store[k] ?? null;

    const state = resolveInitialSessionState({
      windowPrefix: prefix,
      defaultAgentId: "default",
      getItem,
    });

    expect(state.agentId).toBe("scoped-agent");
  });

  it("should fall back to legacy agentId when scoped key is missing (upgrade path)", () => {
    const prefix = windowStoragePrefix();

    const store: Record<string, string> = {
      // Only legacy data — simulating user who had single-tab before upgrade
      "awf:agentId": "legacy-agent",
      "awf:lastSessionKey:legacy-agent": "agent:legacy:session1",
    };
    const getItem = (k: string) => store[k] ?? null;

    const state = resolveInitialSessionState({
      windowPrefix: prefix,
      defaultAgentId: "default",
      getItem,
    });

    // Should find legacy-agent via fallback
    expect(state.agentId).toBe("legacy-agent");
    expect(state.sessionKey).toBe("agent:legacy:session1");
  });
});

// ─── 공유 키 격리 정책 테스트 ─────────────────────────────────────

describe("#142 — Shared keys must NOT use window prefix", () => {
  it("gateway config key should not include window prefix", () => {
    const hooksPath = path.resolve(__dirname, "../lib/gateway/hooks.tsx");
    const source = fs.readFileSync(hooksPath, "utf-8");

    const lines = source.split("\n");
    const configLines = lines.filter(
      (line) =>
        line.includes("GATEWAY_CONFIG_STORAGE_KEY") &&
        line.includes("localStorage")
    );
    for (const line of configLines) {
      expect(line).not.toContain("windowStoragePrefix");
    }
  });

  it("hidden-sessions key should not include window prefix", () => {
    const hiddenPath = path.resolve(
      __dirname,
      "../lib/gateway/hidden-sessions.ts"
    );
    const source = fs.readFileSync(hiddenPath, "utf-8");
    expect(source).toContain('"awf:hidden-sessions"');
    expect(source).not.toContain("windowStoragePrefix");
  });

  it("shortcuts key should not include window prefix", () => {
    const shortcutsPath = path.resolve(__dirname, "../lib/shortcuts.ts");
    const source = fs.readFileSync(shortcutsPath, "utf-8");
    expect(source).toContain('"awf:custom-shortcuts"');
    expect(source).not.toContain("windowStoragePrefix");
  });
});

// ─── 격리 대상 키 통합 검증 ───────────────────────────────────────

describe("#142 — Storage key isolation integration", () => {
  beforeEach(() => {
    sessionStorage.removeItem("__iclaw_window_id__");
    delete (window as any).electronAPI;
  });

  it("two tabs should produce independent prefixes for localStorage keys", () => {
    // Tab 1
    const prefix1 = windowStoragePrefix();
    expect(prefix1).not.toBe("");

    // Simulate Tab 2
    sessionStorage.removeItem("__iclaw_window_id__");
    const prefix2 = windowStoragePrefix();

    // Different prefixes
    expect(prefix1).not.toBe(prefix2);

    // Using them as key namespaces produces distinct keys
    expect(`awf:${prefix1}sessionKey`).not.toBe(`awf:${prefix2}sessionKey`);
    expect(`awf:${prefix1}agentId`).not.toBe(`awf:${prefix2}agentId`);
    expect(`awf:${prefix1}draft:panel-1`).not.toBe(`awf:${prefix2}draft:panel-1`);
  });

  it("queue keys source should use windowStoragePrefix", () => {
    const hooksPath = path.resolve(__dirname, "../lib/gateway/hooks.tsx");
    const source = fs.readFileSync(hooksPath, "utf-8");

    const lines = source.split("\n");
    const queueLine = lines.find(
      (l) =>
        l.includes("queueStorageKey") &&
        l.includes("=") &&
        l.includes("queue")
    );
    expect(queueLine).toBeDefined();
    expect(queueLine).toContain("windowStoragePrefix");
  });

  it("hooks.tsx should import windowStoragePrefix from utils", () => {
    const hooksPath = path.resolve(__dirname, "../lib/gateway/hooks.tsx");
    const source = fs.readFileSync(hooksPath, "utf-8");
    const importLine = source
      .split("\n")
      .find(
        (l) =>
          l.includes("import") &&
          l.includes("windowStoragePrefix") &&
          l.includes("utils")
      );
    expect(importLine).toBeDefined();
  });
});
