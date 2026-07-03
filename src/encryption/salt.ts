import * as Crypto from 'expo-crypto';

/**
 * Generates a cryptographically secure 32-byte random salt.
 * Uses expo-crypto which wraps the platform's native CSPRNG (CommonCrypto on iOS,
 * OpenSSL on Android). Never uses Math.random().
 *
 * The salt is NOT secret — it can be stored in plaintext in Supabase.
 * Security comes entirely from the master password.
 *
 * @returns 64-character hex string (32 bytes)
 */
export async function generateSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(32);
  return bytesToHex(bytes);
}

/**
 * Generates a cryptographically secure 12-byte nonce for AES-GCM.
 * 96-bit IV is the NIST-recommended size for GCM.
 * Must be unique per encryption operation — never reuse with the same key.
 *
 * @returns 24-character hex string (12 bytes)
 */
export async function generateIV(): Promise<Uint8Array> {
  return Crypto.getRandomBytesAsync(12);
}

// ─── Hex Utilities ────────────────────────────────────────────────────────────

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('Invalid hex string: odd length');
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return result;
}
