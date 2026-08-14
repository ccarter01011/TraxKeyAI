-- TraxKey AI — schema v22: vendor performance history
--
-- vendor_performance is a rolling snapshot with one row per vendor and no
-- history, so "when did this vendor start slowing down" is unanswerable
-- today. That question is the single most useful thing Portfolio Insights
-- can tell an operator, because a vendor degrading over months is invisible
-- job-to-job and obvious in a trend.
--
-- Appended weekly by the worker. Deliberately append-only: a corrected
-- history is not a history.

SET search_path TO traxkey;

CREATE TABLE vendor_performance_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  captured_at date NOT NULL DEFAULT CURRENT_DATE,

  jobs_completed integer,
  avg_response_hours numeric,
  avg_cost numeric,
  completion_rate numeric,
  avg_rating numeric,

  -- One snapshot per vendor per day. The worker runs hourly, so without
  -- this it would write 24 identical rows a day and the trend would be
  -- noise rather than signal.
  UNIQUE (vendor_id, captured_at)
);

CREATE INDEX vpo_history_vendor_idx ON vendor_performance_history (vendor_id, captured_at DESC);
