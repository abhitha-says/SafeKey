import { create } from 'zustand';

/**
 * Session store — holds the derived encryption key in MEMORY ONLY.
 * This key is NEVER written to disk, AsyncStorage, or SecureStore in plaintext.
 * Cleared on app background / logout / lock.
 */
interface SessionStore {
  /** 32-byte hex-encoded AES key derived from master password + salt via Argon2id */
  derivedKey: string | null;
  isLocked: boolean;

  setKey: (key: string) => void;
  clearKey: () => void;
  lock: () => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  derivedKey: null,
  isLocked: true,

  setKey: (key: string) => set({ derivedKey: key, isLocked: false }),

  clearKey: () => set({ derivedKey: null, isLocked: true }),

  lock: () => set({ derivedKey: null, isLocked: true }),
}));
