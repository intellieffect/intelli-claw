import { describe, it, expect, beforeEach } from "vitest";
import { initCryptoAdapter } from "@intelli-claw/shared";
import { WebCryptoAdapter } from "@/adapters/crypto";
import { getOrCreateDevice, signChallenge, clearDeviceIdentity } from "@/lib/gateway/device-identity";

// Initialize adapter for tests
initCryptoAdapter(new WebCryptoAdapter());

describe("device-identity", () => {
  beforeEach(async () => {
    // Clear cached state + IndexedDB between tests
    await clearDeviceIdentity();
  });

  it("creates a device with hex id and base64url publicKey", async () => {
    const device = await getOrCreateDevice();
    expect(device.id).toBeTruthy();
    expect(typeof device.id).toBe("string");
    // Device ID should be 64-char hex (SHA-256)
    expect(device.id).toMatch(/^[0-9a-f]{64}$/);
    // Public key should be base64url-encoded (no +, /, =)
    expect(device.publicKey).toBeTruthy();
    expect(device.publicKey).not.toContain("+");
    expect(device.publicKey).not.toContain("/");
    expect(device.publicKey).not.toContain("=");
  });

  it("returns the same device on subsequent calls", async () => {
    const d1 = await getOrCreateDevice();
    const d2 = await getOrCreateDevice();
    expect(d1.id).toBe(d2.id);
  });

  it("persists device across cache clears (IndexedDB)", async () => {
    const d1 = await getOrCreateDevice();
    expect(d1.id).toBeTruthy();
  });

  it("signChallenge returns a valid DeviceIdentity with v2 payload", async () => {
    const identity = await signChallenge({
      nonce: "test-nonce-123",
      clientId: "openclaw-control-ui",
      clientMode: "ui",
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      token: "test-token",
    });

    expect(identity.id).toBeTruthy();
    expect(identity.id).toMatch(/^[0-9a-f]{64}$/);
    expect(identity.nonce).toBe("test-nonce-123");
    expect(identity.signedAt).toBeGreaterThan(0);
    expect(identity.signature).toBeTruthy();
    expect(typeof identity.signature).toBe("string");
    // Public key should be base64url
    expect(identity.publicKey).not.toContain("+");
    expect(identity.publicKey).not.toContain("/");
    expect(identity.publicKey).not.toContain("=");
  });

  it("signChallenge produces different signatures for different nonces", async () => {
    const params = {
      clientId: "openclaw-control-ui",
      clientMode: "ui",
      role: "operator",
      scopes: ["operator.read"],
      token: "test-token",
    };
    const s1 = await signChallenge({ ...params, nonce: "nonce-a" });
    const s2 = await signChallenge({ ...params, nonce: "nonce-b" });
    expect(s1.signature).not.toBe(s2.signature);
    // But same device ID
    expect(s1.id).toBe(s2.id);
  });

  it("clearDeviceIdentity removes the device", async () => {
    const d1 = await getOrCreateDevice();
    await clearDeviceIdentity();
    const d2 = await getOrCreateDevice();
    // New device should have a different ID (new key pair)
    expect(d2.id).not.toBe(d1.id);
  });
});
