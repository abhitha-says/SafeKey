import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Clipboard,
  Linking,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSessionStore } from '@/store/session.store';
import { fetchVaultItems, deleteVaultItem, toggleFavorite } from '@/services/vault.service';
import { decryptVaultEntry } from '@/encryption/vault';
import { colors, typography, spacing, borderRadius, CATEGORY_META } from '@/constants/theme';
import type { VaultItem } from '@/types';

// ─── Copy Row Component ───────────────────────────────────────────────────────

function DetailRow({
  label,
  value,
  secret,
  onCopy,
}: {
  label: string;
  value: string;
  secret?: boolean;
  onCopy?: () => void;
}) {
  const [revealed, setRevealed] = useState(!secret);

  return (
    <View style={rowStyles.wrapper}>
      <Text style={rowStyles.label}>{label}</Text>
      <View style={rowStyles.valueRow}>
        <Text style={rowStyles.value} numberOfLines={secret && !revealed ? 1 : undefined}>
          {secret && !revealed ? '••••••••••••' : value}
        </Text>
        <View style={rowStyles.actions}>
          {secret && (
            <TouchableOpacity
              onPress={() => {
                Haptics.selectionAsync();
                setRevealed((v) => !v);
              }}
              style={rowStyles.actionBtn}
            >
              <Text style={rowStyles.actionIcon}>{revealed ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          )}
          {onCopy && (
            <TouchableOpacity onPress={onCopy} style={rowStyles.actionBtn}>
              <Text style={rowStyles.actionIcon}>📋</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  wrapper: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.md,
  },
  label: {
    fontSize: typography.xs,
    color: colors.textTertiary,
    fontWeight: typography.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  value: {
    flex: 1,
    fontSize: typography.base,
    color: colors.textPrimary,
    lineHeight: typography.base * 1.5,
  },
  actions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.sm,
    backgroundColor: colors.bgGlass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: { fontSize: 16 },
});

// ─── Delete Modal ──────────────────────────────────────────────────────────────

function DeleteModal({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={modalStyles.overlay}>
        <View style={modalStyles.sheet}>
          <Text style={modalStyles.title}>Delete password?</Text>
          <Text style={modalStyles.body}>
            This will permanently delete this entry from your vault. This cannot be undone.
          </Text>
          <TouchableOpacity style={modalStyles.deleteBtn} onPress={onConfirm}>
            <Text style={modalStyles.deleteBtnText}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity style={modalStyles.cancelBtn} onPress={onCancel}>
            <Text style={modalStyles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bgCard,
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  title: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  body: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    lineHeight: typography.sm * 1.6,
    marginBottom: spacing.xl,
  },
  deleteBtn: {
    backgroundColor: colors.danger,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  deleteBtnText: {
    color: '#fff',
    fontSize: typography.base,
    fontWeight: typography.semibold,
  },
  cancelBtn: {
    backgroundColor: colors.bgGlass,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  cancelBtnText: {
    color: colors.textSecondary,
    fontSize: typography.base,
  },
});

// ─── Main Screen ───────────────────────────────────────────────────────────────

export default function VaultDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const derivedKey = useSessionStore((s) => s.derivedKey);

  const [item, setItem] = useState<VaultItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [copyTimer, setCopyTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Load item
  useEffect(() => {
    (async () => {
      try {
        const items = await fetchVaultItems();
        const found = items.find((i) => i.id === id) ?? null;
        setItem(found);
        setFavorite(found?.favorite ?? false);
      } catch {
        Alert.alert('Error', 'Could not load vault item.');
        router.back();
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // Decrypt password on demand
  const decryptPassword = useCallback(async () => {
    if (!item || !derivedKey || password !== null) return;
    setDecrypting(true);
    try {
      const plain = await decryptVaultEntry(
        item.encrypted_password,
        item.iv,
        item.auth_tag,
        derivedKey
      );
      setPassword(plain);

      if (item.notes_encrypted && item.notes_iv && item.notes_auth_tag) {
        const n = await decryptVaultEntry(
          item.notes_encrypted,
          item.notes_iv,
          item.notes_auth_tag,
          derivedKey
        );
        setNotes(n);
      }
    } catch {
      Alert.alert('Error', 'Decryption failed. Vault key may be incorrect.');
    } finally {
      setDecrypting(false);
    }
  }, [item, derivedKey, password]);

  const copyWithAutoClear = useCallback(
    (text: string, label: string) => {
      Clipboard.setString(text);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Clear clipboard after 30s
      if (copyTimer) clearTimeout(copyTimer);
      const t = setTimeout(() => {
        Clipboard.setString('');
      }, 30_000);
      setCopyTimer(t);

      Alert.alert(`${label} copied`, 'Clipboard will clear in 30 seconds.');
    },
    [copyTimer]
  );

  const handleCopyUsername = () => {
    if (item?.username) copyWithAutoClear(item.username, 'Username');
  };

  const handleCopyPassword = async () => {
    if (!password) {
      await decryptPassword();
    }
    // Wait for state update
    setTimeout(() => {
      if (password) copyWithAutoClear(password, 'Password');
    }, 100);
  };

  const handleToggleFavorite = async () => {
    if (!item) return;
    try {
      await toggleFavorite(item.id, favorite);
      setFavorite((v) => !v);
      Haptics.selectionAsync();
    } catch {
      Alert.alert('Error', 'Could not update favorite.');
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    try {
      await deleteVaultItem(item.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      Alert.alert('Error', 'Could not delete item.');
    }
  };

  const handleOpenWebsite = () => {
    if (!item?.website) return;
    const url = item.website.startsWith('http') ? item.website : `https://${item.website}`;
    Linking.openURL(url).catch(() => Alert.alert('Error', 'Could not open URL.'));
  };

  const handleEdit = () => {
    if (!item) return;
    router.push({
      pathname: '/(app)/add-password',
      params: { item: JSON.stringify(item) },
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  if (!item) return null;

  const catMeta = CATEGORY_META[item.category];
  const initial = (item.website ?? item.username ?? '?')[0].toUpperCase();

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Nav ── */}
      <View style={styles.nav}>
        <TouchableOpacity onPress={() => router.back()} style={styles.navBack}>
          <Text style={styles.navBackText}>← Back</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={handleToggleFavorite} style={styles.favBtn}>
          <Text style={styles.favIcon}>{favorite ? '⭐' : '☆'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Hero ── */}
        <View style={styles.hero}>
          <View style={[styles.avatar, { backgroundColor: catMeta.color + '22' }]}>
            <Text style={[styles.avatarText, { color: catMeta.color }]}>{initial}</Text>
          </View>
          <Text style={styles.heroTitle}>{item.website ?? item.username ?? 'Unnamed'}</Text>
          <View style={[styles.catBadge, { backgroundColor: catMeta.color + '22' }]}>
            <Text style={[styles.catBadgeText, { color: catMeta.color }]}>{catMeta.label}</Text>
          </View>
        </View>

        {/* ── Detail card ── */}
        <View style={styles.card}>
          {item.website && (
            <DetailRow
              label="Website"
              value={item.website}
              onCopy={() => copyWithAutoClear(item.website!, 'Website')}
            />
          )}

          {item.username && (
            <DetailRow
              label="Username / Email"
              value={item.username}
              onCopy={handleCopyUsername}
            />
          )}

          {/* Password row — lazy decrypt */}
          <View style={rowStyles.wrapper}>
            <Text style={rowStyles.label}>Password</Text>
            <View style={rowStyles.valueRow}>
              {decrypting ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <Text style={rowStyles.value}>
                  {password ? password : '••••••••••••'}
                </Text>
              )}
              <View style={rowStyles.actions}>
                <TouchableOpacity
                  onPress={async () => {
                    Haptics.selectionAsync();
                    if (!password) await decryptPassword();
                  }}
                  style={rowStyles.actionBtn}
                >
                  <Text style={rowStyles.actionIcon}>{password ? '🙈' : '👁️'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={async () => {
                    if (!password) {
                      await decryptPassword();
                    }
                    if (password) copyWithAutoClear(password, 'Password');
                  }}
                  style={rowStyles.actionBtn}
                >
                  <Text style={rowStyles.actionIcon}>📋</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {notes && (
            <DetailRow label="Notes" value={notes} />
          )}

          <View style={rowStyles.wrapper}>
            <Text style={rowStyles.label}>Added</Text>
            <Text style={rowStyles.value}>
              {new Date(item.created_at).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </Text>
          </View>
        </View>

        {/* ── Actions ── */}
        <View style={styles.actions}>
          {item.website && (
            <TouchableOpacity style={styles.actionBtn} onPress={handleOpenWebsite}>
              <Text style={styles.actionBtnIcon}>🌐</Text>
              <Text style={styles.actionBtnText}>Open website</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.actionBtn} onPress={handleEdit}>
            <Text style={styles.actionBtnIcon}>✏️</Text>
            <Text style={styles.actionBtnText}>Edit</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDanger]}
            onPress={() => setShowDeleteModal(true)}
          >
            <Text style={styles.actionBtnIcon}>🗑</Text>
            <Text style={[styles.actionBtnText, { color: colors.danger }]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <DeleteModal
        visible={showDeleteModal}
        onCancel={() => setShowDeleteModal(false)}
        onConfirm={handleDelete}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  navBack: {},
  navBackText: { color: colors.primaryLight, fontSize: typography.sm },
  favBtn: { padding: spacing.xs },
  favIcon: { fontSize: 22 },

  scroll: {
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },

  // Hero
  hero: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  avatarText: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
  },
  heroTitle: {
    fontSize: typography.xl,
    fontWeight: typography.bold,
    color: colors.textPrimary,
    textAlign: 'center',
  },
  catBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
  },
  catBadgeText: {
    fontSize: typography.sm,
    fontWeight: typography.medium,
  },

  // Card
  card: {
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },

  // Actions
  actions: {
    gap: spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  actionBtnDanger: {
    borderColor: colors.danger + '44',
    backgroundColor: colors.dangerAlpha,
  },
  actionBtnIcon: { fontSize: 18 },
  actionBtnText: {
    fontSize: typography.base,
    color: colors.textPrimary,
    fontWeight: typography.medium,
  },
});
