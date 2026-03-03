import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { vi } from "vitest";

// Mock scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// Mock ResizeObserver (not available in jsdom)
global.ResizeObserver = class ResizeObserver {
  private callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock requestAnimationFrame / cancelAnimationFrame for streaming batching tests
let _rafId = 0;
const _rafCallbacks = new Map<number, FrameRequestCallback>();
if (typeof globalThis.requestAnimationFrame === "undefined") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = ++_rafId;
    _rafCallbacks.set(id, cb);
    setTimeout(() => {
      const fn = _rafCallbacks.get(id);
      if (fn) {
        _rafCallbacks.delete(id);
        fn(performance.now());
      }
    }, 0);
    return id;
  }) as typeof globalThis.requestAnimationFrame;
}
if (typeof globalThis.cancelAnimationFrame === "undefined") {
  globalThis.cancelAnimationFrame = ((id: number) => {
    _rafCallbacks.delete(id);
  }) as typeof globalThis.cancelAnimationFrame;
}

// Mock matchMedia for responsive hooks
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});
