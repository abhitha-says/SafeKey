import { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Switch,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { useSessionStore } from '@/store/session.store';
import { insertVaultItem, updateVaultItem } from '@/services/vault.service';
import { encryptVaultEntry, decryptVaultEntry } from '@/encryption/vault';
import { getStrength } from '@/utils/password-strength';
import { colors, typography, spacing, borderRadius, CATEGORY_META } from '@/constants/theme';
import type { VaultCategory, VaultItem } from '@/types';
import { generatePassword, DEFAULT_CONFIG as DEFAULT_GEN } from '@/utils/password-generator';
import type { GeneratorConfig } from '@/utils/password-generator';

// ─── Field Component ──────────────────────────────────────────────────────────

function Field({
  label,
  children,
  error,
}: {
  label: string;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <View style={fieldStyles.wrapper}>
      <Text style={fieldStyles.label}>{label}</Text>
      {children}
      {error && <Text style={fieldStyles.error}>{error}</Text>}
    </View>
  );
}

const fieldStyles = StyleSheet.create({
  wrapper: { marginBottom: spacing.md },
  label: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  error: {
    fontSize: typography.xs,
    color: colors.danger,
    marginTop: spacing.xs,
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function AddPasswordScreen() {
  const { user } = useAuth();
  const derivedKey = useSessionStore((s) => s.derivedKey);

  // Edit mode: item is passed from vault-detail
  const params = useLocalSearchParams<{ item?: string }>();
  const existingItem: VaultItem | null = params.item ? JSON.parse(params.item) : null;
  const isEditMode = !!existingItem;

  // Form state
  const [website, setWebsite] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<VaultCategory>('general');
  const [favorite, setFavorite] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Generator state
  const [showGenerator, setShowGenerator] = useState(false);
  const [genConfig, setGenConfig] = useState<GeneratorConfig>(DEFAULT_GEN);
  const [generatedPreview, setGeneratedPreview] = useState('');

  // Decrypt and pre-fill in edit mode
  useEffect(() => {
    if (!existingItem || !derivedKey) return;

    setWebsite(existingItem.website ?? '');
    setUsername(existingItem.username ?? '');
    setCategory(existingItem.category);
    setFavorite(existingItem.favorite);

    decryptVaultEntry(
      existingItem.encrypted_password,
      existingItem.iv,
      existingItem.auth_tag,
      derivedKey
    ).then(setPassword).catch(() => {
      Alert.alert('Error', 'Could not decrypt item. Vault key may have changed.');
      router.back();
    });

    if (existingItem.notes_encrypted && existingItem.notes_iv && existingItem.notes_auth_tag) {
      decryptVaultEntry(
        existingItem.notes_encrypted,
        existingItem.notes_iv,
        existingItem.notes_auth_tag,
        derivedKey
      ).then(setNotes).catch(() => setNotes(''));
    }
  }, []);

  // Update preview whenever config changes
  useEffect(() => {
    if (showGenerator) {
      setGeneratedPreview(generatePassword(genConfig));
    }
  }, [genConfig, showGenerator]);

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!password.trim()) e.password = 'Password is required.';
    if (!website.trim() && !username.trim()) e.website = 'Enter a website or username.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validate() || !user?.id || !derivedKey) return;

    setSaving(true);
    try {
      const encPw = await encryptVaultEntry(password, derivedKey);
      let encNotes = null;
      let notesIv = null;
      let notesTag = null;

      if (notes.trim()) {
        const n = await encryptVaultEntry(notes, derivedKey);
        encNotes = n.ciphertext;
        notesIv = n.iv;
        notesTag = n.authTag;
      }

      const payload = {
        website: website.trim() || null,
        username: username.trim() || null,
        encrypted_password: encPw.ciphertext,
        iv: encPw.iv,
        auth_tag: encPw.authTag,
        notes_encrypted: encNotes,
        notes_iv: notesIv,
        notes_auth_tag: notesTag,
        category,
        favorite,
      };

      if (isEditMode && existingItem) {
        await updateVaultItem(existingItem.id, payload);
      } else {
        await insertVaultItem(user.id, payload);
      }

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Save failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  const strength = password.length > 0 ? getStrength(password) : null;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* ── Nav ── */}
        <View style={styles.nav}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
            <Text style={styles.navBackText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.navTitle}>{isEditMode ? 'Edit Password' : 'Add Password'}</Text>
          <View style={{ width: 60 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Website ── */}
          <Field label="Website / App" error={errors.website}>
            <TextInput
              style={[styles.input, errors.website && styles.inputError]}
              placeholder="github.com"
              placeholderTextColor={colors.textTertiary}
              value={website}
              onChangeText={(t) => { setWebsite(t); setErrors((e) => ({ ...e, website: '' })); }}
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>

          {/* ── Username ── */}
          <Field label="Username / Email">
            <TextInput
              style={styles.input}
              placeholder="you@example.com"
              placeholderTextColor={colors.textTertiary}
              value={username}
              onChangeText={setUsername}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>

          {/* ── Password ── */}
          <Field label="Password" error={errors.password}>
            <View style={[styles.inputRow, errors.password && styles.inputError]}>
              <TextInput
                style={styles.inputInner}
                placeholder="••••••••••••"
                placeholderTextColor={colors.textTertiary}
                value={password}
                onChangeText={(t) => { setPassword(t); setErrors((e) => ({ ...e, password: '' })); }}
                secureTextEntry={!passwordVisible}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setPasswordVisible((v) => !v)}
              >
                <Text>{passwordVisible ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            {/* Strength bar */}
            {strength && (
              <View style={styles.strengthRow}>
                <View style={styles.strengthBg}>
                  <View
                    style={[
                      styles.strengthFill,
                      {
                        width: `${(strength.score / 4) * 100}%`,
                        backgroundColor: strength.color,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.strengthLabel, { color: strength.color }]}>
                  {strength.label}
                </Text>
              </View>
            )}
          </Field>

          {/* ── Generator toggle ── */}
          <TouchableOpacity
            style={styles.generatorToggle}
            onPress={() => {
              Haptics.selectionAsync();
              setShowGenerator((v) => !v);
              if (!showGenerator) setGeneratedPreview(generatePassword(genConfig));
            }}
          >
            <Text style={styles.generatorToggleText}>
              {showGenerator ? '▼ Hide generator' : '⚡ Generate password'}
            </Text>
          </TouchableOpacity>

          {/* ── Generator panel ── */}
          {showGenerator && (
            <View style={styles.generatorPanel}>
              {/* Preview */}
              <View style={styles.genPreview}>
                <Text style={styles.genPreviewText} numberOfLines={1}>
                  {generatedPreview}
                </Text>
                <TouchableOpacity
                  onPress={() => setGeneratedPreview(generatePassword(genConfig))}
                >
                  <Text style={styles.genRefresh}>↺</Text>
                </TouchableOpacity>
              </View>

              {/* Use this password */}
              <TouchableOpacity
                style={styles.genUseBtn}
                onPress={() => {
                  setPassword(generatedPreview);
                  setPasswordVisible(true);
                  setShowGenerator(false);
                  Haptics.selectionAsync();
                }}
              >
                <Text style={styles.genUseBtnText}>Use this password</Text>
              </TouchableOpacity>

              {/* Length */}
              <View style={styles.genRow}>
                <Text style={styles.genLabel}>Length: {genConfig.length}</Text>
                <View style={styles.genStepper}>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() =>
                      setGenConfig((c) => ({ ...c, length: Math.max(8, c.length - 1) }))
                    }
                  >
                    <Text style={styles.stepBtnText}>−</Text>
                  </TouchableOpacity>
                  <Text style={styles.stepValue}>{genConfig.length}</Text>
                  <TouchableOpacity
                    style={styles.stepBtn}
                    onPress={() =>
                      setGenConfig((c) => ({ ...c, length: Math.min(64, c.length + 1) }))
                    }
                  >
                    <Text style={styles.stepBtnText}>+</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* Toggles */}
              {(
                [
                  { key: 'uppercase', label: 'A–Z Uppercase' },
                  { key: 'lowercase', label: 'a–z Lowercase' },
                  { key: 'numbers', label: '0–9 Numbers' },
                  { key: 'symbols', label: '!@# Symbols' },
                  { key: 'excludeSimilar', label: 'Exclude similar (iIlL1oO0)' },
                ] as { key: keyof GeneratorConfig; label: string }[]
              ).map(({ key, label }) => (
                <View key={key} style={styles.genRow}>
                  <Text style={styles.genLabel}>{label}</Text>
                  <Switch
                    value={genConfig[key] as boolean}
                    onValueChange={(v) => setGenConfig((c) => ({ ...c, [key]: v }))}
                    trackColor={{ false: colors.bgGlassStrong, true: colors.primary }}
                    thumbColor="#fff"
                  />
                </View>
              ))}
            </View>
          )}

          {/* ── Category ── */}
          <Field label="Category">
            <View style={styles.catGrid}>
              {(Object.keys(CATEGORY_META) as VaultCategory[]).map((cat) => {
                const meta = CATEGORY_META[cat];
                const active = category === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[
                      styles.catOption,
                      active && { borderColor: meta.color, backgroundColor: meta.color + '22' },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setCategory(cat);
                    }}
                  >
                    <Text style={[styles.catOptionText, active && { color: meta.color }]}>
                      {meta.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Field>

          {/* ── Notes ── */}
          <Field label="Notes (optional)">
            <TextInput
              style={[styles.input, styles.notesInput]}
              placeholder="Any extra info..."
              placeholderTextColor={colors.textTertiary}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              autoCapitalize="sentences"
            />
          </Field>

          {/* ── Favorite ── */}
          <View style={styles.favoriteRow}>
            <Text style={styles.favoriteLabel}>Add to favorites</Text>
            <Switch
              value={favorite}
              onValueChange={(v) => {
                Haptics.selectionAsync();
                setFavorite(v);
              }}
              trackColor={{ false: colors.bgGlassStrong, true: colors.accent }}
              thumbColor="#fff"
            />
          </View>

          {/* ── Save ── */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>
                {isEditMode ? 'Save changes' : 'Save password'}
              </Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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

  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },

  // Inputs
  input: {
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: typography.base,
    color: colors.textPrimary,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
  },
  inputInner: {
    flex: 1,
    paddingVertical: spacing.md,
    fontSize: typography.base,
    color: colors.textPrimary,
  },
  eyeBtn: {
    paddingLeft: spacing.sm,
    paddingVertical: spacing.sm,
  },
  notesInput: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: spacing.md,
  },

  // Strength
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  strengthBg: {
    flex: 1,
    height: 4,
    backgroundColor: colors.bgGlassStrong,
    borderRadius: 2,
    overflow: 'hidden',
  },
  strengthFill: { height: '100%', borderRadius: 2 },
  strengthLabel: { fontSize: typography.xs, fontWeight: typography.medium, width: 70 },

  // Generator
  generatorToggle: {
    marginBottom: spacing.md,
  },
  generatorToggleText: {
    color: colors.primaryLight,
    fontSize: typography.sm,
    fontWeight: typography.medium,
  },
  generatorPanel: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  genPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgGlass,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  genPreviewText: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: typography.sm,
    color: colors.primaryLight,
    letterSpacing: 1,
  },
  genRefresh: {
    fontSize: 20,
    color: colors.primary,
  },
  genUseBtn: {
    backgroundColor: colors.primaryAlpha,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  genUseBtnText: {
    color: colors.primaryLight,
    fontWeight: typography.semibold,
    fontSize: typography.sm,
  },
  genRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  genLabel: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    flex: 1,
  },
  genStepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.bgGlass,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    color: colors.textPrimary,
    fontSize: typography.md,
    fontWeight: typography.bold,
  },
  stepValue: {
    color: colors.textPrimary,
    fontSize: typography.base,
    fontWeight: typography.semibold,
    minWidth: 28,
    textAlign: 'center',
  },

  // Category
  catGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  catOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgGlass,
  },
  catOptionText: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    fontWeight: typography.medium,
  },

  // Favorite
  favoriteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  favoriteLabel: {
    fontSize: typography.base,
    color: colors.textPrimary,
  },

  // Save
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md + 2,
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    color: '#fff',
    fontSize: typography.base,
    fontWeight: typography.semibold,
    letterSpacing: 0.2,
  },
});
