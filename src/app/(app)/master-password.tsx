import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as SecureStorage from '@/utils/secure-storage';
import { useAuth } from '@/hooks/useAuth';
import { useBiometric } from '@/hooks/useBiometric';
import { useSessionStore } from '@/store/session.store';
import { deriveKey } from '@/encryption/kdf';
import { getUserProfile } from '@/services/auth.service';
import { getStrength } from '@/utils/password-strength';
import { colors, typography, spacing, borderRadius, animation } from '@/constants/theme';
import type { PasswordStrength } from '@/utils/password-strength';

// ─── Lock Icon (inline SVG-equivalent via View drawing) ──────────────────────

function ShieldIcon({ size = 48 }: { size?: number }) {
  return (
    <View style={[styles.shieldOuter, { width: size, height: size }]}>
      <View style={styles.shieldInner}>
        <View style={styles.lockBody} />
        <View style={styles.lockShackle} />
      </View>
    </View>
  );
}

// ─── Strength Bar ─────────────────────────────────────────────────────────────

function StrengthBar({ strength }: { strength: PasswordStrength | null }) {
  if (!strength || strength.entropy === 0) return null;

  const fillPercent = Math.min((strength.score / 4) * 100, 100);

  return (
    <View style={styles.strengthContainer}>
      <View style={styles.strengthBarBg}>
        <View
          style={[
            styles.strengthBarFill,
            { width: `${fillPercent}%`, backgroundColor: strength.color },
          ]}
        />
      </View>
      <View style={styles.strengthLabelRow}>
        <Text style={[styles.strengthLabel, { color: strength.color }]}>{strength.label}</Text>
        <Text style={styles.entropyLabel}>{strength.entropy} bits</Text>
      </View>
      {strength.suggestions.length > 0 && (
        <Text style={styles.strengthSuggestion}>{strength.suggestions[0]}</Text>
      )}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

type ScreenMode = 'loading' | 'setup' | 'unlock';

export default function MasterPasswordScreen() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const { setKey } = useSessionStore();
  const { unlockWithBiometric, enrollBiometric, hasBiometricKey, checkBiometricCapability, isAuthenticating } =
    useBiometric();

  const [mode, setMode] = useState<ScreenMode>('loading');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const [isConfirmVisible, setIsConfirmVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canUseBiometric, setCanUseBiometric] = useState(false);
  const [hasBiometric, setHasBiometric] = useState(false);
  const [strength, setStrength] = useState<PasswordStrength | null>(null);

  // Shake animation for error
  const shakeAnim = useRef(new Animated.Value(0)).current;
  // Pulse animation for lock icon
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Ambient pulse on lock icon
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 2000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // Determine mode: is this first-time setup or unlock?
  useEffect(() => {
    // Wait for the auth session to load from AsyncStorage before making routing decisions.
    // Without this guard, user is null on first render and we immediately redirect to login.
    if (isAuthLoading) return;

    async function init() {
      if (!user?.id) {
        router.replace('/(auth)/login');
        return;
      }

      // Check biometric availability
      const capability = await checkBiometricCapability();
      const bioAvailable = capability.isAvailable && capability.isBiometricEnrolled;
      setCanUseBiometric(bioAvailable);

      // Does user already have a salt stored? (means they've been through setup before)
      const profile = await getUserProfile(user.id);

      if (!profile?.salt) {
        // First time — no profile exists (shouldn't happen — signUp creates it)
        // This is a data integrity issue — sign them out
        setError('Account data incomplete. Please sign out and re-register.');
        setMode('unlock'); // show screen with error
        return;
      }

      // Check if they have a biometric key enrolled
      const bioKey = await hasBiometricKey();
      setHasBiometric(bioKey && bioAvailable);

      // Determine mode: do they have a master password set?
      // We detect "setup" mode vs "unlock" mode by checking session store
      // After sign-up, vault is locked and derivedKey is null — we need to know
      // if this is the very first time (no vault items, fresh account) or returning user.
      // The salt always exists post-signup, so we check via a flag in SecureStore.
      const masterPasswordSet = await SecureStorage.getItem('safekey_master_password_set');

      if (!masterPasswordSet) {
        setMode('setup');
      } else {
        setMode('unlock');
      }
    }

    init();
  }, [isAuthLoading, user?.id, checkBiometricCapability, hasBiometricKey]);

  const triggerShake = useCallback(() => {
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, [shakeAnim]);

  const handlePasswordChange = useCallback(
    (text: string) => {
      setPassword(text);
      setError(null);
      if (mode === 'setup' && text.length > 0) {
        setStrength(getStrength(text));
      } else {
        setStrength(null);
      }
    },
    [mode]
  );

  const handleSetup = useCallback(async () => {
    if (!user?.id) return;

    // Validation
    if (password.length < 8) {
      setError('Master password must be at least 8 characters.');
      triggerShake();
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      triggerShake();
      return;
    }

    const passwordStrength = getStrength(password);
    if (passwordStrength.score < 1) {
      setError('Password is too weak. Add uppercase, numbers, or symbols.');
      triggerShake();
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Fetch salt (always exists post sign-up)
      console.log('[MasterPassword] Fetching profile for user:', user.id);
      const profile = await getUserProfile(user.id);
      console.log('[MasterPassword] Profile:', profile ? 'found' : 'NULL', 'salt:', profile?.salt ? 'exists' : 'MISSING');

      if (!profile?.salt) {
        setError('Account data missing. Please sign out and re-register.');
        triggerShake();
        return;
      }

      // Derive the key — intentionally slow (~0.5-1s on mobile with 16MB)
      console.log('[MasterPassword] Starting key derivation...');
      const derivedKeyHex = await deriveKey(password, profile.salt);
      console.log('[MasterPassword] Key derived successfully, length:', derivedKeyHex.length);

      // Store key in memory
      setKey(derivedKeyHex);

      // Mark master password as set
      await SecureStorage.setItem('safekey_master_password_set', '1');
      console.log('[MasterPassword] SecureStorage flag set');

      // Offer biometric enrollment if available
      if (canUseBiometric) {
        await enrollBiometric(derivedKeyHex);
        setHasBiometric(true);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('[MasterPassword] Navigating to home...');
      router.replace('/(app)/home');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[MasterPassword] Setup error:', msg);
      setError(msg || 'Setup failed. Please try again.');
      triggerShake();
    } finally {
      setIsProcessing(false);
    }
  }, [user?.id, password, confirmPassword, setKey, canUseBiometric, enrollBiometric, triggerShake]);

  const handleUnlock = useCallback(async () => {
    if (!user?.id) return;

    if (!password) {
      setError('Enter your master password.');
      triggerShake();
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const profile = await getUserProfile(user.id);
      if (!profile?.salt) {
        setError('Account data missing. Please sign out and log back in.');
        triggerShake();
        return;
      }

      const derivedKeyHex = await deriveKey(password, profile.salt);
      setKey(derivedKeyHex);

      // Re-enroll biometric if not enrolled yet
      if (canUseBiometric && !hasBiometric) {
        await enrollBiometric(derivedKeyHex);
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(app)/home');
    } catch (err) {
      setError('Incorrect master password.');
      triggerShake();
    } finally {
      setIsProcessing(false);
    }
  }, [user?.id, password, setKey, canUseBiometric, hasBiometric, enrollBiometric, triggerShake]);

  const handleBiometricUnlock = useCallback(async () => {
    setError(null);
    const result = await unlockWithBiometric();
    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/(app)/home');
    } else {
      if (result.error && !result.error.includes('cancelled')) {
        setError(result.error);
        triggerShake();
      }
    }
  }, [unlockWithBiometric, triggerShake]);

  const isSetupMode = mode === 'setup';
  const isUnlockMode = mode === 'unlock';
  const busy = isProcessing || isAuthenticating;

  if (mode === 'loading') {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* ─── Header ─────────────────────────────────────────────────── */}
        <View style={styles.header}>
          <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
            <View style={styles.iconGlow}>
              <View style={styles.iconContainer}>
                <Text style={styles.lockEmoji}>🔐</Text>
              </View>
            </View>
          </Animated.View>

          <Text style={styles.title}>
            {isSetupMode ? 'Create Master Password' : 'Vault Locked'}
          </Text>
          <Text style={styles.subtitle}>
            {isSetupMode
              ? 'This password encrypts your vault. It is never sent to our servers.'
              : 'Enter your master password to unlock your vault.'}
          </Text>
        </View>

        {/* ─── Zero-knowledge badge ────────────────────────────────────── */}
        <View style={styles.zkBadge}>
          <View style={styles.zkDot} />
          <Text style={styles.zkText}>Zero-knowledge · Client-side encryption · Your key, your data</Text>
        </View>

        {/* ─── Form ────────────────────────────────────────────────────── */}
        <Animated.View
          style={[styles.formCard, { transform: [{ translateX: shakeAnim }] }]}
        >
          {/* Master Password field */}
          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>
              {isSetupMode ? 'Master Password' : 'Master Password'}
            </Text>
            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={handlePasswordChange}
                secureTextEntry={!isPasswordVisible}
                placeholder="Enter your master password"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType={isSetupMode ? 'next' : 'done'}
                onSubmitEditing={isSetupMode ? undefined : handleUnlock}
                editable={!busy}
              />
              <Pressable
                onPress={() => {
                  setIsPasswordVisible((v) => !v);
                  Haptics.selectionAsync();
                }}
                style={styles.eyeButton}
                accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
              >
                <Text style={styles.eyeIcon}>{isPasswordVisible ? '👁' : '👁‍🗨'}</Text>
              </Pressable>
            </View>
          </View>

          {/* Strength bar — setup mode only */}
          {isSetupMode && <StrengthBar strength={strength} />}

          {/* Confirm password — setup mode only */}
          {isSetupMode && (
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Confirm Master Password</Text>
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={confirmPassword}
                  onChangeText={(t) => {
                    setConfirmPassword(t);
                    setError(null);
                  }}
                  secureTextEntry={!isConfirmVisible}
                  placeholder="Re-enter your master password"
                  placeholderTextColor={colors.textTertiary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="done"
                  onSubmitEditing={handleSetup}
                  editable={!busy}
                />
                <Pressable
                  onPress={() => {
                    setIsConfirmVisible((v) => !v);
                    Haptics.selectionAsync();
                  }}
                  style={styles.eyeButton}
                >
                  <Text style={styles.eyeIcon}>{isConfirmVisible ? '👁' : '👁‍🗨'}</Text>
                </Pressable>
              </View>

              {/* Match indicator */}
              {confirmPassword.length > 0 && (
                <Text
                  style={[
                    styles.matchIndicator,
                    {
                      color:
                        confirmPassword === password ? colors.success : colors.danger,
                    },
                  ]}
                >
                  {confirmPassword === password ? '✓ Passwords match' : '✗ Passwords do not match'}
                </Text>
              )}
            </View>
          )}

          {/* Error */}
          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* CTA */}
          <TouchableOpacity
            style={[styles.ctaButton, busy && styles.ctaDisabled]}
            onPress={isSetupMode ? handleSetup : handleUnlock}
            disabled={busy}
            activeOpacity={0.85}
          >
            {busy ? (
              <View style={styles.ctaLoadingRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.ctaLoadingText}>
                  {isProcessing ? 'Deriving key…' : 'Authenticating…'}
                </Text>
              </View>
            ) : (
              <Text style={styles.ctaText}>
                {isSetupMode ? 'Create Vault' : 'Unlock Vault'}
              </Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* ─── Biometric option (unlock mode only) ─────────────────────── */}
        {isUnlockMode && hasBiometric && !busy && (
          <TouchableOpacity
            style={styles.biometricButton}
            onPress={handleBiometricUnlock}
            activeOpacity={0.8}
          >
            <Text style={styles.biometricIcon}>
              {Platform.OS === 'ios' ? '⬢' : '⬡'}
            </Text>
            <Text style={styles.biometricText}>Use Biometric Unlock</Text>
          </TouchableOpacity>
        )}

        {/* ─── Setup warning ───────────────────────────────────────────── */}
        {isSetupMode && (
          <View style={styles.warningBox}>
            <Text style={styles.warningTitle}>⚠️ Remember this password</Text>
            <Text style={styles.warningBody}>
              Your master password is never stored or sent to SafeKey's servers. If you forget
              it, your vault data cannot be recovered. There is no reset.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxxl,
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  iconGlow: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 24,
    elevation: 10,
    marginBottom: spacing.lg,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primaryAlpha,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  lockEmoji: {
    fontSize: 36,
  },
  title: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.sm * typography.normal,
    maxWidth: 280,
  },

  // ZK badge
  zkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successAlpha,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
    alignSelf: 'center',
  },
  zkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
    marginRight: spacing.xs,
  },
  zkText: {
    fontSize: typography.xs,
    color: colors.success,
    fontWeight: typography.medium,
  },

  // Form card
  formCard: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },

  // Field
  fieldGroup: {
    marginBottom: spacing.md,
  },
  fieldLabel: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    fontWeight: typography.medium,
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgGlass,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.base,
    color: colors.textPrimary,
    letterSpacing: 0.3,
  },
  eyeButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  eyeIcon: {
    fontSize: 18,
  },

  // Strength bar
  strengthContainer: {
    marginBottom: spacing.md,
  },
  strengthBarBg: {
    height: 4,
    backgroundColor: colors.bgGlassStrong,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  strengthBarFill: {
    height: '100%',
    borderRadius: 2,
  },
  strengthLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  strengthLabel: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
  },
  entropyLabel: {
    fontSize: typography.xs,
    color: colors.textTertiary,
  },
  strengthSuggestion: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    marginTop: 2,
  },

  // Match indicator
  matchIndicator: {
    fontSize: typography.xs,
    fontWeight: typography.medium,
    marginTop: spacing.xs,
  },

  // Error
  errorContainer: {
    backgroundColor: colors.dangerAlpha,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.danger + '30',
  },
  errorText: {
    fontSize: typography.sm,
    color: colors.danger,
    textAlign: 'center',
  },

  // CTA
  ctaButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  ctaDisabled: {
    opacity: 0.7,
  },
  ctaText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  ctaLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  ctaLoadingText: {
    fontSize: typography.sm,
    color: '#FFFFFF',
  },

  // Biometric
  biometricButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  biometricIcon: {
    fontSize: 22,
    color: colors.primary,
  },
  biometricText: {
    fontSize: typography.base,
    color: colors.primary,
    fontWeight: typography.medium,
  },

  // Warning box
  warningBox: {
    backgroundColor: colors.warningAlpha,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.warning + '30',
  },
  warningTitle: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.warning,
    marginBottom: spacing.xs,
  },
  warningBody: {
    fontSize: typography.xs,
    color: colors.textSecondary,
    lineHeight: typography.xs * typography.relaxed,
  },

  // Shield icon pieces (unused — replaced by emoji, kept for reference)
  shieldOuter: { alignItems: 'center', justifyContent: 'center' },
  shieldInner: { alignItems: 'center' },
  lockBody: {
    width: 18,
    height: 12,
    backgroundColor: colors.primary,
    borderRadius: 3,
    marginTop: 4,
  },
  lockShackle: {
    width: 10,
    height: 8,
    borderWidth: 2.5,
    borderColor: colors.primary,
    borderBottomWidth: 0,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    marginBottom: -2,
  },
});
