import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Ensure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are set in .env'
  );
}

/**
 * In-memory session storage.
 * Session lives while app is running but is wiped on app restart/reload.
 * This forces users to sign in every time they open the app — by design.
 */
const memoryStorage = {
  _store: {} as Record<string, string>,
  getItem(key: string): string | null {
    return this._store[key] ?? null;
  },
  setItem(key: string, value: string): void {
    this._store[key] = value;
  },
  removeItem(key: string): void {
    delete this._store[key];
  },
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: memoryStorage,
    autoRefreshToken: true,
    persistSession: true, // persists to memoryStorage (which resets on restart)
    detectSessionInUrl: false,
  },
});
