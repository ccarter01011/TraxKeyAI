"""Conversational portfolio concierge — asks questions across both halves of
one operator's portfolio.

The existing concierge.py answers one fixed question ("what needs me today?")
from a fixed set of maintenance counts. This answers arbitrary questions, and
the questions worth asking are the ones that span long-term and short-term
rentals at once:

    "Which units earned the least per month this year?"
    "Should I convert 4B from long-term to short-term?"
    "Where did maintenance cost me most, per dollar earned?"

No competitor can answer those, because no competitor holds both halves. An
STR platform has no lease table; an LTR PMS has no nightly rates. TraxKey has
`leases` and `direct_reservations` in one schema under one company_id, so the
join is a query rather than an integration project.

WHY TOOLS RATHER THAN GENERATED SQL: the model picks which question to ask and
reads the answer, but never writes SQL. Every query below is fixed Python with
bound parameters, and `company_id` is supplied by validate_session() on the
server — it is not a tool parameter and the model cannot reach it, reference
it, or be talked into changing it. A prompt-injected instruction to "show me
every company's revenue" has no reachable path: there is no tool that accepts
a company. That is the same tenant-isolation rule every query in this codebase
follows, enforced structurally rather than by asking the model nicely.

The same split as concierge.py: SQL produces every number, Claude only decides
which numbers to fetch and writes the sentence tying them together.
"""

import json
import os
import re
import time
import traceback
from collections import defaultdict

from anthropic import Anthropic

from db import db

anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

MODEL = "claude-sonnet-4-6"
MAX_TURNS = 10           # conversation history kept, per request
MAX_QUESTION_CHARS = 2000
MAX_TOOL_ROUNDS = 6      # ceiling on tool round-trips per question

# This is the most expensive call in the product: up to 16k output tokens,
# multiplied by MAX_TOOL_ROUNDS, per question. It was previously unthrottled,
# so a single Free-tier account on a $0 plan could loop it indefinitely and
# run up an unbounded Anthropic bill.
#
# Keyed on company_id rather than IP or token deliberately: IP is client
# -influenced, and a token is trivially multiplied by logging in again, but
# company_id comes out of validate_session() and is exactly the unit we bill.
CHAT_WINDOW_SECONDS = 3600
CHAT_MAX_PER_WINDOW = 40   # questions per company per hour
CHAT_MIN_GAP_SECONDS = 2   # blocks scripted hammering between questions

_chat_hits = defaultdict(list)


def _chat_rate_limited(company_id):
    now = time.time()
    recent = [t for t in _chat_hits[company_id] if now - t < CHAT_WINDOW_SECONDS]
    _chat_hits[company_id] = recent
    if recent and now - recent[-1] < CHAT_MIN_GAP_SECONDS:
        return True
    if len(recent) >= CHAT_MAX_PER_WINDOW:
        return True
    _chat_hits[company_id].append(now)
    return False

UUID_RE = re.compile(r"^[0-9a-fA-F-]{36}$")


def _uuid_or_none(value):
    """Model-supplied IDs are untrusted input like any other. They reach SQL as
    bound parameters either way, but rejecting a malformed one here produces a
    clear tool error instead of a Postgres cast failure the model can't read."""
    # str() first: the model sends JSON strings, but a caller passing a real
    # uuid.UUID (or anything else) should get a clean answer rather than an
    # AttributeError from deep inside a tool call.
    value = str(value or "").strip()
    return value if UUID_RE.match(value) else None


# ---------------------------------------------------------------- tools

def portfolio_overview(company_id):
    """Both halves of the portfolio, counted the same way. This is the answer
    to 'what do I actually own', and the starting point for most questions."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              count(*) AS total_units,
              count(*) FILTER (WHERE l.id IS NOT NULL) AS units_with_active_lease,
              count(*) FILTER (WHERE p.rental_mode = 'experiential') AS units_at_experiential_properties,
              count(*) FILTER (WHERE u.base_nightly_rate IS NOT NULL) AS units_priced_for_short_term,
              count(*) FILTER (WHERE NOT traxkey.unit_is_occupied(u.id)) AS vacant_units,
              count(DISTINCT p.id) AS properties
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            LEFT JOIN traxkey.leases l
              ON l.unit_id = u.id AND l.status = 'active'
            WHERE p.company_id = %s
            """,
            (company_id,),
        )
        return dict(cur.fetchone())


def unit_income_comparison(company_id, days=90):
    """The cross-portfolio query: monthly income per unit with long-term and
    short-term revenue normalized to the same unit of measure, so a leased unit
    and a nightly-rented one can sit in the same sorted list.

    Long-term income is contractual (rent_amount is per month, taken as-is).
    Short-term income is realized (nightly_rate x nights actually booked over
    the window, scaled to 30 days). Those are genuinely different kinds of
    number — one is promised, one is earned — so the output labels which is
    which rather than pretending they're interchangeable."""
    days = max(1, min(int(days or 90), 365))
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            WITH str_revenue AS (
              SELECT dr.unit_id,
                     sum(dr.nightly_rate * (
                       LEAST(dr.checkout_date, CURRENT_DATE)
                       - GREATEST(dr.checkin_date, CURRENT_DATE - %(days)s::int)
                     )) AS revenue,
                     sum(
                       LEAST(dr.checkout_date, CURRENT_DATE)
                       - GREATEST(dr.checkin_date, CURRENT_DATE - %(days)s::int)
                     ) AS nights
              FROM traxkey.direct_reservations dr
              WHERE dr.company_id = %(c)s
                AND dr.status = 'confirmed'
                AND dr.checkin_date <= CURRENT_DATE
                AND dr.checkout_date >= CURRENT_DATE - %(days)s::int
              GROUP BY dr.unit_id
            )
            SELECT u.id, u.unit_number, p.name AS property_name,
                   l.rent_amount AS monthly_rent,
                   sr.revenue AS short_term_revenue_in_window,
                   sr.nights AS short_term_nights_booked,
                   CASE WHEN sr.revenue IS NOT NULL
                        THEN round(sr.revenue / %(days)s::numeric * 30, 2) END
                     AS short_term_revenue_per_30_days,
                   CASE WHEN l.id IS NOT NULL THEN 'long_term'
                        WHEN sr.unit_id IS NOT NULL THEN 'short_term'
                        ELSE 'idle' END AS income_type
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            LEFT JOIN traxkey.leases l ON l.unit_id = u.id AND l.status = 'active'
            LEFT JOIN str_revenue sr ON sr.unit_id = u.id
            WHERE p.company_id = %(c)s
            ORDER BY COALESCE(l.rent_amount, sr.revenue / %(days)s::numeric * 30, 0)
            LIMIT 60
            """,
            {"c": company_id, "days": days},
        )
        return {"window_days": days, "units": [dict(r) for r in cur.fetchall()]}


def maintenance_cost_by_unit(company_id, days=90):
    """Maintenance spend per unit, which is the cost side of the income query
    above. Joining the two is what answers 'where did maintenance cost me most
    per dollar earned' — a question neither an LTR nor an STR tool can ask,
    because each only holds one of the two numbers."""
    days = max(1, min(int(days or 90), 365))
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.id AS unit_id, u.unit_number, p.name AS property_name,
                   count(mr.id) AS requests,
                   sum(COALESCE(mr.final_cost, mr.quoted_cost, 0)) AS total_cost,
                   count(mr.id) FILTER (WHERE mr.urgency = 'emergency') AS emergencies
            FROM traxkey.maintenance_requests mr
            JOIN traxkey.units u ON u.id = mr.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE mr.company_id = %(c)s
              AND mr.created_at >= now() - make_interval(days => %(days)s)
            GROUP BY u.id, u.unit_number, p.name
            HAVING sum(COALESCE(mr.final_cost, mr.quoted_cost, 0)) > 0
            ORDER BY total_cost DESC
            LIMIT 40
            """,
            {"c": company_id, "days": days},
        )
        return {"window_days": days, "units": [dict(r) for r in cur.fetchall()]}


def lease_expirations(company_id, days_ahead=90):
    """Leases ending soon. On a mixed portfolio this is also a conversion
    prompt: an expiring lease is the moment a unit could switch to short-term,
    which is why it pairs with unit_income_comparison."""
    days_ahead = max(1, min(int(days_ahead or 90), 365))
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT l.id, l.end_date, l.rent_amount, l.notice_days,
                   u.id AS unit_id, u.unit_number, p.name AS property_name
            FROM traxkey.leases l
            JOIN traxkey.units u ON u.id = l.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %(c)s
              AND l.status = 'active'
              AND l.end_date IS NOT NULL
              AND l.end_date <= CURRENT_DATE + %(days)s::int
            ORDER BY l.end_date
            LIMIT 40
            """,
            {"c": company_id, "days": days_ahead},
        )
        rows = [dict(r) for r in cur.fetchall()]
    # A null end_date is month-to-month, not missing data (schema_v15). Saying
    # so keeps the model from reporting "no expirations" as though every lease
    # were safely long-dated.
    return {"window_days": days_ahead, "leases": rows,
            "note": "Month-to-month leases have no end date and are excluded here."}


def short_term_performance(company_id, days=90):
    """Occupancy and realized nightly rate for the short-term side. The
    denominator is only units that have a base nightly rate set, since a
    long-term unit with no STR pricing would otherwise drag occupancy down and
    make the short-term side look worse than it is."""
    days = max(1, min(int(days or 90), 365))
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            WITH str_units AS (
              SELECT u.id FROM traxkey.units u
              JOIN traxkey.properties p ON p.id = u.property_id
              WHERE p.company_id = %(c)s AND u.base_nightly_rate IS NOT NULL
            ),
            booked AS (
              SELECT sum(
                       LEAST(dr.checkout_date, CURRENT_DATE)
                       - GREATEST(dr.checkin_date, CURRENT_DATE - %(days)s::int)
                     ) AS nights,
                     sum(dr.nightly_rate * (
                       LEAST(dr.checkout_date, CURRENT_DATE)
                       - GREATEST(dr.checkin_date, CURRENT_DATE - %(days)s::int)
                     )) AS revenue
              FROM traxkey.direct_reservations dr
              WHERE dr.company_id = %(c)s AND dr.status = 'confirmed'
                AND dr.unit_id IN (SELECT id FROM str_units)
                AND dr.checkin_date <= CURRENT_DATE
                AND dr.checkout_date >= CURRENT_DATE - %(days)s::int
            )
            SELECT (SELECT count(*) FROM str_units) AS short_term_units,
                   COALESCE(b.nights, 0) AS nights_booked,
                   (SELECT count(*) FROM str_units) * %(days)s AS nights_available,
                   COALESCE(b.revenue, 0) AS revenue,
                   CASE WHEN COALESCE(b.nights, 0) > 0
                        THEN round(b.revenue / b.nights, 2) END AS realized_nightly_rate
            FROM booked b
            """,
            {"c": company_id, "days": days},
        )
        row = dict(cur.fetchone())
    avail = row.get("nights_available") or 0
    row["occupancy_pct"] = (
        round((row["nights_booked"] or 0) / avail * 100, 1) if avail else None
    )
    row["window_days"] = days
    return row


def unit_detail(company_id, unit_id):
    """Everything about one unit, both halves. The drill-down after a
    comparison query surfaces an outlier."""
    unit_id = _uuid_or_none(unit_id)
    if not unit_id:
        return {"error": "unit_id must be a UUID from another tool's output."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT u.id, u.unit_number, u.bedrooms, u.bathrooms,
                   CASE WHEN traxkey.unit_is_occupied(u.id) THEN 'occupied' ELSE 'vacant' END AS status,
                   u.base_nightly_rate, p.name AS property_name,
                   p.city, p.state, p.rental_mode,
                   l.rent_amount, l.start_date, l.end_date, l.status AS lease_status
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            LEFT JOIN traxkey.leases l ON l.unit_id = u.id AND l.status = 'active'
            WHERE u.id = %s::uuid AND p.company_id = %s
            """,
            (unit_id, company_id),
        )
        unit = cur.fetchone()
        if not unit:
            return {"error": "No such unit in this portfolio."}

        cur.execute(
            """
            SELECT count(*) AS reservations, sum(nightly_rate * (checkout_date - checkin_date)) AS revenue
            FROM traxkey.direct_reservations
            WHERE unit_id = %s::uuid AND company_id = %s AND status = 'confirmed'
              AND checkout_date >= CURRENT_DATE - 365
            """,
            (unit_id, company_id),
        )
        str_side = dict(cur.fetchone())

        cur.execute(
            """
            SELECT count(*) AS requests,
                   sum(COALESCE(final_cost, quoted_cost, 0)) AS maintenance_cost
            FROM traxkey.maintenance_requests
            WHERE unit_id = %s::uuid AND company_id = %s
              AND created_at >= now() - interval '365 days'
            """,
            (unit_id, company_id),
        )
        maint = dict(cur.fetchone())

    return {"unit": dict(unit), "short_term_last_365": str_side,
            "maintenance_last_365": maint}


TOOL_FUNCTIONS = {
    "portfolio_overview": portfolio_overview,
    "unit_income_comparison": unit_income_comparison,
    "maintenance_cost_by_unit": maintenance_cost_by_unit,
    "lease_expirations": lease_expirations,
    "short_term_performance": short_term_performance,
    "unit_detail": unit_detail,
}

_DAYS = {"type": "integer", "description": "Look-back window in days, 1-365. Defaults to 90."}

TOOLS = [
    {
        "name": "portfolio_overview",
        "description": "Counts of units, properties, active leases, short-term-priced units, and vacancies across the whole portfolio. Call this first when the question is broad or you need to know the shape of the portfolio before drilling in.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "unit_income_comparison",
        "description": "Per-unit income with long-term and short-term revenue on the same monthly basis, sorted lowest-earning first. Use for 'which units earn least', 'should I convert X', or any question comparing the two rental types. Long-term figures are contracted monthly rent; short-term figures are realized revenue over the window scaled to 30 days.",
        "input_schema": {"type": "object", "properties": {"days": _DAYS}},
    },
    {
        "name": "maintenance_cost_by_unit",
        "description": "Maintenance spend and request counts per unit, highest spend first. Combine with unit_income_comparison to reason about cost against income.",
        "input_schema": {"type": "object", "properties": {"days": _DAYS}},
    },
    {
        "name": "lease_expirations",
        "description": "Active leases ending within the window. Month-to-month leases have no end date and are excluded.",
        "input_schema": {"type": "object", "properties": {
            "days_ahead": {"type": "integer", "description": "How far ahead to look, 1-365. Defaults to 90."}}},
    },
    {
        "name": "short_term_performance",
        "description": "Occupancy percentage, nights booked, revenue, and realized nightly rate for the short-term side. Only counts units that have a base nightly rate set.",
        "input_schema": {"type": "object", "properties": {"days": _DAYS}},
    },
    {
        "name": "unit_detail",
        "description": "Full picture of one unit: lease terms, short-term revenue, and maintenance cost over the last year. Use after another tool surfaces a unit worth drilling into.",
        "input_schema": {"type": "object", "properties": {
            "unit_id": {"type": "string", "description": "Unit UUID, taken from another tool's output."}},
            "required": ["unit_id"]},
    },
]


ONBOARDING_STEPS = """
NEW-OPERATOR SETUP, step by step (call portfolio_overview first if you're
unsure whether they've started; zero properties/units means they haven't):

1. Add a property (Properties page, "+ Add property"): name, address, and a
   type (single-family, duplex, apartment, multifamily).
2. Add at least one unit under that property: unit number (blank is fine for
   a single-family home), bedrooms, bathrooms.
3. For a long-term unit: invite the resident from the Residents page, they
   get their own maintenance-reporting link, no account or shared code.
4. For a short-term unit: set a base nightly rate on the unit, then paste
   the calendar export (iCal) URL from Airbnb or Vrbo on the Calendars page
   so bookings sync in.
5. Add a vendor or two on the Vendors page (trade, whether they take
   emergencies) so the AI has someone real to dispatch to once a
   maintenance request comes in.
6. Optional but worth doing early: Business Memory page for approval
   thresholds and quiet hours, so the AI's dispatch decisions match how
   they actually run things, not a generic default.

Suggest ONE next step at a time, not the whole list at once, and only the
step that's actually next given what portfolio_overview shows (e.g. don't
suggest inviting a resident before any unit exists)."""

PLATFORM_HELP = """
DASHBOARD AND PLATFORM REFERENCE, for "how do I..." questions:

- Properties: add/edit properties and their units.
- Residents: invite a long-term tenant or short-term guest, each gets their
  own reporting link.
- Vendors: maintenance contractors, ranked by real completion rate/cost;
  enable portal access so they can update jobs from their phone.
- Ordered Items & Suppliers: track a part/material a job is waiting on
  against a real supplier record (contact, on-time rate, auto-chase),
  not retyped free text each time.
- Invoices: what's owed to the operator, aged and auto-chased by email.
  TraxKey never processes payment, this is visibility and reminders only.
- Pricing calendar: suggested nightly rate per night for short-term units,
  with the reasoning shown (base rate, weekend lift, occupancy, market
  comps where connected).
- Business Memory: the operator's own rules (approval thresholds, quiet
  hours, preferred vendor) that the AI reads as fixed facts, never
  suggestions it can override.
- Insights: vendor slowdowns, underpriced units, other patterns surfaced
  from the operator's own history.
- Analytics: occupancy, rental activity, and owner statements.
- Turns & Calendars: cleaner assignment between guests, iCal sync status.
- Owners: a separate read-only login for a property owner, scoped to just
  their properties.
- Team & Profile: invite staff, manage your own login, and Billing (change
  plan or manage your subscription through Stripe's own portal).
- Suggestion box (from the dashboard): send a feature request straight to
  the team.

Answer these plainly and briefly. You don't need a tool call for a
navigation question, only for a question that needs real data from their
account."""

SYSTEM = f"""You are the concierge for a property management business that runs
both long-term rentals and short-term rentals in one system. You do two
different jobs, and you should tell which one a question needs before
answering:

1. Portfolio analyst: questions that need real data from their account
   (income, maintenance cost, lease expirations, occupancy). Use the tools
   below, and follow the analyst rules.
2. Setup guide and platform help: a new operator getting started, or anyone
   asking "how do I..." / "where do I..." about the dashboard itself. Use
   ONBOARDING_STEPS and PLATFORM_HELP below. If you're not sure whether
   someone is new, call portfolio_overview, zero properties or units means
   they haven't started yet, and it's worth proactively offering the next
   setup step rather than waiting to be asked.

That long-term-plus-short-term combination is the whole point of the
analyst job. The operator's other software sees only half their portfolio:
a short-term platform has no leases, a long-term system has no nightly
rates. You can see both, so answer the questions that need both, and say
plainly when a comparison spans the two.

{ONBOARDING_STEPS}
{PLATFORM_HELP}

Analyst rules:
- Every number you state must come from a tool result. Never estimate, never
  extrapolate, never carry a number over from general knowledge. If a tool
  returns nothing, say so rather than filling the gap.
- Contracted rent and realized short-term revenue are different kinds of
  number. Rent is promised; short-term revenue is what actually happened over
  a window. When you compare them, say which is which.
- A short window makes short-term revenue look erratic. If a conclusion rests
  on a handful of booked nights, say the sample is thin.
- You inform decisions, you do not make them. For conversion, pricing, or
  eviction questions, lay out what the numbers show and what they cannot show.
- Never present legal, tax, insurance, or fair-housing matters as settled.
  Flag them and recommend a qualified professional.
- Answer in plain language. Lead with the answer, then the supporting numbers.
  No preamble, no restating the question back, no em dashes.
- Keep it brief. A specific question deserves a specific answer, not a report."""


def validate_session(token):
    """Same sessions table as everything else. Returns company_id, or None.
    This is the only place a company_id enters the conversation, and it comes
    from the caller's token rather than from anything the model produced."""
    if not token:
        return None
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT company_id FROM traxkey.sessions WHERE token = %s AND expires_at > now()",
            (token,),
        )
        row = cur.fetchone()
    return str(row["company_id"]) if row else None


def _run_tool(company_id, name, tool_input):
    """Dispatch one tool call. company_id is passed positionally by this
    function, never read from tool_input, so a model-supplied 'company_id' key
    is inert rather than dangerous."""
    fn = TOOL_FUNCTIONS.get(name)
    if not fn:
        return {"error": f"No such tool: {name}"}
    kwargs = {k: v for k, v in (tool_input or {}).items() if k != "company_id"}
    try:
        return fn(company_id, **kwargs)
    except TypeError as e:
        return {"error": f"Bad arguments for {name}: {e}"}
    except Exception:
        traceback.print_exc()
        return {"error": f"{name} failed to run."}


def answer(token, question, history=None):
    """Returns (reply, error_code). error_code is None on success."""
    company_id = validate_session(token)
    if not company_id:
        return (None, "unauthorized")
    if not question or not question.strip():
        return (None, "empty")
    if _chat_rate_limited(company_id):
        return (None, "rate_limited")

    messages = []
    for turn in (history or [])[-MAX_TURNS:]:
        role = turn.get("role")
        content = str(turn.get("content", ""))[:MAX_QUESTION_CHARS]
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question.strip()[:MAX_QUESTION_CHARS]})

    try:
        for _ in range(MAX_TOOL_ROUNDS):
            response = anthropic_client.messages.create(
                model=MODEL,
                max_tokens=16000,
                thinking={"type": "adaptive"},
                output_config={"effort": "medium"},
                system=SYSTEM,
                tools=TOOLS,
                messages=messages,
            )

            if response.stop_reason == "refusal":
                return ("I can't answer that one. Try rephrasing, or ask about "
                        "a specific unit or property.", None)

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                text = "\n".join(b.text for b in response.content if b.type == "text")
                return (text.strip() or "I couldn't find anything to answer that.", None)

            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": b.id,
                    "content": json.dumps(_run_tool(company_id, b.name, b.input), default=str),
                }
                for b in tool_uses
            ]})

        # Out of rounds with the model still fetching. Better to say so than to
        # return whatever half-gathered state it had.
        return ("That took more digging than I could finish. Try asking about "
                "one property or one unit at a time.", None)

    except Exception:
        traceback.print_exc()
        return (None, "failed")
