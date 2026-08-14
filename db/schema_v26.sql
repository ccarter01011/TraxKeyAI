-- TraxKey AI — schema v26: owner password reset
--
-- Same shape as users.reset_token/reset_token_expires_at (schema_v8).
-- An owner who forgets their password has no other way in, they don't
-- have an operator login to fall back on.

SET search_path TO traxkey;

ALTER TABLE owners ADD COLUMN reset_token text;
ALTER TABLE owners ADD COLUMN reset_token_expires_at timestamptz;

CREATE UNIQUE INDEX owners_reset_token_idx ON owners (reset_token) WHERE reset_token IS NOT NULL;
