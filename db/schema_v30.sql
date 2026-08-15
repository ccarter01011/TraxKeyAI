-- v30: property onboarding profile + per-property inventory
--
-- Two related things, both about knowing a property well enough to answer
-- questions about it later.
--
-- property_profiles is the onboarding SOP made durable: the nuances an
-- owner knows and nobody writes down (where the water shutoff is, which
-- breaker trips, that the upstairs bath fan is loud but fine). Today that
-- knowledge lives in the operator's head, which means the AI cannot use it
-- and a new employee cannot either.
--
-- property_inventory is the digital twin: every item in the unit, what it
-- cost, where it was bought, warranty, and replacement link. It serves two
-- purposes now (replace-on-breakage, damage assessment) and is deliberately
-- the shared spine for the separate STR setup/procurement product described
-- in PLATFORM-ROADMAP.md.

SET search_path TO traxkey, public;

CREATE TABLE IF NOT EXISTS property_profiles (
  property_id uuid PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,

  -- Onboarding SOP sections. All optional: a half-filled profile is far
  -- more useful than an empty one, so nothing here is NOT NULL.
  year_built integer,
  square_feet integer,
  parking_notes text,
  access_notes text,            -- lockbox, gate code location, which door sticks
  utilities_notes text,         -- who pays what, account numbers live elsewhere
  water_shutoff_location text,
  electrical_panel_location text,
  hvac_type text,
  hvac_filter_size text,        -- the single most-asked maintenance question
  water_heater_notes text,
  appliance_notes text,
  known_quirks text,            -- "upstairs bath fan is loud, this is normal"
  wifi_notes text,              -- network name and where the router is, NOT the password
  trash_day text,
  pet_policy text,
  smoking_policy text,
  emergency_notes text,         -- gas shutoff, nearest hospital, flood history
  insurance_carrier text,
  insurance_policy_number text,
  insurance_deductible numeric(10,2),
  onboarding_completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_profiles_company_idx
  ON property_profiles (company_id);

CREATE TABLE IF NOT EXISTS property_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  -- Null unit_id means the item belongs to the whole property (patio set,
  -- shared laundry) rather than one unit.
  unit_id uuid REFERENCES units(id) ON DELETE SET NULL,

  room text,                    -- kitchen, primary bedroom, patio
  name text NOT NULL,
  category text NOT NULL DEFAULT 'ffe'
    CHECK (category IN ('ffe', 'ose', 'appliance', 'safety')),
  quantity integer NOT NULL DEFAULT 1,

  brand text,
  model_sku text,
  purchase_price numeric(10,2),
  purchased_on date,
  purchase_url text,
  warranty_expires_on date,
  replacement_url text,
  condition text NOT NULL DEFAULT 'good'
    CHECK (condition IN ('new', 'good', 'fair', 'poor', 'damaged', 'missing')),
  notes text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_inventory_property_idx
  ON property_inventory (property_id, room);
CREATE INDEX IF NOT EXISTS property_inventory_company_idx
  ON property_inventory (company_id);

-- Damage assessment on a maintenance request: is this a guest/tenant charge
-- or an insurance claim? TraxKey gathers the facts and recommends; a human
-- decides, because this is a money and liability call.
ALTER TABLE maintenance_requests
  ADD COLUMN IF NOT EXISTS damage_assessment jsonb;
