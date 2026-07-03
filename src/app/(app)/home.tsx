import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useAuth } from '@/hooks/useAuth';
import { useVault } from '@/hooks/useVault';
import { useSessionStore } from '@/store/session.store';
import { signOut } from '@/services/auth.service';
import { useBiometric } from '@/hooks/useBiometric';
import { decryptVaultEntry } from '@/encryption/vault';
import {
  colors,
  typography,
  spacing,
  borderRadius,
  CATEGORY_META,
} from '@/constants/theme';
import type { VaultItem, VaultCategory } from '@/types';

// ─── Category filter list ──────────────────────────────────────────────────────

const ALL_CATEGORIES: Array<{ key: 'all' | VaultCategory; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'general', label: '🗂 General' },
  { key: 'social', label: '👤 Social' },
  { key: 'banking', label: '🏦 Banking' },
  { key: 'email', label: '📧 Email' },
  { key: 'shopping', label: '🛍 Shopping' },
  { key: 'work', label: '💼 Work' },
  { key: 'other', label: '📌 Other' },
];

// ─── Vault Item Card ──────────────────────────────────────────────────────────

function VaultCard({
  item,
  derivedKey,
  onFavorite,
  onDelete,
}: {
  item: VaultItem;
  derivedKey: string;
  onFavorite: () => void;
  onDelete: () => void;
}) {
  const catMeta = CATEGORY_META[item.category];
  const initial = (item.website ?? item.username ?? '?')[0].toUpperCase();

  const handleCopyPassword = useCallback(async () => {
    try {
      const plaintext = await decryptVaultEntry(
        item.encrypted_password,
        item.iv,
        item.auth_tag,
        derivedKey
      );
      Clipboard.setString(plaintext);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Copied', 'Password copied to clipboard.');
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Error', 'Could not decrypt password.');
    }
  }, [item, derivedKey]);

  const handlePress = () => {
    Haptics.selectionAsync();
    router.push(`/(app)/vault-detail/${item.id}`);
  };

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert(
      item.website ?? item.username ?? 'Vault Item',
      'What would you like to do?',
      [
        { text: 'Copy Password', onPress: handleCopyPassword },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={handlePress}
      onLongPress={handleLongPress}
      activeOpacity={0.75}
    >
      {/* Avatar */}
      <View style={[styles.cardAvatar, { backgroundColor: catMeta.color + '22' }]}>
        <Text style={[styles.cardAvatarText, { color: catMeta.color }]}>{initial}</Text>
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.website ?? item.username ?? 'Unnamed'}
        </Text>
        <Text style={styles.cardSubtitle} numberOfLines={1}>
          {item.username ?? '—'}
        </Text>
      </View>

      {/* Right side */}
      <View style={styles.cardRight}>
        {/* Category badge */}
        <View style={[styles.catBadge, { backgroundColor: catMeta.color + '22' }]}>
          <Text style={[styles.catBadgeText, { color: catMeta.color }]}>
            {catMeta.label}
          </Text>
        </View>

        {/* Favorite */}
        <TouchableOpacity onPress={onFavorite} style={styles.favBtn}>
          <Text style={styles.favIcon}>{item.favorite ? '⭐' : '☆'}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyIcon}>{hasQuery ? '🔍' : '🔐'}</Text>
      <Text style={styles.emptyTitle}>
        {hasQuery ? 'No results' : 'Your vault is empty'}
      </Text>
      <Text style={styles.emptyBody}>
        {hasQuery
          ? 'Try a different search term or category.'
          : 'Tap + to add your first password.'}
      </Text>
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const { user } = useAuth();
  const derivedKey = useSessionStore((s) => s.derivedKey);
  const lock = useSessionStore((s) => s.lock);
  const { clearBiometricKey } = useBiometric();
  const { items, isLoading, error, remove, toggleFav } = useVault();

  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<'all' | VaultCategory>('all');

  // Filter in memory — never sends plaintext to server
  const filtered = useMemo(() => {
    let list = items;

    if (activeCategory !== 'all') {
      list = list.filter((i) => i.category === activeCategory);
    }

    if (query.trim()) {
      const q = query.toLowerCase();
      list = list.filter(
        (i) =>
          i.website?.toLowerCase().includes(q) ||
          i.username?.toLowerCase().includes(q)
      );
    }

    // Favorites first
    return [...list].sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  }, [items, query, activeCategory]);

  const handleLock = () => {
    Haptics.selectionAsync();
    lock();
    router.replace('/(app)/master-password');
  };

  const handleSignOut = async () => {
    Haptics.selectionAsync();
    await clearBiometricKey();
    lock();
    await signOut();
    router.replace('/(auth)/login');
  };

  const handleDelete = useCallback(
    (item: VaultItem) => {
      Alert.alert(
        'Delete password',
        `Delete "${item.website ?? item.username ?? 'this item'}"? This cannot be undone.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await remove(item.id);
                await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              } catch {
                Alert.alert('Error', 'Could not delete item.');
              }
            },
          },
        ]
      );
    },
    [remove]
  );

  const firstName = user?.email?.split('@')[0] ?? 'there';

  // Redirect to master-password if vault is locked — must be in useEffect
  // to avoid "navigate before mounting" crash on first render
  useEffect(() => {
    if (!derivedKey) {
      router.replace('/(app)/master-password');
    }
  }, [derivedKey]);

  if (!derivedKey) {
    return (
      <View style={styles.centerState}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Hey, {firstName} 👋</Text>
          <Text style={styles.subGreeting}>
            {items.length === 0
              ? 'Your vault is ready'
              : `${items.length} password${items.length !== 1 ? 's' : ''} secured`}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => {
            Haptics.selectionAsync();
            router.push('/(app)/security-center');
          }}>
            <Text style={styles.iconBtnText}>🛡️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={handleLock}>
            <Text style={styles.iconBtnText}>🔒</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => {
            Haptics.selectionAsync();
            router.push('/(app)/settings');
          }}>
            <Text style={styles.iconBtnText}>⚙️</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Search ── */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search passwords..."
            placeholderTextColor={colors.textTertiary}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>
      </View>

      {/* ── Category chips ── */}
      <FlatList
        data={ALL_CATEGORIES}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
        keyExtractor={(c) => c.key}
        renderItem={({ item: cat }) => {
          const active = activeCategory === cat.key;
          return (
            <TouchableOpacity
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setActiveCategory(cat.key);
              }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />

      {/* ── Vault list ── */}
      {isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={styles.centerState}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={[
            styles.listContent,
            filtered.length === 0 && styles.listContentEmpty,
          ]}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<EmptyState hasQuery={!!query || activeCategory !== 'all'} />}
          renderItem={({ item }) => (
            <VaultCard
              item={item}
              derivedKey={derivedKey}
              onFavorite={() => toggleFav(item.id, item.favorite)}
              onDelete={() => handleDelete(item)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      {/* ── FAB ── */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          router.push('/(app)/add-password');
        }}
        activeOpacity={0.85}
        accessible
        accessibilityRole="button"
        accessibilityLabel="Add new password"
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  greeting: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: colors.textPrimary,
  },
  subGreeting: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bgGlass,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnText: {
    fontSize: 16,
  },

  // Search
  searchRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing.md,
    height: 44,
    gap: spacing.sm,
  },
  searchIcon: {
    fontSize: 15,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.base,
    color: colors.textPrimary,
    height: '100%',
  },

  // Category chips
  chipRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    backgroundColor: colors.bgGlass,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primaryAlpha,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    fontWeight: typography.medium,
  },
  chipTextActive: {
    color: colors.primaryLight,
  },

  // List
  listContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 100, // FAB clearance
  },
  listContentEmpty: {
    flexGrow: 1,
  },
  separator: {
    height: 8,
  },

  // Cards
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgCard,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardAvatar: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cardAvatarText: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
  },
  cardInfo: {
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: typography.base,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    marginTop: 2,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap: 6,
  },
  catBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  catBadgeText: {
    fontSize: typography.xs,
    fontWeight: typography.medium,
  },
  favBtn: {
    padding: 2,
  },
  favIcon: {
    fontSize: 16,
  },

  // States
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },

  // Empty
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing.xxxl,
    gap: spacing.sm,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  emptyTitle: {
    fontSize: typography.md,
    fontWeight: typography.semibold,
    color: colors.textPrimary,
  },
  emptyBody: {
    fontSize: typography.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 240,
  },

  // FAB
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  fabIcon: {
    fontSize: 28,
    color: '#fff',
    lineHeight: 32,
    fontWeight: typography.bold,
  },
});
