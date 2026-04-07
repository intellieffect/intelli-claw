/**
 * Cmd+D close topic — label collision regression
 *
 * Symptom (2026-04-07):
 *   - User presses Cmd+D on a Telegram-spawned topic whose label is shared
 *     by another session (e.g. multiple `[텔레그램] main 토픽 #1234` rows).
 *   - One of them is already closed → its label is `[closed] [텔레그램] main 토픽 #1234`.
 *   - `handleCloseTopic` would patch the second session with the same
 *     `[closed] {label}` value → gateway rejects with
 *     `INVALID_REQUEST label already in use: ...` (see
 *     `~/.openclaw/workspace/openclaw-repo/src/gateway/sessions-patch.ts:208`).
 *   - The catch block only logged to console → silent UI fail.
 *
 * Fix:
 *   - On collision, retry once with a unique sessionId-derived suffix
 *     (`[closed] {label} #abc123`).
 *   - `getCleanLabel` now strips both the prefix AND that suffix so
 *     reopen returns the original label cleanly.
 */
import { describe, it, expect } from "vitest";
import {
  CLOSED_PREFIX,
  isTopicClosed,
  getCleanLabel,
} from "@intelli-claw/shared";

describe("close-topic label collision (Cmd+D)", () => {
  describe("getCleanLabel — strips prefix and unique suffix", () => {
    it("returns empty string for null/missing label", () => {
      expect(getCleanLabel({ label: null })).toBe("");
      expect(getCleanLabel({})).toBe("");
    });

    it("strips a bare [closed] prefix", () => {
      expect(getCleanLabel({ label: `${CLOSED_PREFIX}버그 수정` })).toBe("버그 수정");
    });

    it("strips prefix + collision-avoidance suffix #~abc123", () => {
      const closed = `${CLOSED_PREFIX}[텔레그램] main 토픽 #8224611555 #~abc123`;
      expect(getCleanLabel({ label: closed })).toBe("[텔레그램] main 토픽 #8224611555");
    });

    it("does NOT strip a chat-id-style #digits suffix that is part of the original label", () => {
      // The discriminator is `#~`, not bare `#`. Telegram chat IDs use bare
      // `#12345` and must NEVER be stripped — they're part of the human label.
      const closed = `${CLOSED_PREFIX}[텔레그램] main 토픽 #8224611555`;
      expect(getCleanLabel({ label: closed })).toBe("[텔레그램] main 토픽 #8224611555");
    });

    it("does NOT strip a bare #abcdef suffix (no ~ discriminator)", () => {
      // A user-typed `#topic1` or `#abc` should survive — only the
      // collision marker form `#~xxx` is treated as removable noise.
      expect(getCleanLabel({ label: "버그 수정 #abc123" })).toBe("버그 수정 #abc123");
    });

    it("strips collision suffix without prefix (defensive)", () => {
      // If a label ever ends up with the suffix but no prefix (manual edit?),
      // still strip it for display.
      expect(getCleanLabel({ label: "버그 수정 #~def456" })).toBe("버그 수정");
    });

    it("leaves untouched labels alone", () => {
      expect(getCleanLabel({ label: "버그 수정" })).toBe("버그 수정");
      expect(getCleanLabel({ label: "[텔레그램] 일반" })).toBe("[텔레그램] 일반");
    });
  });

  describe("isTopicClosed — recognizes both forms", () => {
    it("recognizes simple prefix form", () => {
      expect(isTopicClosed({ label: `${CLOSED_PREFIX}버그 수정` })).toBe(true);
    });

    it("recognizes prefix + collision suffix form", () => {
      expect(
        isTopicClosed({ label: `${CLOSED_PREFIX}[텔레그램] main 토픽 #8224611555 #~abc123` }),
      ).toBe(true);
    });

    it("returns false for non-closed labels", () => {
      expect(isTopicClosed({ label: "버그 수정" })).toBe(false);
      expect(isTopicClosed({ label: "[텔레그램] main 토픽 #8224611555" })).toBe(false);
      expect(isTopicClosed({ label: null })).toBe(false);
      expect(isTopicClosed({})).toBe(false);
    });
  });
});

// ─── Source-text guard so the retry path doesn't get accidentally removed ──
import fs from "fs";
import path from "path";

describe("handleCloseTopic source guard", () => {
  const CHAT_PANEL = fs.readFileSync(
    path.resolve(__dirname, "../components/chat/chat-panel.tsx"),
    "utf-8",
  );

  it("builds the closed label with the `#~{sid6}` discriminator from the start", () => {
    // PR #320 follow-up: the retry approach (PR #317) turned out to be
    // unreachable in practice because the same auto-restore polling kept
    // pushing the simple `[closed] {label}` form on every poll cycle. The
    // robust fix is always-unique from the start. Match the actual template
    // literal, regardless of whether the suffix lives in a local variable
    // or an inline helper expression.
    // The label assignment must build `${CLOSED_PREFIX}${...} #~${...}`.
    expect(CHAT_PANEL).toMatch(/CLOSED_PREFIX\}\$\{[^}]+\}\s+#~\$\{[^}]+\}/);
  });

  it("derives suffix from sessionId (sliced to 6), not from a fresh timestamp", () => {
    // Stable suffix per session — closing the same session twice returns
    // the same label (idempotent on transient retries). Match either the
    // inline form `(s.sessionId || s.key).slice(-6)` or the older
    // `sid.slice(-6)` pattern. Whichever lives in the file, the slice MUST
    // be 6 chars and MUST come from a sessionId expression.
    expect(CHAT_PANEL).toMatch(/sessionId[\s\S]{0,40}\.slice\(-6\)|sid\.slice\(-6\)/);
    // Defensive: forbid timestamp-based suffixes (Date.now / random) being
    // used INSIDE the closed-label template.
    expect(CHAT_PANEL).not.toMatch(/CLOSED_PREFIX[\s\S]{0,80}Date\.now/);
  });

  it("does NOT block the UI on the gateway round-trip (#322 optimistic close)", () => {
    // After #322, handleCloseTopic uses local patchSession() to mark siblings
    // [closed] BEFORE the gateway patch, so chat-header drops the tab on the
    // very next paint instead of waiting ~600ms+ for sessions.list to refresh.
    // Guard the optimistic-update call so it can't be silently removed.
    expect(CHAT_PANEL).toMatch(/patchSession\(s\.key,\s*\{\s*label:\s*closedLabel\s*\}\)/);
  });
});
