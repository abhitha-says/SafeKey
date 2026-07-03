-- ═══════════════════════════════════════════════════════════════════════════════
-- SafeKey: check_email_exists RPC
-- Used by signIn to distinguish "unconfirmed account" from "wrong password"
-- Run this in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns TRUE if the email exists in auth.users (regardless of confirmation status),
 * FALSE otherwise.
 * SECURITY DEFINER so the anon role can query auth.users safely.
 */
CREATE OR REPLACE FUNCTION check_email_exists(p_email text)
RETURNS boolean
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE email = lower(p_email)
  );
END;
$$;

-- New Supabase projects do NOT auto-expose functions to anon/authenticated;
-- without this grant the client gets PGRST202 "function not found".
GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO anon, authenticated;
