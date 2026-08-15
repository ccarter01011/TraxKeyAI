"""AirROI comp-set data client.

Feeds the internal HeuristicProvider a real market signal (comp-set average
nightly rate for the property's city/state) instead of pricing on TraxKey's
own occupancy alone. This is not a pricing engine on its own the way
PriceLabsProvider is: AirROI returns market context, pricing_engine.py
blends it into the heuristic's output. See pricing_engine.py's module
docstring for why the blend, not a swap.

AIRROI_API_KEY is not set in this environment. Every function here degrades
to a clear error rather than a guess when it's missing, same pattern as
PRICELABS_API_KEY in pricelabs_client.py and RESEND_API_KEY elsewhere.

NOTE: AirROI's exact response schema for a market/comp-set query was not
readable from this session (same situation pricelabs_client.py documents
for PriceLabs). parse_market_comp() below is written defensively, trying
the field names AirROI's own marketing docs mention in prose (an "average
daily rate" / "ADR" figure, keyed by market). Verify against a real account
response before trusting it unattended, exactly like pricelabs_client.py's
parse_nightly_rates() already warns for PriceLabs.
"""

import os
import traceback

import requests

AIRROI_API_KEY = os.environ.get("AIRROI_API_KEY")
BASE_URL = "https://api.airroi.com"


def _headers():
    return {"Authorization": f"Bearer {AIRROI_API_KEY}"}


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
        r = requests.get(
            f"{BASE_URL}/v1/market",
            headers=_headers(),
            params={"city": city, "state": state},
            timeout=15,
        )
        r.raise_for_status()
        return _parse_market_comp(r.json())
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else None
        if status == 403:
            return {"ok": False, "error": "AirROI rejected the API key."}
        if status == 404:
            return {"ok": False, "error": f"AirROI has no market data for {city}, {state}."}
        traceback.print_exc()
        return {"ok": False, "error": f"AirROI API error ({status})."}
    except Exception:
        traceback.print_exc()
        return {"ok": False, "error": "Could not reach AirROI."}


def _parse_market_comp(raw):
    """Best-effort extraction of an average-daily-rate figure, trying a few
    plausible field names since the exact schema is unconfirmed (see module
    docstring). Returns {"ok": False, ...} rather than a guessed number when
    nothing recognizable is found, so a schema mismatch is visible instead
    of silently feeding a wrong number into pricing."""
    if not isinstance(raw, dict):
        return {"ok": False, "error": "Unrecognized AirROI response shape."}
    market = raw.get("market") if isinstance(raw.get("market"), dict) else raw
    adr = market.get("adr") or market.get("average_daily_rate") or market.get("avg_rate")
    listing_count = market.get("listing_count") or market.get("comp_count")
    if adr is None:
        return {"ok": False, "error": "AirROI response had no recognizable rate field.", "raw": raw}
    return {"ok": True, "avg_rate": float(adr), "listing_count": listing_count}
