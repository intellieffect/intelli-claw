/**
 * ElectronCryptoAdapter — CryptoAdapter implementation using Ed25519 (@noble/curves)
 * with key persistence via Electron main process (userData storage).
 */

import type { CryptoAdapter, CryptoKeyPairInfo } from "@intelli-claw/shared";
import {
  generatePrivateKey,
  getPublicKey,
  ed25519Sign,
  ed25519Fingerprint,
  toBase64Url,
  fromBase64Url,
} from "@intelli-claw/shared";
import type { ElectronAPI } from "../../../desktop/src/preload/index";

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

interface StoredDevicePersisted {
  version: 2;
  id: string;
  publicKeyB64: string;
  privateKeyB64: string;
  createdAt: number;
}

function isValidPersisted(value: unknown): value is StoredDevicePersisted {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 2 &&
    typeof v.id === "string" &&
    typeof v.publicKeyB64 === "string" &&
    typeof v.privateKeyB64 === "string" &&
    typeof v.createdAt === "number"
  );
}

function createDevice(): StoredDevicePersisted {
  const privateKey = generatePrivateKey();
  const publicKey = getPublicKey(privateKey);
  const id = ed25519Fingerprint(publicKey);
  return {
    version: 2,
    id,
    publicKeyB64: toBase64Url(publicKey),
    privateKeyB64: toBase64Url(privateKey),
    createdAt: Date.now(),
  };
}

const cache = new Map<string, StoredDevicePersisted>();

export class ElectronCryptoAdapter implements CryptoAdapter {
  async getOrCreateKeyPair(keyId: string): Promise<CryptoKeyPairInfo> {
    const cached = cache.get(keyId);
    if (cached) {
      return { id: cached.id, publicKey: cached.publicKeyB64 };
    }

    const stored = await window.electronAPI.deviceReadKey(keyId);
    if (isValidPersisted(stored)) {
      cache.set(keyId, stored);
      return { id: stored.id, publicKey: stored.publicKeyB64 };
    }

    // Old format or missing — create new Ed25519 key pair
    const device = createDevice();
    await window.electronAPI.deviceWriteKey(keyId, device);
    cache.set(keyId, device);
    return { id: device.id, publicKey: device.publicKeyB64 };
  }

  async sign(keyId: string, data: string): Promise<string> {
    let device = cache.get(keyId);
    if (!device) {
      const stored = await window.electronAPI.deviceReadKey(keyId);
      if (isValidPersisted(stored)) {
        device = stored;
        cache.set(keyId, stored);
      }
    }

    if (!device) {
      throw new Error(`No key pair found for keyId: ${keyId}`);
    }

    const privateKey = fromBase64Url(device.privateKeyB64);
    return ed25519Sign(data, privateKey);
  }

  async hasKeyPair(keyId: string): Promise<boolean> {
    if (cache.has(keyId)) return true;
    const stored = await window.electronAPI.deviceReadKey(keyId);
    return isValidPersisted(stored);
  }

  async deleteKeyPair(keyId: string): Promise<void> {
    cache.delete(keyId);
    await window.electronAPI.deviceWriteKey(keyId, null);
  }
}
