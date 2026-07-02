# SafeKey — Database Architecture

## Philosophy

The SafeKey database is designed around a single principle: **the server is untrusted**.

Even if Supabase is breached, attackers see only:
- Email addresses
- Random 32-byte salts (not secret, not useful without the master password)
- Ciphertext blobs with IVs and auth tags

They cannot decrypt anything without the user's master password.

---

## Tables

### `public.users`

Extends Supabase `auth.users`. Stores only metadata needed for key derivation.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `UUID` | Primary key. References `auth.users(id)`. Cascade delete. |
| `email` | `TEXT` | User's email address. |
| `salt` | `TEXT` | 32-byte hex-encoded random salt. Not secret. Used with Argon2id to derive vault encryption key. |
| `created_at` | `TIMESTAMPTZ` | Account creation timestamp. |

**What is NOT stored:** master password, encryption key, plaintext passwords.

---

### `public.vault_items`

One row per saved credential. Every sensitive field is encrypted client-side.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `UUID` | Primary key. |
| `user_id` | `UUID` | Foreign key → `public.users(id)`. Cascade delete. |
| `website` | `TEXT` | Plaintext website/service name. Used for display and search. |
| `username` | `TEXT` | Plaintext username/email label. Used for display. |
| `category` | `TEXT` | One of: `general`, `social`, `banking`, `email`, `shopping`, `work`, `other`. |
| `favorite` | `BOOLEAN` | Whether the entry is starred. |
| `encrypted_password` | `TEXT` | AES-256-GCM ciphertext, hex-encoded. |
| `iv` | `TEXT` | 12-byte nonce, hex-encoded. Unique per encryption. Never reused. |
| `auth_tag` | `TEXT` | 16-byte GCM auth tag, hex-encoded. Verifies integrity on decrypt. |
| `notes_encrypted` | `TEXT?` | AES-256-GCM ciphertext of notes (optional). |
| `notes_iv` | `TEXT?` | 12-byte nonce for notes. |
| `notes_auth_tag` | `TEXT?` | GCM auth tag for notes. |
| `created_at` | `TIMESTAMPTZ` | Auto-set on insert. |
| `updated_at` | `TIMESTAMPTZ` | Auto-updated by trigger on every UPDATE. |

---

## Security Model

### Row Level Security (RLS)

All tables have RLS enabled. Every query is filtered to `auth.uid()`.

| Policy | Table | Operation | Condition |
|--------|-------|-----------|-----------|
| `users_select_own` | users | SELECT | `auth.uid() = id` |
| `users_update_own` | users | UPDATE | `auth.uid() = id` |
| `users_insert_own` | users | INSERT | `auth.uid() = id` |
| `vault_select_own` | vault_items | SELECT | `auth.uid() = user_id` |
| `vault_insert_own` | vault_items | INSERT | `auth.uid() = user_id` |
| `vault_update_own` | vault_items | UPDATE | `auth.uid() = user_id` |
| `vault_delete_own` | vault_items | DELETE | `auth.uid() = user_id` |

**Even if someone obtains the anon key**, they cannot read another user's data.

### Auth Tag Integrity

The `auth_tag` column is the AES-256-GCM authentication tag. If any byte of the ciphertext is tampered with, decryption will throw an error (not return garbage). This means:
- A corrupted database cannot silently return wrong passwords
- Bit-flip attacks are detected

---

## Indexes

| Index | Purpose |
|-------|---------|
| `idx_vault_user_updated` | Primary fetch: all items for a user, sorted by updated_at |
| `idx_vault_category` | Home screen category tab filtering |
| `idx_vault_favorite` | Favorites tab — partial index (only `favorite = TRUE` rows) |
| `idx_vault_website` | Website-based search — partial index (non-null websites only) |

---

## Triggers

### `vault_items_updated_at`
Fires `BEFORE UPDATE` on `vault_items`. Sets `updated_at = NOW()` automatically.

### `on_auth_user_created`
Fires `AFTER INSERT` on `auth.users`. Inserts a row into `public.users` using the salt passed via `raw_user_meta_data`. The client also upserts as a safety net.

---

## Applying the Schema

1. Open your Supabase project → **SQL Editor**
2. Paste the contents of `supabase/migrations/001_initial_schema.sql`
3. Run it
4. Go to **Authentication > Settings** → ensure email confirmation is enabled
5. Verify RLS is active: go to **Table Editor** → each table should show "RLS enabled"

### Verify RLS Works

After applying:
```sql
-- Run as anon role — should return 0 rows (not an error)
SELECT * FROM public.vault_items;

-- Run as authenticated user — returns only their rows
SELECT * FROM public.vault_items;
```

---

## Future Schema Changes

When adding tables or columns:
1. Create a new file: `supabase/migrations/NNN_description.sql`
2. Never modify existing migration files
3. Always add RLS policies to new tables
4. Always test with a second test user account to verify cross-user isolation
