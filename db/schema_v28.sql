-- TraxKey AI — schema v28: feature suggestions
--
-- A suggestion box inside the app, matching TraxSail's. The point of putting
-- it in the app rather than on the marketing site is that the customer's
-- identity comes from their session, so they type an idea and nothing else.
-- Asking a paying customer to re-enter their name and email to tell you how
-- to improve your product is a good way to get fewer suggestions.

SET search_path TO traxkey;

CREATE TABLE suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Captured automatically from the session. Nullable because a company
  -- could be deleted later and the idea is still worth keeping.
  company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Denormalised on purpose: if the account goes away we still want to know
  -- who asked, so we can tell them if we ever build it.
  submitted_by_name text,
  submitted_by_email text,
  company_name text,

  subject text NOT NULL,
  message text,

  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'considering', 'planned', 'built', 'declined')),
  -- Internal note for triage. Never shown to the customer.
  admin_note text,

  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (length(trim(subject)) > 0)
);

CREATE INDEX suggestions_status_idx ON suggestions (status, created_at DESC);
CREATE INDEX suggestions_company_idx ON suggestions (company_id);
