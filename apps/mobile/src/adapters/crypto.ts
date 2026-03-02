/**
 * ExpoCryptoAdapter — CryptoAdapter implementation using @noble/curves + expo-secure-store.
 *
 * Algorithm: Ed25519
 * Device ID: SHA-256(raw 32-byte public key) → hex
 * Public key transport: base64url(raw 32 bytes)
 * Signature: Ed25519 → base64url
 */

import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import type { CryptoAdapter, CryptoKeyPairInfo } from "@intelli-claw/shared";

const PRIVATE_KEY_PREFIX = "iclaw_ed_pk_";  // new prefix to avoid collision with old P-256 keys
const PUBLIC_KEY_PREFIX = "iclaw_ed_pub_";
const ID_PREFIX = "iclaw_ed_id_";

// --- Helpers ---

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function deriveDeviceId(publicKeyRaw: Uint8Array): string {
  const hash = sha256(publicKeyRaw);
  return bytesToHex(hash);
}

// --- In-memory cache ---

interface CachedKey {
  privateKey: Uint8Array;
  publicKeyRaw: Uint8Array;
  id: string;
}

const keyCache = new Map<string, CachedKey>();

// --- ExpoCryptoAdapter ---

export class ExpoCryptoAdapter implements CryptoAdapter {
  async getOrCreateKeyPair(keyId: string): Promise<CryptoKeyPairInfo> {
    // Check in-memory cache
    const cached = keyCache.get(keyId);
    if (cached) {
      return { id: cached.id, publicKey: toBase64Url(cached.publicKeyRaw) };
    }

    // Check SecureStore
    const storedPrivateHex = await SecureStore.getItemAsync(
      `${PRIVATE_KEY_PREFIX}${keyId}`,
    );
    const storedPublicHex = await SecureStore.getItemAsync(
      `${PUBLIC_KEY_PREFIX}${keyId}`,
    );
    const storedId = await SecureStore.getItemAsync(`${ID_PREFIX}${keyId}`);

    if (storedPrivateHex && storedPublicHex && storedId) {
      const privateKey = hexToBytes(storedPrivateHex);
      const publicKeyRaw = hexToBytes(storedPublicHex);
      keyCache.set(keyId, { privateKey, publicKeyRaw, id: storedId });
      return { id: storedId, publicKey: toBase64Url(publicKeyRaw) };
    }

    // Generate new Ed25519 key pair
    const randomBytes = Crypto.getRandomBytes(32);
    const privateKey = new Uint8Array(randomBytes);
    const publicKeyRaw = ed25519.getPublicKey(privateKey);
    const id = deriveDeviceId(publicKeyRaw);

    // Store securely
    await SecureStore.setItemAsync(
      `${PRIVATE_KEY_PREFIX}${keyId}`,
      bytesToHex(privateKey),
    );
    await SecureStore.setItemAsync(
      `${PUBLIC_KEY_PREFIX}${keyId}`,
      bytesToHex(publicKeyRaw),
    );
    await SecureStore.setItemAsync(`${ID_PREFIX}${keyId}`, id);

    keyCache.set(keyId, { privateKey, publicKeyRaw, id });
    return { id, publicKey: toBase64Url(publicKeyRaw) };
  }

  async sign(keyId: string, data: string): Promise<string> {
    let entry = keyCache.get(keyId);

    if (!entry) {
      const storedPrivateHex = await SecureStore.getItemAsync(
        `${PRIVATE_KEY_PREFIX}${keyId}`,
      );
      const storedPublicHex = await SecureStore.getItemAsync(
        `${PUBLIC_KEY_PREFIX}${keyId}`,
      );
      const storedId = await SecureStore.getItemAsync(`${ID_PREFIX}${keyId}`);

      if (!storedPrivateHex || !storedPublicHex || !storedId) {
        throw new Error(`No key pair found for keyId: ${keyId}`);
      }

      entry = {
        privateKey: hexToBytes(storedPrivateHex),
        publicKeyRaw: hexToBytes(storedPublicHex),
        id: storedId,
      };
      keyCache.set(keyId, entry);
    }

    // Ed25519 signs the raw message (no prehashing)
    const msgBytes = new TextEncoder().encode(data);
    const signature = ed25519.sign(msgBytes, entry.privateKey);

    return toBase64Url(signature);
  }

  async hasKeyPair(keyId: string): Promise<boolean> {
    if (keyCache.has(keyId)) return true;
    const stored = await SecureStore.getItemAsync(
      `${PRIVATE_KEY_PREFIX}${keyId}`,
    );
    return !!stored;
  }

  async deleteKeyPair(keyId: string): Promise<void> {
    keyCache.delete(keyId);
    await SecureStore.deleteItemAsync(`${PRIVATE_KEY_PREFIX}${keyId}`);
    await SecureStore.deleteItemAsync(`${PUBLIC_KEY_PREFIX}${keyId}`);
    await SecureStore.deleteItemAsync(`${ID_PREFIX}${keyId}`);
  }
}
