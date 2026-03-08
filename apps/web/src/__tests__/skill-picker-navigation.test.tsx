/**
 * Tests for SkillPicker keyboard navigation — selectedIndex sync between
 * ChatInput (parent) and SkillPicker (controlled component).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatInput } from "@/components/chat/chat-input";
import { BUILTIN_COMMANDS } from "@/components/chat/skill-picker";

// Mock framer-motion
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock hooks
vi.mock("@/lib/hooks/use-keyboard-height", () => ({
  useKeyboardHeight: () => 0,
}));
vi.mock("@/lib/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));
vi.mock("@/lib/gateway/use-skills", () => ({
  useSkills: () => ({ skills: [] }),
}));
vi.mock("@/hooks/use-autosize-textarea", () => ({
  useAutosizeTextArea: () => {},
}));

/** Render ChatInput with sensible defaults */
function renderChatInput(overrides: Partial<Parameters<typeof ChatInput>[0]> = {}) {
  const props = {
    onSend: vi.fn(),
    onAbort: vi.fn(),
    streaming: false,
    disabled: false,
    model: "test-model",
    tokenStr: "1k",
    ...overrides,
  };
  const result = render(<ChatInput {...props} />);
  const textarea = screen.getByRole("textbox");
  return { ...result, textarea, ...props };
}

/** Check if element has the active highlight class (not hover variant) */
function isHighlighted(el: HTMLElement) {
  return /(?:^|\s)bg-muted(?:\s|$)/.test(el.className);
}

/** Get all picker item buttons (exclude header/footer) */
function getPickerItems() {
  // Picker items are buttons with text starting with "/"
  return screen.getAllByRole("button").filter((btn) => btn.textContent?.includes("/"));
}

/** Open skill picker by typing "/" */
function openPicker(textarea: HTMLElement) {
  fireEvent.change(textarea, { target: { value: "/" } });
}

describe("SkillPicker keyboard navigation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("arrow down moves highlight to second item", () => {
    const { textarea } = renderChatInput();
    openPicker(textarea);

    // First item should be highlighted
    const items = getPickerItems();
    expect(items.length).toBeGreaterThan(1);
    expect(isHighlighted(items[0])).toBe(true);
    expect(isHighlighted(items[1])).toBe(false);

    // Press ArrowDown
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    const updatedItems = getPickerItems();
    expect(isHighlighted(updatedItems[0])).toBe(false);
    expect(isHighlighted(updatedItems[1])).toBe(true);
  });

  it("enter selects the highlighted item", () => {
    const { textarea, onSend } = renderChatInput();
    openPicker(textarea);

    // ArrowDown twice to select 3rd item
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    const items = getPickerItems();
    expect(isHighlighted(items[2])).toBe(true);

    // Press Enter to select
    fireEvent.keyDown(textarea, { key: "Enter" });

    // The 3rd builtin command should have been selected
    const cmd = BUILTIN_COMMANDS[2];
    if (cmd.immediate) {
      // Immediate commands trigger onSend directly
      expect(onSend).toHaveBeenCalledWith(`/${cmd.name}`);
    } else {
      // Non-immediate commands set text to "/<name> "
      expect(textarea).toHaveValue(`/${cmd.name} `);
    }
  });

  it("mouse hover syncs with keyboard navigation", () => {
    const { textarea } = renderChatInput();
    openPicker(textarea);

    const items = getPickerItems();
    // Hover over 3rd item
    fireEvent.mouseEnter(items[2]);

    // 3rd item should be highlighted
    const afterHover = getPickerItems();
    expect(isHighlighted(afterHover[2])).toBe(true);

    // ArrowDown should move to 4th item (from hovered position)
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    const afterArrow = getPickerItems();
    expect(isHighlighted(afterArrow[2])).toBe(false);
    expect(isHighlighted(afterArrow[3])).toBe(true);
  });

  it("filter resets selectedIndex to first item", () => {
    const { textarea } = renderChatInput();
    openPicker(textarea);

    // Move down a couple
    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    // Type "/st" to filter — the useEffect in chat-input resets index to 0
    fireEvent.change(textarea, { target: { value: "/st" } });

    const items = getPickerItems();
    expect(items.length).toBeGreaterThan(0);
    // First filtered item should be highlighted
    expect(isHighlighted(items[0])).toBe(true);
  });
});
