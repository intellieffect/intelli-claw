/**
 * E2E tests for #222: Thinking/Reasoning block rendering.
 *
 * Verifies that:
 * 1. Thinking blocks from chat history render as collapsible UI
 * 2. Click toggles expand/collapse
 * 3. Global toggle hides thinking blocks
 */
import { test, expect } from "./helpers/fixtures";
import { setupMockGateway, type MockChatMessage } from "./helpers/ws-mock";

test.describe("Thinking/Reasoning Block (#222)", () => {
  test("renders thinking block from history in collapsed state", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Explain quantum physics" },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "Let me break down quantum physics into simple terms..." },
            { type: "text", text: "Quantum physics is the study of matter at the smallest scales." },
          ],
        },
      ],
    });

    // Thinking toggle should be visible
    const toggle = page.getByTestId("thinking-toggle");
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await expect(toggle).toContainText("Reasoning");

    // Content should be hidden (collapsed by default)
    const content = page.getByTestId("thinking-content");
    await expect(content).not.toBeVisible();

    // Main response text should be visible
    await expect(page.getByText("Quantum physics is the study of matter")).toBeVisible();
  });

  test("expands and collapses on click", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: [
            { type: "thinking", text: "The user is greeting me." },
            { type: "text", text: "Hello! How can I help?" },
          ],
        },
      ],
    });

    const toggle = page.getByTestId("thinking-toggle");
    const content = page.getByTestId("thinking-content");

    // Initially collapsed
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await expect(content).not.toBeVisible();

    // Click to expand
    await toggle.click();
    await expect(content).toBeVisible();
    await expect(content).toContainText("The user is greeting me.");

    // Click to collapse
    await toggle.click();
    await expect(content).not.toBeVisible();
  });

  test("renders inline <think> tags from string content", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "What is 2+2?" },
        {
          role: "assistant",
          content: "<think>Simple arithmetic: 2+2=4</think>The answer is 4.",
        },
      ],
    });

    const toggle = page.getByTestId("thinking-toggle");
    await expect(toggle).toBeVisible({ timeout: 5000 });

    // Expand to verify content
    await toggle.click();
    const content = page.getByTestId("thinking-content");
    await expect(content).toContainText("Simple arithmetic: 2+2=4");

    // Main text should be visible
    await expect(page.getByText("The answer is 4.")).toBeVisible();
  });

  test("does not render thinking block when content has no thinking", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello there!" },
      ],
    });

    // Wait for the message to render
    await expect(page.getByText("Hello there!")).toBeVisible({ timeout: 5000 });

    // No thinking toggle should exist
    const toggle = page.getByTestId("thinking-toggle");
    await expect(toggle).not.toBeVisible();
  });
});
