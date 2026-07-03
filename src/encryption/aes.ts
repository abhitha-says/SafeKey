/**
 * AES-256-GCM encryption/decryption using @noble/ciphers (pure JS).
 *
 * Why @noble/ciphers:
 *   - Pure JavaScript — works on ALL Expo SDK versions (no native module needed)
 *   - Audited by Cure53 — production-grade security
 *   - Tiny footprint (~3KB gzipped)
 *   - expo-crypto's AES APIs (AESEncryptionKey etc.) require SDK 57+
 *
 * Security properties of AES-256-GCM:
 *   - Confidentiality: ciphertext reveals nothing about plaintext
 *   - Integrity: auth tag detects any tampering with ciphertext
 *   - Authenticated: wrong key OR tampered ciphertext → decryption throws
 *   - IV: 12-byte (96-bit) random nonce, unique per encryption, NEVER reused
 */

import { gcm } from '@noble/ciphers/aes';
import { generateIV, bytesToHex, hexToBytes } from './salt';
import type { EncryptedData } from '@/types';

/**
 * Encrypts a plaintext string with AES-256-GCM.
 *
 * A fresh random 12-byte IV is generated for every call.
 * NEVER call this with a reused IV — it catastrophically breaks GCM security.
 *
 * @param plaintext - The password/notes string to encrypt
 * @param keyHex - 64-char hex (32 bytes) derived key from Argon2id
 * @returns EncryptedData { ciphertext, iv, authTag } all hex-encoded
 */
export async function encrypt(
  plaintext: string,
  keyHex: string
): Promise<EncryptedData> {
  if (!plaintext) throw new Error('Cannot encrypt empty plaintext');
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('Key must be 64-char hex (32 bytes)');
  }

  const keyBytes = hexToBytes(keyHex);
  const iv = await generateIV(); // 12 bytes from expo-crypto CSPRNG
  const plaintextBytes = new TextEncoder().encode(plaintext);

  // GCM encrypt — returns ciphertext with appended 16-byte auth tag
  const aes = gcm(keyBytes, iv);
  const sealed = aes.encrypt(plaintextBytes);

  // Noble's GCM appends the 16-byte auth tag to the end of ciphertext
  const ciphertextBytes = sealed.slice(0, sealed.length - 16);
  const authTagBytes = sealed.slice(sealed.length - 16);

  return {
    ciphertext: bytesToHex(ciphertextBytes),
    iv: bytesToHex(iv),
    authTag: bytesToHex(authTagBytes),
  };
}

/**
 * Decrypts AES-256-GCM ciphertext.
 *
 * If the key is wrong, the IV is wrong, or the ciphertext has been tampered with,
 * this function THROWS — it does not return garbage data.
 * This is the guarantee of GCM authentication.
 *
 * @param ciphertextHex - hex-encoded ciphertext (without auth tag)
 * @param ivHex - hex-encoded 12-byte nonce
 * @param authTagHex - hex-encoded 16-byte GCM authentication tag
 * @param keyHex - 64-char hex derived key
 * @returns Decrypted plaintext string
 */
export async function decrypt(
  ciphertextHex: string,
  ivHex: string,
  authTagHex: string,
  keyHex: string
): Promise<string> {
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('Key must be 64-char hex (32 bytes)');
  }

  const keyBytes = hexToBytes(keyHex);
  const ivBytes = hexToBytes(ivHex);
  const ciphertextBytes = hexToBytes(ciphertextHex);
  const authTagBytes = hexToBytes(authTagHex);

  // Reassemble: noble GCM expects ciphertext + authTag concatenated
  const sealed = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
  sealed.set(ciphertextBytes, 0);
  sealed.set(authTagBytes, ciphertextBytes.length);

  // Decrypt — throws if auth tag doesn't match (wrong key or tampered data)
  const aes = gcm(keyBytes, ivBytes);
  const plaintextBytes = aes.decrypt(sealed);

  return new TextDecoder().decode(plaintextBytes);
}
