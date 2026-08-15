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

Uses GET /markets/search deliberately, not POST /markets/summary. Both
return an average daily rate; search costs $0.01 a call against summary's
$0.10, and the blend below only needs the market's ADR and comp count, not
the full metrics payload. pricing_engine caches one call per property per
run, so a 30-night calendar costs one cent, not thirty.

NOTE: the response field names below come from AirROI's published example
for /markets/search, not from a live call against a real key. The `query`
parameter name in particular is an inference — the docs name the endpoint
"Find Market by Name" but do not show the parameter. get_market_comp()
returns a clear error rather than a guessed number when the shape doesn't
match, so a mismatch is visible on the first real call instead of silently
feeding a wrong rate into pricing. Same warning pricelabs_client.py carries
for its own parser; verify both against a real account before trusting
either unattended.
"""

import os
import traceback

import requests

AIRROI_API_KEY = os.environ.get("AIRROI_API_KEY")
BASE_URL = "https://api.airroi.com"


def _headers():
    return {"x-api-key": AIRROI_API_KEY}


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
            f"{BASE_URL}/markets/search",
            headers=_headers(),
            params={"query": f"{city}, {state}"},
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
    """Pull the average daily rate and active-listing count out of a
    /markets/search response. AirROI's published example is:

        {"markets": [{"name": "Miami Beach", "active_listings": 4287,
                      "avg_occupancy": 0.724, "avg_daily_rate": 312.50, ...}],
         "total_results": 1}

    The first market is taken as the match. Returns {"ok": False, ...}
    rather than a guessed number when the shape doesn't match, so a schema
    drift or a bad query surfaces as a visible error instead of silently
    feeding a wrong rate into pricing."""
    if not isinstance(raw, dict):
        return {"ok": False, "error": "Unrecognized AirROI response shape."}
    markets = raw.get("markets")
    if not isinstance(markets, list) or not markets:
        return {"ok": False, "error": "AirROI found no market matching this property's city and state."}
    market = markets[0]
    if not isinstance(market, dict):
        return {"ok": False, "error": "Unrecognized AirROI market entry."}

    adr = market.get("avg_daily_rate")
    if adr is None:
        return {"ok": False, "error": "AirROI market had no avg_daily_rate field.", "raw": raw}
    try:
        adr = float(adr)
    except (TypeError, ValueError):
        return {"ok": False, "error": f"AirROI returned a non-numeric rate: {adr!r}."}
    if adr <= 0:
        return {"ok": False, "error": f"AirROI returned a non-positive rate: {adr}."}

    return {
        "ok": True,
        "avg_rate": adr,
        "listing_count": market.get("active_listings"),
        "market_name": market.get("name"),
    }
