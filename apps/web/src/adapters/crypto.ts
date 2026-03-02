/**
 * WebCryptoAdapter — CryptoAdapter implementation using @noble/ed25519 + IndexedDB.
 * Uses Ed25519 for device identity (matching OpenClaw Gateway expectations).
 * Used in both web and Electron.
 *
 * Note: Web Crypto API does not support Ed25519 until Chrome 137+,
 * so we use @noble/ed25519 (pure JS) with Web Crypto SHA-512 for hashing.
 */

import * as ed from "@noble/ed25519";
import type { CryptoAdapter, CryptoKeyPairInfo } from "@intelli-claw/shared";

// --- Configure @noble/ed25519 to use Web Crypto SHA-512 ---
ed.hashes.sha512Async = async (message: Uint8Array): Promise<Uint8Array> => {
  const hash = await crypto.subtle.digest("SHA-512", message);
  return new Uint8Array(hash);
};

const DB_NAME = "intelli-claw-device";
const DB_VERSION = 2; // Bumped for Ed25519 migration
const STORE_NAME = "keys";

interface StoredDevice {
  id: string;
  secretKey: Uint8Array; // Ed25519 private key (32 bytes)
  publicKeyBase64Url: string; // raw Ed25519 public key, base64url-encoded
  createdAt: number;
}

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Clear old store on version upgrade (ECDSA → Ed25519 migration)
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const req = tx.objectStore(STORE_NAME).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// --- Encoding helpers ---

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Device creation ---

async function createDevice(): Promise<StoredDevice> {
  const secretKey = ed.utils.randomSecretKey();
  const publicKey = await ed.getPublicKeyAsync(secretKey);
  const publicKeyBase64Url = toBase64Url(publicKey);

  // Device ID = hex(SHA-256(raw_public_key_bytes)) — matches OpenClaw Gateway
  const hash = await crypto.subtle.digest("SHA-256", publicKey);
  const id = toHex(new Uint8Array(hash));

  return {
    id,
    secretKey,
    publicKeyBase64Url,
    createdAt: Date.now(),
  };
}

// --- In-memory cache ---
const cache = new Map<string, StoredDevice>();

// --- WebCryptoAdapter ---

export class WebCryptoAdapter implements CryptoAdapter {
  async getOrCreateKeyPair(keyId: string): Promise<CryptoKeyPairInfo> {
    // Check cache
    const cached = cache.get(keyId);
    if (cached) {
      return { id: cached.id, publicKey: cached.publicKeyBase64Url };
    }

    const db = await openDB();
    try {
      const stored = await idbGet<StoredDevice>(db, keyId);
      if (stored?.secretKey && stored?.publicKeyBase64Url) {
        cache.set(keyId, stored);
        return { id: stored.id, publicKey: stored.publicKeyBase64Url };
      }

      const device = await createDevice();
      await idbPut(db, keyId, device);
      cache.set(keyId, device);
      return { id: device.id, publicKey: device.publicKeyBase64Url };
    } finally {
      db.close();
    }
  }

  async sign(keyId: string, data: string): Promise<string> {
    let device = cache.get(keyId);
    if (!device) {
      const db = await openDB();
      try {
        device = await idbGet<StoredDevice>(db, keyId);
      } finally {
        db.close();
      }
    }
    if (!device?.secretKey) {
      throw new Error(`No key pair found for keyId: ${keyId}`);
    }

    const payload = new TextEncoder().encode(data);
    const signature = await ed.signAsync(payload, device.secretKey);
    return toBase64Url(signature);
  }

  async hasKeyPair(keyId: string): Promise<boolean> {
    if (cache.has(keyId)) return true;
    const db = await openDB();
    try {
      const stored = await idbGet<StoredDevice>(db, keyId);
      return !!stored?.secretKey;
    } finally {
      db.close();
    }
  }

  async deleteKeyPair(keyId: string): Promise<void> {
    cache.delete(keyId);
    const db = await openDB();
    try {
      await idbDelete(db, keyId);
    } finally {
      db.close();
    }
  }
}
