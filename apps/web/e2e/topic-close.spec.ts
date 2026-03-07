/**
 * E2E tests for Phase 2: Cmd+D topic close via label prefix convention.
 * Tests closing, reopening, sidebar display, and input disabled state.
 *
 * NOTE: Playwright Chromium uses a Linux user agent, so isMac=false in shortcuts.ts.
 * All keyboard shortcuts use Ctrl instead of Cmd (ctrlKey instead of metaKey).
 * We use document.dispatchEvent for shortcuts that Chromium intercepts natively.
 */
import { test, expect } from "./helpers/fixtures";

test.describe("Topic Close — label prefix", () => {
  const MAIN_SESSION = {
    key: "agent:default:main",
    label: "메인",
    updatedAt: Date.now(),
  };
  const TOPIC_SESSION = {
    key: "agent:default:main:topic:abc123",
    label: "default/테스트 토픽",
    updatedAt: Date.now() - 1000,
  };

  /** Dispatch a keyboard shortcut via document event (bypasses Chromium native interception). */
  async function dispatchShortcut(page: any, key: string, opts: { ctrlKey?: boolean; shiftKey?: boolean } = {}) {
    await page.evaluate(({ key, ctrlKey, shiftKey }: { key: string; ctrlKey: boolean; shiftKey: boolean }) => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key, code: `Key${key.toUpperCase()}`, ctrlKey, shiftKey, bubbles: true })
      );
    }, { key, ctrlKey: opts.ctrlKey ?? false, shiftKey: opts.shiftKey ?? false });
  }

  test("Cmd+D closes a topic session (adds [closed] prefix to label)", async ({ mockGateway, page }) => {
    const p = await mockGateway({
      agentId: "default",
      sessions: [MAIN_SESSION, TOPIC_SESSION],
    });

    // Wait for app to render
    await p.waitForTimeout(3000);

    // Select the topic session by clicking the topic tab
    const topicTab = page.locator("button").filter({ hasText: /테스트 토픽/ }).first();
    await topicTab.waitFor({ state: "visible", timeout: 5000 });
    await topicTab.click();
    await page.waitForTimeout(500);

    // Verify we switched to the topic session
    const currentKey = await page.evaluate(() => localStorage.getItem("awf:sessionKey"));
    expect(currentKey).toBe("agent:default:main:topic:abc123");

    // Dispatch Ctrl+D (Playwright Chromium uses Linux UA → isMac=false → Ctrl+D)
    await dispatchShortcut(page, "d", { ctrlKey: true });
    await page.waitForTimeout(2000);

    // Verify the mock session's label was updated with [closed] prefix
    const updatedLabel = await page.evaluate(() => {
      const sessions = (window as any).__mockGatewaySessions;
      return sessions?.find((s: any) => s.key === "agent:default:main:topic:abc123")?.label;
    });
    expect(updatedLabel).toBe("[closed] default/테스트 토픽");
  });

  test("closed topic disappears from tab bar", async ({ mockGateway }) => {
    const closedTopic = {
      ...TOPIC_SESSION,
      label: "[closed] default/테스트 토픽",
    };
    const page = await mockGateway({
      agentId: "default",
      sessions: [MAIN_SESSION, closedTopic],
    });

    await page.waitForTimeout(1000);

    // The closed topic should not appear in the tab bar
    const topicTab = page.locator("button").filter({ hasText: "테스트 토픽" });
    expect(await topicTab.count()).toBe(0);
  });

  test("closed topic appears in session switcher with '닫힌 토픽' section", async ({ mockGateway }) => {
    const closedTopic = {
      ...TOPIC_SESSION,
      label: "[closed] default/테스트 토픽",
    };
    const page = await mockGateway({
      agentId: "default",
      sessions: [MAIN_SESSION, closedTopic],
    });

    await page.waitForTimeout(1000);

    // Open session switcher (Ctrl+K on Playwright Chromium)
    await dispatchShortcut(page, "k", { ctrlKey: true });
    await page.waitForTimeout(500);

    // Check for "닫힌 토픽" section
    const closedSection = page.locator("text=닫힌 토픽");
    await expect(closedSection.first()).toBeVisible();

    // The closed topic label should be shown without prefix
    const closedItem = page.locator("text=테스트 토픽");
    await expect(closedItem.first()).toBeVisible();

    // "다시 열기" button should be present
    const reopenButton = page.locator("text=다시 열기");
    expect(await reopenButton.count()).toBeGreaterThan(0);
  });

  test("'다시 열기' removes [closed] prefix", async ({ mockGateway }) => {
    const closedTopic = {
      ...TOPIC_SESSION,
      label: "[closed] default/테스트 토픽",
    };
    const page = await mockGateway({
      agentId: "default",
      sessions: [MAIN_SESSION, closedTopic],
    });

    await page.waitForTimeout(1000);

    // Open session switcher
    await dispatchShortcut(page, "k", { ctrlKey: true });
    await page.waitForTimeout(500);

    // Click "다시 열기"
    const reopenButton = page.locator("text=다시 열기").first();
    await reopenButton.click();
    await page.waitForTimeout(500);

    // Verify the label was restored (prefix removed)
    const updatedLabel = await page.evaluate(() => {
      const sessions = (window as any).__mockGatewaySessions;
      const topic = sessions.find((s: any) => s.key === "agent:default:main:topic:abc123");
      return topic?.label;
    });
    expect(updatedLabel).toBe("default/테스트 토픽");
  });

  test("Cmd+Shift+T reopens most recently closed topic", async ({ mockGateway }) => {
    const closedTopic1 = {
      key: "agent:default:main:topic:old",
      label: "[closed] default/오래된 토픽",
      updatedAt: Date.now() - 5000,
    };
    const closedTopic2 = {
      key: "agent:default:main:topic:recent",
      label: "[closed] default/최근 토픽",
      updatedAt: Date.now() - 1000,
    };
    const page = await mockGateway({
      agentId: "default",
      sessions: [MAIN_SESSION, closedTopic1, closedTopic2],
    });

    await page.waitForTimeout(1000);

    // Press Ctrl+Shift+T (Playwright Chromium uses Linux UA)
    await dispatchShortcut(page, "t", { ctrlKey: true, shiftKey: true });
    await page.waitForTimeout(500);

    // The most recent closed topic should be reopened (recent, not old)
    const updatedLabel = await page.evaluate(() => {
      const sessions = (window as any).__mockGatewaySessions;
      const topic = sessions.find((s: any) => s.key === "agent:default:main:topic:recent");
      return topic?.label;
    });
    expect(updatedLabel).toBe("default/최근 토픽");
  });

  test("main session cannot be closed with Cmd+D", async ({ mockGateway }) => {
    const page = await mockGateway({
      agentId: "default",
      sessions: [MAIN_SESSION, TOPIC_SESSION],
    });

    await page.waitForTimeout(1000);

    // Ensure main session is selected (default)
    // Press Ctrl+D — should not close main (isTopicSession check)
    await dispatchShortcut(page, "d", { ctrlKey: true });
    await page.waitForTimeout(500);

    // Main session label should be unchanged
    const mainLabel = await page.evaluate(() => {
      const sessions = (window as any).__mockGatewaySessions;
      const main = sessions.find((s: any) => s.key === "agent:default:main");
      return main?.label;
    });
    expect(mainLabel).toBe("메인");
  });

  test("closed topic shows '닫힘' badge in header when selected", async ({ mockGateway }) => {
    const closedTopic = {
      ...TOPIC_SESSION,
      label: "[closed] default/테스트 토픽",
    };
    const page = await mockGateway({
      agentId: "default",
      sessions: [MAIN_SESSION, closedTopic],
    });

    // Set the closed topic as current session via localStorage
    await page.evaluate((key: string) => {
      localStorage.setItem("awf:sessionKey", key);
    }, closedTopic.key);
    await page.reload();
    await page.waitForFunction(() => {
      const ws = (window as any).__mockGatewayWs;
      return ws && ws.readyState === 1;
    }, { timeout: 5000 });
    await page.waitForTimeout(800);

    // Check for "닫힘" badge in header
    const badge = page.locator("text=닫힘");
    expect(await badge.count()).toBeGreaterThan(0);
  });
});
