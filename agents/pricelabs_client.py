"""PriceLabs Customer API client, not the MCP connector.

PriceLabs exposes two integration surfaces and they are not interchangeable:

    MCP server (mcp.pricelabs.co)   OAuth 2.0 with a browser authorize step.
                                     Built for interactive AI assistants
                                     (Claude Desktop, claude.ai) where a
                                     human is present to click "Authorize".

    Customer API (api.pricelabs.co) Plain X-API-Key header. Built for a
                                     headless backend fetching data on its
                                     own schedule.

pricing_engine.py runs unattended in a worker loop with nobody to click
through an OAuth consent screen, so this talks to the Customer API. If a
future version of TraxKey needs an interactive "ask PriceLabs a question"
feature for the operator concierge, that would be a legitimate use for the
MCP connector, a different feature from nightly rate suggestions.

PRICELABS_API_KEY is not set in this environment. Every function here
degrades to a clear error rather than a guess when it's missing, the same
pattern RESEND_API_KEY follows elsewhere in this codebase.
"""

import os
import traceback

import requests

PRICELABS_API_KEY = os.environ.get("PRICELABS_API_KEY")
BASE_URL = "https://api.pricelabs.co"


def _headers():
    return {"X-API-Key": PRICELABS_API_KEY}


def is_configured():
    return bool(PRICELABS_API_KEY)


def list_listings():
    """GET /v1/listings_minimal. Used to help an operator find the
    listing_id to map a TraxKey unit to, not called on the pricing path."""
    if not PRICELABS_API_KEY:
        return {"ok": False, "error": "PRICELABS_API_KEY is not set."}
    try:
        r = requests.get(f"{BASE_URL}/v1/listings_minimal", headers=_headers(), timeout=15)
        r.raise_for_status()
        return {"ok": True, "listings": r.json().get("listings", [])}
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else None
        if status == 403:
            return {"ok": False, "error": "PriceLabs rejected the API key. Check it's correct and API access is enabled in PriceLabs account settings."}
        traceback.print_exc()
        return {"ok": False, "error": f"PriceLabs API error ({status})."}
    except Exception:
        traceback.print_exc()
        return {"ok": False, "error": "Could not reach PriceLabs."}


def get_prices(listing_id, start_date, end_date):
    """GET /v1/listing_prices for one listing, one date range: the per-night
    data PriceLabs actually computed from real market signals, the opposite
    of the heuristic in pricing_engine.HeuristicProvider.

    NOTE: PriceLabs' detailed response schema lives behind a JS-rendered
    Postman/Swagger page this session could not read, so the exact field
    names for each night's price are unconfirmed against a live response.
    parse_nightly_rates() below is written defensively (tries the field
    names PriceLabs' own docs mention in prose: "date" and "price") and
    returns the raw payload alongside whatever it managed to parse, so a
    field-name mismatch is visible and fixable rather than silently wrong.
    Verify this against a real account's response the first time it's used
    for real, before trusting it unattended.
    """
    if not PRICELABS_API_KEY:
        return {"ok": False, "error": "PRICELABS_API_KEY is not set."}
    try:
        r = requests.get(
            f"{BASE_URL}/v1/listing_prices",
            headers=_headers(),
            params={
                "listing_id": listing_id,
                "date_from": start_date.isoformat(),
                "date_to": end_date.isoformat(),
            },
            timeout=20,
        )
        r.raise_for_status()
        return {"ok": True, "data": r.json()}
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else None
        if status == 403:
            return {"ok": False, "error": "PriceLabs rejected the API key or this listing isn't accessible with it."}
        if status == 404:
            return {"ok": False, "error": f"PriceLabs has no listing '{listing_id}'."}
        traceback.print_exc()
        return {"ok": False, "error": f"PriceLabs API error ({status})."}
    except Exception:
        traceback.print_exc()
        return {"ok": False, "error": "Could not reach PriceLabs."}


def parse_nightly_rates(raw):
    """Best-effort extraction of {date_iso: price} from PriceLabs' response,
    trying a few plausible shapes since the exact schema is unconfirmed (see
    get_prices docstring). Returns (parsed_dict, unparsed_bool). When
    unparsed_bool is True, the caller should not trust parsed_dict and
    should surface raw for a human to look at."""
    candidates = raw if isinstance(raw, list) else raw.get("data") or raw.get("prices") or raw.get("pricing")
    if not isinstance(candidates, list):
        return {}, True

    out = {}
    for row in candidates:
        if not isinstance(row, dict):
            return {}, True
        date_val = row.get("date") or row.get("day") or row.get("check_in")
        price_val = row.get("price") or row.get("recommended_price") or row.get("rate")
        if date_val is None or price_val is None:
            return {}, True
        out[str(date_val)[:10]] = price_val
    return out, False
