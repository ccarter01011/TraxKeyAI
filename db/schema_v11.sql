-- TraxKey AI — schema v11
-- Internal admin access (TraxKey staff, not customers). Deliberately a
-- separate table and session store from customer users/sessions so an admin
-- credential can never be confused for a company login, and vice versa.

SET search_path TO traxkey;

CREATE TABLE admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_sessions (
  token text PRIMARY KEY,
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
