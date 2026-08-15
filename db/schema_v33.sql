-- v33: PriceLabs listing mapping
--
-- PriceLabs' pricing is always computed for a specific listing it already
-- has market history for, one that exists in the operator's real PMS/PriceLabs
-- account. A TraxKey unit and a PriceLabs listing are different records in
-- different systems, so this is the join: which real PriceLabs listing (if
-- any) does this unit correspond to. Null means "not connected," and the
-- pricing engine falls back to the heuristic for that unit.

SET search_path TO traxkey, public;

ALTER TABLE units ADD COLUMN IF NOT EXISTS pricelabs_listing_id text;

CREATE UNIQUE INDEX IF NOT EXISTS units_pricelabs_listing_idx
  ON units (pricelabs_listing_id) WHERE pricelabs_listing_id IS NOT NULL;
