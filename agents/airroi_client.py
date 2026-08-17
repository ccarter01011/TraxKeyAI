"""AirROI comp-set data client.

Feeds the internal HeuristicProvider a real market signal (comp-set average
nightly rate for the property's city/state) instead of pricing on TraxKey's
own occupancy alone. This is not a pricing engine on its own the way
PriceLabsProvider is: AirROI returns market context, pricing_engine.py
blends it into the heuristic's output. See pricing_engine.py's module
docstring for why the blend, not a swap.

Verified 2026-08-17 against a live key (arlive...). Two calls, chained,
not one:

  1. GET /markets/search?query="{city}, {state}" ($0.01) - a fuzzy
     lookup/typeahead. It does NOT return rate data, only market identity
     (country/region/locality/district as AirROI spells them). This step
     exists because TraxKey's own city/state strings (whatever format the
     property record happens to use - "FL" or "Florida", abbreviated or
     not) won't reliably match /markets/summary's exact-string matching.
  2. POST /markets/summary ($0.10) with the exact country/region/locality
     strings step 1 returned. This is the one that has average_daily_rate.

Earlier draft of this file assumed a single GET /markets/search call would
return avg_daily_rate directly, based on AirROI's own marketing copy, not a
live call. That shape does not exist - live entries look like:
    {"full_name": "Austin, Texas, United States", "country": "United States",
     "region": "Texas", "locality": "Austin", "district": "",
     "active_listings_count": 11929}
/markets/summary's real response uses average_daily_rate and
active_listings_count (a float, e.g. 4498.8 - it's a rolling average across
num_months, not a point-in-time count), not avg_daily_rate / active_listings.

pricing_engine caches one summary call per property's city/state per run,
so a 30-night calendar costs eleven cents (one search + one summary), not
thirty.
"""

import os
import traceback

import requests

AIRROI_API_KEY = os.environ.get("AIRROI_API_KEY")
BASE_URL = "https://api.airroi.com"


def _headers():
    return {"x-api-key": AIRROI_API_KEY, "Content-Type": "application/json"}


def is_configured():
    return bool(AIRROI_API_KEY)


def get_market_comp(city, state):
    """Comp-set average nightly rate for a city/state market. Called once
    per property per pricing run (pricing_engine.py caches it), not once
    per night, since the comp-set average doesn't change night to night the
    way occupancy does."""
    if not AIRROI_API_KEY:
        return {"ok": False, "error": "AIRROI_API_KEY is not set."}
    if not (city and state):
        return {"ok": False, "error": "Property has no city/state to look up a market for."}
    try:
        market = _resolve_market(city, state)
        if not market["ok"]:
            return market
        r = requests.post(
            f"{BASE_URL}/markets/summary",
            headers=_headers(),
            json={
                "market": {
                    "country": market["country"],
                    "region": market["region"],
                    "locality": market["locality"],
                },
                "currency": "usd",
                "num_months": 1,
            },
            timeout=15,
        )
        if r.status_code == 404:
            return {"ok": False, "error": f"AirROI has no summary data for {city}, {state}."}
        r.raise_for_status()
        return _parse_market_comp(r.json())
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else None
        if status == 403:
            return {"ok": False, "error": "AirROI rejected the API key."}
        traceback.print_exc()
        return {"ok": False, "error": f"AirROI API error ({status})."}
    except Exception:
        traceback.print_exc()
        return {"ok": False, "error": "Could not reach AirROI."}


def _resolve_market(city, state):
    """Turns whatever city/state format TraxKey has on file into the exact
    country/region/locality strings /markets/summary requires. AirROI's own
    error message on a summary mismatch says to do exactly this via
    /markets/search first, rather than guess a locality's canonical form."""
    r = requests.get(
        f"{BASE_URL}/markets/search",
        headers=_headers(),
        params={"query": f"{city}, {state}"},
        timeout=15,
    )
    if r.status_code == 404:
        return {"ok": False, "error": f"AirROI found no market matching {city}, {state}."}
    r.raise_for_status()
    raw = r.json()
    entries = raw.get("entries") if isinstance(raw, dict) else None
    if not entries:
        return {"ok": False, "error": f"AirROI found no market matching {city}, {state}."}
    entry = entries[0]
    if not isinstance(entry, dict) or not entry.get("locality"):
        return {"ok": False, "error": "Unrecognized AirROI market-search entry shape."}
    return {
        "ok": True,
        "country": entry.get("country"),
        "region": entry.get("region"),
        "locality": entry.get("locality"),
    }


def _parse_market_comp(raw):
    """Pull the average daily rate and active-listing count out of a
    /markets/summary response. Live shape:

        {"market": {...}, "occupancy": 0.47, "average_daily_rate": 395.5,
         "rev_par": 186.6, "revenue": 45184.3, "booking_lead_time": 45.5,
         "length_of_stay": 4.5, "min_nights": 6.8,
         "active_listings_count": 4498.8}

    Returns {"ok": False, ...} rather than a guessed number when the shape
    doesn't match, so a schema drift surfaces as a visible error instead of
    silently feeding a wrong rate into pricing."""
    if not isinstance(raw, dict):
        return {"ok": False, "error": "Unrecognized AirROI response shape."}

    adr = raw.get("average_daily_rate")
    if adr is None:
        return {"ok": False, "error": "AirROI summary had no average_daily_rate field.", "raw": raw}
    try:
        adr = float(adr)
    except (TypeError, ValueError):
        return {"ok": False, "error": f"AirROI returned a non-numeric rate: {adr!r}."}
    if adr <= 0:
        return {"ok": False, "error": f"AirROI returned a non-positive rate: {adr}."}

    listing_count = raw.get("active_listings_count")
    market = raw.get("market") if isinstance(raw.get("market"), dict) else {}

    return {
        "ok": True,
        "avg_rate": adr,
        "listing_count": int(listing_count) if isinstance(listing_count, (int, float)) else listing_count,
        "market_name": market.get("locality"),
    }
