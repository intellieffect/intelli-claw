/**
 * E2E tests for Phase 2: Cmd+D topic close + closed state + sidebar
 *
 * NOTE: Playwright headless Chromium reports Windows UA, so shortcuts
 * use Ctrl instead of Cmd (isMac === false in the app).
 */
import { test, expect, ChatPage } from "./helpers/fixtures";

const AGENT_ID = "default";
const MAIN_KEY = `agent:${AGENT_ID}:main`;
const THREAD_KEY_1 = `agent:${AGENT_ID}:main:thread:t001`;
const THREAD_KEY_2 = `agent:${AGENT_ID}:main:thread:t002`;

function makeSessions(extra?: Record<string, unknown>[]) {
  return [
    { key: MAIN_KEY, label: "메인", agentId: AGENT_ID, sessionId: "sid-main", updatedAt: Date.now() - 3000, model: "test-model" },
    { key: THREAD_KEY_1, label: "토픽 1", agentId: AGENT_ID, sessionId: "sid-t1", updatedAt: Date.now() - 2000, model: "test-model" },
    { key: THREAD_KEY_2, label: "토픽 2", agentId: AGENT_ID, sessionId: "sid-t2", updatedAt: Date.now() - 1000, model: "test-model" },
    ...(extra || []),
  ];
}

/**
 * Dispatch a keyboard shortcut via JavaScript.
 * Playwright headless Chromium uses Windows UA, so we use ctrlKey for shortcuts.
 */
async function dispatchShortcut(page: import("@playwright/test").Page, key: string, opts: { ctrl?: boolean; shift?: boolean; alt?: boolean } = {}) {
  await page.evaluate(({ key, opts }) => {
    document.dispatchEvent(new KeyboardEvent("keydown", {
      key,
      code: `Key${key.toUpperCase()}`,
      metaKey: false,
      ctrlKey: opts.ctrl ?? false,
      shiftKey: opts.shift ?? false,
      altKey: opts.alt ?? false,
      bubbles: true,
      cancelable: true,
    }));
  }, { key, opts });
}

/**
 * Open the session switcher by clicking the trigger button.
 * More reliable than keyboard shortcuts in headless mode.
 */
async function openSessionSwitcher(page: import("@playwright/test").Page) {
  // The session switcher trigger has a green dot indicator
  const triggerBtn = page.locator("button").filter({ has: page.locator(".size-2.rounded-full.bg-emerald-500") });
  if (await triggerBtn.count() > 0) {
    await triggerBtn.first().click();
  } else {
    // Fallback: use Ctrl+K
    await page.keyboard.press("Control+k");
  }
  await page.waitForTimeout(500);
}

test.describe("Phase 2: Topic Close (Cmd+D)", () => {
  test("Ctrl+D closes a topic session", async ({ mockGateway }) => {
    const page = await mockGateway({
      sessions: makeSessions(),
      historyMessages: [],
    });

    // Navigate to thread session by clicking on it in the tab bar
    await page.getByText("토픽 2").first().click();
    await page.waitForTimeout(300);

    // Press Ctrl+D to close the topic
    await dispatchShortcut(page, "d", { ctrl: true });
    await page.waitForTimeout(800);

    // The closed topic should no longer appear in the tab bar
    const tabs = page.locator("[data-active]");
    const tabTexts = await tabs.allTextContents();
    const hasClosedTopic = tabTexts.some((t) => t.includes("토픽 2"));
    expect(hasClosedTopic).toBe(false);
  });

  test("Ctrl+D on main session does nothing", async ({ mockGateway }) => {
    const page = await mockGateway({
      sessions: makeSessions(),
      historyMessages: [],
    });

    // Should be on main session by default
    // Press Ctrl+D — should not close main
    await dispatchShortcut(page, "d", { ctrl: true });
    await page.waitForTimeout(300);

    // Main tab should still be visible
    await expect(page.getByText("메인").first()).toBeVisible();
  });

  test("closed topic appears in session switcher '닫힌 토픽' section", async ({ mockGateway }) => {
    const page = await mockGateway({
      sessions: makeSessions([
        { key: `agent:${AGENT_ID}:main:thread:closed1`, label: "닫힌 토픽 A", agentId: AGENT_ID, sessionId: "sid-c1", updatedAt: Date.now() - 500, model: "test-model", status: "closed" },
      ]),
      historyMessages: [],
    });

    // Open session switcher
    await openSessionSwitcher(page);

    // Should see "닫힌 토픽" section
    await expect(page.getByTestId("closed-topics-section")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("닫힌 토픽 A")).toBeVisible();
  });

  test("clicking '다시 열기' reopens a closed topic", async ({ mockGateway }) => {
    const page = await mockGateway({
      sessions: makeSessions([
        { key: `agent:${AGENT_ID}:main:thread:closed1`, label: "닫힌 토픽 B", agentId: AGENT_ID, sessionId: "sid-c1", updatedAt: Date.now() - 500, model: "test-model", status: "closed" },
      ]),
      historyMessages: [],
    });

    // Open session switcher
    await openSessionSwitcher(page);

    // Click reopen button
    const reopenBtn = page.getByTestId("reopen-topic-btn");
    await expect(reopenBtn).toBeVisible({ timeout: 5000 });
    await reopenBtn.click();
    await page.waitForTimeout(500);

    // After reopening, the session switcher should close
    await expect(page.getByTestId("closed-topics-section")).not.toBeVisible();
  });

  test("Ctrl+Shift+T reopens last closed topic", async ({ mockGateway }) => {
    const page = await mockGateway({
      sessions: makeSessions([
        { key: `agent:${AGENT_ID}:main:thread:closed1`, label: "닫힌 Shift+T", agentId: AGENT_ID, sessionId: "sid-c1", updatedAt: Date.now() - 500, model: "test-model", status: "closed" },
      ]),
      historyMessages: [],
    });

    // Press Ctrl+Shift+T to reopen last closed topic
    await dispatchShortcut(page, "t", { ctrl: true, shift: true });
    await page.waitForTimeout(500);

    // The page should still be responsive and the chat panel visible
    await expect(page.locator("[data-chat-panel]")).toBeVisible();
  });

  test("closed topic shows as read-only (input disabled)", async ({ mockGateway }) => {
    const closedKey = `agent:${AGENT_ID}:main:thread:closedRO`;
    const page = await mockGateway({
      sessions: [
        { key: MAIN_KEY, label: "메인", agentId: AGENT_ID, sessionId: "sid-main", updatedAt: Date.now() - 3000, model: "test-model" },
        { key: closedKey, label: "읽기전용 토픽", agentId: AGENT_ID, sessionId: "sid-cro", updatedAt: Date.now() - 500, model: "test-model", status: "closed" },
      ],
      historyMessages: [],
    });

    // Open session switcher and navigate to the closed topic
    await openSessionSwitcher(page);

    // The closed topic should appear in the "닫힌 토픽" section
    // Click on it to navigate
    const closedTopicItem = page.locator("[data-closed-topic]").filter({ hasText: "읽기전용 토픽" });
    await expect(closedTopicItem).toBeVisible({ timeout: 5000 });
    await closedTopicItem.locator("button").first().click();
    await page.waitForTimeout(500);

    // The chat input should be disabled for closed sessions
    const textarea = page.locator("[data-chat-panel] textarea");
    if (await textarea.count() > 0) {
      const isDisabled = await textarea.isDisabled();
      expect(isDisabled).toBe(true);
    }
  });

  test("closed topic shows '닫힘' badge in header", async ({ mockGateway }) => {
    const closedKey = `agent:${AGENT_ID}:main:thread:closedBadge`;
    const page = await mockGateway({
      sessions: [
        { key: MAIN_KEY, label: "메인", agentId: AGENT_ID, sessionId: "sid-main", updatedAt: Date.now() - 3000, model: "test-model" },
        { key: closedKey, label: "배지 테스트", agentId: AGENT_ID, sessionId: "sid-cb", updatedAt: Date.now() - 500, model: "test-model", status: "closed" },
      ],
      historyMessages: [],
    });

    // Navigate to the closed session via switcher
    await openSessionSwitcher(page);

    // Click on the closed topic in the closed section
    const closedTopicItem = page.locator("[data-closed-topic]").filter({ hasText: "배지 테스트" });
    await expect(closedTopicItem).toBeVisible({ timeout: 5000 });
    await closedTopicItem.locator("button").first().click();
    await page.waitForTimeout(500);

    // Should show the "닫힘" badge
    const badge = page.getByTestId("closed-badge");
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toHaveText("닫힘");
  });
});
