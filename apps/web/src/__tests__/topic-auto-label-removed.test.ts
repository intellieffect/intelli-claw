/**
 * topic-auto-label-removed.test.ts
 *
 * Regression guard for the OpenClaw alignment cleanup (2026-04-07).
 *
 * The previous client-side auto-labeling flow (`maybeAutoLabelSession`,
 * `shouldAutoLabel`, `AUTO_LABEL_PATTERN`, `summarizeLabelFromText`) diverged
 * from `~/.openclaw/workspace/openclaw-repo/ui/src/ui/controllers/sessions.ts`
 * — the reference Control UI never auto-labels. It only forwards explicit
 * user input via `sessions.patch`. This test pins that behavior so the
 * auto-label flow doesn't get re-introduced.
 *
 * If you genuinely need a label-derivation feature, propose it server-side
 * to OpenClaw first (so every client stays in sync) instead of patching
 * intelli-claw locally again.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const CHAT_PANEL = fs.readFileSync(
  path.resolve(__dirname, "../components/chat/chat-panel.tsx"),
  "utf-8",
);

describe("topic auto-label removal (OpenClaw alignment)", () => {
  it("does not define an AUTO_LABEL_PATTERN regex", () => {
    expect(CHAT_PANEL).not.toMatch(/const\s+AUTO_LABEL_PATTERN\s*=/);
  });

  it("does not export a shouldAutoLabel predicate", () => {
    expect(CHAT_PANEL).not.toMatch(/export\s+function\s+shouldAutoLabel\b/);
  });

  it("does not define maybeAutoLabelSession", () => {
    expect(CHAT_PANEL).not.toMatch(/function\s+maybeAutoLabelSession\b/);
  });

  it("does not define summarizeLabelFromText", () => {
    expect(CHAT_PANEL).not.toMatch(/const\s+summarizeLabelFromText\s*=/);
  });

  it("does not call any auto-label helper from sendMessage paths", () => {
    expect(CHAT_PANEL).not.toMatch(/maybeAutoLabelSession\s*\(/);
    expect(CHAT_PANEL).not.toMatch(/summarizeLabelFromText\s*\(/);
  });

  it("still imports generateTopicSummary (used by topic-close memory flush)", () => {
    // The PR-184 'flush summary to memory on close' flow stays — it doesn't
    // touch session labels, only writes to local IndexedDB memory store.
    expect(CHAT_PANEL).toContain("generateTopicSummary");
  });

  it("still keeps makeDefaultThreadLabel for explicit new-topic dialog", () => {
    // Explicit user action via TopicNameDialog: setting a default placeholder
    // when the user creates a new thread is fine — it's the user's intent.
    expect(CHAT_PANEL).toContain("makeDefaultThreadLabel");
  });
});
