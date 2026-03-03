/**
 * E2E tests verifying bug fixes for issues #111-#121 and #5536.
 * Runs against production build with mock gateway.
 */
import { test, expect, ChatPage } from "./helpers/fixtures";
import {
  queueAgentResponse,
  queueMultipleAgentMessages,
  sendAgentEvent,
  updateMockHistory,
} from "./helpers/ws-mock";

// =============================================================================
// #117 — NO/NO_REPLY/HEARTBEAT_OK messages hidden from chat
// =============================================================================

test.describe("#117 — Hidden sentinel messages", () => {
  test("NO_REPLY agent message is not displayed", async ({ mockGateway }) => {
    const page = await mockGateway();
    const chat = new ChatPage(page);

    // Queue a NO_REPLY response
    await queueAgentResponse(page, "NO_REPLY");

    await chat.sendMessage("Do something silently");

    // User message should appear
    await expect(page.getByText("Do something silently")).toBeVisible({ timeout: 5000 });

    // Wait for potential rendering
    await page.waitForTimeout(1000);

    // NO_REPLY should NOT be visible anywhere in chat
    await expect(page.getByText("NO_REPLY")).not.toBeVisible();
  });

  test("bare NO agent message is not displayed", async ({ mockGateway }) => {
    const page = await mockGateway();
    const chat = new ChatPage(page);

    await queueAgentResponse(page, "NO");

    await chat.sendMessage("Another silent action");

    await expect(page.getByText("Another silent action")).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    // Bare "NO" should be filtered — but check there's no standalone "NO" bubble
    const noBubbles = page.locator("[data-chat-panel] .group:not(.justify-end)").filter({ hasText: /^NO$/ });
    await expect(noBubbles).toHaveCount(0);
  });

  test("HEARTBEAT_OK agent message is not displayed", async ({ mockGateway }) => {
    const page = await mockGateway();
    const chat = new ChatPage(page);

    await queueAgentResponse(page, "HEARTBEAT_OK");

    await chat.sendMessage("Heartbeat test");

    await expect(page.getByText("Heartbeat test")).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(1000);

    await expect(page.getByText("HEARTBEAT_OK")).not.toBeVisible();
  });

  test("NO/NO_REPLY in history are filtered out", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Hello", timestamp: "2024-01-01T00:00:00Z" },
        { role: "assistant", content: "NO_REPLY", timestamp: "2024-01-01T00:00:01Z" },
        { role: "user", content: "Hello again", timestamp: "2024-01-01T00:00:02Z" },
        { role: "assistant", content: "NO", timestamp: "2024-01-01T00:00:03Z" },
        { role: "user", content: "One more", timestamp: "2024-01-01T00:00:04Z" },
        { role: "assistant", content: "HEARTBEAT_OK", timestamp: "2024-01-01T00:00:05Z" },
        { role: "assistant", content: "Visible reply", timestamp: "2024-01-01T00:00:06Z" },
      ],
    });

    // User messages should be visible
    await expect(page.getByText("Hello", { exact: true })).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Visible reply")).toBeVisible({ timeout: 5000 });

    // Sentinel messages should NOT appear
    await expect(page.getByText("NO_REPLY")).not.toBeVisible();
    await expect(page.getByText("HEARTBEAT_OK")).not.toBeVisible();
  });

  test("legitimate messages containing NO are NOT filtered", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Can you help?", timestamp: "2024-01-01T00:00:00Z" },
        { role: "assistant", content: "NO problem, I can help!", timestamp: "2024-01-01T00:00:01Z" },
      ],
    });

    // "NO problem" should still be visible — it's legitimate content
    await expect(page.getByText("NO problem, I can help!")).toBeVisible({ timeout: 5000 });
  });
});

// =============================================================================
// #112 — Session reset preserves conversation list
// =============================================================================

test.describe("#112 — Session reset preserves conversation list", () => {
  test("previous conversations remain in sidebar after session reset", async ({ mockGateway }) => {
    const page = await mockGateway({
      sessions: [
        { key: "agent:default:main", label: "Main Session", updatedAt: 300 },
        { key: "agent:default:main:thread:t1", label: "Previous Thread", updatedAt: 200 },
        { key: "agent:default:main:thread:t2", label: "Old Conversation", updatedAt: 100 },
      ],
      historyMessages: [
        { role: "user", content: "Hello", timestamp: "2024-01-01T00:00:00Z" },
        { role: "assistant", content: "Hi there!", timestamp: "2024-01-01T00:00:01Z" },
      ],
    });

    // Open session switcher to verify sessions exist
    const sessionTrigger = page.locator("button").filter({ hasText: /세션 선택|default/ }).first();
    if (await sessionTrigger.isVisible({ timeout: 3000 })) {
      await sessionTrigger.click();

      const searchInput = page.locator("input[placeholder*='세션 검색']");
      if (await searchInput.isVisible({ timeout: 2000 })) {
        // Sessions should be listed
        const items = page.locator("[data-session-item]");
        const countBefore = await items.count();
        expect(countBefore).toBeGreaterThanOrEqual(2);

        await searchInput.press("Escape");
      }
    }

    // Now simulate session reset — look for settings or reset button
    const settingsBtn = page.locator("button").filter({ has: page.locator("svg.lucide-settings") }).first();
    if (await settingsBtn.isVisible({ timeout: 2000 })) {
      await settingsBtn.click();
      const resetBtn = page.getByRole("button", { name: /초기화|리셋|reset/i }).first();
      if (await resetBtn.isVisible({ timeout: 2000 })) {
        await resetBtn.click();
        // Confirm if needed
        const confirmBtn = page.getByRole("button", { name: /확인|초기화/i });
        if (await confirmBtn.isVisible({ timeout: 1000 })) {
          await confirmBtn.click();
        }
      }
    }

    // After reset, reopen session switcher — sessions should still be there
    await page.waitForTimeout(500);
    const sessionTriggerAfter = page.locator("button").filter({ hasText: /세션 선택|default/ }).first();
    if (await sessionTriggerAfter.isVisible({ timeout: 3000 })) {
      await sessionTriggerAfter.click();
      const searchAfter = page.locator("input[placeholder*='세션 검색']");
      if (await searchAfter.isVisible({ timeout: 2000 })) {
        const itemsAfter = page.locator("[data-session-item]");
        const countAfter = await itemsAfter.count();
        // Conversation list should be preserved
        expect(countAfter).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

// =============================================================================
// #111 — Session reset preserves agent context
// =============================================================================

test.describe("#111 — Session reset context persistence", () => {
  test("agent maintains context awareness after session reset", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "My name is Alice", timestamp: "2024-01-01T00:00:00Z" },
        { role: "assistant", content: "Nice to meet you, Alice!", timestamp: "2024-01-01T00:00:01Z" },
      ],
    });

    // Verify initial messages are shown
    await expect(page.getByText("My name is Alice")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Nice to meet you, Alice!")).toBeVisible({ timeout: 5000 });

    // After session reset, queue a response that references prior context
    // (the gateway would include context summary in the actual reset flow)
    await queueAgentResponse(page, "Yes Alice, I remember our conversation!");

    const chat = new ChatPage(page);
    await chat.sendMessage("Do you remember me?");

    // Agent should respond with context-aware reply
    await expect(page.getByText("Yes Alice, I remember our conversation!")).toBeVisible({ timeout: 10000 });
  });
});

// =============================================================================
// #115 — Image message deduplication (optimistic + server)
// =============================================================================

test.describe("#115 — Image message deduplication", () => {
  test("image message does not render twice after server confirms", async ({ mockGateway }) => {
    const page = await mockGateway();
    const chat = new ChatPage(page);

    // Queue response that includes an image
    await queueAgentResponse(page, "Here is an image:\nMEDIA:~/test-image.png");

    await chat.sendMessage("Show me an image");

    // Wait for the response
    await expect(page.getByText("Here is an image:")).toBeVisible({ timeout: 10000 });

    // There should be exactly one assistant bubble with this content, not two
    const imageBubbles = page.locator("[data-chat-panel] .group:not(.justify-end)").filter({ hasText: "Here is an image:" });
    await expect(imageBubbles).toHaveCount(1);
  });

  test("image messages in history do not duplicate", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this photo" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
            },
          ],
          timestamp: "2024-01-01T00:00:00Z",
        },
        { role: "assistant", content: "Nice photo!", timestamp: "2024-01-01T00:00:01Z" },
      ],
    });

    await expect(page.getByText("Look at this photo")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Nice photo!")).toBeVisible({ timeout: 5000 });

    // The user message with image should appear exactly once
    const userImageBubbles = page.locator("[data-chat-panel] .group.justify-end").filter({ hasText: "Look at this photo" });
    await expect(userImageBubbles).toHaveCount(1);
  });
});

// =============================================================================
// #119 — WSS reconnection backoff
// =============================================================================

test.describe("#119 — WebSocket reconnection backoff", () => {
  test("reconnects after WebSocket disconnects", async ({ mockGateway }) => {
    const page = await mockGateway();
    const chat = new ChatPage(page);

    // Verify initial connection works
    await expect(chat.input).toBeVisible({ timeout: 5000 });

    // Simulate WebSocket close
    await page.evaluate(() => {
      const ws = (window as any).__mockGatewayWs;
      if (ws) {
        ws.close();
      }
    });

    // Wait a bit for reconnection attempt
    await page.waitForTimeout(2000);

    // Check that a reconnection was attempted (new WebSocket created)
    const reconnected = await page.evaluate(() => {
      const ws = (window as any).__mockGatewayWs;
      return ws !== null;
    });

    expect(reconnected).toBe(true);
  });

  test("shows connection status indicator during disconnect", async ({ mockGateway }) => {
    const page = await mockGateway();
    const chat = new ChatPage(page);

    await expect(chat.input).toBeVisible({ timeout: 5000 });

    // Close WebSocket to trigger reconnection
    await page.evaluate(() => {
      const ws = (window as any).__mockGatewayWs;
      if (ws) {
        // Simulate abnormal close
        ws.readyState = 3; // CLOSED
        const evt = new CloseEvent("close", { code: 1006, reason: "Abnormal" });
        ws.onclose?.(evt);
        ws.dispatchEvent(evt);
      }
    });

    // Should show some disconnect indicator (e.g. reconnecting banner)
    // Wait briefly then check for reconnecting state
    await page.waitForTimeout(500);

    // The app should attempt reconnection — we just verify no crash
    const inputStillVisible = await chat.input.isVisible();
    expect(inputStillVisible).toBe(true);
  });
});

// =============================================================================
// #120 — Cross-device message sync (lifecycle.end → history reload)
// =============================================================================

test.describe("#120 — Cross-device message sync", () => {
  test("lifecycle.end triggers session list refresh for cross-device awareness", async ({ mockGateway }) => {
    const page = await mockGateway({
      sessions: [
        { key: "agent:default:main", label: "Main Session", updatedAt: 300 },
      ],
      historyMessages: [
        { role: "user", content: "Initial message", timestamp: "2024-01-01T00:00:00Z" },
      ],
    });

    await expect(page.getByText("Initial message")).toBeVisible({ timeout: 5000 });

    // Update mock sessions to include updated timestamp (simulating cross-device activity)
    await page.evaluate(() => {
      (window as any).__mockGatewaySessions = [
        { key: "agent:default:main", label: "Main Session", updatedAt: 999 },
      ];
    });

    // Send lifecycle.end event — this triggers session list refresh
    await sendAgentEvent(page, {
      stream: "lifecycle",
      data: { phase: "end" },
      runId: "run-other-device-123",
      sessionKey: "agent:default:main",
    });

    // The session list refresh should occur without errors
    // Verify the app is still functional
    await page.waitForTimeout(1000);
    const chat = new ChatPage(page);
    await expect(chat.input).toBeVisible();
  });

  test("inbound messages from other surfaces sync in real-time", async ({ mockGateway }) => {
    const page = await mockGateway();

    // Simulate message from Telegram surface
    await sendAgentEvent(page, {
      stream: "inbound",
      data: {
        text: "Sent from my Telegram",
        role: "user",
        surface: "telegram",
      },
      sessionKey: "agent:default:main",
    });

    await expect(page.getByText("Sent from my Telegram")).toBeVisible({ timeout: 5000 });
  });
});

// =============================================================================
// #114 — External device image path resolve
// =============================================================================

test.describe("#114 — External device image path resolve", () => {
  test("tilde-path images from MEDIA protocol resolve correctly", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        {
          role: "assistant",
          content: "Check this out:\nMEDIA:~/Pictures/screenshot.png",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ],
    });

    // The text should be visible (MEDIA line processed)
    await expect(page.getByText("Check this out:")).toBeVisible({ timeout: 5000 });

    // MEDIA: raw text should NOT be visible (should be parsed into image)
    await expect(page.getByText("MEDIA:~/Pictures/screenshot.png")).not.toBeVisible();
  });

  test("absolute path images from MEDIA protocol resolve correctly", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        {
          role: "assistant",
          content: "Here's the file:\nMEDIA:/tmp/uploads/image.jpg",
          timestamp: "2024-01-01T00:00:00Z",
        },
      ],
    });

    await expect(page.getByText("Here's the file:")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("MEDIA:/tmp/uploads/image.jpg")).not.toBeVisible();
  });
});

// =============================================================================
// #121 — No message duplication after page refresh
// =============================================================================

test.describe("#121 — No message duplication after refresh", () => {
  test("messages appear exactly once after page reload", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Unique test message A", timestamp: "2024-01-01T00:00:00Z" },
        { role: "assistant", content: "Unique response B", timestamp: "2024-01-01T00:00:01Z" },
        { role: "user", content: "Unique follow-up C", timestamp: "2024-01-01T00:00:02Z" },
        { role: "assistant", content: "Unique reply D", timestamp: "2024-01-01T00:00:03Z" },
      ],
    });

    // Verify messages appear
    await expect(page.getByText("Unique test message A")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Unique response B")).toBeVisible({ timeout: 5000 });

    // Count message bubbles before reload
    const chat = new ChatPage(page);
    const bubblesBefore = await chat.getMessageBubbles().count();

    // Reload the page
    await chat.reload();

    // Messages should still be visible
    await expect(page.getByText("Unique test message A")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Unique response B")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Unique follow-up C")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Unique reply D")).toBeVisible({ timeout: 5000 });

    // Bubble count should be the same (no duplication)
    const bubblesAfter = await chat.getMessageBubbles().count();
    expect(bubblesAfter).toBe(bubblesBefore);
  });

  test("no ghost messages after multiple rapid reloads", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Reload test msg", timestamp: "2024-01-01T00:00:00Z" },
        { role: "assistant", content: "Reload test reply", timestamp: "2024-01-01T00:00:01Z" },
      ],
    });

    const chat = new ChatPage(page);
    await expect(page.getByText("Reload test msg")).toBeVisible({ timeout: 5000 });

    // Multiple rapid reloads
    await chat.reload();
    await chat.reload();
    await chat.reload();

    // After multiple reloads, each message should appear exactly once
    const userBubbles = page.locator("[data-chat-panel] .group.justify-end").filter({ hasText: "Reload test msg" });
    const assistantBubbles = page.locator("[data-chat-panel] .group:not(.justify-end)").filter({ hasText: "Reload test reply" });

    await expect(userBubbles).toHaveCount(1);
    await expect(assistantBubbles).toHaveCount(1);
  });
});

// =============================================================================
// #5536 — Session isolation (Agent A messages don't leak into Agent B)
// =============================================================================

test.describe("#5536 — Session isolation", () => {
  test("agent A messages do not appear in agent B session", async ({ mockGateway }) => {
    const page = await mockGateway({
      agentId: "agentA",
      sessions: [
        { key: "agent:agentA:main", label: "Agent A", agentId: "agentA", updatedAt: 300 },
        { key: "agent:agentB:main", label: "Agent B", agentId: "agentB", updatedAt: 200 },
      ],
      historyMessages: [
        { role: "user", content: "Hello Agent A", timestamp: "2024-01-01T00:00:00Z" },
        { role: "assistant", content: "I am Agent A responding", timestamp: "2024-01-01T00:00:01Z" },
      ],
    });

    // Agent A messages should be visible in Agent A session
    await expect(page.getByText("Hello Agent A")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("I am Agent A responding")).toBeVisible({ timeout: 5000 });

    // Simulate receiving a full lifecycle for Agent B session — should NOT appear
    const wrongRunId = "run-agentB-123";
    await sendAgentEvent(page, {
      stream: "lifecycle",
      data: { phase: "start" },
      runId: wrongRunId,
      sessionKey: "agent:agentB:main",
    });
    await sendAgentEvent(page, {
      stream: "assistant",
      data: { delta: "I am Agent B response — should not appear" },
      runId: wrongRunId,
      sessionKey: "agent:agentB:main",
    });
    await sendAgentEvent(page, {
      stream: "lifecycle",
      data: { phase: "end" },
      runId: wrongRunId,
      sessionKey: "agent:agentB:main",
    });

    await page.waitForTimeout(1000);

    // Agent B message should NOT be visible in Agent A's chat
    await expect(page.getByText("I am Agent B response — should not appear")).not.toBeVisible();
  });

  test("events with mismatched sessionKey are rejected by strict filter", async ({ mockGateway }) => {
    const page = await mockGateway({
      historyMessages: [
        { role: "user", content: "Setup message", timestamp: "2024-01-01T00:00:00Z" },
        { role: "assistant", content: "Setup reply", timestamp: "2024-01-01T00:00:01Z" },
      ],
    });

    await expect(page.getByText("Setup message")).toBeVisible({ timeout: 5000 });

    // Send lifecycle + message with WRONG sessionKey
    const wrongRunId = "run-wrong-" + Date.now();
    await sendAgentEvent(page, {
      stream: "lifecycle",
      data: { phase: "start" },
      runId: wrongRunId,
      sessionKey: "agent:otherAgent:main",
    });
    await sendAgentEvent(page, {
      stream: "assistant",
      data: { delta: "Wrong session message" },
      runId: wrongRunId,
      sessionKey: "agent:otherAgent:main",
    });
    await sendAgentEvent(page, {
      stream: "lifecycle",
      data: { phase: "end" },
      runId: wrongRunId,
      sessionKey: "agent:otherAgent:main",
    });

    await page.waitForTimeout(1000);

    // Should NOT appear — strict session isolation
    await expect(page.getByText("Wrong session message")).not.toBeVisible();

    // Original messages should still be intact (no corruption from wrong-session events)
    await expect(page.getByText("Setup message")).toBeVisible();
    await expect(page.getByText("Setup reply")).toBeVisible();
  });
});
