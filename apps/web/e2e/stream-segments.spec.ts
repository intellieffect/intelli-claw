/**
 * E2E tests for #231: Streaming segments — text↔tool interleave order preservation.
 *
 * Verifies that messages with interleaved text and tool calls render in order.
 */
import { test, expect } from "./helpers/fixtures";

test.describe("Streaming Segments — Interleave Order (#231)", () => {
  test("renders text↔tool segments in correct order from history", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Analyze the code" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me analyze the code for you." },
            { type: "tool_use", id: "call-1", name: "read_file", input: { path: "src/app.ts" } },
            { type: "text", text: "I found an issue in the file." },
            { type: "tool_use", id: "call-2", name: "edit_file", input: { path: "src/app.ts" } },
            { type: "text", text: "The fix has been applied successfully." },
          ],
        },
      ],
    });

    // Wait for the message to render
    await expect(page.getByText("Let me analyze the code for you.")).toBeVisible({ timeout: 5000 });

    // All text segments should be visible
    await expect(page.getByText("I found an issue in the file.")).toBeVisible();
    await expect(page.getByText("The fix has been applied successfully.")).toBeVisible();

    // Tool call cards should be visible
    await expect(page.getByText("read_file")).toBeVisible();
    await expect(page.getByText("edit_file")).toBeVisible();

    // Verify order: get all segment elements within the assistant message
    const assistantMsg = page.locator("[data-chat-panel] .group:not(.justify-end)").last();
    const textContent = await assistantMsg.textContent();

    // The text should appear in interleaved order (text before its corresponding tool)
    const analyzeIdx = textContent!.indexOf("Let me analyze");
    const readFileIdx = textContent!.indexOf("read_file");
    const foundIdx = textContent!.indexOf("I found an issue");
    const editFileIdx = textContent!.indexOf("edit_file");
    const fixIdx = textContent!.indexOf("The fix has been");

    expect(analyzeIdx).toBeLessThan(readFileIdx);
    expect(readFileIdx).toBeLessThan(foundIdx);
    expect(foundIdx).toBeLessThan(editFileIdx);
    expect(editFileIdx).toBeLessThan(fixIdx);
  });

  test("falls back to legacy rendering when no segments", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there! How can I help?" },
      ],
    });

    await expect(page.getByText("Hi there! How can I help?")).toBeVisible({ timeout: 5000 });
  });
});
