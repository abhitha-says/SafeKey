-- ═══════════════════════════════════════════════════════════════════════════════
-- SafeKey: Custom OTP system (bypasses Supabase's broken SMTP relay)
-- Run this in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

-- Table to store our own OTPs
CREATE TABLE IF NOT EXISTS pending_otps (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  otp_code text NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  created_at timestamptz NOT NULL DEFAULT now(),
  attempts int NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pending_otps_email ON pending_otps(email);
ALTER TABLE pending_otps ENABLE ROW LEVEL SECURITY;

-- No RLS policies = only RPC functions (SECURITY DEFINER) can access

-- ─── Store OTP ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION store_otp(p_email text, p_otp text)
RETURNS json
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM pending_otps WHERE email = lower(p_email);
  INSERT INTO pending_otps (email, otp_code, expires_at)
  VALUES (lower(p_email), p_otp, now() + interval '1 hour');
  RETURN json_build_object('success', true);
END;
$$;

-- ─── Verify OTP + confirm user in auth.users ─────────────────────────────────
CREATE OR REPLACE FUNCTION verify_custom_otp(p_email text, p_otp text)
RETURNS json
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  rec pending_otps%ROWTYPE;
BEGIN
  SELECT * INTO rec
  FROM pending_otps
  WHERE email = lower(p_email) AND expires_at > now()
  ORDER BY created_at DESC LIMIT 1;

  IF rec IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'No pending code found. Request a new one.');
  END IF;

  IF rec.attempts >= 5 THEN
    DELETE FROM pending_otps WHERE id = rec.id;
    RETURN json_build_object('success', false, 'error', 'Too many attempts. Request a new code.');
  END IF;

  UPDATE pending_otps SET attempts = attempts + 1 WHERE id = rec.id;

  IF rec.otp_code != p_otp THEN
    RETURN json_build_object('success', false, 'error', 'Invalid code. Please try again.');
  END IF;

  -- Confirm user email in auth.users
  UPDATE auth.users
  SET email_confirmed_at = now(), confirmation_token = '', updated_at = now()
  WHERE email = lower(p_email) AND email_confirmed_at IS NULL;

  DELETE FROM pending_otps WHERE email = lower(p_email);
  RETURN json_build_object('success', true);
END;
$$;

-- ─── Expose RPCs to the API roles ────────────────────────────────────────────
-- New Supabase projects do NOT auto-expose functions to anon/authenticated;
-- without these grants the client gets PGRST202 "function not found".
GRANT EXECUTE ON FUNCTION public.store_otp(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_custom_otp(text, text) TO anon, authenticated;
