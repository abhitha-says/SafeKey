import { Platform } from 'react-native';

/**
 * Cross-platform secure storage wrapper.
 * - Native (iOS/Android): uses expo-secure-store (encrypted keychain)
 * - Web: uses localStorage (not encrypted, but functional for dev/testing)
 *
 * This exists because expo-secure-store crashes on web.
 */

let SecureStoreModule: typeof import('expo-secure-store') | null = null;

async function getSecureStore() {
  if (Platform.OS === 'web') return null;
  if (!SecureStoreModule) {
    SecureStoreModule = await import('expo-secure-store');
  }
  return SecureStoreModule;
}

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return typeof window !== 'undefined' ? localStorage.getItem(key) : null;
  }
  const store = await getSecureStore();
  return store?.getItemAsync(key) ?? null;
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') localStorage.setItem(key, value);
    return;
  }
  const store = await getSecureStore();
  await store?.setItemAsync(key, value);
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') localStorage.removeItem(key);
    return;
  }
  const store = await getSecureStore();
  await store?.deleteItemAsync(key);
}
