/**
 * Ed25519 cryptographic utilities for OpenClaw device identity.
 *
 * Uses @noble/curves for Ed25519 key generation, signing, and verification.
 * This module provides the low-level crypto primitives used by all CryptoAdapter implementations.
 */

import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

// --- Key Operations ---

export function generatePrivateKey(): Uint8Array {
  return ed25519.utils.randomPrivateKey();
}

export function getPublicKey(privateKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(privateKey);
}

export function sign(message: string, privateKey: Uint8Array): string {
  const msgBytes = new TextEncoder().encode(message);
  const sig = ed25519.sign(msgBytes, privateKey);
  return toBase64Url(sig);
}

// --- Fingerprint ---

export function fingerprint(publicKey: Uint8Array): string {
  const hash = sha256(publicKey);
  return bytesToHex(hash);
}

// --- Base64url ---

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(str: string): Uint8Array {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Device Auth Payload (v2 format) ---

export interface DeviceAuthPayloadParams {
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  signedAtMs: number;
  token: string | null;
  nonce: string;
}

export function buildDeviceAuthPayload(params: DeviceAuthPayloadParams): string {
  return [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    params.scopes.join(","),
    String(params.signedAtMs),
    params.token ?? "",
    params.nonce,
  ].join("|");
}
