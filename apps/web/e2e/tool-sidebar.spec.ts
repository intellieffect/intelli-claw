/**
 * E2E tests for #232: Tool output sidebar panel.
 *
 * Verifies that tool call cards show a "상세" button that opens a sidebar,
 * and the sidebar displays tool args/result with proper formatting.
 */
import { test, expect } from "./helpers/fixtures";

test.describe("Tool Output Sidebar (#232)", () => {
  test("shows 상세 button on completed tool calls and opens sidebar", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Read the file" },
        {
          role: "assistant",
          content: "Here is the file content.",
          toolCalls: [
            {
              callId: "call-1",
              name: "Read",
              status: "done",
              args: JSON.stringify({ path: "src/app.ts" }),
              result: JSON.stringify({ content: "const app = express();" }),
            },
          ],
        },
      ],
    });

    // Wait for tool card to render
    const toolCard = page.locator("text=Read");
    await expect(toolCard.first()).toBeVisible({ timeout: 5000 });

    // Click the 상세 button
    const detailBtn = page.locator("button", { hasText: "상세" });
    await expect(detailBtn).toBeVisible();
    await detailBtn.click();

    // Sidebar should be visible with tool details
    await expect(page.getByLabel("사이드바 닫기")).toBeVisible();
    await expect(page.getByText("Arguments")).toBeVisible();
    await expect(page.getByText("Result")).toBeVisible();
  });

  test("closes sidebar with ESC key", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Search" },
        {
          role: "assistant",
          content: "Found results.",
          toolCalls: [
            {
              callId: "call-2",
              name: "web_search",
              status: "done",
              args: JSON.stringify({ query: "test" }),
              result: "Some search results here",
            },
          ],
        },
      ],
    });

    // Open sidebar
    const detailBtn = page.locator("button", { hasText: "상세" });
    await expect(detailBtn).toBeVisible({ timeout: 5000 });
    await detailBtn.click();
    await expect(page.getByLabel("사이드바 닫기")).toBeVisible();

    // Press ESC to close
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("사이드바 닫기")).not.toBeVisible();
  });
});
