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
from typing import TypedDict, Optional

import psycopg
from psycopg.rows import dict_row
from anthropic import Anthropic
from langgraph.graph import StateGraph, END

DATABASE_URL = os.environ["DATABASE_URL"]
anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

VALID_TRADES = ["hvac", "plumbing", "electrical", "appliance", "general", "pest", "locksmith", "roofing"]


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
    final_status: str


def db():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, autocommit=True)


def load_context(state: RequestState) -> RequestState:
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT mr.description, mr.company_id, mr.unit_id, c.cost_approval_threshold
            FROM traxkey.maintenance_requests mr
            JOIN traxkey.companies c ON c.id = mr.company_id
            WHERE mr.id = %s
            """,
            (state["request_id"],),
        )
        row = cur.fetchone()
    return {
        **state,
        "description": row["description"],
        "company_id": str(row["company_id"]),
        "unit_id": str(row["unit_id"]) if row["unit_id"] else None,
        "cost_approval_threshold": float(row["cost_approval_threshold"]),
    }


def diagnose(state: RequestState) -> RequestState:
    """The one LLM step: classify a free-text tenant description. Everything
    downstream of this is plain SQL, no further AI judgment calls."""
    prompt = f"""A tenant reported this maintenance issue:

"{state['description']}"

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
        cur.execute(
            """
            INSERT INTO traxkey.maintenance_events (request_id, event_type, content)
            VALUES (%s, 'triaged', %s)
            """,
            (state["request_id"], f"Category: {parsed['category']}, urgency: {parsed['urgency']}, responsibility: {parsed['responsibility']}"),
        )

    return {**state, "category": parsed["category"], "urgency": parsed["urgency"], "responsibility": parsed["responsibility"]}


def find_vendor(state: RequestState) -> RequestState:
    """Deterministic: best vendor on file for this trade, ranked by real
    history, same reliability-scoring principle as TraxSail's supplier
    score. No AI judgment on which vendor is "best"."""
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
            (state["company_id"], state["category"]),
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

    return {**state, "vendor_id": str(row["id"]), "quoted_cost": quoted_cost, "known_cost": known_cost}


def check_approval(state: RequestState) -> RequestState:
    """Deterministic threshold check. This is the Level 4/5 split from the
    maturity model: under threshold proceeds on its own, over threshold
    pauses for a human. Estimate only, not a real bid, until a vendor
    quote-request flow exists. An unknown cost (a vendor with no job
    history yet) always requires approval, never auto-dispatches on a
    guess."""
    requires_approval = (not state["known_cost"]) or (state["quoted_cost"] > state["cost_approval_threshold"])

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
            if state["known_cost"]:
                reason = f"Estimated cost ${state['quoted_cost']:.0f} is over the ${state['cost_approval_threshold']:.0f} approval threshold."
            else:
                reason = "This vendor has no completed jobs on file yet, no cost history to auto-approve against."
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


def dispatch(state: RequestState) -> RequestState:
    """Only runs when under the approval threshold, auto-dispatches. A
    request paused at awaiting_approval resumes into this same node once a
    human approves it (a separate, simpler check-and-dispatch pass, not
    built yet, next increment)."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.maintenance_requests SET status = 'scheduled' WHERE id = %s",
            (state["request_id"],),
        )
        cur.execute(
            "INSERT INTO traxkey.maintenance_events (request_id, event_type, content) VALUES (%s, 'dispatched', 'Auto-dispatched, within approval threshold.')",
            (state["request_id"],),
        )
    return {**state, "final_status": "scheduled"}


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

builder.set_entry_point("load_context")
builder.add_edge("load_context", "diagnose")
builder.add_edge("diagnose", "find_vendor")
builder.add_conditional_edges("find_vendor", route_after_vendor)
builder.add_conditional_edges("check_approval", route_after_approval)
builder.add_edge("dispatch", END)

graph = builder.compile()


def run_batch():
    """Entry point for a scheduled run: process every request still sitting
    at 'submitted'. This is what LangGraph Platform's cron config invokes."""
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT id FROM traxkey.maintenance_requests WHERE status = 'submitted'")
        pending = cur.fetchall()

    for row in pending:
        graph.invoke({"request_id": str(row["id"])})


if __name__ == "__main__":
    run_batch()
