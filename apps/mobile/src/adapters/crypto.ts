/**
 * ExpoCryptoAdapter — CryptoAdapter implementation using @noble/curves + expo-secure-store.
 *
 * Uses pure-JS ECDSA P-256 (compatible with Web Crypto API signatures)
 * and stores private keys securely via expo-secure-store (Keychain/Keystore).
 */

import { p256 } from "@noble/curves/p256";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import type { CryptoAdapter, CryptoKeyPairInfo } from "@intelli-claw/shared";

const PRIVATE_KEY_PREFIX = "iclaw_pk_";
const PUBLIC_KEY_PREFIX = "iclaw_pub_";
const ID_PREFIX = "iclaw_id_";

// --- Helpers ---

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Convert uncompressed P-256 public key (65 bytes) to JWK format */
function pointToJwk(publicKey: Uint8Array): JsonWebKey {
  // Uncompressed point format: 0x04 || x (32 bytes) || y (32 bytes)
  const x = publicKey.slice(1, 33);
  const y = publicKey.slice(33, 65);
  return {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(x),
    y: toBase64Url(y),
  };
}

/** Create a fingerprint matching WebCryptoAdapter's format */
function createFingerprint(jwk: JsonWebKey): string {
  const encoded = new TextEncoder().encode(JSON.stringify(jwk));
  const hash = sha256(encoded);
  return toBase64(hash).replace(/[+/=]/g, "").slice(0, 32);
}

// --- In-memory cache ---

interface CachedKey {
  privateKey: Uint8Array;
  publicKeyJwk: JsonWebKey;
  id: string;
}

const keyCache = new Map<string, CachedKey>();

// --- ExpoCryptoAdapter ---

export class ExpoCryptoAdapter implements CryptoAdapter {
  async getOrCreateKeyPair(keyId: string): Promise<CryptoKeyPairInfo> {
    // Check in-memory cache
    const cached = keyCache.get(keyId);
    if (cached) {
      return { id: cached.id, publicKey: JSON.stringify(cached.publicKeyJwk) };
    }

    // Check SecureStore
    const storedPrivateHex = await SecureStore.getItemAsync(
      `${PRIVATE_KEY_PREFIX}${keyId}`,
    );
    const storedPublicJson = await SecureStore.getItemAsync(
      `${PUBLIC_KEY_PREFIX}${keyId}`,
    );
    const storedId = await SecureStore.getItemAsync(`${ID_PREFIX}${keyId}`);

    if (storedPrivateHex && storedPublicJson && storedId) {
      const privateKey = hexToBytes(storedPrivateHex);
      const publicKeyJwk = JSON.parse(storedPublicJson) as JsonWebKey;
      keyCache.set(keyId, { privateKey, publicKeyJwk, id: storedId });
      return { id: storedId, publicKey: storedPublicJson };
    }

    // Generate new ECDSA P-256 key pair
    const randomBytes = Crypto.getRandomBytes(32);
    const privateKey = new Uint8Array(randomBytes);
    const publicKeyBytes = p256.getPublicKey(privateKey, false); // uncompressed
    const publicKeyJwk = pointToJwk(publicKeyBytes);
    const id = createFingerprint(publicKeyJwk);

    // Store securely
    const publicKeyJson = JSON.stringify(publicKeyJwk);
    await SecureStore.setItemAsync(
      `${PRIVATE_KEY_PREFIX}${keyId}`,
      bytesToHex(privateKey),
    );
    await SecureStore.setItemAsync(`${PUBLIC_KEY_PREFIX}${keyId}`, publicKeyJson);
    await SecureStore.setItemAsync(`${ID_PREFIX}${keyId}`, id);

    keyCache.set(keyId, { privateKey, publicKeyJwk, id });
    return { id, publicKey: publicKeyJson };
  }

  async sign(keyId: string, data: string): Promise<string> {
    let entry = keyCache.get(keyId);

    if (!entry) {
      const storedPrivateHex = await SecureStore.getItemAsync(
        `${PRIVATE_KEY_PREFIX}${keyId}`,
      );
      const storedPublicJson = await SecureStore.getItemAsync(
        `${PUBLIC_KEY_PREFIX}${keyId}`,
      );
      const storedId = await SecureStore.getItemAsync(`${ID_PREFIX}${keyId}`);

      if (!storedPrivateHex || !storedPublicJson || !storedId) {
        throw new Error(`No key pair found for keyId: ${keyId}`);
      }

      entry = {
        privateKey: hexToBytes(storedPrivateHex),
        publicKeyJwk: JSON.parse(storedPublicJson) as JsonWebKey,
        id: storedId,
      };
      keyCache.set(keyId, entry);
    }

    // Hash with SHA-256 then sign with ECDSA P-256 (matches Web Crypto behavior)
    const msgBytes = new TextEncoder().encode(data);
    const msgHash = sha256(msgBytes);
    const signature = p256.sign(msgHash, entry.privateKey);

    // Return r || s (64 bytes) as base64, matching Web Crypto's IEEE P1363 format
    return toBase64(signature.toCompactRawBytes());
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
