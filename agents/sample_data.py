"""Seed a new account with a working sample portfolio, and remove it again.

The problem this solves: a brand new TraxKey account is an empty dashboard.
For a product whose entire value is the AI noticing things, an empty account
looks broken, there is nothing to notice. Buildium offers "use sample data to
see how it handles your real-world tasks" on their trial, and it is the best
idea on any of the competitor sites.

Everything created here is flagged `is_sample`, so removing it is one
statement rather than a scavenger hunt. Properties cascade to units,
residents, leases, turns and requests, so flagging the two roots is enough.

Deliberately seeds a MIXED portfolio, two long-term units and two short-term,
because that is the product's actual argument. A sample portfolio that was
all long-term would demo somebody else's product.
"""

import traceback

from db import db


def has_sample(company_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM traxkey.properties WHERE company_id = %s AND is_sample LIMIT 1",
            (company_id,),
        )
        return cur.fetchone() is not None


def has_real_data(company_id):
    """Real (non-sample) properties. Used to avoid dropping sample data on
    top of a portfolio someone has already started building, which would
    just be confusing."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM traxkey.properties WHERE company_id = %s AND NOT is_sample LIMIT 1",
            (company_id,),
        )
        return cur.fetchone() is not None


def seed(company_id):
    """Create the sample portfolio. Returns a short summary."""
    if has_sample(company_id):
        return {"ok": False, "error": "Sample data is already loaded."}

    with db() as conn, conn.cursor() as cur:
        # --- Long-term side ---
        cur.execute("""
            INSERT INTO traxkey.properties
              (company_id, name, address_line1, city, state, zip, property_type, is_sample)
            VALUES (%s, 'Sample: Oakview Duplex', '18 Oakview Rd', 'Austin', 'TX', '78704', 'duplex', true)
            RETURNING id
        """, (company_id,))
        ltr = cur.fetchone()["id"]

        cur.execute("""
            INSERT INTO traxkey.units (property_id, unit_number, bedrooms, bathrooms, status)
            VALUES (%s, 'A', 2, 1, 'occupied'), (%s, 'B', 2, 1, 'occupied')
            RETURNING id
        """, (ltr, ltr))
        ltr_units = [r["id"] for r in cur.fetchall()]

        # --- Short-term side ---
        cur.execute("""
            INSERT INTO traxkey.properties
              (company_id, name, address_line1, city, state, zip, property_type, is_sample)
            VALUES (%s, 'Sample: Lakeside Cottage', '92 Lakeside Dr', 'Austin', 'TX', '78703', 'single_family', true)
            RETURNING id
        """, (company_id,))
        str_prop = cur.fetchone()["id"]

        cur.execute("""
            INSERT INTO traxkey.units (property_id, unit_number, bedrooms, bathrooms, status)
            VALUES (%s, NULL, 2, 1, 'occupied') RETURNING id
        """, (str_prop,))
        str_unit = cur.fetchone()["id"]

        # --- Vendors with history, so ranking has something to rank ---
        vendors = {}
        for name, trade, jobs, resp, cost, rate, rating in [
            # completion_rate is 0-100, matching the real completion workflow
            # (TraxKey-08-Complete-Request.json) and what the dashboard
            # displays with `${Math.round(rate)}%`. A 0-1 fraction here
            # rounds to 0% or 1% on every card, which is how this bug shipped.
            ("Sample: Ace Appliance", "appliance", 38, 3.0, 240, 94, 4.7),
            ("Sample: TrueFlow Plumbing", "plumbing", 52, 2.5, 310, 96, 4.8),
            ("Sample: Nightowl HVAC", "hvac", 11, 14.0, 520, 72, 3.2),
            ("Sample: SparkleClean", "cleaning", 96, 1.5, 110, 98, 4.9),
        ]:
            cur.execute("""
                INSERT INTO traxkey.vendors (company_id, name, trade, contact_email, is_sample)
                VALUES (%s, %s, %s, 'vendor@example.com', true) RETURNING id
            """, (company_id, name, trade))
            vid = cur.fetchone()["id"]
            vendors[trade] = vid
            cur.execute("""
                INSERT INTO traxkey.vendor_performance
                  (vendor_id, jobs_completed, avg_response_hours, avg_cost, completion_rate, avg_rating)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (vid, jobs, resp, cost, rate, rating))

        # --- A long-term resident on a lease inside the renewal window, so
        # the leases page and the concierge both have something to say ---
        cur.execute("""
            INSERT INTO traxkey.leases
              (unit_id, start_date, end_date, rent_amount, deposit_amount, status)
            VALUES (%s, CURRENT_DATE - INTERVAL '11 months', CURRENT_DATE + INTERVAL '40 days', 1650, 1650, 'active')
            RETURNING id
        """, (ltr_units[0],))
        lease_id = cur.fetchone()["id"]

        cur.execute("""
            INSERT INTO traxkey.residents (unit_id, name, email, is_active, lease_id)
            VALUES (%s, 'Sample Resident (Dana Woods)', NULL, true, %s)
        """, (ltr_units[0], lease_id))

        # --- A short-term guest currently in the unit ---
        cur.execute("""
            INSERT INTO traxkey.residents
              (unit_id, name, email, is_active, checkin_date, checkout_date)
            VALUES (%s, 'Sample Guest (Ravi Patel)', NULL, true,
                    CURRENT_DATE - 1, CURRENT_DATE + 3)
        """, (str_unit,))

        # --- Requests across three states so the dashboard badges light up ---
        cur.execute("""
            INSERT INTO traxkey.maintenance_requests
              (company_id, unit_id, description, category, urgency, responsibility, status,
               assigned_vendor_id, quoted_cost, requires_human_approval, created_at)
            VALUES
              (%(c)s, %(u1)s, 'Dishwasher leaves standing water at the end of every cycle',
               'appliance', 'routine', 'owner', 'awaiting_approval', %(v_app)s, 610, true, now() - interval '2 hours'),
              (%(c)s, %(u2)s, 'Bathroom extractor fan is loud and barely pulling air',
               'general', 'routine', 'owner', 'needs_vendor', NULL, NULL, false, now() - interval '1 day'),
              (%(c)s, %(us)s, 'Air conditioning stopped cooling, guest is in the unit now',
               'hvac', 'urgent', 'owner', 'scheduled', %(v_hvac)s, 480, false, now() - interval '4 hours')
        """, {"c": company_id, "u1": ltr_units[0], "u2": ltr_units[1], "us": str_unit,
              "v_app": vendors["appliance"], "v_hvac": vendors["hvac"]})

        # --- An open cleaning turn on the short-term unit ---
        cur.execute("""
            INSERT INTO traxkey.turns
              (company_id, unit_id, status, turn_type, auto_created, deadline_at)
            VALUES (%s, %s, 'inspecting', 'cleaning', true, CURRENT_DATE + 3)
            RETURNING id
        """, (company_id, str_unit))
        turn_id = cur.fetchone()["id"]
        cur.execute("""
            INSERT INTO traxkey.turn_events (turn_id, event_type, content)
            VALUES (%s, 'vacancy_started', 'Sample turn: next guest arrives in 3 days.')
        """, (turn_id,))

    return {"ok": True, "message": "Sample portfolio loaded: 2 long-term units, 1 short-term, 4 vendors, 3 requests."}


def remove(company_id):
    """Delete everything flagged is_sample for this company."""
    with db() as conn, conn.cursor() as cur:
        # Requests reference units via ON DELETE CASCADE, but they also
        # reference vendors with ON DELETE NO ACTION, so clear the sample
        # requests before the vendors they point at.
        cur.execute("""
            DELETE FROM traxkey.maintenance_requests mr
            USING traxkey.units u, traxkey.properties p
            WHERE mr.unit_id = u.id AND u.property_id = p.id
              AND p.company_id = %s AND p.is_sample
        """, (company_id,))
        cur.execute("DELETE FROM traxkey.properties WHERE company_id = %s AND is_sample", (company_id,))
        cur.execute("DELETE FROM traxkey.vendors WHERE company_id = %s AND is_sample", (company_id,))
    return {"ok": True, "message": "Sample data removed."}
