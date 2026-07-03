/**
 * High-level vault encryption API.
 *
 * This is the ONLY layer that the rest of the app imports.
 * All crypto details (AES, IV generation, encoding) stay inside this module.
 *
 * Usage:
 *   const encrypted = await encryptVaultEntry('MyPassword123', derivedKeyHex);
 *   // store encrypted.ciphertext, encrypted.iv, encrypted.authTag in Supabase
 *
 *   const plaintext = await decryptVaultEntry(
 *     item.encrypted_password,
 *     item.iv,
 *     item.auth_tag,
 *     derivedKeyHex
 *   );
 */

import { encrypt, decrypt } from './aes';
import type { EncryptedData } from '@/types';

// ─── Encrypt ─────────────────────────────────────────────────────────────────

/**
 * Encrypts a single vault field (password or notes) with AES-256-GCM.
 * Generates a fresh IV for each call — safe to call multiple times per entry.
 */
export async function encryptVaultEntry(
  plaintext: string,
  keyHex: string
): Promise<EncryptedData> {
  return encrypt(plaintext, keyHex);
}

// ─── Decrypt ─────────────────────────────────────────────────────────────────

/**
 * Decrypts a vault entry. Throws if auth tag fails (wrong key or tampering).
 * The caller must gate this behind biometric authentication.
 */
export async function decryptVaultEntry(
  ciphertextHex: string,
  ivHex: string,
  authTagHex: string,
  keyHex: string
): Promise<string> {
  return decrypt(ciphertextHex, ivHex, authTagHex, keyHex);
}

// ─── Bulk Decrypt (Security Center) ──────────────────────────────────────────

/**
 * Decrypts multiple vault entries for security analysis (weak password detection,
 * duplicate detection, etc.). Plaintext is returned in memory for analysis
 * and must NOT be stored in state after analysis completes.
 *
 * @param items - Array of encrypted vault items from Supabase
 * @param keyHex - The current session's derived key
 * @returns Array of { id, password } pairs. Discard after use.
 */
export async function bulkDecryptPasswords(
  items: Array<{
    id: string;
    encrypted_password: string;
    iv: string;
    auth_tag: string;
  }>,
  keyHex: string
): Promise<Array<{ id: string; password: string }>> {
  const results = await Promise.allSettled(
    items.map(async (item) => ({
      id: item.id,
      password: await decrypt(item.encrypted_password, item.iv, item.auth_tag, keyHex),
    }))
  );

  return results
    .filter((r): r is PromiseFulfilledResult<{ id: string; password: string }> =>
      r.status === 'fulfilled'
    )
    .map((r) => r.value);
}

// ─── Re-encrypt (Master Password Change) ─────────────────────────────────────

/**
 * Re-encrypts a single vault entry with a new key.
 * Used during master password change: decrypt with old key, re-encrypt with new key.
 * Each re-encryption generates a fresh IV.
 */
export async function reEncryptVaultEntry(
  ciphertextHex: string,
  ivHex: string,
  authTagHex: string,
  oldKeyHex: string,
  newKeyHex: string
): Promise<EncryptedData> {
  const plaintext = await decrypt(ciphertextHex, ivHex, authTagHex, oldKeyHex);
  return encrypt(plaintext, newKeyHex);
}
