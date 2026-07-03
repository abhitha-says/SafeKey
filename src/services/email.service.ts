/**
 * Direct Resend HTTP API email sender.
 * Bypasses Supabase's SMTP relay entirely — sends OTP emails straight through Resend.
 */

import * as Crypto from 'expo-crypto';

const RESEND_API_KEY = process.env.EXPO_PUBLIC_RESEND_API_KEY;

export async function sendOtpEmail(
  email: string,
  otp: string,
  type: 'signup' | 'login' = 'signup'
): Promise<{ success: boolean; error?: string }> {
  if (!RESEND_API_KEY) {
    console.error('[email] EXPO_PUBLIC_RESEND_API_KEY not set');
    return { success: false, error: 'Email service not configured.' };
  }

  const subject =
    type === 'signup'
      ? 'Verify your SafeKey account'
      : 'Your SafeKey login code';

  const heading =
    type === 'signup'
      ? 'Your SafeKey verification code'
      : 'Your SafeKey sign-in code';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 24px; background: #0a0a0f; color: #e4e4e7;">
      <div style="text-align: center; margin-bottom: 32px;">
        <span style="font-size: 48px;">🔐</span>
      </div>
      <h2 style="text-align: center; color: #f4f4f5; font-size: 22px; margin-bottom: 8px;">
        ${heading}
      </h2>
      <p style="text-align: center; color: #a1a1aa; font-size: 15px; margin-bottom: 32px;">
        Enter this 8-digit code in the app:
      </p>
      <div style="background: #18181b; border: 1px solid #27272a; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
        <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #a78bfa; font-family: monospace;">
          ${otp}
        </span>
      </div>
      <p style="text-align: center; color: #71717a; font-size: 13px;">
        This code expires in 1 hour.<br/>
        If you didn't request this, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #27272a; margin: 32px 0;" />
      <p style="text-align: center; color: #52525b; font-size: 12px;">
        SafeKey — Zero-Knowledge Password Manager
      </p>
    </div>
  `;

  try {
    console.log('[email] Sending OTP to', email, 'via Resend...');
    console.log('[email] API key present:', !!RESEND_API_KEY, '| key prefix:', RESEND_API_KEY?.slice(0, 8));

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SafeKey <noreply@opscores.in>',
        to: [email],
        subject,
        html,
      }),
    });

    const responseText = await res.text();
    let data: any = {};
    try { data = JSON.parse(responseText); } catch {}

    if (!res.ok) {
      console.error('[email] Resend API error status:', res.status, '| body:', responseText);
      return {
        success: false,
        error: data?.message || `Email send failed (${res.status}). Check Resend API key and domain.`,
      };
    }

    console.log('[email] Email sent successfully. Resend ID:', data.id);
    return { success: true };
  } catch (err) {
    console.error('[email] Network error sending via Resend:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to send email.',
    };
  }
}

/**
 * Generate a cryptographically random 8-digit OTP.
 * Uses expo-crypto's native CSPRNG — Hermes has no global `crypto`, and
 * Math.random is not crypto-safe.
 * Bytes >= 250 are discarded (rejection sampling) so every digit 0-9 is
 * equally likely — a plain `byte % 10` would bias digits 0-5.
 */
export async function generateOtp(): Promise<string> {
  let otp = '';
  while (otp.length < 8) {
    const bytes = await Crypto.getRandomBytesAsync(16);
    for (const b of bytes) {
      if (b < 250 && otp.length < 8) otp += (b % 10).toString();
    }
  }
  return otp;
}
