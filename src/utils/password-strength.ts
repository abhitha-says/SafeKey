import { colors } from '@/constants/theme';

export type StrengthScore = 0 | 1 | 2 | 3 | 4;
export type StrengthLabel = 'Very Weak' | 'Weak' | 'Fair' | 'Strong' | 'Very Strong';

export interface PasswordStrength {
  score: StrengthScore;
  label: StrengthLabel;
  color: string;
  entropy: number; // bits of entropy
  suggestions: string[];
}

/**
 * Calculates real entropy bits for a password.
 * Uses character pool size × log2 — not a pattern-based heuristic.
 * Accounts for pool expansion as character sets are used.
 */
function calculateEntropy(password: string): number {
  if (!password || password.length === 0) return 0;

  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32; // printable special chars

  if (poolSize === 0) return 0;
  return password.length * Math.log2(poolSize);
}

/**
 * Computes password strength with entropy, label, color, and actionable suggestions.
 *
 * Entropy thresholds:
 *   < 28 bits  → Very Weak  (easily brute-forced)
 *   28–35 bits → Weak
 *   36–59 bits → Fair
 *   60–127 bits → Strong
 *   ≥ 128 bits → Very Strong (unbreakable for foreseeable future)
 */
export function getStrength(password: string): PasswordStrength {
  const entropy = calculateEntropy(password);
  const suggestions: string[] = [];

  // Collect actionable suggestions
  if (password.length < 12) {
    suggestions.push('Use at least 12 characters');
  }
  if (!/[A-Z]/.test(password)) {
    suggestions.push('Add uppercase letters');
  }
  if (!/[0-9]/.test(password)) {
    suggestions.push('Add numbers');
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    suggestions.push('Add symbols (!, @, #, ...)');
  }
  if (/(.)\1{2,}/.test(password)) {
    suggestions.push('Avoid repeated characters');
  }
  if (/^[a-zA-Z]+$/.test(password) && password.length < 16) {
    suggestions.push('Mix letters with numbers and symbols');
  }

  let score: StrengthScore;
  let label: StrengthLabel;
  let color: string;

  if (entropy < 28) {
    score = 0;
    label = 'Very Weak';
    color = colors.strengthVeryWeak;
  } else if (entropy < 36) {
    score = 1;
    label = 'Weak';
    color = colors.strengthWeak;
  } else if (entropy < 60) {
    score = 2;
    label = 'Fair';
    color = colors.strengthFair;
  } else if (entropy < 128) {
    score = 3;
    label = 'Strong';
    color = colors.strengthStrong;
  } else {
    score = 4;
    label = 'Very Strong';
    color = colors.strengthVeryStrong;
  }

  return { score, label, color, entropy: Math.round(entropy), suggestions };
}
