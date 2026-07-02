-- =============================================================================
-- SafeKey — Initial Schema Migration
-- Migration: 001_initial_schema
-- Created: 2026-07-02
--
-- Architecture notes:
--   - public.users extends auth.users (Supabase manages auth credentials)
--   - salt is stored per-user for Argon2id key derivation
--   - vault_items stores ONLY encrypted data — server never sees plaintext
--   - All passwords, notes encrypted client-side with AES-256-GCM
--   - RLS enforces zero cross-user data access at the database level
-- =============================================================================


-- -----------------------------------------------------------------------------
-- EXTENSION: Enable pgcrypto for gen_random_uuid()
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- -----------------------------------------------------------------------------
-- TABLE: public.users
-- Extends Supabase auth.users. Stores the salt for Argon2id key derivation.
-- The salt is not secret — it is public. Security comes from the master password.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id          UUID        REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email       TEXT        NOT NULL,
  salt        TEXT        NOT NULL,   -- 32-byte hex salt for Argon2id KDF
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.users              IS 'User profiles — extends Supabase auth.users';
COMMENT ON COLUMN public.users.salt         IS '32-byte hex-encoded random salt. Used with Argon2id to derive vault encryption key. Not secret.';


-- -----------------------------------------------------------------------------
-- TABLE: public.vault_items
-- Each row is one credential entry. All sensitive fields are encrypted
-- client-side with AES-256-GCM before leaving the device.
--
-- Encryption structure per field:
--   encrypted_password + iv + auth_tag  → password ciphertext
--   notes_encrypted    + notes_iv + notes_auth_tag → notes ciphertext (optional)
--
-- iv  = 12-byte nonce (hex) — unique per encryption operation
-- auth_tag = 16-byte GCM authentication tag (hex) — verifies integrity
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vault_items (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Metadata (not sensitive — stored plaintext for display/search)
  website          TEXT,
  username         TEXT,
  category         TEXT        NOT NULL DEFAULT 'general'
                               CHECK (category IN ('general', 'social', 'banking', 'email', 'shopping', 'work', 'other')),
  favorite         BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Encrypted password (AES-256-GCM)
  encrypted_password TEXT      NOT NULL,    -- hex ciphertext
  iv               TEXT        NOT NULL,    -- hex 12-byte nonce
  auth_tag         TEXT        NOT NULL,    -- hex 16-byte GCM auth tag

  -- Encrypted notes (optional)
  notes_encrypted  TEXT,                   -- hex ciphertext, nullable
  notes_iv         TEXT,                   -- hex 12-byte nonce, nullable
  notes_auth_tag   TEXT,                   -- hex 16-byte GCM auth tag, nullable

  -- Timestamps
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  public.vault_items                   IS 'Encrypted vault entries — server stores ciphertext only, never plaintext';
COMMENT ON COLUMN public.vault_items.encrypted_password IS 'AES-256-GCM ciphertext of the password, hex-encoded';
COMMENT ON COLUMN public.vault_items.iv                IS 'Unique 12-byte nonce per encryption operation, hex-encoded. Never reuse.';
COMMENT ON COLUMN public.vault_items.auth_tag          IS '16-byte GCM authentication tag. Verifies ciphertext integrity on decrypt.';
COMMENT ON COLUMN public.vault_items.notes_encrypted   IS 'AES-256-GCM ciphertext of optional notes, hex-encoded. NULL if no notes.';


-- -----------------------------------------------------------------------------
-- INDEXES: Optimise the most common query patterns
-- -----------------------------------------------------------------------------

-- Primary lookup: all vault items for a user, sorted by recently updated
CREATE INDEX IF NOT EXISTS idx_vault_user_updated
  ON public.vault_items(user_id, updated_at DESC);

-- Category filter (used in home screen tabs)
CREATE INDEX IF NOT EXISTS idx_vault_category
  ON public.vault_items(user_id, category);

-- Favorites filter
CREATE INDEX IF NOT EXISTS idx_vault_favorite
  ON public.vault_items(user_id, favorite)
  WHERE favorite = TRUE;

-- Website search (partial index for non-null websites)
CREATE INDEX IF NOT EXISTS idx_vault_website
  ON public.vault_items(user_id, website)
  WHERE website IS NOT NULL;


-- -----------------------------------------------------------------------------
-- FUNCTION + TRIGGER: Auto-update updated_at on row change
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER vault_items_updated_at
  BEFORE UPDATE ON public.vault_items
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();


-- -----------------------------------------------------------------------------
-- FUNCTION + TRIGGER: Auto-create user profile on Supabase auth sign-up
-- Inserts into public.users when a new auth.users row is created.
-- The salt must be passed by the client during sign-up and stored here.
-- Note: We use a default placeholder salt — the client MUST update it
--       immediately after sign-up by calling the upsert endpoint.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, email, salt)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'salt', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- -----------------------------------------------------------------------------
-- ROW LEVEL SECURITY: Zero cross-user data access
-- Every query is automatically filtered to the authenticated user's data.
-- Even if the client sends a malformed user_id, Supabase RLS blocks it.
-- -----------------------------------------------------------------------------

ALTER TABLE public.users       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_items ENABLE ROW LEVEL SECURITY;

-- Users: can only read and update their own profile
CREATE POLICY "users_select_own" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "users_update_own" ON public.users
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "users_insert_own" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Vault items: full CRUD, owner only
CREATE POLICY "vault_select_own" ON public.vault_items
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "vault_insert_own" ON public.vault_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vault_update_own" ON public.vault_items
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "vault_delete_own" ON public.vault_items
  FOR DELETE USING (auth.uid() = user_id);


-- -----------------------------------------------------------------------------
-- GRANT: Allow authenticated users to access their rows
-- (anon role has no access — requires authentication)
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.users       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vault_items TO authenticated;
GRANT USAGE ON SCHEMA public TO authenticated;
