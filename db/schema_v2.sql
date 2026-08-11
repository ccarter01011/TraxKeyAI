-- TraxKey AI — schema v2
-- Adds: property owners (the PM company's clients, distinct from the PM
-- company itself and from residents/tenants), and turn management (the
-- vacant-to-ready lifecycle, the general engine that also covers
-- Breezeway-style turnover scheduling without forcing STR-specific
-- concepts like bookings/guests into this MVP).

SET search_path TO traxkey;

-- The property owner: who the PM company (companies table) works FOR.
-- One owner can have many properties. Owner reporting reads from this.
CREATE TABLE owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text,
  phone text,
  portal_access_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE properties ADD COLUMN owner_id uuid REFERENCES owners(id);

-- One row per vacancy-to-ready cycle. Deliberately generalized: a
-- year-end lease turnover and a same-week STR cleaning turn are the same
-- shape here, only the timeline is different. vacancy_started_at /
-- unit_ready_at is what powers the "days vacant" KPI called out in the PRD.
CREATE TABLE turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  vacancy_started_at timestamptz NOT NULL DEFAULT now(),
  inspection_completed_at timestamptz,
  unit_ready_at timestamptz,
  new_resident_id uuid REFERENCES residents(id),
  status text NOT NULL DEFAULT 'vacancy_started' CHECK (
    status IN ('vacancy_started','inspecting','repairs_in_progress','ready','relisted','occupied')
  ),
  total_cost numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Links a turn to whatever maintenance_requests it generated (repairs,
-- cleaning, painting), reusing the vendor/dispatch engine instead of
-- duplicating it.
ALTER TABLE maintenance_requests ADD COLUMN turn_id uuid REFERENCES turns(id);

CREATE TABLE turn_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  event_type text NOT NULL, -- vacancy_started, inspection_scheduled, inspection_completed, repairs_identified, unit_ready, relisted, leased
  content text,
  created_at timestamptz NOT NULL DEFAULT now()
);
