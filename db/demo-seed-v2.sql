-- Richer demo data for Sunset Property Management (Alex Rivera's account).
-- Mixed portfolio: adds a second LTR unit, a fourth STR unit, and a whole
-- new short-term property, plus leases, vendor history, varied maintenance
-- states, bookings, and one review risk. Every date is relative to today
-- (2026-08-13) so the automation acts on it exactly like real data.

DO $$
DECLARE
  cid uuid := 'ad12cc61-1e7b-4a12-b9a6-5f55f7eef41b';
  p_riverside uuid := 'e6595e27-c623-4489-bdcc-5713cabbd47a';
  u_maple uuid := '4ecec5f1-db49-4d80-8a20-e0001ed0edc2';
  u_riv_a uuid := '912cdfb0-ac3a-4a2c-80cd-dccbb9600933';
  u_riv_b uuid := '5dab6b33-1116-48bf-a53c-2323eaa4e323';
  u_riv_c uuid;
  u_riv_d uuid;
  p_hillcrest uuid;
  u_hillcrest uuid;
  v_plumbing uuid := 'c17753a3-1398-4d04-9b4f-19dcfccbc806';
  v_hvac uuid := '4e19d018-cdcd-4c76-8abe-de66068ee36d';
  v_electric uuid := '8b7a3f80-c49f-440f-a289-b8b9fe8eaeb1';
  v_cleaning uuid;
  r_morgan uuid := '11984510-0a69-4382-a2a0-22ef959b0381';
  r_jordan uuid := 'bae46126-2af8-4f06-a436-ef9eff0c2952';
  r_priya uuid;
  r_repeat_guest uuid;
  lease_maple uuid;
  lease_riv_a uuid;
  lease_riv_c uuid;
  cal_riv_b uuid;
  cal_riv_d uuid;
  cal_hillcrest uuid;
  turn_riv_d uuid;
BEGIN

  -- ============================================================ PROPERTIES
  INSERT INTO traxkey.properties (id, company_id, name, address_line1, city, state, zip, property_type)
  VALUES (gen_random_uuid(), cid, 'Hillcrest Cottage', '410 Hillcrest Ave', 'Austin', 'TX', '78704', 'single_family')
  RETURNING id INTO p_hillcrest;

  INSERT INTO traxkey.units (id, property_id, unit_number, bedrooms, bathrooms, status)
  VALUES (gen_random_uuid(), p_hillcrest, NULL, 2, 1, 'occupied')
  RETURNING id INTO u_hillcrest;

  -- Riverside is a fourplex; it only had A and B on file. Rounding it out.
  INSERT INTO traxkey.units (id, property_id, unit_number, bedrooms, bathrooms, status)
  VALUES (gen_random_uuid(), p_riverside, 'C', 2, 1, 'occupied')
  RETURNING id INTO u_riv_c;

  INSERT INTO traxkey.units (id, property_id, unit_number, bedrooms, bathrooms, status)
  VALUES (gen_random_uuid(), p_riverside, 'D', 1, 1, 'occupied')
  RETURNING id INTO u_riv_d;

  -- ================================================================ VENDORS
  INSERT INTO traxkey.vendors (id, company_id, name, trade, contact_phone, contact_email)
  VALUES (gen_random_uuid(), cid, 'Fresh Start Cleaning Co', 'cleaning', '512-555-0148', 'dispatch@freshstart.example')
  RETURNING id INTO v_cleaning;

  INSERT INTO traxkey.vendor_performance (vendor_id, jobs_completed, avg_response_hours, avg_cost, completion_rate, avg_rating) VALUES
    (v_plumbing, 14, 3.5, 310, 0.93, 4.6),
    (v_hvac,     9,  11.0, 480, 0.78, 3.4),  -- slow and pricier, shows up as the weak link
    (v_electric, 6,  2.1,  240, 1.00, 4.9),  -- the standout
    (v_cleaning, 22, 1.8,  95,  0.95, 4.7)
  ON CONFLICT (vendor_id) DO UPDATE SET
    jobs_completed = EXCLUDED.jobs_completed, avg_response_hours = EXCLUDED.avg_response_hours,
    avg_cost = EXCLUDED.avg_cost, completion_rate = EXCLUDED.completion_rate, avg_rating = EXCLUDED.avg_rating;

  -- =============================================================== LEASES
  INSERT INTO traxkey.leases (id, unit_id, start_date, end_date, rent_amount, deposit_amount, rent_due_day, notice_days, status)
  VALUES (gen_random_uuid(), u_maple, CURRENT_DATE - INTERVAL '10 months', CURRENT_DATE + INTERVAL '45 days', 2100, 2100, 1, 30, 'active')
  RETURNING id INTO lease_maple;

  INSERT INTO traxkey.leases (id, unit_id, start_date, end_date, rent_amount, deposit_amount, rent_due_day, notice_days, status)
  VALUES (gen_random_uuid(), u_riv_a, CURRENT_DATE - INTERVAL '4 months', CURRENT_DATE + INTERVAL '200 days', 1450, 1450, 1, 30, 'active')
  RETURNING id INTO lease_riv_a;

  -- This one is inside the 90-day renewal window on purpose, the sharpest
  -- item on the leases page and something the concierge can point at.
  INSERT INTO traxkey.leases (id, unit_id, start_date, end_date, rent_amount, deposit_amount, rent_due_day, notice_days, status)
  VALUES (gen_random_uuid(), u_riv_c, CURRENT_DATE - INTERVAL '11 months', CURRENT_DATE + INTERVAL '18 days', 1500, 1500, 5, 30, 'active')
  RETURNING id INTO lease_riv_c;

  -- ============================================================= RESIDENTS
  INSERT INTO traxkey.residents (id, unit_id, name, email, phone, is_active, lease_id)
  VALUES (gen_random_uuid(), u_riv_c, 'Priya Nair', 'priya.nair@example.com', '512-555-0119', true, lease_riv_c)
  RETURNING id INTO r_priya;

  UPDATE traxkey.residents SET lease_id = lease_riv_a WHERE id = r_morgan;
  UPDATE traxkey.residents SET lease_id = lease_maple WHERE id = r_jordan;

  INSERT INTO traxkey.residents (id, unit_id, name, email, phone, is_active, checkin_date, checkout_date)
  VALUES (gen_random_uuid(), u_hillcrest, 'Devon Marsh', 'devon.marsh@example.com', '214-555-0177', true,
          CURRENT_DATE + INTERVAL '2 days', CURRENT_DATE + INTERVAL '6 days')
  RETURNING id INTO r_repeat_guest;

  -- A guest flagged for human review: three low-severity requests in one
  -- short stay. The operator's judgment call, not the software's, per the
  -- design note in graph.py.
  INSERT INTO traxkey.residents (id, unit_id, name, email, phone, is_active, checkin_date, checkout_date,
                                  requires_human_review, review_reason, flagged_at)
  VALUES (gen_random_uuid(), u_riv_d, 'Casey Tran', 'casey.tran@example.com', '972-555-0163', true,
          CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE + INTERVAL '4 days',
          true, 'Three requests in three days, all minor (lightbulb, remote batteries, wifi password). Watching before assuming anything.',
          now() - INTERVAL '1 day');

  -- =========================================================== MAINTENANCE
  INSERT INTO traxkey.maintenance_requests
    (id, company_id, unit_id, resident_id, description, category, urgency, responsibility, status, created_at)
  VALUES
    (gen_random_uuid(), cid, u_riv_d, NULL,
     'Guest reports the kitchen sink garbage disposal jammed, makes a humming noise but does not turn',
     'appliance', 'routine', 'owner', 'submitted', now() - INTERVAL '3 hours'),

    (gen_random_uuid(), cid, u_hillcrest, NULL,
     'Smoke detector in the hallway chirping every 30 seconds, likely low battery',
     'general', 'routine', 'owner', 'submitted', now() - INTERVAL '6 hours'),

    (gen_random_uuid(), cid, u_riv_c, r_priya,
     'No hot water anywhere in the unit as of this morning',
     'plumbing', 'emergency', 'owner', 'triaged', now() - INTERVAL '1 hour');

  -- Needs a vendor: nobody on file does locksmith work, a real, visible gap.
  INSERT INTO traxkey.maintenance_requests
    (id, company_id, unit_id, resident_id, description, category, urgency, responsibility, status, created_at)
  VALUES
    (gen_random_uuid(), cid, u_riv_a, r_morgan,
     'Front door deadbolt is sticking badly, key turns but the bolt does not fully retract',
     'locksmith', 'urgent', 'owner', 'needs_vendor', now() - INTERVAL '1 day');

  -- Awaiting approval: unknown vendor cost, so it correctly stopped for a
  -- human rather than auto-approving at $0.
  INSERT INTO traxkey.maintenance_requests
    (id, company_id, unit_id, resident_id, description, category, urgency, responsibility, status,
     assigned_vendor_id, quoted_cost, requires_human_approval, created_at)
  VALUES
    (gen_random_uuid(), cid, u_hillcrest, NULL,
     'Dishwasher not draining, standing water at the end of every cycle',
     'appliance', 'routine', 'owner', 'awaiting_approval',
     v_hvac, 610, true, now() - INTERVAL '2 days');

  -- In progress: dispatched and moving.
  INSERT INTO traxkey.maintenance_requests
    (id, company_id, unit_id, resident_id, description, category, urgency, responsibility, status,
     assigned_vendor_id, quoted_cost, created_at)
  VALUES
    (gen_random_uuid(), cid, u_riv_b, NULL,
     'Bathroom exhaust fan is very loud and vibrating',
     'electrical', 'routine', 'owner', 'in_progress',
     v_electric, 180, now() - INTERVAL '4 days');

  -- ================================================================ TURNS
  -- Same-day turnaround on Riverside D: checkout and next check-in the same
  -- day, exactly the case occupancy-aware urgency exists for.
  INSERT INTO traxkey.turns (id, company_id, unit_id, status, turn_type, auto_created, deadline_at, vacancy_started_at)
  VALUES (gen_random_uuid(), cid, u_riv_d, 'inspecting', 'cleaning', true,
          CURRENT_DATE, now() - INTERVAL '3 hours')
  RETURNING id INTO turn_riv_d;
  INSERT INTO traxkey.turn_events (turn_id, event_type, content)
  VALUES (turn_riv_d, 'vacancy_started', 'Same-day turnaround: next guest checks in today. Cleaning flagged urgent automatically.');

  -- =========================================================== CALENDARS
  INSERT INTO traxkey.unit_calendars (id, unit_id, source, ical_url, last_sync_error)
  VALUES (gen_random_uuid(), u_riv_b, 'airbnb', 'https://www.airbnb.com/calendar/ical/demo-riverside-b.ics',
          'Demo calendar, not a live feed')
  RETURNING id INTO cal_riv_b;

  INSERT INTO traxkey.unit_calendars (id, unit_id, source, ical_url, last_sync_error)
  VALUES (gen_random_uuid(), u_riv_d, 'airbnb', 'https://www.airbnb.com/calendar/ical/demo-riverside-d.ics',
          'Demo calendar, not a live feed')
  RETURNING id INTO cal_riv_d;

  INSERT INTO traxkey.unit_calendars (id, unit_id, source, ical_url, last_sync_error)
  VALUES (gen_random_uuid(), u_hillcrest, 'vrbo', 'https://www.vrbo.com/calendar/ical/demo-hillcrest.ics',
          'Demo calendar, not a live feed')
  RETURNING id INTO cal_hillcrest;

  INSERT INTO traxkey.bookings (unit_id, calendar_id, external_uid, checkin_date, checkout_date, guest_label) VALUES
    (u_riv_b, cal_riv_b, 'demo-rb-1', CURRENT_DATE + 9, CURRENT_DATE + 13, 'Guest booking'),
    (u_riv_b, cal_riv_b, 'demo-rb-2', CURRENT_DATE + 20, CURRENT_DATE + 24, 'Guest booking'),
    -- The turned-over stay: same checkout/checkin day as the turn above.
    (u_riv_d, cal_riv_d, 'demo-rd-prev', CURRENT_DATE - 4, CURRENT_DATE, 'Casey Tran'),
    (u_riv_d, cal_riv_d, 'demo-rd-next', CURRENT_DATE, CURRENT_DATE + 5, 'Guest booking'),
    (u_hillcrest, cal_hillcrest, 'demo-hc-current', CURRENT_DATE + 2, CURRENT_DATE + 6, 'Devon Marsh'),
    (u_hillcrest, cal_hillcrest, 'demo-hc-block', CURRENT_DATE + 7, CURRENT_DATE + 9, 'Owner block, not available');
  UPDATE traxkey.bookings SET is_blocked = true WHERE external_uid = 'demo-hc-block';

  -- ======================================================== REVIEW RISK
  -- Flags a stay where a maintenance issue landed close to checkout, still
  -- unacknowledged, exactly the signal the feature exists to surface.
  INSERT INTO traxkey.review_risks (company_id, unit_id, checkout_date, severity, reason, suggested_outreach)
  VALUES (cid, u_riv_d, CURRENT_DATE,
          'medium',
          'A maintenance request was opened during the stay and the guest checked out before it was confirmed resolved.',
          'A short, no-excuses check-in message after checkout: ask how the stay went and mention the fix is already scheduled before they leave a review.');

END $$;
