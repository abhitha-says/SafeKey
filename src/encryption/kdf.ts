import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from './salt';

/**
 * PBKDF2-SHA256 parameters — tuned for Hermes (React Native JS engine).
 *
 * 10,000 iterations completes in ~0.5-1s on Hermes.
 * Combined with 256-bit random salt + AES-256-GCM, this provides
 * strong protection for on-device vault encryption.
 *
 * Note: OWASP recommends 600k for server-side, but that takes
 * minutes in pure JS on Hermes. Increase when using native crypto.
 */
export const KDF_PARAMS = {
  c: 10_000,   // iterations — Hermes-safe (pure JS)
  dkLen: 32,   // derived key length in bytes (256-bit)
} as const;

/**
 * Reduced params for unit tests ONLY.
 * DO NOT use in production — these are cryptographically weak.
 */
export const KDF_PARAMS_TEST = {
  c: 1000,
  dkLen: 32,
} as const;

/**
 * Derives a 32-byte (256-bit) encryption key from the user's master password and salt.
 *
 * Uses PBKDF2 with SHA-256 and 600k iterations.
 * Runs in ~0.5-1 second on mobile hardware.
 *
 * The derived key:
 *   - Is 32 bytes (256 bits) — exactly what AES-256 needs
 *   - Is deterministic: same password + same salt = same key every time
 *   - Is NEVER stored anywhere — only held in memory (Zustand session store)
 *   - Cannot be reversed to recover the master password
 *
 * @param masterPassword - The user's plaintext master password
 * @param saltHex - 64-char hex string (32 bytes) from public.users.salt
 * @returns 64-char hex string representing the 32-byte AES-256 key
 */
export async function deriveKey(
  masterPassword: string,
  saltHex: string,
  params: typeof KDF_PARAMS | typeof KDF_PARAMS_TEST = KDF_PARAMS
): Promise<string> {
  if (!masterPassword || masterPassword.length === 0) {
    throw new Error('Master password cannot be empty');
  }
  if (!saltHex || saltHex.length !== 64) {
    throw new Error('Salt must be a 64-character hex string (32 bytes)');
  }

  const passwordBytes = new TextEncoder().encode(masterPassword);
  const saltBytes = hexToBytes(saltHex);

  // Use setTimeout to yield to the UI thread before heavy computation
  return new Promise<string>((resolve, reject) => {
    setTimeout(() => {
      try {
        const keyBytes = pbkdf2(sha256, passwordBytes, saltBytes, {
          c: params.c,
          dkLen: params.dkLen,
        });
        resolve(bytesToHex(keyBytes));
      } catch (err) {
        reject(new Error(`Key derivation failed: ${err instanceof Error ? err.message : String(err)}`));
      }
    }, 50); // 50ms delay lets the UI render the loading state
  });
}

/**
 * Verifies a master password attempt without storing the result.
 */
export async function derivationTest(
  masterPassword: string,
  saltHex: string
): Promise<string> {
  return deriveKey(masterPassword, saltHex);
}
