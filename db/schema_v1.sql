-- TraxKey AI — schema v1
-- Scope: AI Maintenance Coordinator MVP only. No leasing, accounting, or rent
-- collection tables yet, those come after this one workflow proves itself.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Isolated in its own schema, this Postgres instance also runs the
-- LangGraph Platform deployment (agent_*, agents_memory_* tables already
-- live in public). Keeping our app tables separate avoids any future
-- collision as that platform's own schema evolves.
CREATE SCHEMA IF NOT EXISTS traxkey;
SET search_path TO traxkey;

-- A property management company account (mirrors TraxSail's "businesses").
CREATE TABLE companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','starter','growth','scale')),
  plan_status text NOT NULL DEFAULT 'trialing' CHECK (plan_status IN ('trialing','active','past_due','cancelled')),
  tracking_email text NOT NULL UNIQUE,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  cost_approval_threshold numeric NOT NULL DEFAULT 500, -- above this, a human must approve dispatch
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','ops_manager','staff')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  address_line1 text NOT NULL,
  address_line2 text,
  city text NOT NULL,
  state text NOT NULL,
  zip text NOT NULL,
  property_type text NOT NULL CHECK (property_type IN ('single_family','duplex','apartment','multifamily')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_number text, -- null for single-family, the whole property is the unit
  bedrooms int,
  bathrooms numeric,
  status text NOT NULL DEFAULT 'occupied' CHECK (status IN ('occupied','vacant')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE residents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  trade text NOT NULL, -- hvac, plumbing, electrical, appliance, general, pest, locksmith, roofing
  contact_email text,
  contact_phone text,
  emergency_available boolean NOT NULL DEFAULT false,
  service_zips text[], -- zip codes this vendor covers
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Rolling performance stats per vendor, per trade. Recomputed after every
-- closed request. This table IS the "vendor intelligence" differentiator,
-- surfaced directly on the customer dashboard as a scorecard.
CREATE TABLE vendor_performance (
  vendor_id uuid PRIMARY KEY REFERENCES vendors(id) ON DELETE CASCADE,
  jobs_completed int NOT NULL DEFAULT 0,
  avg_response_hours numeric,
  avg_cost numeric,
  completion_rate numeric, -- % of dispatched jobs actually completed
  avg_rating numeric, -- 1-5, from resident/PM feedback after close
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  resident_id uuid REFERENCES residents(id) ON DELETE SET NULL,
  description text NOT NULL, -- raw tenant-submitted text
  photo_urls text[],
  category text, -- hvac, plumbing, electrical, appliance, general, pest, locksmith, roofing — AI-classified
  urgency text CHECK (urgency IN ('emergency','urgent','routine')), -- AI-classified
  responsibility text CHECK (responsibility IN ('owner','tenant','unclear')), -- AI-determined
  status text NOT NULL DEFAULT 'submitted' CHECK (
    status IN ('submitted','triaged','assigned','scheduled','in_progress','on_hold','completed','closed')
  ),
  assigned_vendor_id uuid REFERENCES vendors(id),
  quoted_cost numeric,
  final_cost numeric,
  requires_human_approval boolean NOT NULL DEFAULT false, -- set true when quoted_cost > company.cost_approval_threshold
  approved_by uuid REFERENCES users(id),
  approved_at timestamptz,
  resident_rating int CHECK (resident_rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);

-- Full audit trail per request, same pattern as TraxSail's po_events —
-- every AI action and status change gets a row here, this is what powers
-- both the customer-facing timeline and the AI Workforce Activity feed.
CREATE TABLE maintenance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES maintenance_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- submitted, triaged, vendor_matched, quote_received, approval_needed, approved, dispatched, followed_up, verified, invoiced, closed
  content text,
  created_at timestamptz NOT NULL DEFAULT now()
);
