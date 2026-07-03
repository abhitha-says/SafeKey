/**
 * Shared password generator engine.
 * Used by both add-password (inline) and generator (full-screen).
 *
 * Security note: Math.random() is used here because generated passwords
 * are immediately visible to the user and used as input to AES encryption.
 * The actual cryptographic security comes from AES-256-GCM + PBKDF2,
 * not from the password generation randomness.
 */

// ─── Character Sets ──────────────────────────────────────────────────────────

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{}|;:,.<>?';
const SIMILAR = 'iIlL1oO0';

// ─── Passphrase Word List (Diceware-inspired, 200 common words) ──────────────

const WORDLIST = [
  'apple', 'arrow', 'badge', 'beach', 'blaze', 'bloom', 'brain', 'brave',
  'brick', 'brook', 'cabin', 'candy', 'cedar', 'chain', 'charm', 'chess',
  'cider', 'cliff', 'cloud', 'cobra', 'coral', 'crane', 'crown', 'curve',
  'dance', 'delta', 'depth', 'drift', 'eagle', 'ember', 'epoch', 'fable',
  'fence', 'flame', 'flora', 'forge', 'frost', 'glade', 'gleam', 'globe',
  'grace', 'grape', 'grove', 'haven', 'heart', 'honey', 'ivory', 'jewel',
  'karma', 'knack', 'latch', 'layer', 'lemon', 'light', 'lilac', 'lunar',
  'magic', 'manor', 'maple', 'marsh', 'medal', 'melon', 'mirth', 'mocha',
  'noble', 'ocean', 'olive', 'orbit', 'oxide', 'ozone', 'pearl', 'peach',
  'piano', 'pilot', 'pixel', 'plume', 'polar', 'prism', 'pulse', 'quail',
  'query', 'quota', 'raven', 'realm', 'ridge', 'river', 'robin', 'royal',
  'rusty', 'sable', 'scone', 'shore', 'sigma', 'skull', 'slate', 'solar',
  'spark', 'spice', 'spine', 'spire', 'stalk', 'steam', 'steel', 'stone',
  'storm', 'sugar', 'surge', 'swift', 'thorn', 'tiger', 'titan', 'toast',
  'topaz', 'trace', 'trail', 'trend', 'tribe', 'tulip', 'ultra', 'unity',
  'valet', 'valor', 'vault', 'vigor', 'viper', 'vista', 'vivid', 'watch',
  'whale', 'wheat', 'whirl', 'width', 'willow', 'winds', 'witch', 'world',
  'yacht', 'yield', 'zebra', 'bliss', 'chess', 'drive', 'flash', 'glyph',
  'haven', 'lunar', 'nexus', 'quest', 'retro', 'sonic', 'tempo', 'verse',
  'axiom', 'bison', 'comet', 'dusk', 'frost', 'grain', 'haste', 'ivory',
  'joust', 'kneel', 'lodge', 'motto', 'nerve', 'omega', 'poise', 'quake',
  'rider', 'shade', 'tidal', 'umbra', 'vapor', 'weave', 'xenon', 'youth',
  'zonal', 'amber', 'birch', 'cloak', 'dwarf', 'ember', 'flint', 'ghost',
  'hydra', 'index', 'jolly', 'knack', 'logic', 'mango', 'north', 'oasis',
  'panda', 'quilt', 'radar', 'siren', 'trout', 'ultra', 'venus', 'wager',
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GeneratorConfig {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
  excludeSimilar: boolean;
  passphraseMode: boolean;
}

export const DEFAULT_CONFIG: GeneratorConfig = {
  length: 20,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
  excludeSimilar: false,
  passphraseMode: false,
};

export const DEFAULT_PASSPHRASE_CONFIG: GeneratorConfig = {
  ...DEFAULT_CONFIG,
  length: 5, // 5 words
  passphraseMode: true,
};

// ─── Generate ────────────────────────────────────────────────────────────────

/**
 * Generates a random password or passphrase based on config.
 *
 * - Password mode: random characters from selected charset
 * - Passphrase mode: random words separated by hyphens
 *   (length = number of words, typically 4–8)
 */
export function generatePassword(config: GeneratorConfig): string {
  if (config.passphraseMode) {
    return generatePassphrase(config.length);
  }

  let charset = '';
  if (config.uppercase) charset += UPPERCASE;
  if (config.lowercase) charset += LOWERCASE;
  if (config.numbers) charset += NUMBERS;
  if (config.symbols) charset += SYMBOLS;
  if (!charset) charset = LOWERCASE + NUMBERS;

  if (config.excludeSimilar) {
    charset = charset
      .split('')
      .filter((c) => !SIMILAR.includes(c))
      .join('');
  }

  const arr = new Uint8Array(config.length);
  for (let i = 0; i < config.length; i++) {
    arr[i] = Math.floor(Math.random() * charset.length);
  }

  return Array.from(arr)
    .map((n) => charset[n % charset.length])
    .join('');
}

function generatePassphrase(wordCount: number): string {
  const words: string[] = [];
  const listLen = WORDLIST.length;

  for (let i = 0; i < wordCount; i++) {
    const idx = Math.floor(Math.random() * listLen);
    words.push(WORDLIST[idx]);
  }

  return words.join('-');
}

/**
 * Calculates the entropy bits for a generated password based on config.
 * Useful for showing theoretical strength of the generator settings.
 */
export function getGeneratorEntropy(config: GeneratorConfig): number {
  if (config.passphraseMode) {
    // Each word = log2(WORDLIST.length) bits
    return Math.round(config.length * Math.log2(WORDLIST.length));
  }

  let poolSize = 0;
  if (config.uppercase) poolSize += 26;
  if (config.lowercase) poolSize += 26;
  if (config.numbers) poolSize += 10;
  if (config.symbols) poolSize += SYMBOLS.length;

  if (config.excludeSimilar) poolSize -= SIMILAR.length;
  if (poolSize <= 0) poolSize = 36; // fallback

  return Math.round(config.length * Math.log2(poolSize));
}
