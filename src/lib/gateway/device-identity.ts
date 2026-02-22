import type { DeviceIdentity } from "./protocol";

const DB_NAME = "intelli-claw-device";
const DB_VERSION = 1;
const STORE_NAME = "keys";
const DEVICE_KEY = "primary";

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
    false, // privateKey non-extractable
    ["sign", "verify"],
  );

  // Export public key (we need a separate extractable copy for JWK export)
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

// --- Public API ---

let cached: StoredDevice | null = null;

export async function getOrCreateDevice(): Promise<StoredDevice> {
  if (cached) return cached;

  const db = await openDB();
  try {
    const stored = await idbGet<StoredDevice>(db, DEVICE_KEY);
    if (stored?.privateKey && stored?.publicKeyJwk) {
      cached = stored;
      return stored;
    }

    const device = await createDevice();
    await idbPut(db, DEVICE_KEY, device);
    cached = device;
    return device;
  } finally {
    db.close();
  }
}

export async function signChallenge(nonce: string): Promise<DeviceIdentity> {
  const device = await getOrCreateDevice();
  const signedAt = Date.now();
  const payload = new TextEncoder().encode(`${nonce}:${signedAt}`);
  const sigBuf = await crypto.subtle.sign(
    { name: ALGO.name, hash: ALGO.hash },
    device.privateKey,
    payload,
  );

  return {
    id: device.id,
    publicKey: JSON.stringify(device.publicKeyJwk),
    signature: toBase64(sigBuf),
    signedAt,
    nonce,
  };
}

export async function clearDeviceIdentity(): Promise<void> {
  cached = null;
  const db = await openDB();
  try {
    await idbDelete(db, DEVICE_KEY);
  } finally {
    db.close();
  }
}
