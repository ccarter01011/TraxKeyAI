-- TraxKey AI — schema v21: sample data flag
--
-- Buildium's best idea, borrowed: "no credit card, use sample data to see
-- how it handles your real-world tasks." A brand new TraxKey account is an
-- empty dashboard, which is the worst possible first impression for a
-- product whose whole value is the AI noticing things. With nothing to
-- notice, it looks broken.
--
-- The flag exists so the operator can remove it in one click when they are
-- ready for real data. Marking the two roots is enough: properties cascade
-- to units, residents, leases, turns, and requests.

SET search_path TO traxkey;

ALTER TABLE properties ADD COLUMN is_sample boolean NOT NULL DEFAULT false;
ALTER TABLE vendors    ADD COLUMN is_sample boolean NOT NULL DEFAULT false;

CREATE INDEX properties_sample_idx ON properties (company_id) WHERE is_sample;
CREATE INDEX vendors_sample_idx    ON vendors (company_id)    WHERE is_sample;
