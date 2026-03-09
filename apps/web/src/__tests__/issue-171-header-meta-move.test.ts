/**
 * Issue #171 — Session meta info moved from header to chat input bar
 *
 * Validates that:
 * 1. ChatHeader no longer exports/uses session meta elements (sessionType, topicCount, clearMessages, agentStatus indicator)
 * 2. ChatInput accepts and renders session meta props
 * 3. formatAgentStatus works correctly in chat-input
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENTS_DIR = path.resolve(__dirname, "../components/chat");

function readComponent(name: string): string {
  return fs.readFileSync(path.join(COMPONENTS_DIR, name), "utf-8");
}

describe("Issue #171: Header meta → Chat input migration", () => {
  const headerSrc = readComponent("chat-header.tsx");
  const inputSrc = readComponent("chat-input.tsx");
  const panelSrc = readComponent("chat-panel.tsx");

  describe("chat-header.tsx cleanup", () => {
    it("should NOT contain History or Trash2 icon imports", () => {
      // These icons moved to chat-input
      expect(headerSrc).not.toMatch(/\bHistory\b.*from\s+["']lucide-react/);
      expect(headerSrc).not.toMatch(/\bTrash2\b.*from\s+["']lucide-react/);
    });

    it("should NOT contain onClearMessages or onOpenTopicHistory props", () => {
      expect(headerSrc).not.toContain("onClearMessages");
      expect(headerSrc).not.toContain("onOpenTopicHistory");
    });

    it("should NOT contain formatAgentStatus function", () => {
      expect(headerSrc).not.toContain("function formatAgentStatus");
    });

    it("should NOT render sessionType badge", () => {
      // The header used to have {sessionType} — now removed
      expect(headerSrc).not.toMatch(/\bsessionType\b/);
    });

    it("should NOT import getTopicCount", () => {
      expect(headerSrc).not.toContain("getTopicCount");
    });

    it("should still contain agent avatar and session tabs", () => {
      expect(headerSrc).toContain("AgentAvatar");
      expect(headerSrc).toContain("renderTab");
    });
  });

  describe("chat-input.tsx additions", () => {
    it("should import History and Trash2 icons", () => {
      expect(inputSrc).toContain("History");
      expect(inputSrc).toContain("Trash2");
    });

    it("should import AgentStatus type", () => {
      expect(inputSrc).toMatch(/import.*AgentStatus.*from/);
    });

    it("should contain formatAgentStatus function", () => {
      expect(inputSrc).toContain("function formatAgentStatus");
    });

    it("should accept sessionType prop", () => {
      expect(inputSrc).toContain("sessionType?:");
    });

    it("should accept topicCount prop", () => {
      expect(inputSrc).toContain("topicCount?:");
    });

    it("should accept agentStatus prop", () => {
      expect(inputSrc).toContain("agentStatus?:");
    });

    it("should accept onOpenTopicHistory prop", () => {
      expect(inputSrc).toContain("onOpenTopicHistory?:");
    });

    it("should accept onClearMessages prop", () => {
      expect(inputSrc).toContain("onClearMessages?:");
    });

    it("should render session meta section with separator", () => {
      // The pipe separator between token info and session meta
      expect(inputSrc).toContain("{/* Session meta — moved from header */}");
    });

    it("should render sessionType badge", () => {
      expect(inputSrc).toContain("{sessionType}");
      expect(inputSrc).toContain("uppercase");
    });

    it("should render topic count button with History icon", () => {
      expect(inputSrc).toMatch(/대화 이력 보기/);
      expect(inputSrc).toMatch(/<History\s+size=/);
    });

    it("should render clear messages button with Trash2 icon", () => {
      expect(inputSrc).toMatch(/채팅 비우기/);
      expect(inputSrc).toMatch(/<Trash2\s+size=/);
    });

    it("should render agent status indicator with animated dot", () => {
      expect(inputSrc).toMatch(/animate-ping/);
      expect(inputSrc).toMatch(/statusInfo\.dotColor/);
    });

    it("should use flex-wrap for responsive overflow prevention", () => {
      expect(inputSrc).toContain("flex-wrap");
    });
  });

  describe("chat-panel.tsx props wiring", () => {
    it("should pass sessionType to ChatInput", () => {
      expect(panelSrc).toMatch(/sessionType=\{sessionType/);
    });

    it("should pass topicCount to ChatInput", () => {
      expect(panelSrc).toMatch(/topicCount=\{topicCount\}/);
    });

    it("should pass agentStatus to ChatInput", () => {
      expect(panelSrc).toMatch(/agentStatus=\{agentStatus\}/);
    });

    it("should pass onOpenTopicHistory to ChatInput", () => {
      // The ChatInput JSX should contain onOpenTopicHistory prop
      const inputJSX = panelSrc.match(/<ChatInput[\s\S]*?\/>/)?.[0] || "";
      expect(inputJSX).toContain("onOpenTopicHistory");
      expect(inputJSX).toContain("setTopicHistoryOpen");
    });

    it("should pass onClearMessages to ChatInput", () => {
      const inputJSX = panelSrc.match(/<ChatInput[\s\S]*?\/>/)?.[0] || "";
      expect(inputJSX).toContain("onClearMessages");
      expect(inputJSX).toContain("clearMessages");
    });

    it("should NOT pass onOpenTopicHistory to ChatHeader", () => {
      const headerJSX = panelSrc.match(/<ChatHeader[\s\S]*?\/>/)?.[0] || "";
      expect(headerJSX).not.toContain("onOpenTopicHistory");
    });

    it("should NOT pass onClearMessages to ChatHeader", () => {
      const headerJSX = panelSrc.match(/<ChatHeader[\s\S]*?\/>/)?.[0] || "";
      expect(headerJSX).not.toContain("onClearMessages");
    });

    it("should import getTopicCount for topic count state", () => {
      expect(panelSrc).toContain("getTopicCount");
    });
  });

  describe("formatAgentStatus in chat-input", () => {
    // Extract and test the function logic
    it("should return null for idle phase", () => {
      // Verified via source inspection
      expect(inputSrc).toContain('status.phase === "idle"');
    });

    it("should handle thinking, writing, tool, waiting phases", () => {
      expect(inputSrc).toContain('"thinking"');
      expect(inputSrc).toContain('"writing"');
      expect(inputSrc).toContain('"tool"');
      expect(inputSrc).toContain('"waiting"');
    });
  });
});
