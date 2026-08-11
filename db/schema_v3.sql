-- TraxKey AI — schema v3
-- Adds: a per-company portal slug (so the public tenant intake form knows
-- which company a submission belongs to, via a link like
-- tenant.traxkey.ai/?co=SLUG that the PM company shares with residents),
-- and loosens maintenance_requests so a raw, unmatched submission can be
-- stored before Property/Unit data entry exists to resolve it to a real
-- unit. Address-to-unit matching is a real next step, not built yet, this
-- just makes sure no submission is lost in the meantime.

SET search_path TO traxkey;

ALTER TABLE companies ADD COLUMN portal_slug text UNIQUE;
UPDATE companies SET portal_slug = substr(md5(random()::text), 1, 8) WHERE portal_slug IS NULL;
ALTER TABLE companies ALTER COLUMN portal_slug SET NOT NULL;

ALTER TABLE maintenance_requests ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE maintenance_requests ADD COLUMN address_text text; -- raw tenant-submitted address, until matched to a real unit
ALTER TABLE maintenance_requests ADD COLUMN submitter_name text;
ALTER TABLE maintenance_requests ADD COLUMN submitter_phone text;
