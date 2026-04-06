import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { ChatView } from "@/components/chat/chat-view";

vi.mock("@/lib/platform", () => ({
  platform: {
    onWindowFocusChange: (callback: (focused: boolean) => void) => {
      return (window as any).electronAPI?.onWindowFocusChange?.(callback);
    },
  },
}));

vi.mock("@/lib/gateway/hooks", () => ({
  useGateway: () => ({ state: "connected", error: null }),
}));

vi.mock("@/lib/hooks/use-mobile", () => ({
  useIsMobile: () => false,
}));

vi.mock("@/components/chat/connection-status", () => ({
  ConnectionStatus: () => <div data-testid="connection-status" />,
}));

vi.mock("@/components/settings/connection-settings", () => ({
  ConnectionSettings: () => null,
}));

vi.mock("@/components/chat/chat-panel", () => ({
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

vi.mock("@/components/chat/shortcut-help-dialog", () => ({
  ShortcutHelpDialog: () => null,
}));

vi.mock("@/assets/logo.svg", () => ({
  default: "logo.svg",
}));

describe("#274 — Electron 활성 창 chrome 강조", () => {
  const originalElectronAPI = (window as any).electronAPI;
  let focusListener: ((focused: boolean) => void) | undefined;
  let unsubscribe = vi.fn();

  beforeEach(() => {
    unsubscribe = vi.fn();
    focusListener = undefined;

    (window as any).electronAPI = {
      onWindowFocusChange: vi.fn((callback: (focused: boolean) => void) => {
        focusListener = callback;
        return unsubscribe;
      }),
    };
    document.documentElement.classList.add("electron");
  });

  afterEach(() => {
    cleanup();
    if (originalElectronAPI === undefined) {
      delete (window as any).electronAPI;
    } else {
      (window as any).electronAPI = originalElectronAPI;
    }
    document.documentElement.removeAttribute("data-window-focused");
    document.documentElement.classList.remove("electron");
  });

  it("Electron 환경에서 초기 포커스 상태를 html data attribute에 반영한다", async () => {
    render(<ChatView />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    });

    expect(document.documentElement).toHaveAttribute("data-window-focused", "true");
  });

  it("main process focus change 이벤트를 받아 html data attribute를 갱신한다", async () => {
    render(<ChatView />);

    await waitFor(() => {
      expect((window as any).electronAPI.onWindowFocusChange).toHaveBeenCalled();
    });

    focusListener?.(false);
    expect(document.documentElement).toHaveAttribute("data-window-focused", "false");

    focusListener?.(true);
    expect(document.documentElement).toHaveAttribute("data-window-focused", "true");
  });

  it("unmount 시 Electron focus listener를 정리한다", async () => {
    const { unmount } = render(<ChatView />);

    await waitFor(() => {
      expect((window as any).electronAPI.onWindowFocusChange).toHaveBeenCalled();
    });

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
