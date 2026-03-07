/**
 * Tests for #174: Current time display in chat input bar
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ChatInput } from "@/components/chat/chat-input";

// Mock framer-motion to avoid animation issues in tests
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  },
}));

// Mock hooks used by ChatInput
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

describe("#174: Clock display in chat input", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders current time in HH:MM format", () => {
    vi.setSystemTime(new Date(2026, 2, 7, 16, 19, 0));

    render(
      <ChatInput
        onSend={vi.fn()}
        onAbort={vi.fn()}
        streaming={false}
        disabled={false}
        model="claude-sonnet-4-20250514"
        tokenStr="10k"
      />
    );

    const clock = screen.getByTestId("chat-clock");
    expect(clock).toBeDefined();
    expect(clock.textContent).toBe("16:19");
  });

  it("pads hours and minutes with leading zeros", () => {
    vi.setSystemTime(new Date(2026, 0, 1, 3, 5, 0));

    render(
      <ChatInput
        onSend={vi.fn()}
        onAbort={vi.fn()}
        streaming={false}
        disabled={false}
        model="test-model"
        tokenStr="1k"
      />
    );

    const clock = screen.getByTestId("chat-clock");
    expect(clock.textContent).toBe("03:05");
  });

  it("updates time when minute changes", () => {
    vi.setSystemTime(new Date(2026, 2, 7, 14, 30, 0, 0));

    render(
      <ChatInput
        onSend={vi.fn()}
        onAbort={vi.fn()}
        streaming={false}
        disabled={false}
        model="test-model"
        tokenStr="1k"
      />
    );

    const clock = screen.getByTestId("chat-clock");
    expect(clock.textContent).toBe("14:30");

    // Advance to next minute boundary (60s)
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(clock.textContent).toBe("14:31");
  });
});
