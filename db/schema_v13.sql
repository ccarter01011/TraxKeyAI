-- TraxKey AI — schema v13
-- Review-risk flagging. When a guest had an unresolved (or slowly resolved)
-- issue during their stay, that's a bad review about to happen. We're the
-- only system that knows both "a guest was physically here" and "their issue
-- wasn't handled", because we hold the booking calendar and the maintenance
-- history together.
--
-- For an STR operator, one prevented 3-star review is worth more than a
-- year of subscription.

SET search_path TO traxkey;

CREATE TABLE review_risks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  checkout_date date NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low','medium','high')),
  -- Plain-language explanation of why this was flagged. Deterministic,
  -- assembled from the facts, not model output.
  reason text NOT NULL,
  request_ids uuid[] NOT NULL DEFAULT '{}',
  -- AI-drafted outreach the operator can send. Suggestion only, never sent
  -- automatically: apologising to a guest is a judgment call and a brand
  -- decision, not something to automate behind someone's back.
  suggested_outreach text,
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One risk per booking, so repeat worker passes can't duplicate.
CREATE UNIQUE INDEX review_risks_booking_idx ON review_risks (booking_id)
  WHERE booking_id IS NOT NULL;
CREATE INDEX review_risks_company_idx ON review_risks (company_id, acknowledged_at);
