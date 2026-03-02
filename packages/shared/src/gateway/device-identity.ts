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

/** Parameters for building the v2 auth payload (must match OpenClaw Gateway's buildDeviceAuthPayload). */
export interface SignChallengeParams {
  nonce: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token: string;
}

/**
 * Build the v2 device auth payload string.
 * Format: v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce
 * Must match OpenClaw Gateway's buildDeviceAuthPayload exactly.
 */
function buildAuthPayload(
  deviceId: string,
  signedAt: number,
  params: SignChallengeParams,
): string {
  const scopes = params.scopes.join(",");
  return [
    "v2",
    deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(signedAt),
    params.token,
    params.nonce,
  ].join("|");
}

/**
 * Sign a gateway challenge using the device's Ed25519 private key.
 * Creates the device key pair if it doesn't exist yet.
 * Uses v2 payload format matching OpenClaw Gateway expectations.
 */
export async function signChallenge(params: SignChallengeParams): Promise<DeviceIdentity> {
  if (!adapter) {
    throw new Error("CryptoAdapter not initialized. Call initCryptoAdapter() first.");
  }

  const keyPair = await adapter.getOrCreateKeyPair(DEVICE_KEY_ID);
  const signedAt = Date.now();
  const payload = buildAuthPayload(keyPair.id, signedAt, params);
  const signature = await adapter.sign(DEVICE_KEY_ID, payload);

  return {
    id: keyPair.id,
    publicKey: keyPair.publicKey,
    signature,
    signedAt,
    nonce: params.nonce,
  };
}

/** Clear the device identity (delete stored keys). */
export async function clearDeviceIdentity(): Promise<void> {
  if (!adapter) return;
  await adapter.deleteKeyPair(DEVICE_KEY_ID);
}
