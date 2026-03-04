import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ChatInput } from "@/components/chat/chat-input";
import { installMockStorage, type MockStorage } from "./helpers/mock-storage";

let mockLocal: MockStorage;
let cleanupStorage: () => void;

beforeEach(() => {
  const s = installMockStorage();
  mockLocal = s.localStorage;
  cleanupStorage = s.cleanup;
  // Reset electronAPI
  delete (window as Record<string, unknown>).electronAPI;
});

afterEach(() => {
  cleanupStorage();
});

describe("#126 — draft storageKey에 windowStoragePrefix 적용", () => {
  it("window 0(웹)에서는 기존 키 형식 유지 (awf:draft:panel-1)", () => {
    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} panelId="panel-1" />
    );
    const textarea = screen.getByPlaceholderText(/메시지를 입력/);
    fireEvent.change(textarea, { target: { value: "hello from w0" } });

    expect(mockLocal.getItem("awf:draft:panel-1")).toBe("hello from w0");
  });

  it("window 1에서는 awf:w1:draft:panel-1 키에 저장", () => {
    (window as Record<string, unknown>).electronAPI = { windowId: 1 };

    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} panelId="panel-1" />
    );
    const textarea = screen.getByPlaceholderText(/메시지를 입력/);
    fireEvent.change(textarea, { target: { value: "hello from w1" } });

    expect(mockLocal.getItem("awf:w1:draft:panel-1")).toBe("hello from w1");
    // 기존 키에는 저장되지 않아야 함
    expect(mockLocal.getItem("awf:draft:panel-1")).toBeNull();
  });

  it("window 2에서는 awf:w2:draft:panel-1 키에 저장", () => {
    (window as Record<string, unknown>).electronAPI = { windowId: 2 };

    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} panelId="panel-1" />
    );
    const textarea = screen.getByPlaceholderText(/메시지를 입력/);
    fireEvent.change(textarea, { target: { value: "hello from w2" } });

    expect(mockLocal.getItem("awf:w2:draft:panel-1")).toBe("hello from w2");
  });

  it("mount 시 해당 윈도우의 저장된 draft를 복원", () => {
    (window as Record<string, unknown>).electronAPI = { windowId: 1 };
    mockLocal.setItem("awf:w1:draft:panel-1", "saved draft");

    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} panelId="panel-1" />
    );
    const textarea = screen.getByPlaceholderText(/메시지를 입력/) as HTMLTextAreaElement;
    expect(textarea.value).toBe("saved draft");
  });

  it("전송 시 해당 윈도우의 draft 키를 삭제", () => {
    (window as Record<string, unknown>).electronAPI = { windowId: 1 };

    render(
      <ChatInput onSend={() => {}} onAbort={() => {}} streaming={false} disabled={false} panelId="panel-1" />
    );
    const textarea = screen.getByPlaceholderText(/메시지를 입력/);
    fireEvent.change(textarea, { target: { value: "msg" } });
    expect(mockLocal.getItem("awf:w1:draft:panel-1")).toBe("msg");

    fireEvent.click(screen.getByLabelText("전송"));
    expect(mockLocal.getItem("awf:w1:draft:panel-1")).toBeNull();
  });
});

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
