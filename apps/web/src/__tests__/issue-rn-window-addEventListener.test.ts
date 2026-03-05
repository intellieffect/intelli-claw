/**
 * React Native 환경에서 window.addEventListener가 존재하지 않아
 * client.ts setupNetworkListeners()에서 크래시 발생하는 이슈.
 *
 * RN에서는 `typeof window !== "undefined"` → true이지만
 * `window.addEventListener`는 undefined.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GatewayClient } from "@/lib/gateway/client";

// --- Mock WebSocket ---
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: ((e: { code?: number; reason?: string; wasClean?: boolean }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
}

describe("React Native: window.addEventListener 미존재 환경", () => {
  let originalWebSocket: typeof globalThis.WebSocket;
  let origAddEventListener: typeof window.addEventListener;
  let origRemoveEventListener: typeof window.removeEventListener;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    // Restore addEventListener/removeEventListener
    if (origAddEventListener) {
      Object.defineProperty(window, "addEventListener", {
        value: origAddEventListener,
        writable: true,
        configurable: true,
      });
    }
    if (origRemoveEventListener) {
      Object.defineProperty(window, "removeEventListener", {
        value: origRemoveEventListener,
        writable: true,
        configurable: true,
      });
    }
  });

  it("window.addEventListener이 undefined여도 connect()가 크래시하지 않아야 함", () => {
    // Save originals
    origAddEventListener = window.addEventListener;
    origRemoveEventListener = window.removeEventListener;

    // Simulate React Native: window exists but addEventListener is undefined
    Object.defineProperty(window, "addEventListener", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "removeEventListener", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const client = new GatewayClient({
      url: "ws://localhost:18789",
      token: "test",
      clientId: "test-rn",
    });

    // connect() 호출 시 크래시 없이 정상 동작해야 함
    expect(() => client.connect()).not.toThrow();

    // cleanup도 크래시 없이 동작해야 함
    expect(() => client.disconnect()).not.toThrow();
  });

  it("window.addEventListener이 존재하면 정상적으로 리스너를 등록해야 함", () => {
    const addSpy = vi.fn();
    const removeSpy = vi.fn();

    origAddEventListener = window.addEventListener;
    origRemoveEventListener = window.removeEventListener;

    Object.defineProperty(window, "addEventListener", {
      value: addSpy,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "removeEventListener", {
      value: removeSpy,
      writable: true,
      configurable: true,
    });

    const client = new GatewayClient({
      url: "ws://localhost:18789",
      token: "test",
      clientId: "test-browser",
    });

    client.connect();
    expect(addSpy).toHaveBeenCalledWith("online", expect.any(Function));

    client.disconnect();
    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
  });
});
