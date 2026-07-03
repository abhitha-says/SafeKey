import { useState, useCallback, useEffect } from 'react';
import { useFocusEffect } from 'expo-router';
import { fetchVaultItems, deleteVaultItem, toggleFavorite } from '@/services/vault.service';
import type { VaultItem } from '@/types';

interface UseVaultReturn {
  items: VaultItem[];
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  toggleFav: (id: string, current: boolean) => Promise<void>;
}

/**
 * Fetches vault items (encrypted) from Supabase.
 * Re-fetches every time the screen comes into focus.
 * Decryption happens on-demand in individual screens — never bulk here.
 */
export function useVault(): UseVaultReturn {
  const [items, setItems] = useState<VaultItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchVaultItems();
      setItems(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load vault.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Re-fetch every time this screen gains focus
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteVaultItem(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    },
    []
  );

  const toggleFav = useCallback(
    async (id: string, current: boolean) => {
      await toggleFavorite(id, current);
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, favorite: !current } : i))
      );
    },
    []
  );

  return { items, isLoading, error, refetch: load, remove, toggleFav };
}
