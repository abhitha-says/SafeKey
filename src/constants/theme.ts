// ─── Design Tokens ───────────────────────────────────────────────────────────
// Single source of truth. Every component pulls from here — no hardcoded values.

export const colors = {
  // Backgrounds
  bg: '#0A0A0F',
  bgCard: '#13131A',
  bgCardElevated: '#1A1A24',
  bgGlass: 'rgba(255, 255, 255, 0.04)',
  bgGlassStrong: 'rgba(255, 255, 255, 0.08)',

  // Primary brand — deep purple
  primary: '#6C63FF',
  primaryLight: '#9C94FF',
  primaryDark: '#4A43CC',
  primaryAlpha: 'rgba(108, 99, 255, 0.15)',
  primaryAlphaStrong: 'rgba(108, 99, 255, 0.25)',

  // Accent — pink for favorites, alerts
  accent: '#FF6B9D',
  accentAlpha: 'rgba(255, 107, 157, 0.15)',

  // Semantic
  success: '#4ECDC4',
  successAlpha: 'rgba(78, 205, 196, 0.15)',
  warning: '#FFE66D',
  warningAlpha: 'rgba(255, 230, 109, 0.15)',
  danger: '#FF4444',
  dangerAlpha: 'rgba(255, 68, 68, 0.15)',

  // Text
  textPrimary: '#F0EEFF',
  textSecondary: '#8B8BA7',
  textTertiary: '#555570',
  textInverse: '#0A0A0F',

  // Borders
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.15)',

  // Strength meter
  strengthVeryWeak: '#FF4444',
  strengthWeak: '#FF8C00',
  strengthFair: '#FFE66D',
  strengthStrong: '#4ECDC4',
  strengthVeryStrong: '#6C63FF',

  // Category colors
  categoryGeneral: '#6C63FF',
  categorySocial: '#FF6B9D',
  categoryBanking: '#4ECDC4',
  categoryEmail: '#FFE66D',
  categoryShopping: '#FF8C00',
  categoryWork: '#9C94FF',
  categoryOther: '#8B8BA7',
} as const;

export const gradients = {
  primary: ['#6C63FF', '#9C94FF'] as const,
  card: ['rgba(108, 99, 255, 0.1)', 'rgba(108, 99, 255, 0.02)'] as const,
  bg: ['#0A0A0F', '#0F0F1A'] as const,
  danger: ['#FF4444', '#CC2200'] as const,
  success: ['#4ECDC4', '#2AAA9F'] as const,
  accent: ['#FF6B9D', '#CC4477'] as const,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const borderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

export const typography = {
  // Font sizes
  xs: 11,
  sm: 13,
  base: 15,
  md: 17,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,

  // Font weights (React Native uses string literals)
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  black: '900' as const,

  // Line heights
  tight: 1.2,
  normal: 1.5,
  relaxed: 1.8,
} as const;

export const shadows = {
  sm: {
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  md: {
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 6,
  },
  lg: {
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 10,
  },
} as const;

export const animation = {
  fast: 150,
  normal: 250,
  slow: 400,
  spring: {
    damping: 20,
    stiffness: 300,
    mass: 0.8,
  },
} as const;

// Category metadata
export const CATEGORY_META = {
  general: { label: 'General', color: colors.categoryGeneral, icon: 'grid' },
  social: { label: 'Social', color: colors.categorySocial, icon: 'users' },
  banking: { label: 'Banking', color: colors.categoryBanking, icon: 'credit-card' },
  email: { label: 'Email', color: colors.categoryEmail, icon: 'mail' },
  shopping: { label: 'Shopping', color: colors.categoryShopping, icon: 'shopping-bag' },
  work: { label: 'Work', color: colors.categoryWork, icon: 'briefcase' },
  other: { label: 'Other', color: colors.categoryOther, icon: 'more-horizontal' },
} as const;
