"""AI Maintenance Coordinator.

Deterministic-vs-reasoning split, same principle used across this project:
SQL for facts, thresholds, and vendor selection math; a single LLM call only
for the one genuinely ambiguous step, reading a tenant's raw description.

Runs as a scheduled batch pass rather than being triggered per-request by
n8n, deliberately, so the already-published intake workflows never need to
be touched. Each run: pull every request still sitting at status
'submitted', push each one through the pipeline once.
"""

import os
import json
import traceback
from typing import TypedDict, Optional

import requests
from anthropic import Anthropic
from langgraph.graph import StateGraph, END

from db import db
from business_memory import (
    load_rules, effective_threshold, forces_approval, in_quiet_hours, preferred_vendor_id,
)
from ical_sync import get_occupancy

anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

RESEND_API_KEY = os.environ.get("RESEND_API_KEY")  # optional: notification is best-effort, never blocks dispatch
NOTIFY_FROM_ADDRESS = os.environ.get("NOTIFY_FROM_ADDRESS", "dispatch@notify.traxkey.ai")

VALID_TRADES = ["hvac", "plumbing", "electrical", "appliance", "general", "pest", "locksmith", "roofing", "cleaning"]


class RequestState(TypedDict, total=False):
    request_id: str
    description: str
    company_id: str
    unit_id: Optional[str]
    cost_approval_threshold: float
    category: Optional[str]
    urgency: Optional[str]
    responsibility: Optional[str]
    vendor_id: Optional[str]
    quoted_cost: Optional[float]
    known_cost: bool
    requires_approval: bool
    occupancy: Optional[dict]
    requires_human_review: bool
    review_reason: Optional[str]
    final_status: str
    property_id: Optional[str]
    timezone: Optional[str]
    rules: list


def load_context(state: RequestState) -> RequestState:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT mr.description, mr.company_id, mr.unit_id, c.cost_approval_threshold,
                   c.timezone,
                   mr.category, mr.urgency, mr.responsibility,
                   u.property_id,
                   COALESCE(r.requires_human_review, false) AS requires_human_review,
                   r.review_reason
            FROM traxkey.maintenance_requests mr
            JOIN traxkey.companies c ON c.id = mr.company_id
            LEFT JOIN traxkey.units u ON u.id = mr.unit_id
            LEFT JOIN traxkey.residents r ON r.id = mr.resident_id
            WHERE mr.id = %s
            """,
            (state["request_id"],),
        )
        row = cur.fetchone()

    unit_id = str(row["unit_id"]) if row["unit_id"] else None
    # Occupancy is a plain SQL fact, not an AI judgment. It only exists for
    # units with a synced iCal calendar, a long-term unit or one with no
    # calendar configured simply returns no occupancy and the urgency call
    # proceeds exactly as it did before.
    occupancy = get_occupancy(unit_id) if unit_id else None

    return {
        **state,
        "description": row["description"],
        "company_id": str(row["company_id"]),
        "unit_id": unit_id,
        "cost_approval_threshold": float(row["cost_approval_threshold"]),
        "occupancy": occupancy,
        "requires_human_review": row["requires_human_review"],
        "review_reason": row["review_reason"],
        "property_id": str(row["property_id"]) if row["property_id"] else None,
        "timezone": row["timezone"],
        # Business Memory: the operator's own standing rules. Loaded once
        # here, applied deterministically downstream. The LLM never sees
        # them, they are not suggestions it weighs.
        "rules": load_rules(str(row["company_id"])),
        # Set when something upstream (cleaner_assignment.py, so far) already
        # knows category/urgency/responsibility as plain facts, a cleaning
        # turn doesn't need an LLM to tell it the job is a cleaning job.
        # diagnose() skips its API call when these are already present.
        "category": row["category"],
        "urgency": row["urgency"],
        "responsibility": row["responsibility"],
    }


def _occupancy_context(occupancy):
    """Turn occupancy facts into a line for the diagnosis prompt. Same
    broken appliance is a different problem with a guest in the unit than
    in one sitting empty for two weeks, and short-term rentals live or die
    on that distinction."""
    if not occupancy:
        return ""

    if occupancy["occupied_now"]:
        line = "Someone is staying in this unit RIGHT NOW"
        if occupancy["current_checkout"]:
            line += f", checking out {occupancy['current_checkout']}"
        line += "."
    elif occupancy["next_checkin"]:
        line = f"The unit is empty right now. The next guest arrives {occupancy['next_checkin']}."
    else:
        line = "The unit is empty right now, with no upcoming booking on the calendar."

    return f"""

Occupancy context (from the unit's booking calendar):
{line}
Weigh this in the urgency call. An issue affecting someone currently in
the unit, or one that must be fixed before an imminent arrival, is more
urgent than the same issue in a unit that will sit empty."""


def diagnose(state: RequestState) -> RequestState:
    """The one LLM step: classify a free-text tenant description. Everything
    downstream of this is plain SQL, no further AI judgment calls.

    Skipped entirely when category/urgency/responsibility already arrived
    pre-set, e.g. an auto-created cleaning job: a cleaning turn's category is
    'cleaning' by construction, there is no ambiguous text to classify, and
    spending an API call to have the model re-derive a fact we already have
    would violate the one rule this whole system runs on."""
    if state.get("category") and state.get("urgency") and state.get("responsibility"):
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE traxkey.maintenance_requests SET status = 'triaged' WHERE id = %s",
                (state["request_id"],),
            )
            cur.execute(
                "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'triaged', %s)",
                (state["request_id"], f"Pre-classified: {state['category']}, {state['urgency']}. No AI call needed."),
            )
        return state

    prompt = f"""A tenant reported this maintenance issue:

"{state['description']}"
{_occupancy_context(state.get('occupancy'))}

Classify it. Respond with ONLY a JSON object, no markdown, no prose:
{{
  "category": one of {VALID_TRADES},
  "urgency": one of ["routine", "urgent", "emergency"],
  "responsibility": one of ["owner", "tenant", "unclear"]
}}

responsibility guidance: "owner" for normal wear/failure (a water heater
dying, HVAC breaking), "tenant" for damage caused by tenant action (a
clogged drain from grease, a broken window from tenant negligence),
"unclear" if the description doesn't give enough to tell."""

    response = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=200,
        temperature=0,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = response.content[0].text.strip()
    cleaned = raw.replace("```json", "").replace("```", "").strip()
    parsed = json.loads(cleaned)

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.maintenance_requests
            SET category = %s, urgency = %s, responsibility = %s, status = 'triaged'
            WHERE id = %s
            """,
            (parsed["category"], parsed["urgency"], parsed["responsibility"], state["request_id"]),
        )
        occ = state.get("occupancy")
        if occ and occ["occupied_now"]:
            occ_note = f" Occupied now, checkout {occ['current_checkout']}."
        elif occ and occ["next_checkin"]:
            occ_note = f" Vacant, next arrival {occ['next_checkin']}."
        elif occ:
            occ_note = " Vacant, nothing booked."
        else:
            occ_note = ""

        cur.execute(
            """
            INSERT INTO traxkey.maintenance_events (request_id, event_type, content)
            VALUES (%s, 'triaged', %s)
            """,
            (state["request_id"], f"Category: {parsed['category']}, urgency: {parsed['urgency']}, responsibility: {parsed['responsibility']}.{occ_note}"),
        )

    return {**state, "category": parsed["category"], "urgency": parsed["urgency"], "responsibility": parsed["responsibility"]}


def route_after_diagnose(state: RequestState) -> str:
    """A resident the operator flagged never reaches auto-dispatch. Still
    diagnosed, so the operator sees the AI's read on it, but a human decides
    what happens next."""
    return "hold_for_review" if state.get("requires_human_review") else "find_vendor"


def hold_for_review(state: RequestState) -> RequestState:
    reason = state.get("review_reason") or "This resident is set to human review."
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.maintenance_requests SET status = 'needs_human_review' WHERE id = %s",
            (state["request_id"],),
        )
        cur.execute(
            "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'needs_human_review', %s)",
            (state["request_id"], f"Held for a person to review. {reason}"),
        )
    return {**state, "final_status": "needs_human_review"}


def find_vendor(state: RequestState) -> RequestState:
    """Deterministic: best vendor on file for this trade, ranked by real
    history, same reliability-scoring principle as TraxSail's supplier
    score. No AI judgment on which vendor is "best".

    A Business Memory preferred_vendor rule, if one applies, wins outright,
    the operator's explicit instruction beats the ranking. If that vendor no
    longer exists or no longer does this trade, it's ignored and ranking
    proceeds normally rather than failing the request."""
    trade = state["category"]
    rules = state.get("rules", [])
    pref_id, _pref_rule = preferred_vendor_id(
        rules, trade=trade, property_id=state.get("property_id"), unit_id=state.get("unit_id")
    )

    row = None
    used_preference = False
    if pref_id:
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT v.id, vp.avg_cost, COALESCE(vp.jobs_completed, 0) AS jobs_completed
                FROM traxkey.vendors v
                LEFT JOIN traxkey.vendor_performance vp ON vp.vendor_id = v.id
                WHERE v.id = %s AND v.company_id = %s AND v.trade = %s
                """,
                (pref_id, state["company_id"], trade),
            )
            row = cur.fetchone()
        used_preference = row is not None

    if not row:
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT v.id, vp.avg_cost, COALESCE(vp.jobs_completed, 0) AS jobs_completed
                FROM traxkey.vendors v
                LEFT JOIN traxkey.vendor_performance vp ON vp.vendor_id = v.id
                WHERE v.company_id = %s AND v.trade = %s
                ORDER BY COALESCE(vp.completion_rate, 0) DESC, COALESCE(vp.avg_rating, 0) DESC, COALESCE(vp.avg_cost, 999999) ASC
                LIMIT 1
                """,
                (state["company_id"], trade),
            )
            row = cur.fetchone()

    if not row:
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE traxkey.maintenance_requests SET status = 'needs_vendor' WHERE id = %s",
                (state["request_id"],),
            )
            cur.execute(
                "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'needs_vendor', %s)",
                (state["request_id"], f"No {state['category']} vendor on file for this company."),
            )
        return {**state, "vendor_id": None, "final_status": "needs_vendor"}

    # A vendor with zero completed jobs has no real cost history, an
    # unknown cost needs a human, not a $0 default that would slip past
    # every threshold check for that vendor's very first job.
    known_cost = row["jobs_completed"] > 0 and row["avg_cost"] is not None
    quoted_cost = float(row["avg_cost"]) if known_cost else None

    if used_preference:
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'vendor_matched', %s)",
                (state["request_id"], f"Assigned to your preferred {trade} vendor, set in Business Memory."),
            )

    return {**state, "vendor_id": str(row["id"]), "quoted_cost": quoted_cost, "known_cost": known_cost}


def check_approval(state: RequestState) -> RequestState:
    """Deterministic threshold check. This is the Level 4/5 split from the
    maturity model: under threshold proceeds on its own, over threshold
    pauses for a human. Estimate only, not a real bid, until a vendor
    quote-request flow exists. An unknown cost (a vendor with no job
    history yet) always requires approval, never auto-dispatches on a
    guess.

    Business Memory can only ever make this stricter, never looser than the
    company default: a threshold override replaces the ceiling, but
    always_require_approval and quiet_hours can only add a reason to pause,
    never remove one. There is no rule type that widens the gate."""
    rules = state.get("rules", [])
    threshold, threshold_rule = effective_threshold(
        rules, state["cost_approval_threshold"],
        trade=state["category"], property_id=state.get("property_id"), unit_id=state.get("unit_id"),
    )
    forced_rule = forces_approval(
        rules, trade=state["category"], property_id=state.get("property_id"), unit_id=state.get("unit_id")
    )
    quiet, quiet_rule = in_quiet_hours(rules, state.get("timezone"))

    requires_approval = (
        (not state["known_cost"])
        or (state["quoted_cost"] > threshold)
        or bool(forced_rule)
        or quiet
    )

    with db() as conn, conn.cursor() as cur:
        if requires_approval:
            cur.execute(
                """
                UPDATE traxkey.maintenance_requests
                SET status = 'awaiting_approval', assigned_vendor_id = %s, quoted_cost = %s, requires_human_approval = true
                WHERE id = %s
                """,
                (state["vendor_id"], state["quoted_cost"], state["request_id"]),
            )
            if forced_rule:
                reason = f"Held for approval: {forced_rule.get('note') or 'your business rule requires approval on everything in this scope.'}"
            elif quiet:
                reason = f"Held for approval: outside your quiet hours ({quiet_rule['value']}), no auto-dispatch during this window."
            elif not state["known_cost"]:
                reason = "This vendor has no completed jobs on file yet, no cost history to auto-approve against."
            elif threshold_rule:
                reason = f"Estimated cost ${state['quoted_cost']:.0f} is over your ${threshold:.0f} limit for this ({threshold_rule['scope']}), set in Business Memory."
            else:
                reason = f"Estimated cost ${state['quoted_cost']:.0f} is over the ${threshold:.0f} approval threshold."
            cur.execute(
                "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'approval_needed', %s)",
                (state["request_id"], reason),
            )
        else:
            cur.execute(
                """
                UPDATE traxkey.maintenance_requests
                SET status = 'assigned', assigned_vendor_id = %s, quoted_cost = %s
                WHERE id = %s
                """,
                (state["vendor_id"], state["quoted_cost"], state["request_id"]),
            )

    return {**state, "requires_approval": requires_approval}


def notify_vendor(request_id: str) -> None:
    """Best-effort: a failed notification should never block a dispatch
    that already happened in the database. Vendor has no login yet, this
    is the whole "vendor knows a job exists" mechanism for now."""
    if not RESEND_API_KEY:
        return
    try:
        with db() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT mr.description, mr.category, mr.urgency, mr.quoted_cost,
                  v.name AS vendor_name, v.contact_email,
                  u.unit_number, p.name AS property_name, p.address_line1, p.city, p.state
                FROM traxkey.maintenance_requests mr
                JOIN traxkey.vendors v ON v.id = mr.assigned_vendor_id
                LEFT JOIN traxkey.units u ON u.id = mr.unit_id
                LEFT JOIN traxkey.properties p ON p.id = u.property_id
                WHERE mr.id = %s
                """,
                (request_id,),
            )
            row = cur.fetchone()

        if not row or not row["contact_email"]:
            return

        address = f"{row['address_line1']}, {row['city']}, {row['state']}" if row["address_line1"] else "address on file"
        unit_part = f", Unit {row['unit_number']}" if row["unit_number"] else ""
        cost_part = f"<p>Estimated cost: ${row['quoted_cost']:.0f}</p>" if row["quoted_cost"] else ""

        html = f"""<div style="font-family: Arial, sans-serif; font-size:14px; color:#1e293b;">
<p>Hi {row['vendor_name']},</p>
<p>New {row['category']} job dispatched to you, urgency: <strong>{row['urgency']}</strong>.</p>
<p><strong>Location:</strong> {row['property_name'] or ''}{unit_part} — {address}</p>
<p><strong>Issue:</strong> {row['description']}</p>
{cost_part}
<p style="font-size:11px;color:#94a3b8;margin-top:24px;">Sent automatically by TraxKey AI.</p>
</div>"""

        requests.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={
                "from": f"TraxKey AI Dispatch <{NOTIFY_FROM_ADDRESS}>",
                "to": row["contact_email"],
                "subject": f"New {row['urgency']} {row['category']} job",
                "html": html,
            },
            timeout=10,
        )
    except Exception:
        # Never let a notification failure surface as a dispatch failure,
        # the job is already scheduled in the database either way.
        traceback.print_exc()


def dispatch(state: RequestState) -> RequestState:
    """Only runs when under the approval threshold, auto-dispatches."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.maintenance_requests SET status = 'scheduled' WHERE id = %s",
            (state["request_id"],),
        )
        cur.execute(
            "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'dispatched', 'Auto-dispatched, within approval threshold.')",
            (state["request_id"],),
        )
    notify_vendor(state["request_id"])
    return {**state, "final_status": "scheduled"}


def dispatch_approved(request_id: str) -> None:
    """A request a human just approved (n8n's approve-request endpoint set
    it to 'assigned') resumes here, skipping diagnose/find_vendor/
    check_approval entirely since those already ran, this just finishes
    the job with the vendor and cost already on record."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.maintenance_requests SET status = 'scheduled' WHERE id = %s",
            (request_id,),
        )
        cur.execute(
            "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'dispatched', 'Dispatched after human approval.')",
            (request_id,),
        )
    notify_vendor(request_id)


def route_after_vendor(state: RequestState) -> str:
    return "check_approval" if state.get("vendor_id") else END


def route_after_approval(state: RequestState) -> str:
    return END if state["requires_approval"] else "dispatch"


builder = StateGraph(RequestState)
builder.add_node("load_context", load_context)
builder.add_node("diagnose", diagnose)
builder.add_node("find_vendor", find_vendor)
builder.add_node("check_approval", check_approval)
builder.add_node("dispatch", dispatch)
builder.add_node("hold_for_review", hold_for_review)

builder.set_entry_point("load_context")
builder.add_edge("load_context", "diagnose")
builder.add_conditional_edges("diagnose", route_after_diagnose)
builder.add_conditional_edges("find_vendor", route_after_vendor)
builder.add_conditional_edges("check_approval", route_after_approval)
builder.add_edge("dispatch", END)
builder.add_edge("hold_for_review", END)

graph = builder.compile()


def run_batch():
    """Entry point for a scheduled run: process every new submission, and
    separately, finish dispatching anything a human just approved."""
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM traxkey.maintenance_requests WHERE status = 'submitted'")
        pending = cur.fetchall()

    for row in pending:
        graph.invoke({"request_id": str(row["id"])})

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM traxkey.maintenance_requests WHERE status = 'assigned' AND approved_at IS NOT NULL"
        )
        approved = cur.fetchall()

    for row in approved:
        dispatch_approved(str(row["id"]))


if __name__ == "__main__":
    run_batch()
