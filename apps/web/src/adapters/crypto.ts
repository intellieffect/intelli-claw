/**
 * WebCryptoAdapter — CryptoAdapter implementation using Web Crypto API + IndexedDB.
 * Used in both web and Electron (which has the same Web Crypto API).
 *
 * Algorithm: Ed25519
 * Device ID: SHA-256(raw 32-byte public key) → hex
 * Public key transport: base64url(raw 32 bytes)
 * Signature: Ed25519 → base64url
 */

import type { CryptoAdapter, CryptoKeyPairInfo } from "@intelli-claw/shared";

const DB_NAME = "intelli-claw-device";
const DB_VERSION = 2; // bumped: ECDSA P-256 → Ed25519 (incompatible key format change)
const STORE_NAME = "keys";

interface StoredDevice {
  id: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyRaw: ArrayBuffer;
  createdAt: number;
}

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Delete old store if upgrading from v1 (ECDSA keys are incompatible)
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

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function toBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- Crypto helpers ---

async function deriveDeviceId(rawPublicKey: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", rawPublicKey);
  return bufToHex(hash);
}

async function createDevice(): Promise<StoredDevice> {
  const keyPair = await crypto.subtle.generateKey(
    "Ed25519" as unknown as AlgorithmIdentifier,
    false,
    ["sign", "verify"],
  );

  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const id = await deriveDeviceId(publicKeyRaw);

  return {
    id,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyRaw,
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
      return { id: cached.id, publicKey: toBase64Url(cached.publicKeyRaw) };
    }

    const db = await openDB();
    try {
      const stored = await idbGet<StoredDevice>(db, keyId);
      if (stored?.privateKey && stored?.publicKeyRaw) {
        cache.set(keyId, stored);
        return { id: stored.id, publicKey: toBase64Url(stored.publicKeyRaw) };
      }

      const device = await createDevice();
      await idbPut(db, keyId, device);
      cache.set(keyId, device);
      return { id: device.id, publicKey: toBase64Url(device.publicKeyRaw) };
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
    if (!device?.privateKey) {
      throw new Error(`No key pair found for keyId: ${keyId}`);
    }

    const payload = new TextEncoder().encode(data);
    const sigBuf = await crypto.subtle.sign(
      "Ed25519" as unknown as AlgorithmIdentifier,
      device.privateKey,
      payload,
    );
    return toBase64Url(sigBuf);
  }

  async hasKeyPair(keyId: string): Promise<boolean> {
    if (cache.has(keyId)) return true;
    const db = await openDB();
    try {
      const stored = await idbGet<StoredDevice>(db, keyId);
      return !!(stored?.privateKey);
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
