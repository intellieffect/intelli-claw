/**
 * Tests for UI feature fixes:
 * - #44: Command palette (Cmd+K) arrow key navigation
 * - #43: Quick new session from + button (same agent, no picker)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { SessionSwitcher } from "@/components/chat/session-switcher";
import type { GatewaySession } from "@/lib/gateway/session-utils";

// --- Test data ---

const mockSessions: GatewaySession[] = [
  { key: "agent:alpha:main", updatedAt: 300, label: "Alpha Main" },
  { key: "agent:beta:main", updatedAt: 200, label: "Beta Main" },
  { key: "agent:alpha:main:thread:t1", updatedAt: 100, label: "Alpha Thread 1" },
];

// --- #44: Command Palette Arrow Key Navigation ---

describe("#44: Command palette arrow key navigation", () => {
  let onSelect: ReturnType<typeof vi.fn>;
  let onNew: ReturnType<typeof vi.fn>;
  let onOpenChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelect = vi.fn();
    onNew = vi.fn();
    onOpenChange = vi.fn();
  });

  it("ArrowDown moves selection from first to second item", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={onSelect}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByPlaceholderText(/세션 검색/);

    // Initially first item is selected (index 0)
    // Press ArrowDown to move to index 1
    fireEvent.keyDown(input, { key: "ArrowDown" });

    // The second session item should have the highlight class (bg-muted/70)
    const items = document.querySelectorAll("[data-session-item]");
    expect(items.length).toBeGreaterThanOrEqual(3); // 3 sessions + 1 "new conversation"

    // Second item (index 1) should be highlighted
    expect(items[1].className).toContain("bg-muted/70");
    // First item (index 0) should NOT be highlighted
    expect(items[0].className).not.toContain("bg-muted/70");
  });

  it("ArrowUp wraps from first item to last (new conversation) item", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={onSelect}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByPlaceholderText(/세션 검색/);

    // Initially at index 0; ArrowUp should wrap to the last item (new conversation)
    fireEvent.keyDown(input, { key: "ArrowUp" });

    const items = document.querySelectorAll("[data-session-item]");
    const lastItem = items[items.length - 1];
    expect(lastItem.className).toContain("bg-muted/70");
  });

  it("ArrowDown then ArrowUp returns to original position", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={onSelect}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByPlaceholderText(/세션 검색/);

    // ArrowDown (index 0 -> 1), then ArrowUp (index 1 -> 0)
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowUp" });

    const items = document.querySelectorAll("[data-session-item]");
    expect(items[0].className).toContain("bg-muted/70");
    expect(items[1].className).not.toContain("bg-muted/70");
  });

  it("Enter selects the highlighted session after ArrowDown", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={onSelect}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByPlaceholderText(/세션 검색/);

    // Move to second item and press Enter
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    // Second session (sorted by updatedAt desc) is "Beta Main"
    expect(onSelect).toHaveBeenCalledWith("agent:beta:main");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Enter on default (index 0) selects the first session", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={onSelect}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByPlaceholderText(/세션 검색/);

    // Press Enter without any arrow navigation
    fireEvent.keyDown(input, { key: "Enter" });

    // First session (sorted by updatedAt desc) is "Alpha Main"
    expect(onSelect).toHaveBeenCalledWith("agent:alpha:main");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("navigating to last item and pressing Enter triggers onNew", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={onSelect}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByPlaceholderText(/세션 검색/);

    // Navigate past all sessions to the "new conversation" item
    // 3 sessions + 1 "new conversation" = 4 total items; index 3 is the last
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 0 -> 1
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 1 -> 2
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 2 -> 3 (new conversation)
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onNew).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("ArrowDown wraps around from last item to first", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={onSelect}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByPlaceholderText(/세션 검색/);

    // Navigate to last item and then one more ArrowDown (should wrap to index 0)
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 0 -> 1
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 1 -> 2
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 2 -> 3
    fireEvent.keyDown(input, { key: "ArrowDown" }); // 3 -> 0 (wrap)

    const items = document.querySelectorAll("[data-session-item]");
    expect(items[0].className).toContain("bg-muted/70");
  });

  it("search resets selection to index 0", () => {
    render(
      <SessionSwitcher
        sessions={mockSessions}
        onSelect={onSelect}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    const input = screen.getByPlaceholderText(/세션 검색/);

    // Move to second item
    fireEvent.keyDown(input, { key: "ArrowDown" });

    // Type search text (resets selection)
    fireEvent.change(input, { target: { value: "alpha" } });

    // First matching item should be highlighted
    const items = document.querySelectorAll("[data-session-item]");
    expect(items[0].className).toContain("bg-muted/70");
  });
});

// --- #43: Quick new session from + button ---

describe("#43: Quick new session (+ button creates session for current agent)", () => {
  it("onNew callback is called when + button (new conversation) in palette is clicked", () => {
    const onNew = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <SessionSwitcher
        sessions={mockSessions}
        currentKey="agent:alpha:main"
        onSelect={() => {}}
        onNew={onNew}
        open={true}
        onOpenChange={onOpenChange}
      />
    );

    fireEvent.click(screen.getByText("새 대화 시작"));
    expect(onNew).toHaveBeenCalled();
  });
});
