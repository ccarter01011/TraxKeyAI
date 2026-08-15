-- v34: allow 'market_heuristic' as a nightly-rate source
--
-- The AirROI-informed heuristic (pricing_engine.MarketHeuristicProvider) is
-- a distinct source from the plain heuristic: it blends comp-set market data
-- into the rule-of-thumb calculation. Recording it separately is the whole
-- point of the `source` column being vendor-agnostic (see schema_v31) —
-- an operator looking at last month's rates should be able to tell which
-- nights had market data behind them and which were rules alone.

SET search_path TO traxkey, public;

ALTER TABLE unit_nightly_rates DROP CONSTRAINT IF EXISTS unit_nightly_rates_source_check;

ALTER TABLE unit_nightly_rates ADD CONSTRAINT unit_nightly_rates_source_check
  CHECK (source IN ('heuristic', 'market_heuristic', 'manual',
                    'pricelabs', 'beyond', 'wheelhouse'));
