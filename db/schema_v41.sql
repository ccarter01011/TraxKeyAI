-- v41: remove the PriceLabs integration
--
-- TraxKey now prices every unit with its own heuristic/market-comp engine
-- (pricing_engine.py) and no longer integrates with PriceLabs at all. Drops
-- the listing-mapping column and index. 'pricelabs' is left in the
-- unit_nightly_rates.source CHECK constraint (schema_v34.sql) rather than
-- removed: any row already written with that source is historical record,
-- and rewriting the constraint to exclude it would fail outright if even
-- one such row exists. The application code no longer produces that value,
-- which is the part that actually matters going forward.

SET search_path TO traxkey, public;

DROP INDEX IF EXISTS units_pricelabs_listing_idx;
ALTER TABLE units DROP COLUMN IF EXISTS pricelabs_listing_id;
