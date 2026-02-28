import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatInput } from "@/components/chat/chat-input";

describe("ChatInput focus ring (issue #70)", () => {
  it("uses inset ring so it is not clipped by overflow-hidden ancestors", () => {
    const { container } = render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} />
    );
    // The bordered container div should use ring-inset to prevent clipping
    const borderedDiv = container.querySelector(
      "[class*='border-input']"
    ) as HTMLElement;
    expect(borderedDiv).toBeTruthy();
    const classes = borderedDiv.className;
    // Must use ring-inset instead of outward ring
    expect(classes).toContain("ring-inset");
    // Should NOT have an outward ring that gets clipped
    expect(classes).not.toMatch(/focus-within:ring-\[3px\](?!.*ring-inset)/);
  });

  it("maintains visible focus indicator with inset ring", () => {
    const { container } = render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} />
    );
    const borderedDiv = container.querySelector(
      "[class*='border-input']"
    ) as HTMLElement;
    expect(borderedDiv).toBeTruthy();
    // Should still have a focus-within ring style
    expect(borderedDiv.className).toMatch(/focus-within:ring/);
  });
});
