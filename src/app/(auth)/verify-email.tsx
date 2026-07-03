import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { verifyCustomOtp, resendVerificationEmail, sendLoginOtp, signInAfterVerification } from '@/services/auth.service';
import { supabase } from '@/services/supabase';
import { colors, typography, spacing, borderRadius } from '@/constants/theme';

// ─── Constants ────────────────────────────────────────────────────────────────

const OTP_LENGTH = 8;
const COOLDOWN_SECONDS = 60;

// ─── OTP Input Component ──────────────────────────────────────────────────────

function OtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<TextInput>(null);

  const handlePress = () => {
    inputRef.current?.focus();
  };

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={handlePress}
      style={otpStyles.container}
      accessible
      accessibilityLabel="Enter 6-digit verification code"
    >
      {Array.from({ length: OTP_LENGTH }).map((_, i) => {
        const char = value[i] || '';
        const isCurrent = i === value.length;
        const isFilled = !!char;

        return (
          <View
            key={i}
            style={[
              otpStyles.cell,
              isCurrent && otpStyles.cellActive,
              isFilled && otpStyles.cellFilled,
            ]}
          >
            <Text style={[otpStyles.cellText, isFilled && otpStyles.cellTextFilled]}>
              {char}
            </Text>
            {isCurrent && <View style={otpStyles.cursor} />}
          </View>
        );
      })}

      {/* Hidden input that captures keyboard */}
      <TextInput
        ref={inputRef}
        style={otpStyles.hiddenInput}
        value={value}
        onChangeText={(text) => {
          const cleaned = text.replace(/[^0-9]/g, '').slice(0, OTP_LENGTH);
          onChange(cleaned);
        }}
        keyboardType="number-pad"
        maxLength={OTP_LENGTH}
        autoFocus
        editable={!disabled}
        caretHidden
        accessible={false}
      />
    </TouchableOpacity>
  );
}

const otpStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    position: 'relative',
  },
  cell: {
    width: 38,
    height: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.bgGlass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryAlpha,
  },
  cellFilled: {
    borderColor: colors.primaryLight,
    backgroundColor: 'rgba(108, 99, 255, 0.08)',
  },
  cellText: {
    fontSize: typography.lg,
    fontWeight: typography.bold,
    color: colors.textTertiary,
  },
  cellTextFilled: {
    color: colors.textPrimary,
  },
  cursor: {
    position: 'absolute',
    bottom: 12,
    width: 20,
    height: 2,
    backgroundColor: colors.primary,
    borderRadius: 1,
  },
  hiddenInput: {
    position: 'absolute',
    opacity: 0,
    width: 1,
    height: 1,
  },
});

// ─── Screen Component ─────────────────────────────────────────────────────────

export default function VerifyEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string; mode?: string; password?: string }>();
  const email = params.email ?? '';
  const isLoginMode = params.mode === 'login';
  const password = params.password ?? '';

  const [otp, setOtp] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    timerRef.current = setInterval(() => {
      setCooldown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [cooldown]);

  // Auto-verify when 6 digits entered
  useEffect(() => {
    if (otp.length === OTP_LENGTH) {
      handleVerify();
    }
  }, [otp]);

  const handleVerify = async () => {
    if (otp.length !== OTP_LENGTH || !email || verifying) return;

    Keyboard.dismiss();
    setVerifying(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    // Use our custom OTP verification (bypasses Supabase's broken email system)
    const result = await verifyCustomOtp(email, otp);

    if (!result.success) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(result.error ?? 'Invalid code. Please try again.');
      setOtp('');
      setVerifying(false);
      return;
    }

    // OTP verified — user's email is now confirmed in auth.users.
    // Sign in with password to get a Supabase session.
    if (password) {
      const signInResult = await supabase.auth.signInWithPassword({ email, password });
      if (signInResult.error) {
        console.log('[verify] Post-verification sign-in failed:', signInResult.error.message);
        // Still redirect — user can sign in from login screen
      }
    }

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setVerifying(false);

    // If we have a session, go to master password. Otherwise, go to login.
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      router.replace('/(app)/master-password');
    } else {
      setFeedbackMessage('Email verified! Please sign in.');
      setTimeout(() => router.replace('/(auth)/login'), 1500);
    }
  };

  const handleResend = async () => {
    if (!email || cooldown > 0 || resending) return;

    setResending(true);
    setErrorMessage(null);
    setFeedbackMessage(null);

    // Use the correct resend function based on mode
    const result = isLoginMode
      ? await sendLoginOtp(email)
      : await resendVerificationEmail(email);

    if (result.error) {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setErrorMessage(result.error);
    } else {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFeedbackMessage('New code sent!');
      setCooldown(COOLDOWN_SECONDS);
      setOtp('');
    }

    setResending(false);
  };

  const canResend = !resending && cooldown <= 0 && !!email;

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        {/* Icon */}
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>🔐</Text>
        </View>

        {/* Header */}
        <Text style={styles.title}>Enter verification code</Text>
        <Text style={styles.body}>
          We sent an 8-digit code to{'\n'}
          {email ? (
            <Text style={styles.emailHighlight}>{email}</Text>
          ) : (
            'your email address'
          )}
        </Text>

        {/* OTP Input */}
        <View style={styles.otpSection}>
          <OtpInput value={otp} onChange={setOtp} disabled={verifying} />
        </View>

        {/* Verifying indicator */}
        {verifying && (
          <View style={styles.verifyingRow}>
            <ActivityIndicator color={colors.primary} size="small" />
            <Text style={styles.verifyingText}>Verifying...</Text>
          </View>
        )}

        {/* Feedback messages */}
        {feedbackMessage && (
          <View style={styles.successBanner}>
            <Text style={styles.successText}>✓ {feedbackMessage}</Text>
          </View>
        )}
        {errorMessage && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        )}

        {/* Verify button (fallback if auto-verify didn't trigger) */}
        <TouchableOpacity
          style={[
            styles.primaryButton,
            (otp.length !== OTP_LENGTH || verifying) && styles.primaryButtonDisabled,
          ]}
          onPress={handleVerify}
          disabled={otp.length !== OTP_LENGTH || verifying}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Verify code"
        >
          {verifying ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.primaryButtonText}>Verify</Text>
          )}
        </TouchableOpacity>

        {/* Resend */}
        <TouchableOpacity
          style={[styles.resendButton, !canResend && styles.resendButtonDisabled]}
          onPress={handleResend}
          disabled={!canResend}
          accessible
          accessibilityRole="button"
          accessibilityLabel={
            cooldown > 0
              ? `Resend code available in ${cooldown} seconds`
              : 'Resend verification code'
          }
        >
          {resending ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <Text style={[styles.resendText, !canResend && styles.resendTextDisabled]}>
              {cooldown > 0
                ? `Resend code (${cooldown}s)`
                : "Didn't get it? Resend code"}
            </Text>
          )}
        </TouchableOpacity>

        {/* Back to login */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.replace('/(auth)/login')}
          accessible
          accessibilityRole="button"
          accessibilityLabel="Back to sign in"
        >
          <Text style={styles.backText}>← Back to sign in</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  content: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primaryAlpha,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: typography.xxl,
    fontWeight: typography.bold,
    color: colors.textPrimary,
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  body: {
    fontSize: typography.base,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: typography.base * typography.normal,
  },
  emailHighlight: {
    color: colors.primaryLight,
    fontWeight: typography.medium,
  },
  otpSection: {
    marginVertical: spacing.lg,
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  verifyingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  verifyingText: {
    fontSize: typography.sm,
    color: colors.primary,
  },
  successBanner: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.3)',
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  successText: {
    color: '#22C55E',
    fontSize: typography.sm,
    textAlign: 'center',
  },
  errorBanner: {
    alignSelf: 'stretch',
    backgroundColor: colors.dangerAlpha,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: borderRadius.md,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.sm,
    textAlign: 'center',
  },
  primaryButton: {
    alignSelf: 'stretch',
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: typography.base,
    fontWeight: typography.semibold,
    letterSpacing: 0.2,
  },
  resendButton: {
    paddingVertical: spacing.sm,
  },
  resendButtonDisabled: {
    opacity: 0.5,
  },
  resendText: {
    color: colors.primary,
    fontSize: typography.sm,
    fontWeight: typography.medium,
  },
  resendTextDisabled: {
    color: colors.textTertiary,
  },
  backButton: {
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  backText: {
    color: colors.textSecondary,
    fontSize: typography.sm,
  },
});
