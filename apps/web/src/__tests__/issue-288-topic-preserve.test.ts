import { describe, it, expect } from "vitest";

/**
 * Issue #288: 세션 갱신 시 토픽 주제가 의도치 않게 자동 업데이트되는 이슈
 *
 * `maybeAutoLabelSession` was overwriting user-renamed topic labels because
 * the "is this an auto-generated label?" regex was too loose. Any label
 * starting with `thread-` or `topic-` (or containing `작업-NNNN`) would
 * trigger re-labeling on every send.
 *
 * Fix: tighten the predicate to match ONLY known auto-generated formats.
 * These tests pin that predicate so regressions are caught.
 */
function importShouldAutoLabel() {
  return import("@/components/chat/chat-panel").then((m) => m.shouldAutoLabel);
}

describe("shouldAutoLabel (issue #288)", () => {
  describe("auto-generated / placeholder labels → should re-label", () => {
    it("returns true for undefined label", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel(undefined)).toBe(true);
    });

    it("returns true for empty string label", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("")).toBe(true);
    });

    it("returns true for whitespace-only label", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("   ")).toBe(true);
    });

    it("returns true for default thread label with agent prefix", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      // Matches makeDefaultThreadLabel output: `${agent}/작업-${mmdd}-${hhmm}`
      expect(shouldAutoLabel("iclaw/작업-0406-1930")).toBe(true);
      expect(shouldAutoLabel("default/작업-1231-2359")).toBe(true);
    });

    it("returns true for default thread label without agent prefix", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("작업-0406-1930")).toBe(true);
    });

    it("returns true for legacy '스레드 #N' / '토픽 #N' patterns", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("스레드 #1")).toBe(true);
      expect(shouldAutoLabel("토픽 #12")).toBe(true);
      expect(shouldAutoLabel("thread #5")).toBe(true);
      expect(shouldAutoLabel("topic #3")).toBe(true);
    });

    it("returns true for 'New Chat/Thread/Session' scaffold placeholders", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("New Chat")).toBe(true);
      expect(shouldAutoLabel("New Thread")).toBe(true);
      expect(shouldAutoLabel("New Session")).toBe(true);
      // Case-insensitive
      expect(shouldAutoLabel("new chat")).toBe(true);
      expect(shouldAutoLabel("NEW THREAD")).toBe(true);
    });

    it("returns true for 'chat-N' / 'session-N' scaffold placeholders", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("chat-123")).toBe(true);
      expect(shouldAutoLabel("session-45")).toBe(true);
    });
  });

  describe("user-renamed labels → must NOT re-label", () => {
    it("returns false for a simple custom topic", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("My custom topic")).toBe(false);
    });

    it("returns false for a Korean custom topic", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("버그 수정")).toBe(false);
      expect(shouldAutoLabel("api-연동-v2")).toBe(false);
    });

    it("returns false for labels that happen to start with 'topic-' or 'thread-'", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      // These would match the OLD loose regex (`^topic[:\s-]`) and be
      // incorrectly overwritten — this is the #288 regression we're guarding.
      expect(shouldAutoLabel("topic-discussion")).toBe(false);
      expect(shouldAutoLabel("thread-refactor")).toBe(false);
      expect(shouldAutoLabel("topic: performance")).toBe(false);
    });

    it("returns false for labels containing '작업' but not the auto format", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("작업 일지")).toBe(false);
      expect(shouldAutoLabel("나의 작업-회고")).toBe(false);
    });

    it("returns false for agent-prefixed user-summarized labels", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      // After first send the label becomes `${agent}/${snippet}` — once it's
      // been summarized from user text it must be treated as owned content.
      expect(shouldAutoLabel("iclaw/버그 수정 요청")).toBe(false);
      expect(shouldAutoLabel("default/API design review")).toBe(false);
    });
  });

  describe("explicit isUserRenamed flag", () => {
    it("returns false when isUserRenamed is true, even for empty label", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("", true)).toBe(false);
      expect(shouldAutoLabel(undefined, true)).toBe(false);
    });

    it("returns false when isUserRenamed is true, even for auto-pattern label", async () => {
      const shouldAutoLabel = await importShouldAutoLabel();
      expect(shouldAutoLabel("iclaw/작업-0406-1930", true)).toBe(false);
      expect(shouldAutoLabel("New Chat", true)).toBe(false);
    });
  });
});
