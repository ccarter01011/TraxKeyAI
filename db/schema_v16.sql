-- TraxKey AI — schema v16: Marketing leads
--
-- Backs the "Ask a human" popup on the sales chatbot. The chatbot is
-- throttled and honest about gaps, but some prospects want a person, not an
-- AI, and the bot should hand them off cleanly rather than loop them.

SET search_path TO traxkey;

CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  company text,
  portfolio_size text,
  message text,
  -- Where on the site this came from, e.g. 'chat_ask_human', 'pricing_talk_to_us'.
  source text,
  contacted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX leads_created_idx ON leads (created_at DESC);
