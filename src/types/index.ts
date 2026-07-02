// ─── Vault Item ─────────────────────────────────────────────────────────────

export interface VaultItem {
  id: string;
  user_id: string;
  website: string | null;
  username: string | null;
  encrypted_password: string;
  iv: string;
  auth_tag: string;
  notes_encrypted: string | null;
  notes_iv: string | null;
  notes_auth_tag: string | null;
  category: VaultCategory;
  favorite: boolean;
  created_at: string;
  updated_at: string;
}

export type VaultCategory =
  | 'general'
  | 'social'
  | 'banking'
  | 'email'
  | 'shopping'
  | 'work'
  | 'other';

// Decrypted form — only exists in memory, never persisted
export interface DecryptedVaultItem extends Omit<VaultItem, 'encrypted_password' | 'iv' | 'auth_tag' | 'notes_encrypted' | 'notes_iv' | 'notes_auth_tag'> {
  password: string;
  notes: string | null;
}

// ─── Form Types ──────────────────────────────────────────────────────────────

export interface AddVaultItemForm {
  website: string;
  username: string;
  password: string;
  notes?: string;
  category: VaultCategory;
  favorite: boolean;
}

// ─── User ────────────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  salt: string;
  created_at: string;
}

// ─── Encryption ──────────────────────────────────────────────────────────────

export interface EncryptedData {
  ciphertext: string; // hex
  iv: string;         // hex, 12 bytes
  authTag: string;    // hex, 16 bytes
}

// ─── Password Generator ──────────────────────────────────────────────────────

export interface GeneratorConfig {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeSimilar: boolean;
  passphraseMode: boolean;
}

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Very Weak' | 'Weak' | 'Fair' | 'Strong' | 'Very Strong';
  color: string;
  entropy: number; // bits
}

// ─── Security Center ─────────────────────────────────────────────────────────

export interface SecurityReport {
  score: number; // 0-100
  weakPasswords: DecryptedVaultItem[];
  duplicateGroups: DecryptedVaultItem[][];
  oldPasswords: DecryptedVaultItem[];
}
