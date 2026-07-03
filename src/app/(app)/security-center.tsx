import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useVault } from '@/hooks/useVault';
import { useSessionStore } from '@/store/session.store';
import { bulkDecryptPasswords } from '@/encryption/vault';
import { getStrength } from '@/utils/password-strength';
import { colors, typography, spacing, borderRadius, CATEGORY_META } from '@/constants/theme';
import type { VaultItem } from '@/types';

// ─── Analysis Result Types ───────────────────────────────────────────────────

interface AnalysisResult {
  score: number; // 0–100
  weakItems: Array<{ item: VaultItem; label: string }>;
  duplicateGroups: Array<{ password: string; items: VaultItem[] }>;
  oldItems: VaultItem[];
  totalAnalyzed: number;
}

// 90 days in milliseconds
const OLD_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;

// ─── Score Ring ──────────────────────────────────────────────────────────────

function ScoreRing({ score }: { score: number }) {
  const scoreColor =
    score >= 80
      ? colors.success
      : score >= 60
      ? colors.warning
      : score >= 40
      ? colors.strengthWeak
      : colors.danger;

  const label =
    score >= 80
      ? 'Excellent'
      : score >= 60
      ? 'Good'
      : score >= 40
      ? 'Fair'
      : 'Needs work';

  return (
    <View style={styles.ringContainer}>
      <View style={[styles.ringOuter, { borderColor: scoreColor + '30' }]}>
        <View style={[styles.ringProgress, { borderColor: scoreColor }]}>
          <Text style={[styles.ringScore, { color: scoreColor }]}>{score}</Text>
          <Text style={styles.ringMax}>/100</Text>
        </View>
      </View>
      <Text style={[styles.ringLabel, { color: scoreColor }]}>{label}</Text>
      <Text style={styles.ringSubLabel}>Vault Health Score</Text>
    </View>
  );
}

// ─── Finding Card ────────────────────────────────────────────────────────────

function FindingCard({
  icon,
  title,
  count,
  color,
  description,
  onPress,
}: {
  icon: string;
  title: string;
  count: number;
  color: string;
  description: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.findingCard}
      onPress={onPress}
      activeOpacity={onPress ? 0.75 : 1}
      disabled={!onPress}
    >
      <View style={[styles.findingIcon, { backgroundColor: color + '22' }]}>
        <Text style={styles.findingIconText}>{icon}</Text>
      </View>
      <View style={styles.findingInfo}>
        <View style={styles.findingHeader}>
          <Text style={styles.findingTitle}>{title}</Text>
          <View style={[styles.findingBadge, { backgroundColor: color + '22' }]}>
            <Text style={[styles.findingBadgeText, { color }]}>{count}</Text>
          </View>
        </View>
        <Text style={styles.findingDesc}>{description}</Text>
      </View>
      {onPress && <Text style={styles.findingChevron}>›</Text>}
    </TouchableOpacity>
  );
}

// ─── Item Row ────────────────────────────────────────────────────────────────

function ItemRow({ item, subtitle }: { item: VaultItem; subtitle?: string }) {
  const catMeta = CATEGORY_META[item.category];
  const initial = (item.website ?? item.username ?? '?')[0].toUpperCase();

  return (
    <TouchableOpacity
      style={styles.itemRow}
      onPress={() => {
        Haptics.selectionAsync();
        router.push(`/(app)/vault-detail/${item.id}`);
      }}
      activeOpacity={0.75}
    >
      <View style={[styles.itemAvatar, { backgroundColor: catMeta.color + '22' }]}>
        <Text style={[styles.itemAvatarText, { color: catMeta.color }]}>{initial}</Text>
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.website ?? item.username ?? 'Unnamed'}
        </Text>
        {subtitle && (
          <Text style={styles.itemSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function SecurityCenterScreen() {
  const derivedKey = useSessionStore((s) => s.derivedKey);
  const { items, isLoading: isVaultLoading } = useVault();

  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const runAnalysis = useCallback(async () => {
    if (!derivedKey || items.length === 0) {
      setAnalysis({
        score: 100,
        weakItems: [],
        duplicateGroups: [],
        oldItems: [],
        totalAnalyzed: 0,
      });
      return;
    }

    setIsAnalyzing(true);

    try {
      // Decrypt all passwords in memory
      const decrypted = await bulkDecryptPasswords(items, derivedKey);
      const now = Date.now();

      // Map id → plaintext
      const idToPassword = new Map(decrypted.map((d) => [d.id, d.password]));

      // ── Weak password detection ──
      const weakItems: Array<{ item: VaultItem; label: string }> = [];
      for (const item of items) {
        const pw = idToPassword.get(item.id);
        if (!pw) continue;
        const str = getStrength(pw);
        if (str.score <= 1) {
          weakItems.push({ item, label: str.label });
        }
      }

      // ── Duplicate detection ──
      const passwordToItems = new Map<string, VaultItem[]>();
      for (const item of items) {
        const pw = idToPassword.get(item.id);
        if (!pw) continue;
        const existing = passwordToItems.get(pw) ?? [];
        existing.push(item);
        passwordToItems.set(pw, existing);
      }
      const duplicateGroups = Array.from(passwordToItems.entries())
        .filter(([, group]) => group.length > 1)
        .map(([password, groupItems]) => ({ password, items: groupItems }));

      // ── Old password detection ──
      const oldItems = items.filter((item) => {
        const updatedAt = new Date(item.updated_at).getTime();
        return now - updatedAt > OLD_THRESHOLD_MS;
      });

      // ── Score calculation ──
      // Start at 100, deduct for issues
      let score = 100;
      const total = items.length;

      if (total > 0) {
        // Weak: -15 points per weak password (proportional)
        const weakPenalty = (weakItems.length / total) * 40;
        score -= weakPenalty;

        // Duplicates: -20 points per duplicate group (proportional)
        const dupCount = duplicateGroups.reduce(
          (sum, g) => sum + g.items.length,
          0
        );
        const dupPenalty = (dupCount / total) * 30;
        score -= dupPenalty;

        // Old: -10 points (proportional)
        const oldPenalty = (oldItems.length / total) * 20;
        score -= oldPenalty;

        // Bonus for having many passwords (shows active use)
        if (total >= 10) score += 5;
        if (total >= 25) score += 5;
      }

      score = Math.max(0, Math.min(100, Math.round(score)));

      setAnalysis({
        score,
        weakItems,
        duplicateGroups,
        oldItems,
        totalAnalyzed: decrypted.length,
      });

      // Discard plaintext references — GC will collect
      idToPassword.clear();
      passwordToItems.clear();
    } catch (err) {
      Alert.alert(
        'Analysis Error',
        'Could not analyze vault. Your master password may have changed.'
      );
      console.error('[SecurityCenter] Analysis error:', err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [derivedKey, items]);

  useEffect(() => {
    if (!isVaultLoading && derivedKey) {
      runAnalysis();
    }
  }, [isVaultLoading, derivedKey]);

  const toggleSection = useCallback(
    (section: string) => {
      Haptics.selectionAsync();
      setExpandedSection((s) => (s === section ? null : section));
    },
    []
  );

  // Redirect if vault is locked — must be in useEffect to avoid crash
  useEffect(() => {
    if (!derivedKey) {
      router.replace('/(app)/master-password');
    }
  }, [derivedKey]);

  if (!derivedKey) {
    return (
      <View style={styles.loadingState}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const loading = isVaultLoading || isAnalyzing;

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Nav ── */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
          <Text style={styles.navBackText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Security Center</Text>
        <TouchableOpacity
          onPress={runAnalysis}
          style={styles.navAction}
          disabled={loading}
        >
          <Text style={styles.navActionText}>{loading ? '...' : '↺'}</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingState}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>Analyzing vault security...</Text>
          <Text style={styles.loadingSubtext}>
            Decrypting locally. Nothing leaves your device.
          </Text>
        </View>
      ) : analysis ? (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Score ── */}
          <ScoreRing score={analysis.score} />

          {/* ── Summary ── */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{analysis.totalAnalyzed}</Text>
              <Text style={styles.summaryLabel}>Analyzed</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{analysis.weakItems.length}</Text>
              <Text style={styles.summaryLabel}>Weak</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>
                {analysis.duplicateGroups.length}
              </Text>
              <Text style={styles.summaryLabel}>Duplicates</Text>
            </View>
            <View style={styles.summaryDivider} />
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{analysis.oldItems.length}</Text>
              <Text style={styles.summaryLabel}>Old</Text>
            </View>
          </View>

          {/* ── Findings ── */}
          {analysis.weakItems.length > 0 && (
            <View>
              <FindingCard
                icon="⚠️"
                title="Weak Passwords"
                count={analysis.weakItems.length}
                color={colors.danger}
                description="These passwords could be cracked in minutes. Update them with strong alternatives."
                onPress={() => toggleSection('weak')}
              />
              {expandedSection === 'weak' &&
                analysis.weakItems.map(({ item, label }) => (
                  <ItemRow key={item.id} item={item} subtitle={label} />
                ))}
            </View>
          )}

          {analysis.duplicateGroups.length > 0 && (
            <View>
              <FindingCard
                icon="🔁"
                title="Reused Passwords"
                count={analysis.duplicateGroups.reduce(
                  (s, g) => s + g.items.length,
                  0
                )}
                color={colors.warning}
                description="If one account is breached, all accounts with the same password are at risk."
                onPress={() => toggleSection('duplicates')}
              />
              {expandedSection === 'duplicates' &&
                analysis.duplicateGroups.map((group, gi) =>
                  group.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      subtitle={`Group ${gi + 1} · shared with ${group.items.length - 1} other${group.items.length > 2 ? 's' : ''}`}
                    />
                  ))
                )}
            </View>
          )}

          {analysis.oldItems.length > 0 && (
            <View>
              <FindingCard
                icon="🕰️"
                title="Old Passwords"
                count={analysis.oldItems.length}
                color={colors.textTertiary}
                description="These haven't been updated in over 90 days. Consider rotating them."
                onPress={() => toggleSection('old')}
              />
              {expandedSection === 'old' &&
                analysis.oldItems.map((item) => {
                  const days = Math.floor(
                    (Date.now() - new Date(item.updated_at).getTime()) /
                      (24 * 60 * 60 * 1000)
                  );
                  return (
                    <ItemRow
                      key={item.id}
                      item={item}
                      subtitle={`${days} days old`}
                    />
                  );
                })}
            </View>
          )}

          {/* All clear */}
          {analysis.weakItems.length === 0 &&
            analysis.duplicateGroups.length === 0 &&
            analysis.oldItems.length === 0 &&
            analysis.totalAnalyzed > 0 && (
              <View style={styles.allClear}>
                <Text style={styles.allClearIcon}>🛡️</Text>
                <Text style={styles.allClearTitle}>All Clear</Text>
                <Text style={styles.allClearBody}>
                  No weak, duplicate, or old passwords found. Your vault is in
                  excellent shape.
                </Text>
              </View>
            )}

          {/* Empty vault */}
          {analysis.totalAnalyzed === 0 && (
            <View style={styles.allClear}>
              <Text style={styles.allClearIcon}>📦</Text>
              <Text style={styles.allClearTitle}>Vault is Empty</Text>
              <Text style={styles.allClearBody}>
                Add some passwords to see your security score.
              </Text>
            </View>
          )}

          {/* ZK badge */}
          <View style={styles.zkBadge}>
            <View style={styles.zkDot} />
            <Text style={styles.zkText}>
              All analysis performed client-side. Zero data sent to servers.
            </Text>
          </View>

          <View style={{ height: spacing.xxxl }} />
        </ScrollView>
      ) : null}
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
  navAction: { width: 60, alignItems: 'flex-end' },
  navActionText: { color: colors.primary, fontSize: 20 },

  scroll: { padding: spacing.lg },

  // Loading
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  loadingText: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  loadingSubtext: {
    fontSize: typography.xs,
    color: colors.textTertiary,
  },

  // Score ring
  ringContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  ringOuter: {
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 6,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  ringProgress: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgCard,
  },
  ringScore: {
    fontSize: typography.xxxl,
    fontWeight: typography.black,
  },
  ringMax: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    marginTop: -4,
  },
  ringLabel: {
    fontSize: typography.md,
    fontWeight: typography.semibold,
  },
  ringSubLabel: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    marginTop: 2,
  },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  summaryItem: { alignItems: 'center' },
  summaryValue: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: colors.textPrimary,
  },
  summaryLabel: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 30,
    backgroundColor: colors.border,
  },

  // Findings
  findingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  findingIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  findingIconText: { fontSize: 20 },
  findingInfo: { flex: 1, minWidth: 0 },
  findingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  findingTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
  },
  findingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  findingBadgeText: {
    fontSize: typography.xs,
    fontWeight: typography.bold,
  },
  findingDesc: {
    fontSize: typography.xs,
    color: colors.textSecondary,
    lineHeight: typography.xs * 1.5,
  },
  findingChevron: {
    fontSize: 22,
    color: colors.textTertiary,
    marginLeft: spacing.xs,
  },

  // Item rows
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginLeft: spacing.xl,
    borderLeftWidth: 2,
    borderLeftColor: colors.border,
    gap: spacing.sm,
    marginBottom: 2,
  },
  itemAvatar: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemAvatarText: {
    fontSize: typography.sm,
    fontWeight: typography.bold,
  },
  itemInfo: { flex: 1, minWidth: 0 },
  itemName: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
    color: colors.textPrimary,
  },
  itemSubtitle: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    marginTop: 1,
  },

  // All clear
  allClear: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  allClearIcon: { fontSize: 48, marginBottom: spacing.sm },
  allClearTitle: {
    fontSize: typography.md,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
  },
  allClearBody: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
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
    marginTop: spacing.lg,
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
