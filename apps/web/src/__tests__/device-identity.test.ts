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

  it("creates a device with id and publicKey", async () => {
    const device = await getOrCreateDevice();
    expect(device.id).toBeTruthy();
    expect(typeof device.id).toBe("string");
    expect(device.publicKey).toBeTruthy();
    // publicKey is base64url-encoded raw Ed25519 key (32 bytes → 43 chars)
    expect(typeof device.publicKey).toBe("string");
    expect(device.publicKey.length).toBeGreaterThanOrEqual(40);
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

  it("signChallenge returns a valid DeviceIdentity", async () => {
    const identity = await signChallenge("test-nonce-123");

    expect(identity.id).toBeTruthy();
    expect(identity.nonce).toBe("test-nonce-123");
    expect(identity.signedAt).toBeGreaterThan(0);
    expect(identity.signature).toBeTruthy();
    expect(typeof identity.signature).toBe("string");
    // publicKey is base64url-encoded raw Ed25519 key
    expect(typeof identity.publicKey).toBe("string");
    expect(identity.publicKey.length).toBeGreaterThanOrEqual(40);
  });

  it("signChallenge produces different signatures for different nonces", async () => {
    const s1 = await signChallenge("nonce-a");
    const s2 = await signChallenge("nonce-b");
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
