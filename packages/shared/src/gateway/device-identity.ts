/**
 * Device identity management — platform-agnostic via CryptoAdapter.
 *
 * Call initCryptoAdapter() before using signChallenge().
 * Each platform provides its own CryptoAdapter implementation.
 */

import type { DeviceIdentity } from "./protocol";
import type { CryptoAdapter } from "../adapters/crypto";

const DEVICE_KEY_ID = "primary";

let adapter: CryptoAdapter | null = null;

/** Initialize the crypto adapter. Must be called once before signChallenge(). */
export function initCryptoAdapter(cryptoAdapter: CryptoAdapter): void {
  adapter = cryptoAdapter;
}

/** Get the current crypto adapter (for testing/inspection). */
export function getCryptoAdapter(): CryptoAdapter | null {
  return adapter;
}

/**
 * Sign a gateway challenge nonce using the device's private key.
 * Creates the device key pair if it doesn't exist yet.
 */
export async function signChallenge(nonce: string): Promise<DeviceIdentity> {
  if (!adapter) {
    throw new Error("CryptoAdapter not initialized. Call initCryptoAdapter() first.");
  }

  const keyPair = await adapter.getOrCreateKeyPair(DEVICE_KEY_ID);
  const signedAt = Date.now();
  const signature = await adapter.sign(DEVICE_KEY_ID, `${nonce}:${signedAt}`);

  return {
    id: keyPair.id,
    publicKey: keyPair.publicKey,
    signature,
    signedAt,
    nonce,
  };
}

/** Clear the device identity (delete stored keys). */
export async function clearDeviceIdentity(): Promise<void> {
  if (!adapter) return;
  await adapter.deleteKeyPair(DEVICE_KEY_ID);
}
