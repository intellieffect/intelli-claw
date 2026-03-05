import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ChatInput } from "@/components/chat/chat-input";

describe("#124 — window focus 시 textarea 자동 focus", () => {
  it("window focus 이벤트 발생 시 textarea에 focus", () => {
    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} />
    );
    const textarea = screen.getByPlaceholderText(/메시지를 입력/);

    // blur 시킨 후
    act(() => { textarea.blur(); });
    expect(document.activeElement).not.toBe(textarea);

    // window focus 이벤트 발생
    act(() => { window.dispatchEvent(new Event("focus")); });
    expect(document.activeElement).toBe(textarea);
  });

  it("unmount 후에는 focus 리스너가 제거됨", () => {
    const spy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} />
    );

    unmount();
    expect(spy).toHaveBeenCalledWith("focus", expect.any(Function));
    spy.mockRestore();
  });
});
