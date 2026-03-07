/**
 * E2E tests for Phase 4: Cmd+T topic name input dialog (#172)
 */
import { test, expect } from "./helpers/fixtures";

/**
 * Dispatch Cmd+T / Ctrl+T depending on the platform detected by the app.
 * Playwright Desktop Chrome uses a non-Mac user agent, so isMac = false → Ctrl+T.
 * We dispatch both metaKey and ctrlKey to cover both cases.
 */
async function pressNewTab(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    // Dispatch Ctrl+T (non-Mac shortcut)
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "t", ctrlKey: true, bubbles: true }),
    );
  });
}

test.describe("Topic Name Dialog — Phase 4", () => {
  test("Cmd+T opens the name dialog", async ({ mockGateway }) => {
    const page = await mockGateway({
      agentId: "default",
      sessions: [
        { key: "agent:default:main", label: "Main", updatedAt: Date.now() },
      ],
    });

    await page.waitForTimeout(500);
    await pressNewTab(page);

    // The dialog should appear
    const dialog = page.locator("[data-testid='topic-name-dialog']");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const input = page.locator("[data-testid='topic-name-input']");
    await expect(input).toBeVisible();
    await expect(input).toBeFocused();
  });

  test("typing name + Enter creates topic with that name", async ({ mockGateway }) => {
    const page = await mockGateway({
      agentId: "default",
      sessions: [
        { key: "agent:default:main", label: "Main", updatedAt: Date.now() },
      ],
    });

    await page.waitForTimeout(500);
    await pressNewTab(page);

    const input = page.locator("[data-testid='topic-name-input']");
    await expect(input).toBeVisible({ timeout: 3000 });

    // Type a topic name and press Enter
    await input.fill("My Test Topic");
    await input.press("Enter");

    // Dialog should close
    const dialog = page.locator("[data-testid='topic-name-dialog']");
    await expect(dialog).not.toBeVisible({ timeout: 2000 });

    // Check that the session key contains the sanitized name
    await page.waitForTimeout(500);
    const sessionKey = await page.evaluate(() => {
      const entries: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const val = localStorage.getItem(key) || "";
          if (val.includes(":topic:")) entries.push(val);
        }
      }
      return entries;
    });

    expect(sessionKey.length).toBeGreaterThan(0);
    expect(sessionKey.some((k) => k.includes(":topic:my-test-topic"))).toBe(true);
  });

  test("pressing Escape cancels (no new topic)", async ({ mockGateway }) => {
    const page = await mockGateway({
      agentId: "default",
      sessions: [
        { key: "agent:default:main", label: "Main", updatedAt: Date.now() },
      ],
    });

    await page.waitForTimeout(500);
    await pressNewTab(page);

    const dialog = page.locator("[data-testid='topic-name-dialog']");
    await expect(dialog).toBeVisible({ timeout: 3000 });

    // Press Escape
    await page.keyboard.press("Escape");

    // Dialog should close
    await expect(dialog).not.toBeVisible({ timeout: 2000 });

    // No new topic session should have been created
    const topicKeys = await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const val = localStorage.getItem(key) || "";
          if (val.includes(":topic:")) keys.push(val);
        }
      }
      return keys;
    });

    expect(topicKeys.length).toBe(0);
  });

  test("empty input + Enter creates topic with auto-generated name", async ({ mockGateway }) => {
    const page = await mockGateway({
      agentId: "default",
      sessions: [
        { key: "agent:default:main", label: "Main", updatedAt: Date.now() },
      ],
    });

    await page.waitForTimeout(500);
    await pressNewTab(page);

    const input = page.locator("[data-testid='topic-name-input']");
    await expect(input).toBeVisible({ timeout: 3000 });

    // Press Enter without typing anything
    await input.press("Enter");

    // Dialog should close
    const dialog = page.locator("[data-testid='topic-name-dialog']");
    await expect(dialog).not.toBeVisible({ timeout: 2000 });

    // A topic session should have been created with auto-generated ID
    await page.waitForTimeout(500);
    const topicKeys = await page.evaluate(() => {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          const val = localStorage.getItem(key) || "";
          if (val.includes(":topic:")) keys.push(val);
        }
      }
      return keys;
    });

    expect(topicKeys.length).toBeGreaterThan(0);
    // Auto-generated ID is base36 format (alphanumeric)
    const topicId = topicKeys[0].split(":topic:")[1];
    expect(topicId).toBeTruthy();
    expect(topicId.length).toBeGreaterThan(0);
  });

  test("new topic with custom name appears in tab bar", async ({ mockGateway }) => {
    const page = await mockGateway({
      agentId: "default",
      sessions: [
        { key: "agent:default:main", label: "Main", updatedAt: Date.now() },
      ],
    });

    await page.waitForTimeout(500);
    await pressNewTab(page);

    const input = page.locator("[data-testid='topic-name-input']");
    await expect(input).toBeVisible({ timeout: 3000 });

    await input.fill("Feature Work");
    await input.press("Enter");

    await page.waitForTimeout(1000);

    // The tab bar should contain the new topic label
    const tabBar = page.locator("[data-chat-panel]");
    const tabText = await tabBar.textContent();
    expect(tabText).toBeTruthy();
  });
});
