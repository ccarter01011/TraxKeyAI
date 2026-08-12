-- TraxKey AI — schema v7
-- Vendor portal: vendors are a different kind of principal than a
-- company's own users (sessions/users tables), scoped per-vendor-row
-- rather than a global identity. A real-world vendor working for two
-- companies gets two separate vendor rows/logins today, a known
-- simplification, not a bug, revisit if it matters in practice.

SET search_path TO traxkey;

ALTER TABLE vendors ADD COLUMN password_hash text;
ALTER TABLE vendors ADD COLUMN portal_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE vendor_sessions (
  token text PRIMARY KEY,
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
