import { useState, useCallback } from 'react';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStorage from '@/utils/secure-storage';
import { useSessionStore } from '@/store/session.store';

const BIOMETRIC_KEY_STORAGE_KEY = 'safekey_biometric_key';

export interface BiometricCapability {
  isAvailable: boolean;
  isBiometricEnrolled: boolean;
  supportedTypes: LocalAuthentication.AuthenticationType[];
}

export interface BiometricHook {
  /** Check hardware and enrollment status */
  checkBiometricCapability: () => Promise<BiometricCapability>;
  /** On first master password unlock: store the derived key behind biometric gate */
  enrollBiometric: (derivedKeyHex: string) => Promise<{ success: boolean; error?: string }>;
  /** On subsequent unlocks: retrieve and set key via biometric prompt */
  unlockWithBiometric: () => Promise<{ success: boolean; error?: string }>;
  /** Remove the stored key (on logout / master password change) */
  clearBiometricKey: () => Promise<void>;
  /** Is a biometric key currently enrolled? */
  hasBiometricKey: () => Promise<boolean>;
  isAuthenticating: boolean;
}

/**
 * Biometric unlock hook for SafeKey.
 *
 * Security model:
 *   - The derived key is stored in expo-secure-store (Keychain/Keystore — hardware-backed on supported devices)
 *   - Access is gated behind LocalAuthentication.authenticateAsync()
 *   - We DO NOT store the key in plain AsyncStorage — ever.
 *   - On Android: protected by the Android Keystore (TEE/StrongBox)
 *   - On iOS: protected by the Secure Enclave (Keychain with kSecAccessControlBiometryAny)
 *
 * Flow:
 *   First unlock  → user enters master password → deriveKey() → enrollBiometric(key)
 *   Subsequent    → unlockWithBiometric() → biometric prompt → retrieve key → setKey()
 */
export function useBiometric(): BiometricHook {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const setKey = useSessionStore((s) => s.setKey);

  const checkBiometricCapability = useCallback(async (): Promise<BiometricCapability> => {
    const isAvailable = await LocalAuthentication.hasHardwareAsync();
    const isBiometricEnrolled = await LocalAuthentication.isEnrolledAsync();
    const supportedTypes = await LocalAuthentication.supportedAuthenticationTypesAsync();
    return { isAvailable, isBiometricEnrolled, supportedTypes };
  }, []);

  const enrollBiometric = useCallback(
    async (derivedKeyHex: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const { isAvailable, isBiometricEnrolled } = await checkBiometricCapability();

        if (!isAvailable || !isBiometricEnrolled) {
          return { success: false, error: 'Biometrics not available or not enrolled on this device.' };
        }

        // Prompt biometric before storing — user must confirm enrollment intentionally
        setIsAuthenticating(true);
        const authResult = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Enable biometric unlock for SafeKey',
          disableDeviceFallback: false,
          cancelLabel: 'Skip',
        });
        setIsAuthenticating(false);

        if (!authResult.success) {
          return { success: false, error: 'Biometric authentication cancelled.' };
        }

        // Store in SecureStorage — hardware-backed on supported devices
        await SecureStorage.setItem(BIOMETRIC_KEY_STORAGE_KEY, derivedKeyHex);

        return { success: true };
      } catch (err) {
        setIsAuthenticating(false);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Failed to enroll biometric.',
        };
      }
    },
    [checkBiometricCapability]
  );

  const unlockWithBiometric = useCallback(
    async (): Promise<{ success: boolean; error?: string }> => {
      try {
        const { isAvailable, isBiometricEnrolled } = await checkBiometricCapability();
        if (!isAvailable || !isBiometricEnrolled) {
          return { success: false, error: 'Biometrics not available.' };
        }

        setIsAuthenticating(true);
        const authResult = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock SafeKey',
          disableDeviceFallback: false,
          cancelLabel: 'Use master password',
        });
        setIsAuthenticating(false);

        if (!authResult.success) {
          return { success: false, error: 'Biometric authentication cancelled or failed.' };
        }

        const storedKey = await SecureStorage.getItem(BIOMETRIC_KEY_STORAGE_KEY);
        if (!storedKey) {
          return { success: false, error: 'No biometric key found. Please enter your master password.' };
        }

        // Load the derived key into memory
        setKey(storedKey);
        return { success: true };
      } catch (err) {
        setIsAuthenticating(false);
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Biometric unlock failed.',
        };
      }
    },
    [checkBiometricCapability, setKey]
  );

  const clearBiometricKey = useCallback(async (): Promise<void> => {
    try {
      await SecureStorage.deleteItem(BIOMETRIC_KEY_STORAGE_KEY);
    } catch {
      // Key may not exist — not an error
    }
  }, []);

  const hasBiometricKey = useCallback(async (): Promise<boolean> => {
    try {
      const key = await SecureStorage.getItem(BIOMETRIC_KEY_STORAGE_KEY);
      return !!key;
    } catch {
      return false;
    }
  }, []);

  return {
    checkBiometricCapability,
    enrollBiometric,
    unlockWithBiometric,
    clearBiometricKey,
    hasBiometricKey,
    isAuthenticating,
  };
}
