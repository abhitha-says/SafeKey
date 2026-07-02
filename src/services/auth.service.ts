import { supabase } from './supabase';
import type { UserProfile } from '@/types';

// ─── Salt Generation ──────────────────────────────────────────────────────────

/**
 * Generates a cryptographically secure 32-byte salt.
 * Uses expo-crypto which wraps the platform's native CSPRNG.
 */
async function generateSalt(): Promise<string> {
  // Dynamic import — expo-crypto is only available in native/dev client builds
  const Crypto = await import('expo-crypto');
  const bytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── Sign Up ─────────────────────────────────────────────────────────────────

export interface SignUpResult {
  success: boolean;
  error?: string;
  needsEmailVerification?: boolean;
}

/**
 * Creates a Supabase auth account and immediately inserts the user profile
 * with a generated salt into public.users.
 *
 * The trigger on_auth_user_created will attempt to create the row first,
 * but we pass the salt via raw_user_meta_data so it's available in the trigger.
 * We also upsert from the client side as a safety net.
 */
export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const salt = await generateSalt();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { salt }, // passed to handle_new_user trigger via raw_user_meta_data
    },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data.user) {
    return { success: false, error: 'Sign up failed — no user returned.' };
  }

  // Upsert into public.users as a safety net (in case trigger races)
  const { error: profileError } = await supabase.from('users').upsert(
    {
      id: data.user.id,
      email: data.user.email!,
      salt,
    },
    { onConflict: 'id' }
  );

  if (profileError) {
    console.error('[auth] Failed to upsert user profile:', profileError.message);
    // Don't block sign-up — the trigger may have already handled it
  }

  const needsEmailVerification = !data.session; // Supabase requires email confirmation
  return { success: true, needsEmailVerification };
}

// ─── Sign In ─────────────────────────────────────────────────────────────────

export interface SignInResult {
  success: boolean;
  error?: string;
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ─── Sign Out ────────────────────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// ─── Forgot Password ─────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(email: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: 'safekey://reset-password',
  });

  if (error) return { error: error.message };
  return {};
}

// ─── Get Current Session ─────────────────────────────────────────────────────

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// ─── Get User Profile (with salt) ────────────────────────────────────────────

/**
 * Fetches the user's salt from public.users.
 * The salt is needed for Argon2id key derivation on master password entry.
 */
export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error || !data) {
    console.error('[auth] Failed to fetch user profile:', error?.message);
    return null;
  }

  return data as UserProfile;
}

// ─── Delete Account ───────────────────────────────────────────────────────────

/**
 * Deletes the user's vault items and profile.
 * Supabase auth user deletion must be done via admin API or Edge Function.
 * The ON DELETE CASCADE on vault_items handles cleanup automatically.
 */
export async function deleteUserData(userId: string): Promise<{ error?: string }> {
  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', userId);

  if (error) return { error: error.message };
  await signOut();
  return {};
}
