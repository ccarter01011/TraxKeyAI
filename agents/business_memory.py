"""Business Memory: per-company rules the AI obeys.

What "the AI learns your business" means in TraxKey: durable Postgres rows
read as facts. Not fine-tuning, not model-side memory. The LLM never sees
these rules as suggestions it may weigh, they are applied in Python before
and after it runs.

Precedence, most specific wins:

    unit  >  property  >  trade  >  global (business_memory)  >  company default

That order is the whole design. "Require approval on everything at Unit 4B"
has to beat "auto-approve HVAC under $300", or the operator's most deliberate
instruction would be the one most easily overridden.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

from db import db

# Precedence rank. Higher wins. Kept explicit rather than implied by query
# ordering so the tie-breaking is obvious at the call site.
SCOPE_RANK = {"global": 0, "trade": 1, "property": 2, "unit": 3}


def load_rules(company_id):
    """Every rule for a company. One query per request, then resolved in
    Python, cheaper and clearer than four correlated subqueries."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT rule_type, scope, scope_ref, value, note
            FROM traxkey.business_memory
            WHERE company_id = %s
            """,
            (company_id,),
        )
        return [dict(r) for r in cur.fetchall()]


def resolve(rules, rule_type, *, trade=None, property_id=None, unit_id=None):
    """The highest-precedence rule of this type that applies, or None.

    Returns the whole row, not just the value, so callers can quote the
    operator's own note back to them when explaining a decision.
    """
    targets = {
        "global": None,
        "trade": trade,
        "property": str(property_id) if property_id else None,
        "unit": str(unit_id) if unit_id else None,
    }

    best = None
    for r in rules:
        if r["rule_type"] != rule_type:
            continue
        want = targets.get(r["scope"], "__no_match__")
        # A scoped rule only applies when we actually know that scope's value
        # and it matches. An unknown unit_id must never silently match.
        if r["scope"] == "global":
            if r["scope_ref"] is not None:
                continue
        elif want is None or str(r["scope_ref"]) != str(want):
            continue

        if best is None or SCOPE_RANK[r["scope"]] > SCOPE_RANK[best["scope"]]:
            best = r
    return best


def effective_threshold(rules, company_default, *, trade=None, property_id=None, unit_id=None):
    """Dollar ceiling for auto-dispatch, after any override."""
    rule = resolve(rules, "approval_threshold", trade=trade,
                   property_id=property_id, unit_id=unit_id)
    if not rule:
        return float(company_default), None
    try:
        return float(rule["value"]), rule
    except (TypeError, ValueError):
        # A malformed rule must never widen the gate. Fall back to the
        # company default, which is the safer of the two.
        return float(company_default), None


def forces_approval(rules, *, trade=None, property_id=None, unit_id=None):
    """An always_require_approval rule covering this request, or None."""
    rule = resolve(rules, "always_require_approval", trade=trade,
                   property_id=property_id, unit_id=unit_id)
    if rule and str(rule["value"]).strip().lower() in ("true", "yes", "1"):
        return rule
    return None


def _parse_window(value):
    """'20:00-07:00' -> ((20,0), (7,0)). None if unparseable."""
    try:
        start_s, end_s = str(value).split("-", 1)
        sh, sm = (int(x) for x in start_s.strip().split(":"))
        eh, em = (int(x) for x in end_s.strip().split(":"))
        if not (0 <= sh < 24 and 0 <= eh < 24 and 0 <= sm < 60 and 0 <= em < 60):
            return None
        return (sh, sm), (eh, em)
    except (ValueError, AttributeError):
        return None


def in_quiet_hours(rules, timezone_name):
    """True if right now falls inside the company's no-auto-dispatch window.

    Evaluated in the company's own timezone, because "don't wake my vendors
    at 2am" means 2am where the property is, not UTC.
    """
    rule = resolve(rules, "quiet_hours")
    if not rule:
        return False, None

    window = _parse_window(rule["value"])
    if not window:
        # Unparseable window means we cannot honour the rule. Do not block
        # dispatch on a rule we failed to read, that would silently stall
        # every job. Treat it as absent.
        return False, None

    (sh, sm), (eh, em) = window
    try:
        now = datetime.now(ZoneInfo(timezone_name or "America/Chicago"))
    except Exception:
        now = datetime.now(ZoneInfo("America/Chicago"))

    minutes = now.hour * 60 + now.minute
    start = sh * 60 + sm
    end = eh * 60 + em

    inside = start <= minutes < end if start <= end else (minutes >= start or minutes < end)
    return inside, (rule if inside else None)


def preferred_vendor_id(rules, *, trade=None, property_id=None, unit_id=None):
    """Vendor the operator wants for this trade regardless of ranking."""
    rule = resolve(rules, "preferred_vendor", trade=trade,
                   property_id=property_id, unit_id=unit_id)
    return (rule["value"], rule) if rule else (None, None)
