// Re-export from shared package
export { signChallenge, clearDeviceIdentity, initCryptoAdapter, getCryptoAdapter, type SignChallengeParams } from "@intelli-claw/shared";
import { getCryptoAdapter } from "@intelli-claw/shared";

// Also export the WebCryptoAdapter initialization for convenience
export { WebCryptoAdapter } from "@/adapters/crypto";

// Web-specific: getOrCreateDevice (uses CryptoAdapter under the hood)
export async function getOrCreateDevice(): Promise<{ id: string; publicKey: string }> {
  const adapter = getCryptoAdapter();
  if (!adapter) throw new Error("CryptoAdapter not initialized");
  const keyPair = await adapter.getOrCreateKeyPair("primary");
  return { id: keyPair.id, publicKey: keyPair.publicKey };
}
