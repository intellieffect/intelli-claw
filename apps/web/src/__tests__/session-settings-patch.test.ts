/**
 * session-settings-patch.test.ts — #233
 *
 * Verify that setThinking / setVerbose use sessions.patch RPC
 * instead of chat directives, with fallback on RPC failure.
 *
 * Strategy: mock GatewayClient so GatewayProvider injects our mock,
 * which useGateway() then returns naturally. This avoids fighting
 * vitest's module-resolution for internal relative imports.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock GatewayClient at the source level
// ---------------------------------------------------------------------------
const mockRequest = vi.fn();
let stateCallback: ((s: string, err?: unknown) => void) | null = null;

vi.mock("@intelli-claw/shared/gateway/client", () => {
  return {
    GatewayClient: class MockGatewayClient {
      request = mockRequest;
      mainSessionKey = "";
      serverVersion = "";
      serverCommit = "";
      getUrl() { return "ws://test"; }
      connect() {
        // Immediately report "connected" state
        if (stateCallback) stateCallback("connected");
      }
      disconnect() {}
      onStateChange(handler: (s: string, err?: unknown) => void) {
        stateCallback = handler;
        return () => { stateCallback = null; };
      }
      onEvent() { return () => {}; }
    },
  };
});

import { GatewayProvider, useSessionSettings } from "@intelli-claw/shared";

// ---------------------------------------------------------------------------
// Wrapper — provide GatewayProvider with dummy url/token
// ---------------------------------------------------------------------------
function Wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(GatewayProvider, { url: "ws://test", token: "test-token" }, children);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setupDefaultMock() {
  mockRequest.mockImplementation(async (method: string) => {
    if (method === "sessions.list") {
      return {
        sessions: [
          { key: "test-session", model: "gpt-4", thinking: "medium", verbose: false, label: "Test" },
        ],
      };
    }
    if (method === "models.list") return { models: [] };
    return {};
  });
}

// ---------------------------------------------------------------------------
describe("useSessionSettings — sessions.patch (#233)", () => {
  beforeEach(() => {
    stateCallback = null;
    mockRequest.mockReset();
    setupDefaultMock();
  });

  describe("setThinking", () => {
    it("calls sessions.patch with thinkingLevel", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      mockRequest.mockClear();
      setupDefaultMock();

      await act(async () => { await result.current.setThinking("high"); });

      expect(mockRequest).toHaveBeenCalledWith("sessions.patch", {
        key: "test-session",
        thinkingLevel: "high",
      });
      expect(mockRequest).not.toHaveBeenCalledWith("chat.send", expect.anything());
    });

    it("falls back to chat directive when sessions.patch fails", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      mockRequest.mockImplementation(async (method: string) => {
        if (method === "sessions.patch") throw new Error("RPC not supported");
        return {};
      });

      await act(async () => { await result.current.setThinking("low"); });

      expect(mockRequest).toHaveBeenCalledWith("sessions.patch", { key: "test-session", thinkingLevel: "low" });
      expect(mockRequest).toHaveBeenCalledWith("chat.send", { sessionKey: "test-session", body: "/think:low" });
    });

    it("optimistically updates session state", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      await act(async () => { await result.current.setThinking("high"); });
      expect(result.current.session?.thinking).toBe("high");
    });
  });

  describe("setVerbose", () => {
    it("calls sessions.patch with verboseLevel 'on'", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      mockRequest.mockClear();
      setupDefaultMock();

      await act(async () => { await result.current.setVerbose(true); });

      expect(mockRequest).toHaveBeenCalledWith("sessions.patch", { key: "test-session", verboseLevel: "on" });
    });

    it("calls sessions.patch with verboseLevel 'off'", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      mockRequest.mockClear();
      setupDefaultMock();

      await act(async () => { await result.current.setVerbose(false); });

      expect(mockRequest).toHaveBeenCalledWith("sessions.patch", { key: "test-session", verboseLevel: "off" });
    });

    it("falls back to chat directive on failure", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      mockRequest.mockImplementation(async (method: string) => {
        if (method === "sessions.patch") throw new Error("RPC not supported");
        return {};
      });

      await act(async () => { await result.current.setVerbose(true); });

      expect(mockRequest).toHaveBeenCalledWith("chat.send", { sessionKey: "test-session", body: "/verbose on" });
    });
  });

  describe("patchSession extended", () => {
    it("forwards thinkingLevel", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      mockRequest.mockClear();
      setupDefaultMock();

      await act(async () => { await result.current.patchSession({ thinkingLevel: "high" }); });

      expect(mockRequest).toHaveBeenCalledWith("sessions.patch", { key: "test-session", thinkingLevel: "high" });
    });

    it("supports combined patch", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      mockRequest.mockClear();
      setupDefaultMock();

      await act(async () => {
        await result.current.patchSession({ model: "claude-3", thinkingLevel: "medium", verboseLevel: "off" });
      });

      expect(mockRequest).toHaveBeenCalledWith("sessions.patch", {
        key: "test-session", model: "claude-3", thinkingLevel: "medium", verboseLevel: "off",
      });
    });

    it("falls back to chat directives when sessions.patch fails", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      mockRequest.mockImplementation(async (method: string) => {
        if (method === "sessions.patch") throw new Error("RPC not supported");
        return {};
      });

      await act(async () => {
        await result.current.patchSession({ thinkingLevel: "high", verboseLevel: "on" });
      });

      expect(mockRequest).toHaveBeenCalledWith("sessions.patch", {
        key: "test-session", thinkingLevel: "high", verboseLevel: "on",
      });
      expect(mockRequest).toHaveBeenCalledWith("chat.send", { sessionKey: "test-session", body: "/think:high" });
      expect(mockRequest).toHaveBeenCalledWith("chat.send", { sessionKey: "test-session", body: "/verbose on" });
    });

    it("still supports model and label (backward compat)", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      mockRequest.mockClear();
      setupDefaultMock();

      await act(async () => { await result.current.patchSession({ model: "claude-3", label: "Chat" }); });

      expect(mockRequest).toHaveBeenCalledWith("sessions.patch", { key: "test-session", model: "claude-3", label: "Chat" });
    });
  });

  describe("dual-failure", () => {
    it("setThinking: sessions.patch + chat.send both fail without throwing", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRequest.mockRejectedValue(new Error("always fails"));

      await act(async () => { await result.current.setThinking("high"); });

      // Should not throw — error is logged
      expect(consoleError).toHaveBeenCalledWith("[AWF] setThinking error:", expect.any(Error));
      // Session state should remain unchanged
      expect(result.current.session?.thinking).toBe("medium");
      consoleError.mockRestore();
    });

    it("setVerbose: sessions.patch + chat.send both fail without throwing", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRequest.mockRejectedValue(new Error("always fails"));

      await act(async () => { await result.current.setVerbose(true); });

      expect(consoleError).toHaveBeenCalledWith("[AWF] setVerbose error:", expect.any(Error));
      expect(result.current.session?.verbose).toBe(false);
      consoleError.mockRestore();
    });

    it("patchSession: sessions.patch + chat.send both fail without throwing", async () => {
      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      mockRequest.mockRejectedValue(new Error("always fails"));

      await act(async () => {
        await result.current.patchSession({ thinkingLevel: "high", verboseLevel: "on" });
      });

      expect(consoleError).toHaveBeenCalledWith("[AWF] patchSession fallback error:", expect.any(Error));
      consoleError.mockRestore();
    });
  });

  describe("session info", () => {
    it("exposes thinking/verbose from sessions.list", async () => {
      mockRequest.mockImplementation(async (method: string) => {
        if (method === "sessions.list") return { sessions: [{ key: "test-session", thinking: "high", verbose: true }] };
        if (method === "models.list") return { models: [] };
        return {};
      });

      const { result } = renderHook(() => useSessionSettings("test-session"), { wrapper: Wrapper });
      await waitFor(() => expect(result.current.session).not.toBeNull());

      expect(result.current.session?.thinking).toBe("high");
      expect(result.current.session?.verbose).toBe(true);
    });
  });
});
