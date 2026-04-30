-- User management — app_users + user_invites.
--
-- app_users mirrors auth.users for the rows we care about (so we can
-- store role + active flag without touching Supabase's auth schema).
-- The id column is the same uuid as auth.users.id; rows are inserted
-- when a user accepts an invite (or via the bootstrap endpoint that
-- promotes the first signed-in user to admin).

CREATE TABLE IF NOT EXISTS public.app_users (
  id            uuid PRIMARY KEY,
  email         text NOT NULL UNIQUE,
  name          text,
  role          text NOT NULL DEFAULT 'member',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_users_role_chk') THEN
    ALTER TABLE public.app_users
      ADD CONSTRAINT app_users_role_chk CHECK (role IN ('admin', 'member'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS app_users_email_idx ON public.app_users(email);

CREATE TABLE IF NOT EXISTS public.user_invites (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 text NOT NULL,
  role                  text NOT NULL DEFAULT 'member',
  token                 text NOT NULL UNIQUE,
  invited_by            uuid,
  invited_by_email      text,
  expires_at            timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  accepted_at           timestamptz,
  accepted_by_user_id   uuid,
  revoked_at            timestamptz,
  revoked_by            uuid
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_invites_role_chk') THEN
    ALTER TABLE public.user_invites
      ADD CONSTRAINT user_invites_role_chk CHECK (role IN ('admin', 'member'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_invites_state_chk') THEN
    ALTER TABLE public.user_invites
      ADD CONSTRAINT user_invites_state_chk CHECK (
        accepted_at IS NULL OR revoked_at IS NULL
      );
  END IF;
END $$;

-- Lookup by token (very common: invite-accept flow)
CREATE INDEX IF NOT EXISTS user_invites_token_idx ON public.user_invites(token);
-- Pending-invites-by-email index (the admin UI shows pending invites
-- per email so a re-invite can either revoke + re-create or just
-- bump the expiry).
CREATE INDEX IF NOT EXISTS user_invites_email_pending_idx
  ON public.user_invites(email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
