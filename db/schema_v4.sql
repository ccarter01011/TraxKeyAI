-- TraxKey AI — schema v4
-- Per-resident invite tokens. A resident's link (tenant.traxkey.ai/?token=X)
-- identifies the exact unit and company in one lookup, no free-text address
-- matching needed, and pre-fills the tenant's own name/phone. This replaces
-- the company-wide ?co= code as the primary path; ?co= stays as a fallback
-- for before residents are set up.

SET search_path TO traxkey;

ALTER TABLE residents ADD COLUMN access_token text UNIQUE;
UPDATE residents SET access_token = substr(md5(random()::text || id::text), 1, 16) WHERE access_token IS NULL;
ALTER TABLE residents ALTER COLUMN access_token SET DEFAULT substr(md5(random()::text || gen_random_uuid()::text), 1, 16);
