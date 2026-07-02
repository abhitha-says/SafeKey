import { supabase } from './supabase';
import type { VaultItem, VaultCategory } from '@/types';

// ─── Fetch ────────────────────────────────────────────────────────────────────

/**
 * Fetch all vault items for the current user, ordered by most recently updated.
 * RLS ensures only the authenticated user's rows are returned.
 */
export async function fetchVaultItems(): Promise<VaultItem[]> {
  const { data, error } = await supabase
    .from('vault_items')
    .select('*')
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch vault items: ${error.message}`);
  }

  return (data ?? []) as VaultItem[];
}

// ─── Insert ───────────────────────────────────────────────────────────────────

export interface InsertVaultItemPayload {
  website: string | null;
  username: string | null;
  encrypted_password: string;
  iv: string;
  auth_tag: string;
  notes_encrypted?: string | null;
  notes_iv?: string | null;
  notes_auth_tag?: string | null;
  category: VaultCategory;
  favorite: boolean;
}

export async function insertVaultItem(
  userId: string,
  payload: InsertVaultItemPayload
): Promise<VaultItem> {
  const { data, error } = await supabase
    .from('vault_items')
    .insert({
      user_id: userId,
      ...payload,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to insert vault item: ${error?.message}`);
  }

  return data as VaultItem;
}

// ─── Update ───────────────────────────────────────────────────────────────────

export interface UpdateVaultItemPayload extends Partial<InsertVaultItemPayload> {}

export async function updateVaultItem(
  itemId: string,
  payload: UpdateVaultItemPayload
): Promise<VaultItem> {
  const { data, error } = await supabase
    .from('vault_items')
    .update(payload)
    .eq('id', itemId)
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to update vault item: ${error?.message}`);
  }

  return data as VaultItem;
}

// ─── Toggle Favorite ──────────────────────────────────────────────────────────

export async function toggleFavorite(itemId: string, currentValue: boolean): Promise<void> {
  const { error } = await supabase
    .from('vault_items')
    .update({ favorite: !currentValue })
    .eq('id', itemId);

  if (error) {
    throw new Error(`Failed to toggle favorite: ${error.message}`);
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteVaultItem(itemId: string): Promise<void> {
  const { error } = await supabase
    .from('vault_items')
    .delete()
    .eq('id', itemId);

  if (error) {
    throw new Error(`Failed to delete vault item: ${error.message}`);
  }
}

// ─── Batch Update (for master password change) ────────────────────────────────

/**
 * Re-encrypts all vault items when the user changes their master password.
 * Uses upsert to update all rows atomically.
 * Each item must have a fresh IV and auth_tag (never reuse IVs).
 */
export type BatchVaultUpdate = {
  id: string;
  encrypted_password: string;
  iv: string;
  auth_tag: string;
  notes_encrypted?: string | null;
  notes_iv?: string | null;
  notes_auth_tag?: string | null;
};

export async function batchUpdateVaultItems(items: BatchVaultUpdate[]): Promise<void> {
  if (items.length === 0) return;

  const { error } = await supabase
    .from('vault_items')
    .upsert(items, { onConflict: 'id' });

  if (error) {
    throw new Error(`Batch update failed: ${error.message}`);
  }
}
