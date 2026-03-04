/**
 * Shared Playwright test fixtures for intelli-claw e2e tests.
 */
import { test as base, expect, type Page } from "@playwright/test";
import { setupMockGateway, type MockGatewayOptions } from "./ws-mock";

export { expect };

/**
 * Extended test fixture that sets up mock gateway and provides helper methods.
 */
export const test = base.extend<{
  /** Set up a mock gateway with the given options */
  mockGateway: (options?: MockGatewayOptions) => Promise<Page>;
}>({
  mockGateway: async ({ page }, use) => {
    const setup = async (options: MockGatewayOptions = {}) => {
      await setupMockGateway(page, options);
      await page.goto("/");
      // Wait for the app to connect (connection status changes)
      await page.waitForFunction(() => {
        const ws = (window as any).__mockGatewayWs;
        return ws && ws.readyState === 1;
      }, { timeout: 5000 });
      // Wait for initial rendering
      await page.waitForTimeout(500);
      return page;
    };
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(setup);
  },
});

/**
 * Common page object helpers.
 */
export class ChatPage {
  constructor(private page: Page) {}

  /** Get the message input textarea */
  get input() {
    return this.page.getByRole("textbox", { name: /메시지를 입력하세요/i });
  }

  /** Get the send button */
  get sendButton() {
    return this.page.getByRole("button", { name: /전송/i });
  }

  /** Get the abort button (shown during streaming) */
  get abortButton() {
    return this.page.getByRole("button", { name: /중단/i });
  }

  /** Type and send a message */
  async sendMessage(text: string) {
    await this.input.fill(text);
    await this.sendButton.click();
  }

  /** Get all visible message bubbles */
  async getMessages() {
    // User messages have bg-primary, assistant messages have bg-zinc-800
    const userMsgs = await this.page.locator("[data-chat-panel] .group.justify-end").allTextContents();
    const assistantMsgs = await this.page.locator("[data-chat-panel] .group:not(.justify-end)").allTextContents();
    return { userMsgs, assistantMsgs };
  }

  /** Get all message bubble elements */
  getMessageBubbles() {
    return this.page.locator("[data-chat-panel] .group");
  }

  /** Wait for assistant message containing specific text */
  async waitForAssistantMessage(text: string, timeout = 10000) {
    await this.page.locator("[data-chat-panel] .group:not(.justify-end)").filter({ hasText: text }).waitFor({ timeout });
  }

  /** Wait for user message containing specific text */
  async waitForUserMessage(text: string, timeout = 10000) {
    await this.page.locator("[data-chat-panel] .group.justify-end").filter({ hasText: text }).waitFor({ timeout });
  }

  /** Get thinking indicator */
  get thinkingIndicator() {
    return this.page.locator(".animate-bounce");
  }

  /** Check if loading state is shown */
  async isLoading() {
    return this.page.getByText("대화 기록 불러오는 중...").isVisible();
  }

  /** Reload the page */
  async reload() {
    await this.page.reload();
    await this.page.waitForFunction(() => {
      const ws = (window as any).__mockGatewayWs;
      return ws && ws.readyState === 1;
    }, { timeout: 5000 });
    await this.page.waitForTimeout(500);
  }
}
