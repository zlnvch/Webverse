import { describe, it, expect } from 'vitest';
import {
  generateSalt,
  generateNonce,
  generateDEK,
  deriveKEK,
  encryptDEK,
  decryptDEK,
  computeHMACPageKey,
  encryptStroke,
  decryptStroke,
  uint8ArrayToBase64,
  base64ToUint8Array
} from './index';

describe('Encryption Utilities', () => {
  describe('generateSalt', () => {
    it('should generate 16 random bytes', () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Uint8Array);
      expect(salt.length).toBe(16);
    });

    it('should generate different values each time', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toEqual(salt2);
    });
  });

  describe('generateNonce', () => {
    it('should generate 24 random bytes', () => {
      const nonce = generateNonce();
      expect(nonce).toBeInstanceOf(Uint8Array);
      expect(nonce.length).toBe(24);
    });

    it('should generate different values each time', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      expect(nonce1).not.toEqual(nonce2);
    });
  });

  describe('generateDEK', () => {
    it('should generate 32 random bytes', () => {
      const dek = generateDEK();
      expect(dek).toBeInstanceOf(Uint8Array);
      expect(dek.length).toBe(32);
    });

    it('should generate different values each time', () => {
      const dek1 = generateDEK();
      const dek2 = generateDEK();
      expect(dek1).not.toEqual(dek2);
    });
  });

  describe('deriveKEK', () => {
    it('should derive a key from password and salt', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const kek = await deriveKEK(password, salt);

      expect(kek).toBeInstanceOf(Uint8Array);
      expect(kek.length).toBe(32);
    });

    it('should derive the same key for same password and salt', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const kek1 = await deriveKEK(password, salt);
      const kek2 = await deriveKEK(password, salt);

      expect(kek1).toEqual(kek2);
    });

    it('should derive different keys for different passwords', async () => {
      const salt = generateSalt();
      const kek1 = await deriveKEK('password1', salt);
      const kek2 = await deriveKEK('password2', salt);

      expect(kek1).not.toEqual(kek2);
    });

    it('should derive different keys for different salts', async () => {
      const password = 'test-password';
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      const kek1 = await deriveKEK(password, salt1);
      const kek2 = await deriveKEK(password, salt2);

      expect(kek1).not.toEqual(kek2);
    });
  });

  describe('encryptDEK and decryptDEK', () => {
    it('should encrypt and decrypt DEK correctly', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const kek = await deriveKEK(password, salt);
      const dek = generateDEK();

      const encrypted = encryptDEK(dek, kek);
      expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
      expect(encrypted.nonce.length).toBe(24);
      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);

      const decrypted = decryptDEK(encrypted.ciphertext, encrypted.nonce, kek);
      expect(decrypted).toEqual(dek);
    });

    it('should produce different ciphertext for same data (due to random nonce)', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const kek = await deriveKEK(password, salt);
      const dek = generateDEK();

      const encrypted1 = encryptDEK(dek, kek);
      const encrypted2 = encryptDEK(dek, kek);

      expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
      expect(encrypted1.nonce).not.toEqual(encrypted2.nonce);
    });

    it('should fail to decrypt with wrong key', async () => {
      const password1 = 'password1';
      const password2 = 'password2';
      const salt = generateSalt();
      const kek1 = await deriveKEK(password1, salt);
      const kek2 = await deriveKEK(password2, salt);
      const dek = generateDEK();

      const encrypted = encryptDEK(dek, kek1);

      // Decryption with wrong key should throw an error due to authentication tag failure
      expect(() => {
        decryptDEK(encrypted.ciphertext, encrypted.nonce, kek2);
      }).toThrow();
    });
  });

  describe('computeHMACPageKey', () => {
    it('should compute HMAC for URL', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const dek = await deriveKEK(password, salt);
      const url = 'https://example.com/page';

      const hmac = computeHMACPageKey(dek, url);

      expect(hmac).toBeInstanceOf(Uint8Array);
      expect(hmac.length).toBe(32); // SHA-256 produces 32 bytes
    });

    it('should produce same HMAC for same inputs', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const dek = await deriveKEK(password, salt);
      const url = 'https://example.com/page';

      const hmac1 = computeHMACPageKey(dek, url);
      const hmac2 = computeHMACPageKey(dek, url);

      expect(hmac1).toEqual(hmac2);
    });

    it('should produce different HMAC for different URLs', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const dek = await deriveKEK(password, salt);

      const hmac1 = computeHMACPageKey(dek, 'https://example.com/page1');
      const hmac2 = computeHMACPageKey(dek, 'https://example.com/page2');

      expect(hmac1).not.toEqual(hmac2);
    });

    it('should produce different HMAC for different DEKs', async () => {
      const salt = generateSalt();
      const dek1 = await deriveKEK('password1', salt);
      const dek2 = await deriveKEK('password2', salt);
      const url = 'https://example.com/page';

      const hmac1 = computeHMACPageKey(dek1, url);
      const hmac2 = computeHMACPageKey(dek2, url);

      expect(hmac1).not.toEqual(hmac2);
    });
  });

  describe('encryptStroke and decryptStroke', () => {
    it('should encrypt and decrypt stroke correctly', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const kek = await deriveKEK(password, salt);
      const dek = generateDEK();

      const stroke = {
        tool: 'pen',
        color: '#000000',
        width: 4,
        startX: 100,
        startY: 100,
        dx: [10, 20, 30],
        dy: [10, 20, 30]
      };

      const encrypted = encryptStroke(dek, stroke);
      expect(encrypted.nonce).toBeInstanceOf(Uint8Array);
      expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);

      const decrypted = decryptStroke(dek, encrypted.nonce, encrypted.ciphertext);
      expect(decrypted).toEqual(stroke);
    });

    it('should handle complex stroke objects', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const kek = await deriveKEK(password, salt);
      const dek = generateDEK();

      const stroke = {
        tool: 'pen',
        color: '#ff0000',
        width: 8,
        startX: 0,
        startY: 0,
        dx: Array.from({ length: 100 }, () => Math.random() * 100),
        dy: Array.from({ length: 100 }, () => Math.random() * 100),
        metadata: { id: 123, userId: 'user456' }
      };

      const encrypted = encryptStroke(dek, stroke);
      const decrypted = decryptStroke(dek, encrypted.nonce, encrypted.ciphertext);

      expect(decrypted).toEqual(stroke);
    });

    it('should produce different ciphertext for same stroke (due to random nonce)', async () => {
      const password = 'test-password';
      const salt = generateSalt();
      const kek = await deriveKEK(password, salt);
      const dek = generateDEK();

      const stroke = { tool: 'pen', color: '#000000', width: 4, startX: 0, startY: 0, dx: [10], dy: [10] };

      const encrypted1 = encryptStroke(dek, stroke);
      const encrypted2 = encryptStroke(dek, stroke);

      expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
    });
  });

  describe('uint8ArrayToBase64 and base64ToUint8Array', () => {
    it('should convert Uint8Array to base64 and back', () => {
      const original = new Uint8Array([0, 1, 2, 255, 128, 127]);
      const base64 = uint8ArrayToBase64(original);
      const restored = base64ToUint8Array(base64);

      expect(restored).toEqual(original);
    });

    it('should handle empty array', () => {
      const original = new Uint8Array([]);
      const base64 = uint8ArrayToBase64(original);
      const restored = base64ToUint8Array(base64);

      expect(restored).toEqual(original);
    });

    it('should handle larger arrays', () => {
      const original = new Uint8Array(Array.from({ length: 1000 }, (_, i) => i % 256));
      const base64 = uint8ArrayToBase64(original);
      const restored = base64ToUint8Array(base64);

      expect(restored).toEqual(original);
    });

    it('should produce valid base64 strings', () => {
      const bytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const base64 = uint8ArrayToBase64(bytes);

      expect(base64).toBe('SGVsbG8=');
    });

    it('should round-trip special characters', () => {
      const original = new Uint8Array([0, 128, 255, 1, 127, 254]);
      const base64 = uint8ArrayToBase64(original);
      const restored = base64ToUint8Array(base64);

      expect(restored).toEqual(original);
    });
  });

  describe('End-to-end encryption workflow', () => {
    it('should complete full encryption cycle for DEK', async () => {
      const password = 'my-secure-password';
      const salt = generateSalt();

      // Derive KEK
      const kek = await deriveKEK(password, salt);
      expect(kek.length).toBe(32);

      // Generate and encrypt DEK
      const dek = generateDEK();
      const encryptedDEK = encryptDEK(dek, kek);

      // Decrypt DEK
      const decryptedDEK = decryptDEK(encryptedDEK.ciphertext, encryptedDEK.nonce, kek);

      expect(decryptedDEK).toEqual(dek);
    });

    it('should complete full encryption cycle for stroke', async () => {
      const password = 'my-secure-password';
      const salt = generateSalt();

      // Derive keys
      const kek = await deriveKEK(password, salt);
      const dek = generateDEK();

      // Encrypt stroke
      const stroke = {
        tool: 'pen',
        color: '#ff0000',
        width: 5,
        startX: 50,
        startY: 50,
        dx: [100, 200, 150],
        dy: [50, 100, 75]
      };

      const encryptedStroke = encryptStroke(dek, stroke);

      // Decrypt stroke
      const decryptedStroke = decryptStroke(dek, encryptedStroke.nonce, encryptedStroke.ciphertext);

      expect(decryptedStroke).toEqual(stroke);
    });

    it('should maintain data integrity through base64 encoding', async () => {
      const password = 'password123';
      const salt = generateSalt();
      const kek = await deriveKEK(password, salt);
      const dek = generateDEK();

      const stroke = { tool: 'pen', color: '#0000ff', width: 3, startX: 10, startY: 20, dx: [30], dy: [40] };

      // Encrypt
      const encrypted = encryptStroke(dek, stroke);

      // Convert to base64 (as done in production)
      const nonceBase64 = uint8ArrayToBase64(encrypted.nonce);
      const ciphertextBase64 = uint8ArrayToBase64(encrypted.ciphertext);

      // Convert back from base64
      const nonce = base64ToUint8Array(nonceBase64);
      const ciphertext = base64ToUint8Array(ciphertextBase64);

      // Decrypt
      const decrypted = decryptStroke(dek, nonce, ciphertext);

      expect(decrypted).toEqual(stroke);
    });
  });
});
