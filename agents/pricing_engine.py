"""Dynamic pricing suggestions for direct-booked units, vendor-agnostic.

Three providers exist, picked per-unit rather than globally:

    PriceLabsProvider   A unit mapped to a real PriceLabs listing (see
                        schema_v33.sql, units.pricelabs_listing_id) with
                        PRICELABS_API_KEY set. A finished rate, computed by
                        PriceLabs from real market history.

    MarketHeuristicProvider  AIRROI_API_KEY set and AirROI has comp data for
                        the property's market. The internal heuristic, then
                        pulled toward the comp-set average. AirROI returns
                        market *context* (an average nightly rate for the
                        market), not a finished per-night rate, so it blends
                        into the heuristic rather than replacing it.

    HeuristicProvider   Everything else. Deterministic stand-in: base rate
                        adjusted for weekend demand, lead time, and the
                        property's own occupancy that week.

The fallback chain matters: PriceLabs can only price a listing it already
has market history for, and AirROI only covers markets it tracks, so a
brand-new test unit in a thin market still gets a priced calendar instead
of an error.

    provider = pick_provider(unit)
    suggestions = provider.suggest(unit, date_range, occupancy_context)

Every suggestion records `factors`, in plain language, so an operator (or a
future us) can see why a night was priced the way it was without reading
the algorithm. That matters most for the heuristic: nobody should mistake a
rule-of-thumb calculation for market intelligence. When AirROI data is in
play the factors say so explicitly, and name the comp count behind it.
"""

import json
import os
from datetime import date, timedelta

from db import db
import airroi_client
import pricelabs_client


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


class MarketHeuristicProvider:
    """The heuristic, then pulled toward AirROI's comp-set average for the
    property's market.

    The pull is deliberately partial (COMP_WEIGHT below), not a jump to the
    comp average. The comp set is a whole market's average across every
    property type and quality level in it; this unit's base rate encodes
    what the operator knows about their own property that a market average
    cannot. Snapping straight to the market number would throw that away.
    The blend keeps the operator's base rate as the anchor and treats the
    comp average as evidence about which direction to lean.

    PULL_CAP exists because a thin or mismatched market (a luxury cabin in
    a market of budget condos) can produce a comp average far from anything
    sensible for this unit. Capping how far a single night can be moved
    keeps a bad market match from producing an absurd rate.
    """

    name = "market_heuristic"

    COMP_WEIGHT = 0.35   # how far toward the comp average a night is pulled
    PULL_CAP = 0.25      # never move a night more than 25% on comp data alone
    MIN_COMPS = 5        # below this, the market average isn't worth trusting

    def __init__(self):
        self._cache = {}        # "city|state" -> {"avg_rate": x, "listing_count": n}
        self._cache_error = {}  # "city|state" -> error string

    @staticmethod
    def _key(city, state):
        return f"{(city or '').strip().lower()}|{(state or '').strip().lower()}"

    def prefetch_market(self, city, state):
        """One lookup per property per run. The comp-set average is a market
        figure, so it doesn't change night to night the way occupancy does,
        and fetching it per night would be one billed API call per night."""
        key = self._key(city, state)
        if key in self._cache or key in self._cache_error:
            return
        result = airroi_client.get_market_comp(city, state)
        if not result.get("ok"):
            self._cache_error[key] = result.get("error", "Unknown AirROI error.")
            return
        count = result.get("listing_count")
        if count is not None and count < self.MIN_COMPS:
            self._cache_error[key] = (
                f"AirROI found only {count} active listings in this market, "
                f"too few to price against."
            )
            return
        self._cache[key] = result

    def suggest(self, unit, stay_date, occupancy_pct, today=None):
        rate, factors = PROVIDERS["heuristic"].suggest(unit, stay_date, occupancy_pct, today)

        market = self._cache.get(self._key(unit.get("city"), unit.get("state")))
        if not market:
            # No usable comp data for this market. The heuristic's own answer
            # still stands; say why the market layer didn't apply rather than
            # letting the operator assume comp data was used.
            reason = self._cache_error.get(self._key(unit.get("city"), unit.get("state")),
                                           "No AirROI market data for this property.")
            return rate, factors + [f"Market comparison unavailable: {reason}"]

        comp = market["avg_rate"]
        target = rate + (comp - rate) * self.COMP_WEIGHT
        capped = max(rate * (1 - self.PULL_CAP), min(rate * (1 + self.PULL_CAP), target))

        direction = "above" if comp > rate else "below"
        count = market.get("listing_count")
        detail = f" across {count} active listings" if count else ""
        # The matched market is named so a wrong match (AirROI resolving to a
        # different town of the same name) is visible in the UI rather than
        # silently priced against the wrong comp set.
        where = f" in {market['market_name']}" if market.get("market_name") else ""
        factors.append(
            f"Market comp average ${comp:.0f}{detail}{where}, {direction} this rate, "
            f"adjusted {(capped - rate) / rate * 100:+.0f}% toward it"
        )
        if abs(target - capped) > 0.01:
            factors.append(f"Adjustment capped at {self.PULL_CAP*100:.0f}% to limit a single market signal's pull")
        return round(capped, 2), factors


class PriceLabsProvider:
    """Real PriceLabs pricing, for a unit mapped to a real PriceLabs
    listing. Talks to the Customer API (api.pricelabs.co), not the MCP
    connector, see pricelabs_client.py's module docstring for why: MCP's
    OAuth flow needs a human in a browser, this runs unattended.

    suggest() here is shaped differently from HeuristicProvider's: PriceLabs
    prices a whole date range in one call rather than one night at a time,
    so the per-night loop in suggest_rates() below calls
    prefetch_range() once, then reads from the cached result.
    """

    name = "pricelabs"

    def __init__(self):
        self._cache = {}  # listing_id -> {date_iso: price}
        self._cache_error = {}  # listing_id -> error string

    def prefetch_range(self, listing_id, start_date, end_date):
        if listing_id in self._cache or listing_id in self._cache_error:
            return
        result = pricelabs_client.get_prices(listing_id, start_date, end_date)
        if not result.get("ok"):
            self._cache_error[listing_id] = result.get("error", "Unknown PriceLabs error.")
            return
        parsed, unparsed = pricelabs_client.parse_nightly_rates(result["data"])
        if unparsed:
            self._cache_error[listing_id] = (
                "Got a response from PriceLabs but couldn't parse it with the "
                "field names this integration expects. The response shape needs "
                "a one-time check against a real account, see pricelabs_client.py."
            )
            return
        self._cache[listing_id] = parsed

    def suggest(self, unit, stay_date, occupancy_pct, today=None):
        listing_id = unit.get("pricelabs_listing_id")
        if not listing_id:
            return None, ["No PriceLabs listing mapped to this unit."]
        if listing_id in self._cache_error:
            return None, [self._cache_error[listing_id]]
        rate = self._cache.get(listing_id, {}).get(stay_date.isoformat())
        if rate is None:
            return None, [f"PriceLabs has no price for {stay_date.isoformat()} on listing {listing_id}."]
        return round(float(rate), 2), ["Live PriceLabs recommendation for this listing and date."]


PROVIDERS = {
    "heuristic": HeuristicProvider(),
    "market_heuristic": MarketHeuristicProvider(),
    "pricelabs": PriceLabsProvider(),
}


def pick_provider(unit):
    """PriceLabs first when this unit is mapped to a real listing, then the
    AirROI-informed heuristic when that key is configured, then the plain
    heuristic. Decided per unit, not globally, since most units will never
    have a PriceLabs mapping regardless of whether the key is set.

    PriceLabs outranks AirROI because it returns a finished per-night rate
    computed from that specific listing's history; AirROI returns market
    context that still has to be blended with a rule of thumb."""
    if unit.get("pricelabs_listing_id") and pricelabs_client.is_configured():
        return PROVIDERS["pricelabs"]
    if airroi_client.is_configured():
        return PROVIDERS["market_heuristic"]
    return PROVIDERS["heuristic"]


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
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.id, u.base_nightly_rate, u.property_id, u.pricelabs_listing_id,
                   p.city, p.state
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

        provider = pick_provider(unit)
        heuristic = PROVIDERS["heuristic"]
        if provider.name == "pricelabs":
            provider.prefetch_range(unit["pricelabs_listing_id"], start_date, end_date)
        elif provider.name == "market_heuristic":
            provider.prefetch_market(unit["city"], unit["state"])

        cur.execute("SELECT id FROM traxkey.units WHERE property_id = %s", (unit["property_id"],))
        sibling_units = [r["id"] for r in cur.fetchall()]

        out = []
        d = start_date
        while d <= end_date:
            occ = _week_occupancy(cur, unit_id, sibling_units, d)
            rate, factors = provider.suggest(unit, d, occ)
            source = provider.name
            if rate is None:
                # PriceLabs had nothing for this specific night (not yet
                # synced, listing paused, etc). Fall back to the heuristic
                # for just this night rather than leaving it unpriced, and
                # say so, rather than silently passing off a guess as a
                # PriceLabs number.
                rate, h_factors = heuristic.suggest(unit, d, occ)
                factors = [f"PriceLabs unavailable for this night: {factors[0]}", "Used the internal heuristic instead."] + h_factors
                source = "heuristic"
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
                (unit_id, d, unit["base_nightly_rate"], rate, source,
                 json.dumps(factors)),
            )
            out.append(dict(cur.fetchone()))
            d += timedelta(days=1)
    return {"ok": True, "rates": out}


def set_pricelabs_listing(company_id, unit_id, listing_id):
    """Map (or unmap, if listing_id is blank) a TraxKey unit to a real
    PriceLabs listing. This is the join that lets suggest_rates use real
    PriceLabs data for this unit instead of the heuristic."""
    listing_id = (listing_id or "").strip() or None
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.units u
            SET pricelabs_listing_id = %s
            FROM traxkey.properties p
            WHERE u.id = %s::uuid AND u.property_id = p.id AND p.company_id = %s
            RETURNING u.id
            """,
            (listing_id, unit_id, company_id),
        )
        row = cur.fetchone()
    if not row:
        return {"ok": False, "error": "Unit not found."}
    return {"ok": True}


def pricelabs_status():
    """Whether the integration is configured at all, for the UI to show
    the right thing without every operator needing to know an env var name."""
    return {"configured": pricelabs_client.is_configured()}


def market_data_status():
    """Whether AirROI comp data is available, so the pricing page can say
    which tier of pricing a unit is actually getting rather than leaving the
    operator to guess."""
    return {"configured": airroi_client.is_configured()}


def list_pricelabs_listings():
    return pricelabs_client.list_listings()


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
    """Read-side twin of suggest_rates. `unit_id` arrives from the query
    string, so every statement below joins through properties and constrains
    on company_id — a unit belonging to another operator returns nothing
    rather than that operator's guest list.

    Scoped per statement rather than behind a single ownership check up
    front: the reservation rows carry guest names and stay dates, and one
    guard protecting three queries is one refactor away from protecting two.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT r.stay_date, r.base_rate, r.suggested_rate, r.applied_rate, r.source, r.factors
            FROM traxkey.unit_nightly_rates r
            JOIN traxkey.units u ON u.id = r.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE r.unit_id = %s::uuid AND p.company_id = %s
              AND r.stay_date BETWEEN %s AND %s
            ORDER BY r.stay_date
            """,
            (unit_id, company_id, start_date, end_date),
        )
        rates = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT dr.id, dr.guest_name, dr.checkin_date, dr.checkout_date,
                   dr.nightly_rate, dr.status, dr.source
            FROM traxkey.direct_reservations dr
            JOIN traxkey.units u ON u.id = dr.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE dr.unit_id = %s::uuid AND p.company_id = %s
              AND dr.status = 'confirmed'
              AND dr.checkin_date <= %s AND dr.checkout_date >= %s
            ORDER BY dr.checkin_date
            """,
            (unit_id, company_id, end_date, start_date),
        )
        reservations = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT u.pricelabs_listing_id
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE u.id = %s::uuid AND p.company_id = %s
            """,
            (unit_id, company_id),
        )
        unit_row = cur.fetchone()
    return {
        "rates": rates,
        "reservations": reservations,
        "pricelabsListingId": unit_row["pricelabs_listing_id"] if unit_row else None,
    }


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
