import { supabase } from './supabase';
import type { UserProfile } from '@/types';
import { generateOtp, sendOtpEmail } from './email.service';

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
  alreadyExists?: boolean;
}

/**
 * Creates a Supabase auth account.
 * The salt is passed via raw_user_meta_data so the handle_new_user
 * database trigger can insert it into public.users.
 * Profile creation is fully handled by the trigger (service-role privileges).
 */
export async function signUp(email: string, password: string): Promise<SignUpResult> {
  const salt = await generateSalt();

  console.log('[auth] signUp called for:', email);

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { salt }, // passed to handle_new_user trigger via raw_user_meta_data
    },
  });

  // ── DIAGNOSTIC: log the full response ──
  console.log('[auth] signUp response:', JSON.stringify({
    hasError: !!error,
    errorMessage: error?.message,
    errorStatus: error?.status,
    hasUser: !!data?.user,
    userId: data?.user?.id?.slice(0, 8),
    hasSession: !!data?.session,
    identitiesCount: data?.user?.identities?.length,
    confirmationSentAt: data?.user?.confirmation_sent_at,
    emailConfirmedAt: data?.user?.email_confirmed_at,
  }, null, 2));

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data.user) {
    return { success: false, error: 'Sign up failed — no user returned.' };
  }

  // Supabase returns a user with empty identities when the email already exists
  // (to prevent email enumeration). Detect this and inform the user.
  if (data.user.identities && data.user.identities.length === 0) {
    return {
      success: false,
      alreadyExists: true,
      error: 'An account with this email already exists. Please sign in.',
    };
  }

  // Profile creation is handled by the handle_new_user database trigger.
  // The salt is passed via raw_user_meta_data in the signUp options above.

  const needsEmailVerification = !data.session;
  console.log('[auth] signUp result: needsEmailVerification =', needsEmailVerification);

  // Send OTP via Resend (bypasses Supabase's broken SMTP relay)
  if (needsEmailVerification) {
    const otpResult = await sendCustomOtp(email, 'signup');
    if (!otpResult.success) {
      console.error('[auth] Failed to send OTP email:', otpResult.error);
      // Don't fail signup — user can resend from verify screen
    }
  }

  return { success: true, needsEmailVerification };
}

// ─── Custom OTP: Send ────────────────────────────────────────────────────────

/**
 * Generates an 8-digit OTP, stores it in pending_otps via RPC,
 * and sends it directly through Resend HTTP API.
 * Completely bypasses Supabase's SMTP relay.
 */
export async function sendCustomOtp(
  email: string,
  type: 'signup' | 'login' = 'signup'
): Promise<{ success: boolean; error?: string }> {
  const otp = await generateOtp();
  console.log('[auth] Generated OTP for', email, '— storing...');

  // Store OTP in database via RPC
  const { error: rpcError } = await supabase.rpc('store_otp', {
    p_email: email.toLowerCase(),
    p_otp: otp,
  });

  if (rpcError) {
    console.error('[auth] store_otp RPC error:', rpcError.message);
    return { success: false, error: 'Failed to generate code. Try again.' };
  }

  // Send email via Resend HTTP API
  const emailResult = await sendOtpEmail(email, otp, type);
  if (!emailResult.success) {
    return { success: false, error: emailResult.error };
  }

  return { success: true };
}

// ─── Custom OTP: Verify ──────────────────────────────────────────────────────

export interface VerifyOtpResult {
  success: boolean;
  error?: string;
  alreadyVerified?: boolean;
}

/**
 * Verifies the OTP code against our pending_otps table.
 * On success, the RPC function also confirms the user in auth.users.
 */
export async function verifyCustomOtp(
  email: string,
  otp: string
): Promise<VerifyOtpResult> {
  console.log('[auth] verifyCustomOtp for', email);

  const { data, error } = await supabase.rpc('verify_custom_otp', {
    p_email: email.toLowerCase(),
    p_otp: otp,
  });

  if (error) {
    console.error('[auth] verify_custom_otp RPC error:', error.message);
    return { success: false, error: 'Verification failed. Try again.' };
  }

  const result = data as { success: boolean; error?: string };
  if (!result.success) {
    return { success: false, error: result.error ?? 'Invalid code.' };
  }

  console.log('[auth] OTP verified successfully for', email);
  return { success: true };
}

// ─── Resend Verification Email ───────────────────────────────────────────────

/**
 * Resends OTP via our custom system (Resend HTTP API).
 */
export async function resendVerificationEmail(email: string): Promise<{ error?: string }> {
  const result = await sendCustomOtp(email, 'signup');
  if (!result.success) return { error: result.error };
  return {};
}

// ─── Sign In ─────────────────────────────────────────────────────────────────

export interface SignInResult {
  success: boolean;
  error?: string;
  needsVerification?: boolean;
}

/**
 * Signs the user in.
 *
 * Supabase can return "Invalid login credentials" for TWO different reasons:
 *   1. The account exists but email is unconfirmed (our custom OTP wasn't verified yet)
 *   2. The email/password combination is genuinely wrong
 *
 * We disambiguate by attempting a signUp with the same email.
 * Supabase returns identities=[] when the email is already registered (anti-enumeration),
 * which tells us the account exists → redirect to OTP verification.
 * If a brand-new user is returned (identities.length > 0), credentials are truly wrong.
 */
export async function signIn(email: string, password: string): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (!error) {
    return { success: true };
  }

  console.log('[auth] signIn error:', error.message);

  // "Email not confirmed" — explicit unverified signal from Supabase
  if (error.message === 'Email not confirmed') {
    const otpResult = await sendCustomOtp(email, 'signup');
    return {
      success: false,
      needsVerification: true,
      error: otpResult.success
        ? 'Email not verified. We sent a fresh verification code.'
        : 'Email not verified. Please try again.',
    };
  }

  // "Invalid login credentials" — could be unconfirmed OR truly wrong password.
  // Check if the email exists in auth.users via a SECURITY DEFINER RPC to distinguish the two.
  if (error.message === 'Invalid login credentials') {
    try {
      const { data: existsData, error: existsError } = await supabase.rpc('check_email_exists', {
        p_email: email.toLowerCase(),
      });

      if (!existsError && existsData === true) {
        // Email exists in auth.users → account is registered but unconfirmed
        console.log('[auth] Account exists but unconfirmed — sending OTP');
        const otpResult = await sendCustomOtp(email, 'signup');
        return {
          success: false,
          needsVerification: true,
          error: otpResult.success
            ? 'Your email is not yet verified. We sent a fresh verification code.'
            : 'Your email is not yet verified. Use "Sign in with email code" below.',
        };
      }
    } catch (checkErr) {
      console.log('[auth] check_email_exists threw:', checkErr);
    }

    // Email doesn't exist OR RPC not available → credentials are wrong
    return { success: false, error: 'Incorrect email or password. Please try again.' };
  }

  return { success: false, error: error.message };
}

// ─── Sign Out ────────────────────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// ─── OTP-Based Sign In ───────────────────────────────────────────────────────

/**
 * Sends a login OTP via our custom system (Resend HTTP API).
 */
export async function sendLoginOtp(email: string): Promise<{ error?: string }> {
  const result = await sendCustomOtp(email, 'login');
  if (!result.success) return { error: result.error };
  return {};
}

/**
 * After custom OTP verification, sign the user in with their password
 * to get a Supabase session.
 */
export async function signInAfterVerification(
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.log('[auth] signInAfterVerification error:', error.message);
    return { success: false, error: error.message };
  }
  return { success: true };
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
