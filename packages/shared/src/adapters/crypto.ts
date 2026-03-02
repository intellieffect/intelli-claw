/**
 * CryptoAdapter — platform-agnostic cryptographic key management.
 *
 * Implementations:
 * - Web/Electron: Web Crypto API + IndexedDB
 * - Mobile: expo-crypto + expo-secure-store
 */

export interface CryptoKeyPairInfo {
  /** Device ID: hex(SHA-256(raw_public_key_bytes)) */
  id: string;
  /** Raw Ed25519 public key, base64url-encoded (32 bytes) */
  publicKey: string;
}

export interface CryptoAdapter {
  /** Get or create an Ed25519 key pair. Returns existing if already stored. */
  getOrCreateKeyPair(keyId: string): Promise<CryptoKeyPairInfo>;

  /** Sign data with the private key associated with keyId. Returns base64url-encoded signature. */
  sign(keyId: string, data: string): Promise<string>;

  /** Check if a key pair exists for the given keyId. */
  hasKeyPair(keyId: string): Promise<boolean>;

  /** Delete a stored key pair. */
  deleteKeyPair(keyId: string): Promise<void>;
}
