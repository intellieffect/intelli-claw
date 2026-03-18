/**
 * Tests for remaining fixes (#250, #251):
 * 1. exec.approval event handling
 * 2. isChatStopCommand / isChatResetCommand
 * 3. buildDeviceAuthPayload utility
 */
import { describe, it, expect } from "vitest";

// --- 1. buildDeviceAuthPayload (#251) ---
import { buildDeviceAuthPayload } from "@intelli-claw/shared";

describe("buildDeviceAuthPayload", () => {
  it("produces v3 pipe-delimited payload", () => {
    const result = buildDeviceAuthPayload({
      deviceId: "dev-123",
      clientId: "openclaw-control-ui",
      clientMode: "ui",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      signedAt: 1710000000000,
      token: "tok-abc",
      nonce: "nonce-xyz",
      platform: "web",
    });
    expect(result).toBe(
      "v3|dev-123|openclaw-control-ui|ui|operator|operator.read,operator.write|1710000000000|tok-abc|nonce-xyz|web|"
    );
  });

  it("handles empty scopes", () => {
    const result = buildDeviceAuthPayload({
      deviceId: "d1",
      clientId: "c1",
      clientMode: "ui",
      role: "operator",
      scopes: [],
      signedAt: 0,
      token: "t",
      nonce: "n",
      platform: "web",
    });
    expect(result).toBe("v3|d1|c1|ui|operator||0|t|n|web|");
  });
});

// --- 2. isChatStopCommand / isChatResetCommand (#251) ---
import { isChatStopCommand, isChatResetCommand } from "@/lib/gateway/hooks";

describe("isChatStopCommand", () => {
  it.each(["/stop", "stop", "abort", "/abort", "  /stop  ", "STOP", "Abort"])(
    "recognizes '%s' as stop command",
    (text) => {
      expect(isChatStopCommand(text)).toBe(true);
    }
  );

  it.each(["hello", "/new", "/reset", "", "stopping", "stopped"])(
    "does not recognize '%s' as stop command",
    (text) => {
      expect(isChatStopCommand(text)).toBe(false);
    }
  );
});

describe("isChatResetCommand", () => {
  it("recognizes /new as reset", () => {
    const result = isChatResetCommand("/new");
    expect(result).toEqual({ reset: true, message: undefined });
  });

  it("recognizes /reset as reset", () => {
    const result = isChatResetCommand("/reset");
    expect(result).toEqual({ reset: true, message: undefined });
  });

  it("extracts message after /new", () => {
    const result = isChatResetCommand("/new start fresh");
    expect(result).toEqual({ reset: true, message: "start fresh" });
  });

  it("extracts message after /reset", () => {
    const result = isChatResetCommand("/reset hello world");
    expect(result).toEqual({ reset: true, message: "hello world" });
  });

  it("is case-insensitive", () => {
    expect(isChatResetCommand("/NEW").reset).toBe(true);
    expect(isChatResetCommand("/Reset").reset).toBe(true);
  });

  it("returns false for non-reset commands", () => {
    expect(isChatResetCommand("hello")).toEqual({ reset: false });
    expect(isChatResetCommand("/stop")).toEqual({ reset: false });
    expect(isChatResetCommand("")).toEqual({ reset: false });
  });
});
