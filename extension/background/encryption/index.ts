import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { argon2id } from '@noble/hashes/argon2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

export function generateSalt() {
  return randomBytes(16);
}

export function generateNonce() {
  return randomBytes(24);
}

export function generateDEK() {
  return randomBytes(32);
}

export async function deriveKEK(password: string, salt: Uint8Array) {
  return argon2id(
    new TextEncoder().encode(password),
    salt,
    {
      p: 1, // parallelism
      m: 64 * 1024, // memory size in KB
      t: 3, // iterations
      dkLen: 32 // derived key length
    }
  );
}

export function encryptDEK(dek: Uint8Array, kek: Uint8Array) {
  const nonce = generateNonce();
  const cipher = xchacha20poly1305(kek, nonce);
  return {
    nonce,
    ciphertext: cipher.encrypt(dek)
  };
}

export function decryptDEK(encryptedDEK: Uint8Array, nonce: Uint8Array, kek: Uint8Array): Uint8Array {
  const cipher = xchacha20poly1305(kek, nonce);
  return cipher.decrypt(encryptedDEK);
}

export function computeHMACPageKey(dek: Uint8Array, canonicalUrl: string) {
  const data = new TextEncoder().encode(canonicalUrl);
  return hmac(sha256, dek, data); // Uint8Array
}

export function encryptStroke(dek: Uint8Array, stroke: object) {
  const nonce = generateNonce();
  const cipher = xchacha20poly1305(dek, nonce);
  const data = new TextEncoder().encode(JSON.stringify(stroke));
  return {
    nonce,
    ciphertext: cipher.encrypt(data)
  };
}

export function decryptStroke(dek: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): object {
  const cipher = xchacha20poly1305(dek, nonce);
  const decrypted = cipher.decrypt(ciphertext);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

// Helper to convert Uint8Array to base64 string for storage/transmission
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const binaryString = String.fromCharCode.apply(null, Array.from(bytes));
  return btoa(binaryString);
}

// Helper to convert base64 string to Uint8Array
export function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
