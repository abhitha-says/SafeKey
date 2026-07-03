import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Clipboard,
  Alert,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  generatePassword,
  getGeneratorEntropy,
  DEFAULT_CONFIG,
  DEFAULT_PASSPHRASE_CONFIG,
} from '@/utils/password-generator';
import type { GeneratorConfig } from '@/utils/password-generator';
import { getStrength } from '@/utils/password-strength';
import { colors, typography, spacing, borderRadius } from '@/constants/theme';

// ─── History Entry ───────────────────────────────────────────────────────────

interface HistoryEntry {
  password: string;
  timestamp: number;
  entropy: number;
}

const MAX_HISTORY = 5;

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function GeneratorScreen() {
  const [config, setConfig] = useState<GeneratorConfig>(DEFAULT_CONFIG);
  const [currentPassword, setCurrentPassword] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Fade animation for password preview
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Generate on mount
  useEffect(() => {
    regenerate();
  }, []);

  const regenerate = useCallback(() => {
    // Fade out → generate → fade in
    Animated.timing(fadeAnim, {
      toValue: 0.3,
      duration: 80,
      useNativeDriver: true,
    }).start(() => {
      const pw = generatePassword(config);
      setCurrentPassword(pw);

      // Add to history
      setHistory((prev) => {
        const next: HistoryEntry = {
          password: pw,
          timestamp: Date.now(),
          entropy: getGeneratorEntropy(config),
        };
        return [next, ...prev].slice(0, MAX_HISTORY);
      });

      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 120,
        useNativeDriver: true,
      }).start();
    });

    Haptics.selectionAsync();
  }, [config, fadeAnim]);

  // Regenerate when config changes
  useEffect(() => {
    if (currentPassword) regenerate();
  }, [config]);

  const handleCopy = useCallback(
    (pw: string, index?: number) => {
      Clipboard.setString(pw);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedIndex(index ?? -1);
      setTimeout(() => setCopiedIndex(null), 2000);
      Alert.alert('Copied', 'Password copied to clipboard.');
    },
    []
  );

  const togglePassphraseMode = useCallback(() => {
    setConfig((c) =>
      c.passphraseMode ? DEFAULT_CONFIG : DEFAULT_PASSPHRASE_CONFIG
    );
    Haptics.selectionAsync();
  }, []);

  const strength = currentPassword ? getStrength(currentPassword) : null;
  const entropy = getGeneratorEntropy(config);

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Nav ── */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
          <Text style={styles.navBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Password Generator</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Preview Card ── */}
        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>Generated Password</Text>
          <Animated.View style={[styles.previewBox, { opacity: fadeAnim }]}>
            <Text
              style={[
                styles.previewText,
                config.passphraseMode && styles.previewTextPassphrase,
              ]}
              selectable
            >
              {currentPassword}
            </Text>
          </Animated.View>

          {/* Strength */}
          {strength && (
            <View style={styles.strengthSection}>
              <View style={styles.strengthBarBg}>
                <View
                  style={[
                    styles.strengthBarFill,
                    {
                      width: `${Math.min((strength.score / 4) * 100, 100)}%`,
                      backgroundColor: strength.color,
                    },
                  ]}
                />
              </View>
              <View style={styles.strengthLabelRow}>
                <Text style={[styles.strengthLabel, { color: strength.color }]}>
                  {strength.label}
                </Text>
                <Text style={styles.entropyText}>{entropy} bits</Text>
              </View>
            </View>
          )}

          {/* Action buttons */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.actionBtn}
              onPress={() => handleCopy(currentPassword)}
            >
              <Text style={styles.actionBtnText}>
                {copiedIndex === -1 ? '✓ Copied' : '📋 Copy'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.actionBtnPrimary]}
              onPress={regenerate}
            >
              <Text style={[styles.actionBtnText, styles.actionBtnPrimaryText]}>
                ↺ Regenerate
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Mode Toggle ── */}
        <View style={styles.modeCard}>
          <TouchableOpacity
            style={[
              styles.modeBtn,
              !config.passphraseMode && styles.modeBtnActive,
            ]}
            onPress={() => {
              if (config.passphraseMode) togglePassphraseMode();
            }}
          >
            <Text style={styles.modeBtnIcon}>🔑</Text>
            <Text
              style={[
                styles.modeBtnLabel,
                !config.passphraseMode && styles.modeBtnLabelActive,
              ]}
            >
              Password
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.modeBtn,
              config.passphraseMode && styles.modeBtnActive,
            ]}
            onPress={() => {
              if (!config.passphraseMode) togglePassphraseMode();
            }}
          >
            <Text style={styles.modeBtnIcon}>📝</Text>
            <Text
              style={[
                styles.modeBtnLabel,
                config.passphraseMode && styles.modeBtnLabelActive,
              ]}
            >
              Passphrase
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Settings Card ── */}
        <View style={styles.settingsCard}>
          {/* Length */}
          <View style={styles.settingRow}>
            <Text style={styles.settingLabel}>
              {config.passphraseMode ? 'Words' : 'Length'}
            </Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => {
                  const min = config.passphraseMode ? 3 : 8;
                  setConfig((c) => ({
                    ...c,
                    length: Math.max(min, c.length - 1),
                  }));
                  Haptics.selectionAsync();
                }}
              >
                <Text style={styles.stepBtnText}>−</Text>
              </TouchableOpacity>
              <Text style={styles.stepValue}>{config.length}</Text>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => {
                  const max = config.passphraseMode ? 10 : 128;
                  setConfig((c) => ({
                    ...c,
                    length: Math.min(max, c.length + 1),
                  }));
                  Haptics.selectionAsync();
                }}
              >
                <Text style={styles.stepBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Character toggles — password mode only */}
          {!config.passphraseMode && (
            <>
              {(
                [
                  { key: 'uppercase' as const, label: 'A–Z Uppercase', icon: 'A' },
                  { key: 'lowercase' as const, label: 'a–z Lowercase', icon: 'a' },
                  { key: 'numbers' as const, label: '0–9 Numbers', icon: '#' },
                  { key: 'symbols' as const, label: '!@# Symbols', icon: '!' },
                  { key: 'excludeSimilar' as const, label: 'Exclude similar chars', icon: '≠' },
                ] as const
              ).map(({ key, label, icon }) => (
                <View key={key} style={styles.settingRow}>
                  <View style={styles.settingLabelRow}>
                    <View style={styles.settingIcon}>
                      <Text style={styles.settingIconText}>{icon}</Text>
                    </View>
                    <Text style={styles.settingLabel}>{label}</Text>
                  </View>
                  <Switch
                    value={config[key] as boolean}
                    onValueChange={(v) => {
                      setConfig((c) => ({ ...c, [key]: v }));
                      Haptics.selectionAsync();
                    }}
                    trackColor={{
                      false: colors.bgGlassStrong,
                      true: colors.primary,
                    }}
                    thumbColor="#fff"
                  />
                </View>
              ))}

              {/* Similar chars info */}
              {config.excludeSimilar && (
                <Text style={styles.infoText}>
                  Excluded: i I l L 1 o O 0
                </Text>
              )}
            </>
          )}

          {/* Passphrase info */}
          {config.passphraseMode && (
            <Text style={styles.infoText}>
              Words are separated by hyphens. Passphrases are easier to remember
              and type on mobile, while maintaining high entropy.
            </Text>
          )}
        </View>

        {/* ── History ── */}
        {history.length > 1 && (
          <View style={styles.historyCard}>
            <Text style={styles.historyTitle}>Recent ({history.length - 1})</Text>
            {history.slice(1).map((entry, i) => (
              <TouchableOpacity
                key={entry.timestamp}
                style={styles.historyRow}
                onPress={() => handleCopy(entry.password, i)}
                activeOpacity={0.7}
              >
                <Text style={styles.historyPassword} numberOfLines={1}>
                  {entry.password}
                </Text>
                <Text style={styles.historyMeta}>
                  {copiedIndex === i ? '✓' : '📋'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Bottom padding ── */}
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

  // Preview
  previewCard: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  previewLabel: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    fontWeight: typography.medium,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  previewBox: {
    backgroundColor: colors.bgGlass,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    minHeight: 56,
    justifyContent: 'center',
  },
  previewText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: typography.base,
    color: colors.primaryLight,
    letterSpacing: 0.8,
    lineHeight: typography.base * 1.6,
  },
  previewTextPassphrase: {
    fontFamily: undefined,
    fontSize: typography.md,
    letterSpacing: 0,
  },

  // Strength
  strengthSection: { marginBottom: spacing.md },
  strengthBarBg: {
    height: 4,
    backgroundColor: colors.bgGlassStrong,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: spacing.xs,
  },
  strengthBarFill: { height: '100%', borderRadius: 2 },
  strengthLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  strengthLabel: {
    fontSize: typography.xs,
    fontWeight: typography.semibold,
  },
  entropyText: {
    fontSize: typography.xs,
    color: colors.textTertiary,
  },

  // Actions
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: spacing.sm + 2,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    backgroundColor: colors.bgGlass,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionBtnPrimary: {
    backgroundColor: colors.primaryAlpha,
    borderColor: colors.primary,
  },
  actionBtnText: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.textSecondary,
  },
  actionBtnPrimaryText: {
    color: colors.primaryLight,
  },

  // Mode toggle
  modeCard: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: spacing.md,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    gap: spacing.xs,
  },
  modeBtnActive: {
    backgroundColor: colors.primaryAlpha,
    borderColor: colors.primary,
  },
  modeBtnIcon: { fontSize: 20 },
  modeBtnLabel: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    color: colors.textSecondary,
  },
  modeBtnLabelActive: {
    color: colors.primaryLight,
  },

  // Settings
  settingsCard: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  settingIcon: {
    width: 28,
    height: 28,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.bgGlass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingIconText: {
    fontSize: typography.sm,
    fontWeight: typography.bold,
    color: colors.textSecondary,
  },
  settingLabel: {
    fontSize: typography.base,
    color: colors.textPrimary,
    flex: 1,
  },
  infoText: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    marginTop: spacing.sm,
    lineHeight: typography.xs * 1.6,
  },

  // Stepper
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBtn: {
    width: 34,
    height: 34,
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
    fontSize: typography.md,
    fontWeight: typography.semibold,
    minWidth: 32,
    textAlign: 'center',
  },

  // History
  historyCard: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  historyTitle: {
    fontSize: typography.sm,
    fontWeight: typography.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  historyPassword: {
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: typography.xs,
    color: colors.textSecondary,
  },
  historyMeta: {
    fontSize: 14,
  },
});
