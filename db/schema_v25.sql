-- TraxKey AI — schema v25: owner portal
--
-- Owners are the property manager's own customer. Today TraxKey holds
-- everything an owner wants to know (what broke, what it cost, whether the
-- unit is occupied) and gives them no way to see any of it, so the manager
-- answers those questions by hand.
--
-- This is the FIFTH auth principal. users, vendors, admins, and now owners
-- each have their own table and their own session store, deliberately never
-- shared. A stolen owner token must be useless everywhere else.
--
-- Password hashing matches every other principal: pgcrypto crypt() with
-- gen_salt('bf'). Same mechanism as users and vendors, verified against
-- TraxKey-01-Auth and TraxKey-09-Vendor-Portal before writing this.

SET search_path TO traxkey;

ALTER TABLE owners ADD COLUMN password_hash text;
-- Off by default. An owner only gets access when the manager decides,
-- exactly like vendors.
ALTER TABLE owners ADD COLUMN portal_enabled boolean NOT NULL DEFAULT false;

-- An owner's email is how they log in, so it has to be unique. Partial,
-- because an owner record with no email is perfectly valid, they just
-- cannot sign in.
CREATE UNIQUE INDEX owners_email_unique ON owners (lower(email))
  WHERE email IS NOT NULL;

CREATE TABLE owner_sessions (
  token text PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX owner_sessions_owner_idx ON owner_sessions (owner_id);
