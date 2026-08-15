"""Dynamic pricing suggestions for direct-booked units, vendor-agnostic.

No revenue-management vendor is wired up yet. PriceLabs has no MCP
connector and their REST API is account-gated, so this ships with a
HeuristicProvider standing in for a real one. The interface is the point:
swapping in PriceLabs, Beyond, or Wheelhouse later means writing one new
Provider class and changing PROVIDER, nothing about the schema, the routes,
or the UI changes.

    provider = PROVIDERS[PROVIDER]
    suggestions = provider.suggest(unit, date_range, occupancy_context)

Every suggestion records `factors`, in plain language, so an operator (or a
future us) can see why a night was priced the way it was without reading
the algorithm. That matters more for a stand-in heuristic than it would for
a real vendor: nobody should mistake this for market intelligence.
"""

import json
import os
from datetime import date, timedelta

from db import db

PROVIDER = os.environ.get("PRICING_PROVIDER", "heuristic")


class HeuristicProvider:
    """Not real revenue management. A deterministic stand-in: base rate,
    adjusted for day-of-week demand, how far out the date is, and how full
    the property already is that week. Every factor is named in the output
    so it's never mistaken for market data TraxKey doesn't have."""

    name = "heuristic"

    WEEKEND_LIFT = 0.18       # Fri/Sat nights command more, this is a rule of
                              # thumb, not a fitted model.
    LAST_MINUTE_DISCOUNT = 0.12   # inside 3 days, a discount beats an empty night
    LAST_MINUTE_WINDOW_DAYS = 3
    FAR_OUT_PREMIUM = 0.08    # booked 60+ days out, demand is proven; hold price
    FAR_OUT_WINDOW_DAYS = 60
    HIGH_OCCUPANCY_LIFT = 0.15     # property's week is >70% booked already
    LOW_OCCUPANCY_DISCOUNT = 0.10  # property's week is <30% booked

    def suggest(self, unit, stay_date, occupancy_pct, today=None):
        today = today or date.today()
        base = float(unit["base_nightly_rate"] or 100)
        rate = base
        factors = [f"Base rate ${base:.0f}"]

        if stay_date.weekday() in (4, 5):  # Fri, Sat
            rate *= (1 + self.WEEKEND_LIFT)
            factors.append(f"Weekend night, +{self.WEEKEND_LIFT*100:.0f}%")

        days_out = (stay_date - today).days
        if 0 <= days_out <= self.LAST_MINUTE_WINDOW_DAYS:
            rate *= (1 - self.LAST_MINUTE_DISCOUNT)
            factors.append(f"{days_out} days out, last-minute discount -{self.LAST_MINUTE_DISCOUNT*100:.0f}%")
        elif days_out >= self.FAR_OUT_WINDOW_DAYS:
            rate *= (1 + self.FAR_OUT_PREMIUM)
            factors.append(f"Booked {days_out} days out, demand holds firm +{self.FAR_OUT_PREMIUM*100:.0f}%")

        if occupancy_pct is not None:
            if occupancy_pct >= 70:
                rate *= (1 + self.HIGH_OCCUPANCY_LIFT)
                factors.append(f"Property {occupancy_pct:.0f}% booked this week, +{self.HIGH_OCCUPANCY_LIFT*100:.0f}%")
            elif occupancy_pct <= 30:
                rate *= (1 - self.LOW_OCCUPANCY_DISCOUNT)
                factors.append(f"Property only {occupancy_pct:.0f}% booked this week, -{self.LOW_OCCUPANCY_DISCOUNT*100:.0f}%")

        return round(rate, 2), factors


PROVIDERS = {"heuristic": HeuristicProvider()}


def _week_occupancy(cur, unit_id, sibling_units, stay_date):
    """Booked nights across the whole property in the 7-day window centered
    on stay_date, direct reservations plus synced iCal bookings. This is
    what a real vendor would call 'comp set' demand; here it's just the
    property's own week, which is the only demand signal TraxKey actually
    has. Takes an open cursor rather than opening its own connection, since
    it's called once per night in a loop and a connection per call does not
    scale."""
    if not sibling_units:
        return None
    start = stay_date - timedelta(days=3)
    end = stay_date + timedelta(days=3)
    total_nights = len(sibling_units) * 7
    cur.execute(
        """
        SELECT COALESCE(sum(
          LEAST(checkout_date, %(end)s) - GREATEST(checkin_date, %(start)s)
        ), 0) AS booked
        FROM (
          SELECT checkin_date, checkout_date FROM traxkey.direct_reservations
          WHERE unit_id = ANY(%(units)s) AND status = 'confirmed'
            AND checkin_date <= %(end)s AND checkout_date >= %(start)s
          UNION ALL
          SELECT checkin_date, checkout_date FROM traxkey.bookings
          WHERE unit_id = ANY(%(units)s)
            AND checkin_date <= %(end)s AND checkout_date >= %(start)s
        ) x
        """,
        {"units": sibling_units, "start": start, "end": end},
    )
    booked = cur.fetchone()["booked"] or 0
    return round(booked / total_nights * 100, 1) if total_nights else None


def suggest_rates(company_id, unit_id, start_date, end_date):
    """Compute and store a suggestion for every night in the range, on a
    single connection. Returns the rows written, dates as ISO strings for
    JSON."""
    provider = PROVIDERS[PROVIDER]
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.id, u.base_nightly_rate, u.property_id
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE u.id = %s::uuid AND p.company_id = %s
            """,
            (unit_id, company_id),
        )
        unit = cur.fetchone()
        if not unit:
            return {"ok": False, "error": "Unit not found."}
        if not unit["base_nightly_rate"]:
            return {"ok": False, "error": "Set a base nightly rate for this unit first."}

        cur.execute("SELECT id FROM traxkey.units WHERE property_id = %s", (unit["property_id"],))
        sibling_units = [r["id"] for r in cur.fetchall()]

        out = []
        d = start_date
        while d <= end_date:
            occ = _week_occupancy(cur, unit_id, sibling_units, d)
            rate, factors = provider.suggest(unit, d, occ)
            cur.execute(
                """
                INSERT INTO traxkey.unit_nightly_rates
                  (unit_id, stay_date, base_rate, suggested_rate, source, factors)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (unit_id, stay_date) DO UPDATE
                  SET base_rate = EXCLUDED.base_rate,
                      suggested_rate = EXCLUDED.suggested_rate,
                      source = EXCLUDED.source,
                      factors = EXCLUDED.factors,
                      updated_at = now()
                RETURNING unit_id, stay_date, base_rate, suggested_rate, applied_rate, source, factors
                """,
                (unit_id, d, unit["base_nightly_rate"], rate, provider.name,
                 json.dumps(factors)),
            )
            out.append(dict(cur.fetchone()))
            d += timedelta(days=1)
    return {"ok": True, "rates": out}


def set_base_rate(company_id, unit_id, rate):
    """Set through the agents service rather than n8n, so this works without
    a second workflow-node edit: the n8n Get Properties+Units node was
    updated to read base_nightly_rate, but writing it doesn't need to route
    through n8n at all."""
    try:
        rate = float(rate)
    except (TypeError, ValueError):
        return {"ok": False, "error": "Rate must be a number."}
    if rate <= 0:
        return {"ok": False, "error": "Rate must be positive."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.units u
            SET base_nightly_rate = %s
            FROM traxkey.properties p
            WHERE u.id = %s::uuid AND u.property_id = p.id AND p.company_id = %s
            RETURNING u.id
            """,
            (rate, unit_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Unit not found."}


def apply_rate(company_id, unit_id, stay_date, rate):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.unit_nightly_rates
            SET applied_rate = %s, updated_at = now()
            WHERE unit_id = %s::uuid AND stay_date = %s
              AND EXISTS (SELECT 1 FROM traxkey.units u JOIN traxkey.properties p ON p.id = u.property_id
                          WHERE u.id = %s::uuid AND p.company_id = %s)
            RETURNING unit_id
            """,
            (rate, unit_id, stay_date, unit_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}


def get_calendar(company_id, unit_id, start_date, end_date):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT stay_date, base_rate, suggested_rate, applied_rate, source, factors
            FROM traxkey.unit_nightly_rates
            WHERE unit_id = %s::uuid AND stay_date BETWEEN %s AND %s
            ORDER BY stay_date
            """,
            (unit_id, start_date, end_date),
        )
        rates = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT id, guest_name, checkin_date, checkout_date, nightly_rate, status, source
            FROM traxkey.direct_reservations
            WHERE unit_id = %s::uuid AND status = 'confirmed'
              AND checkin_date <= %s AND checkout_date >= %s
            ORDER BY checkin_date
            """,
            (unit_id, end_date, start_date),
        )
        reservations = [dict(r) for r in cur.fetchall()]
    return {"rates": rates, "reservations": reservations}


def create_reservation(company_id, body):
    unit_id = (body.get("unitId") or "").strip()
    guest = (body.get("guestName") or "").strip()
    checkin = (body.get("checkinDate") or "").strip()
    checkout = (body.get("checkoutDate") or "").strip()
    rate = str(body.get("nightlyRate") or "").strip()
    if not (unit_id and guest and checkin and checkout and rate):
        return {"ok": False, "error": "Guest name, dates, and a nightly rate are all needed."}

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.direct_reservations
              (company_id, unit_id, guest_name, guest_email, checkin_date, checkout_date,
               nightly_rate, source, notes)
            SELECT p.company_id, u.id, %(guest)s, NULLIF(%(email)s, ''),
                   %(checkin)s::date, %(checkout)s::date, %(rate)s::numeric,
                   COALESCE(NULLIF(%(source)s, ''), 'direct'), NULLIF(%(notes)s, '')
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE u.id = %(unit)s::uuid AND p.company_id = %(c)s
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.direct_reservations dr
                WHERE dr.unit_id = %(unit)s::uuid AND dr.status = 'confirmed'
                  AND dr.checkin_date < %(checkout)s::date AND dr.checkout_date > %(checkin)s::date
              )
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.bookings b
                WHERE b.unit_id = %(unit)s::uuid
                  AND b.checkin_date < %(checkout)s::date AND b.checkout_date > %(checkin)s::date
              )
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.property_buyouts pb
                WHERE pb.property_id = p.id AND pb.status = 'confirmed'
                  AND pb.checkin_date < %(checkout)s::date AND pb.checkout_date > %(checkin)s::date
              )
            RETURNING id
            """,
            {"c": company_id, "unit": unit_id, "guest": guest,
             "email": (body.get("guestEmail") or "").strip(),
             "checkin": checkin, "checkout": checkout, "rate": rate,
             "source": (body.get("source") or "").strip(),
             "notes": (body.get("notes") or "").strip()},
        )
        row = cur.fetchone()
    if not row:
        return {"ok": False, "error": "Those dates overlap an existing reservation, an existing buyout, or the unit wasn't found."}
    return {"ok": True, "id": str(row["id"])}


def create_buyout(company_id, body):
    """A whole-property booking: every unit blocked for the range. Conflict
    check covers both individual unit reservations and iCal-synced bookings
    across every unit on the property, since a buyout is meaningless if one
    cabin is already spoken for."""
    prop = (body.get("propertyId") or "").strip()
    guest = (body.get("guestName") or "").strip()
    checkin = (body.get("checkinDate") or "").strip()
    checkout = (body.get("checkoutDate") or "").strip()
    rate = str(body.get("totalRate") or "").strip()
    if not (prop and guest and checkin and checkout and rate):
        return {"ok": False, "error": "Guest name, dates, and a total rate are all needed."}

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.property_buyouts
              (company_id, property_id, guest_name, guest_email, checkin_date, checkout_date, total_rate, notes)
            SELECT p.company_id, p.id, %(guest)s, NULLIF(%(email)s, ''),
                   %(checkin)s::date, %(checkout)s::date, %(rate)s::numeric, NULLIF(%(notes)s, '')
            FROM traxkey.properties p
            WHERE p.id = %(prop)s::uuid AND p.company_id = %(c)s
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.direct_reservations dr
                JOIN traxkey.units u ON u.id = dr.unit_id
                WHERE u.property_id = p.id AND dr.status = 'confirmed'
                  AND dr.checkin_date < %(checkout)s::date AND dr.checkout_date > %(checkin)s::date
              )
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.bookings b
                JOIN traxkey.units u ON u.id = b.unit_id
                WHERE u.property_id = p.id
                  AND b.checkin_date < %(checkout)s::date AND b.checkout_date > %(checkin)s::date
              )
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.property_buyouts pb
                WHERE pb.property_id = p.id AND pb.status = 'confirmed'
                  AND pb.checkin_date < %(checkout)s::date AND pb.checkout_date > %(checkin)s::date
              )
            RETURNING id
            """,
            {"c": company_id, "prop": prop, "guest": guest,
             "email": (body.get("guestEmail") or "").strip(),
             "checkin": checkin, "checkout": checkout, "rate": rate,
             "notes": (body.get("notes") or "").strip()},
        )
        row = cur.fetchone()
    if not row:
        return {"ok": False, "error": "At least one unit already has a reservation in that window, or the property wasn't found."}
    return {"ok": True, "id": str(row["id"])}


def list_buyouts(company_id, property_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, guest_name, checkin_date, checkout_date, total_rate, status
            FROM traxkey.property_buyouts
            WHERE company_id = %s AND property_id = %s::uuid AND status = 'confirmed'
            ORDER BY checkin_date
            """,
            (company_id, property_id),
        )
        return [dict(r) for r in cur.fetchall()]


def cancel_reservation(company_id, reservation_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.direct_reservations SET status='cancelled', updated_at=now() WHERE id=%s::uuid AND company_id=%s RETURNING id",
            (reservation_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}
