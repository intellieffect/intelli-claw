/**
 * WebCryptoAdapter — CryptoAdapter implementation using Web Crypto API + IndexedDB.
 * Used in both web and Electron (which has the same Web Crypto API).
 */

import type { CryptoAdapter, CryptoKeyPairInfo } from "@intelli-claw/shared";

const DB_NAME = "intelli-claw-device";
const DB_VERSION = 1;
const STORE_NAME = "keys";

interface StoredDevice {
  id: string;
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyJwk: JsonWebKey;
  createdAt: number;
}

// --- IndexedDB helpers ---

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
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

// --- Crypto helpers ---

const ALGO: EcdsaParams & EcKeyGenParams = {
  name: "ECDSA",
  namedCurve: "P-256",
  hash: "SHA-256",
};

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fingerprint(jwk: JsonWebKey): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(jwk));
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return toBase64(hash).replace(/[+/=]/g, "").slice(0, 32);
}

async function createDevice(): Promise<StoredDevice> {
  const keyPair = await crypto.subtle.generateKey(
    { name: ALGO.name, namedCurve: ALGO.namedCurve },
    false,
    ["sign", "verify"],
  );

  const publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const id = await fingerprint(publicKeyJwk);

  return {
    id,
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyJwk,
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
      return { id: cached.id, publicKey: JSON.stringify(cached.publicKeyJwk) };
    }

    const db = await openDB();
    try {
      const stored = await idbGet<StoredDevice>(db, keyId);
      if (stored?.privateKey && stored?.publicKeyJwk) {
        cache.set(keyId, stored);
        return { id: stored.id, publicKey: JSON.stringify(stored.publicKeyJwk) };
      }

      const device = await createDevice();
      await idbPut(db, keyId, device);
      cache.set(keyId, device);
      return { id: device.id, publicKey: JSON.stringify(device.publicKeyJwk) };
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
      { name: ALGO.name, hash: ALGO.hash },
      device.privateKey,
      payload,
    );
    return toBase64(sigBuf);
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
