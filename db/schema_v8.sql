-- TraxKey AI — schema v8
-- Password reset for company users (property managers). Vendor password
-- reset isn't built, vendors are a small enough set for now that a
-- property manager can just re-enable portal access with a new password.

SET search_path TO traxkey;

ALTER TABLE users ADD COLUMN reset_token text;
ALTER TABLE users ADD COLUMN reset_token_expires_at timestamptz;
