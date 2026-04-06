/**
 * #268 — QR로 게이트웨이 연결 안되는 이슈
 *
 * Defensive validation tests for the URL/token that arrive from QR scans
 * and deep links. Without these guards, stray whitespace or a missing
 * scheme would reach `new WebSocket(url)` and throw a silent error.
 */
import { describe, it, expect } from "vitest";
import {
  validateGatewayUrl,
  normalizeToken,
} from "../lib/validate-gateway-url";

describe("#268 — validateGatewayUrl", () => {
  it("accepts a clean wss:// URL", () => {
    const r = validateGatewayUrl("wss://host.example:18789");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("wss://host.example:18789");
  });

  it("accepts a clean ws:// URL", () => {
    const r = validateGatewayUrl("ws://localhost:18789");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("ws://localhost:18789");
  });

  it("trims leading/trailing whitespace", () => {
    const r = validateGatewayUrl("  wss://host.example:18789  \n");
    expect(r.ok).toBe(true);
    expect(r.url).toBe("wss://host.example:18789");
  });

  it("rejects empty string", () => {
    const r = validateGatewayUrl("");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("비어");
  });

  it("rejects whitespace-only string", () => {
    const r = validateGatewayUrl("   \t\n  ");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("비어");
  });

  it("rejects non-string input", () => {
    expect(validateGatewayUrl(undefined).ok).toBe(false);
    expect(validateGatewayUrl(null).ok).toBe(false);
    expect(validateGatewayUrl(42).ok).toBe(false);
    expect(validateGatewayUrl({}).ok).toBe(false);
  });

  it("rejects http:// scheme", () => {
    const r = validateGatewayUrl("http://host.example:18789");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("wss://");
  });

  it("rejects missing scheme", () => {
    const r = validateGatewayUrl("host.example:18789");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("wss://");
  });

  it("rejects malformed host", () => {
    const r = validateGatewayUrl("wss://:18789");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("잘못");
  });

  it("accepts URL with path (Tailscale MagicDNS)", () => {
    const r = validateGatewayUrl("wss://macbook.tail.ts.net:18789/ws");
    expect(r.ok).toBe(true);
  });
});

describe("#268 — normalizeToken", () => {
  it("returns the trimmed token", () => {
    expect(normalizeToken("secret-123")).toBe("secret-123");
    expect(normalizeToken("  secret-123  \n")).toBe("secret-123");
  });

  it("coerces non-string to empty string", () => {
    expect(normalizeToken(undefined)).toBe("");
    expect(normalizeToken(null)).toBe("");
    expect(normalizeToken(42)).toBe("");
    expect(normalizeToken({})).toBe("");
  });

  it("handles empty / whitespace-only tokens", () => {
    expect(normalizeToken("")).toBe("");
    expect(normalizeToken("   ")).toBe("");
  });
});
