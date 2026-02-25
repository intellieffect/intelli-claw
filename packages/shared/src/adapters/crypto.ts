/**
 * CryptoAdapter — platform-agnostic cryptographic key management.
 *
 * Implementations:
 * - Web/Electron: Web Crypto API + IndexedDB
 * - Mobile: expo-crypto + expo-secure-store
 */

export interface CryptoKeyPairInfo {
  /** Fingerprint/hash of the public key (used as device ID) */
  id: string;
  /** JSON-serialized public key (JWK format) */
  publicKey: string;
}

export interface CryptoAdapter {
  /** Get or create an ECDSA P-256 key pair. Returns existing if already stored. */
  getOrCreateKeyPair(keyId: string): Promise<CryptoKeyPairInfo>;

  /** Sign data with the private key associated with keyId. Returns base64-encoded signature. */
  sign(keyId: string, data: string): Promise<string>;

  /** Check if a key pair exists for the given keyId. */
  hasKeyPair(keyId: string): Promise<boolean>;

  /** Delete a stored key pair. */
  deleteKeyPair(keyId: string): Promise<void>;
}
