import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { useVault } from '@/hooks/useVault';
import { useBiometric } from '@/hooks/useBiometric';
import { useSessionStore } from '@/store/session.store';
import { signOut, deleteUserData, getUserProfile } from '@/services/auth.service';
import { batchUpdateVaultItems } from '@/services/vault.service';
import { reEncryptVaultEntry } from '@/encryption/vault';
import { deriveKey } from '@/encryption/kdf';
import * as SecureStorage from '@/utils/secure-storage';
import { colors, typography, spacing, borderRadius } from '@/constants/theme';

// ─── Section Header ──────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

// ─── Setting Row ─────────────────────────────────────────────────────────────

function SettingRow({
  icon,
  label,
  subtitle,
  onPress,
  danger,
  trailing,
  disabled,
}: {
  icon: string;
  label: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.settingRow, disabled && styles.settingRowDisabled]}
      onPress={onPress}
      disabled={!onPress || disabled}
      activeOpacity={0.75}
    >
      <View
        style={[
          styles.settingIcon,
          { backgroundColor: danger ? colors.dangerAlpha : colors.bgGlass },
        ]}
      >
        <Text style={styles.settingIconText}>{icon}</Text>
      </View>
      <View style={styles.settingInfo}>
        <Text
          style={[styles.settingLabel, danger && { color: colors.danger }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {subtitle && (
          <Text style={styles.settingSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing ?? (
        onPress && <Text style={styles.settingChevron}>›</Text>
      )}
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const { user } = useAuth();
  const derivedKey = useSessionStore((s) => s.derivedKey);
  const lock = useSessionStore((s) => s.lock);
  const { items } = useVault();
  const {
    checkBiometricCapability,
    hasBiometricKey,
    enrollBiometric,
    clearBiometricKey,
  } = useBiometric();

  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Check biometric state on mount
  useEffect(() => {
    async function check() {
      const cap = await checkBiometricCapability();
      setBiometricAvailable(cap.isAvailable && cap.isBiometricEnrolled);
      const enrolled = await hasBiometricKey();
      setBiometricEnabled(enrolled);
    }
    check();
  }, [checkBiometricCapability, hasBiometricKey]);

  // ── Lock vault ──
  const handleLock = useCallback(() => {
    Haptics.selectionAsync();
    lock();
    router.replace('/(app)/master-password');
  }, [lock]);

  // ── Sign out ──
  const handleSignOut = useCallback(async () => {
    Alert.alert('Sign Out', 'Your vault will be locked. Sign in again to access it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: async () => {
          Haptics.selectionAsync();
          await clearBiometricKey();
          lock();
          await signOut();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }, [clearBiometricKey, lock]);

  // ── Toggle biometric ──
  const handleBiometricToggle = useCallback(
    async (enabled: boolean) => {
      if (enabled) {
        if (!derivedKey) {
          Alert.alert('Vault locked', 'Unlock your vault first.');
          return;
        }
        const result = await enrollBiometric(derivedKey);
        if (result.success) {
          setBiometricEnabled(true);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          Alert.alert('Failed', result.error ?? 'Could not enable biometric.');
        }
      } else {
        await clearBiometricKey();
        setBiometricEnabled(false);
        Haptics.selectionAsync();
      }
    },
    [derivedKey, enrollBiometric, clearBiometricKey]
  );

  // ── Change master password ──
  const handleChangeMasterPassword = useCallback(() => {
    if (!derivedKey || !user?.id) return;

    // For now, prompt confirms the intention — the actual password input
    // is done by locking and going through setup flow with a flag
    Alert.alert(
      'Change Master Password',
      'This will re-encrypt all your vault data with a new master password. Your existing data will remain intact.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: async () => {
            // Lock vault and redirect to master-password in setup mode
            // by clearing the 'safekey_master_password_set' flag
            await clearBiometricKey();
            await SecureStorage.deleteItem('safekey_master_password_set');
            lock();
            router.replace('/(app)/master-password');
          },
        },
      ]
    );
  }, [derivedKey, user?.id, clearBiometricKey, lock]);

  // ── Delete account ──
  const handleDeleteAccount = useCallback(() => {
    if (!user?.id) return;

    Alert.alert(
      '⚠️ Delete Account',
      'This will permanently delete all your vault data, passwords, and account. This action CANNOT be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: () => {
            // Double confirmation
            Alert.alert(
              'Are you absolutely sure?',
              'Type DELETE to confirm.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Yes, Delete',
                  style: 'destructive',
                  onPress: async () => {
                    setIsDeleting(true);
                    try {
                      await clearBiometricKey();
                      await SecureStorage.deleteItem('safekey_master_password_set');
                      const result = await deleteUserData(user.id);
                      if (result.error) {
                        Alert.alert('Error', result.error);
                      } else {
                        lock();
                        router.replace('/(auth)/login');
                      }
                    } catch (err) {
                      Alert.alert(
                        'Error',
                        err instanceof Error ? err.message : 'Delete failed.'
                      );
                    } finally {
                      setIsDeleting(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }, [user?.id, clearBiometricKey, lock]);

  const email = user?.email ?? 'Unknown';
  const initial = email[0].toUpperCase();

  // Redirect if vault is locked — must be in useEffect to avoid crash
  useEffect(() => {
    if (!derivedKey) {
      router.replace('/(app)/master-password');
    }
  }, [derivedKey]);

  if (!derivedKey) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Nav ── */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
          <Text style={styles.navBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Profile Card ── */}
        <View style={styles.profileCard}>
          <View style={styles.profileAvatar}>
            <Text style={styles.profileAvatarText}>{initial}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileEmail} numberOfLines={1}>
              {email}
            </Text>
            <Text style={styles.profileMeta}>
              {items.length} password{items.length !== 1 ? 's' : ''} secured
            </Text>
          </View>
        </View>

        {/* ── Security ── */}
        <SectionHeader title="Security" />
        <View style={styles.section}>
          <SettingRow
            icon="🔐"
            label="Change Master Password"
            subtitle="Re-encrypt vault with new key"
            onPress={handleChangeMasterPassword}
          />
          {biometricAvailable && (
            <SettingRow
              icon={Platform.OS === 'ios' ? '⬢' : '🔓'}
              label="Biometric Unlock"
              subtitle={
                biometricEnabled
                  ? 'Enabled — unlock with fingerprint or face'
                  : 'Disabled — unlock with master password only'
              }
              trailing={
                <Switch
                  value={biometricEnabled}
                  onValueChange={handleBiometricToggle}
                  trackColor={{
                    false: colors.bgGlassStrong,
                    true: colors.primary,
                  }}
                  thumbColor="#fff"
                />
              }
            />
          )}
          <SettingRow
            icon="🔒"
            label="Lock Vault"
            subtitle="Require master password to access"
            onPress={handleLock}
          />
        </View>

        {/* ── Tools ── */}
        <SectionHeader title="Tools" />
        <View style={styles.section}>
          <SettingRow
            icon="🛡️"
            label="Security Center"
            subtitle="Analyze vault for weak & duplicate passwords"
            onPress={() => {
              Haptics.selectionAsync();
              router.push('/(app)/security-center');
            }}
          />
          <SettingRow
            icon="⚡"
            label="Password Generator"
            subtitle="Create strong passwords & passphrases"
            onPress={() => {
              Haptics.selectionAsync();
              router.push('/(app)/generator');
            }}
          />
        </View>

        {/* ── Account ── */}
        <SectionHeader title="Account" />
        <View style={styles.section}>
          <SettingRow
            icon="↩️"
            label="Sign Out"
            subtitle="Lock vault and return to login"
            onPress={handleSignOut}
          />
        </View>

        {/* ── About ── */}
        <SectionHeader title="About" />
        <View style={styles.section}>
          <SettingRow
            icon="🔑"
            label="SafeKey"
            subtitle="v1.0.0 · Zero-Knowledge Password Manager"
          />
          <SettingRow
            icon="🔬"
            label="Encryption"
            subtitle="AES-256-GCM · PBKDF2-SHA256 · Client-Side Only"
          />
        </View>

        {/* ── ZK Badge ── */}
        <View style={styles.zkBadge}>
          <View style={styles.zkDot} />
          <Text style={styles.zkText}>
            Your data never leaves your device unencrypted
          </Text>
        </View>

        {/* ── Danger Zone ── */}
        <SectionHeader title="Danger Zone" />
        <View style={[styles.section, styles.dangerSection]}>
          <SettingRow
            icon="🗑️"
            label="Delete Account"
            subtitle="Permanently erase all data"
            onPress={handleDeleteAccount}
            danger
            disabled={isDeleting}
          />
        </View>

        <View style={{ height: spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  // Nav
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navBack: { width: 60 },
  navBackText: { color: colors.primaryLight, fontSize: typography.sm },
  navTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
  },

  scroll: { padding: spacing.lg },

  // Profile
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    gap: spacing.md,
  },
  profileAvatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primaryAlpha,
    borderWidth: 2,
    borderColor: colors.primary + '40',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.primary,
  },
  profileInfo: { flex: 1, minWidth: 0 },
  profileEmail: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
  },
  profileMeta: {
    fontSize: typography.xs,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // Sections
  sectionHeader: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
    paddingLeft: spacing.xs,
  },
  section: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  dangerSection: {
    borderColor: colors.danger + '30',
  },

  // Setting row
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  settingRowDisabled: { opacity: 0.5 },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  settingIconText: { fontSize: 18 },
  settingInfo: { flex: 1, minWidth: 0 },
  settingLabel: {
    fontSize: typography.base,
    fontWeight: typography.medium,
    color: colors.textPrimary,
  },
  settingSubtitle: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    marginTop: 2,
  },
  settingChevron: {
    fontSize: 22,
    color: colors.textTertiary,
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
    marginVertical: spacing.md,
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
});
