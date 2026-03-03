/**
 * reconnect-backoff.test.ts — #119 모바일 WSS 게이트웨이 연결 실패 반복 (code 1006)
 *
 * TDD: exponential backoff with jitter, max delay cap,
 * and network online/visibility change reconnect trigger.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000, 60000];
const MAX_RECONNECT_DELAY = 60_000;

function getReconnectDelay(attempt: number): number {
  const baseDelay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
  const jitter = baseDelay * (0.75 + Math.random() * 0.5);
  return Math.min(jitter, MAX_RECONNECT_DELAY);
}

function setupNetworkListeners(onReconnect: () => void): () => void {
  const handleOnline = () => onReconnect();
  const handleVisibility = () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      onReconnect();
    }
  };
  if (typeof window !== "undefined") window.addEventListener("online", handleOnline);
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibility);
  return () => {
    if (typeof window !== "undefined") window.removeEventListener("online", handleOnline);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleVisibility);
  };
}

describe("#119 — reconnect backoff with jitter", () => {
  beforeEach(() => { vi.spyOn(Math, "random").mockReturnValue(0.5); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("first reconnect delay is ~1s (with jitter)", () => {
    const delay = getReconnectDelay(0);
    expect(delay).toBeGreaterThanOrEqual(750);
    expect(delay).toBeLessThanOrEqual(1250);
  });

  it("delays increase exponentially", () => {
    const delays = [0, 1, 2, 3, 4].map(getReconnectDelay);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it("caps at MAX_RECONNECT_DELAY (60s)", () => {
    const delay = getReconnectDelay(100);
    expect(delay).toBeLessThanOrEqual(MAX_RECONNECT_DELAY);
  });

  it("attempt 5 uses 30s base delay", () => {
    const delay = getReconnectDelay(5);
    expect(delay).toBeGreaterThanOrEqual(22500);
    expect(delay).toBeLessThanOrEqual(37500);
  });

  it("attempt 6+ uses 60s base delay (capped)", () => {
    const delay = getReconnectDelay(6);
    expect(delay).toBeGreaterThanOrEqual(45000);
    expect(delay).toBeLessThanOrEqual(60000);
  });

  it("jitter produces different delays for same attempt", () => {
    vi.restoreAllMocks();
    const delays = new Set(Array.from({ length: 10 }, () => getReconnectDelay(3)));
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe("#119 — network change reconnect", () => {
  it("should reconnect on online event", () => {
    const spy = vi.fn();
    const cleanup = setupNetworkListeners(spy);
    window.dispatchEvent(new Event("online"));
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
    window.dispatchEvent(new Event("online"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("should reconnect on visibilitychange when visible", () => {
    const spy = vi.fn();
    const cleanup = setupNetworkListeners(spy);
    Object.defineProperty(document, "visibilityState", { value: "visible", writable: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(spy).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("should NOT reconnect on visibilitychange when hidden", () => {
    const spy = vi.fn();
    const cleanup = setupNetworkListeners(spy);
    Object.defineProperty(document, "visibilityState", { value: "hidden", writable: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(spy).toHaveBeenCalledTimes(0);
    cleanup();
  });
});
