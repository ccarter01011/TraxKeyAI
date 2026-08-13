"""Review-risk flagging.

A guest who had a problem during their stay is a review waiting to happen.
Catching that at checkout, while the operator can still reach out, is worth
more to an STR business than almost anything else in this system.

Only we can do this: it needs the booking calendar (was a guest actually
here, and when) and the maintenance history (was their issue handled, how
fast) in the same place. Turnover tools have one, maintenance tools have the
other.

Severity is deterministic SQL. The AI only drafts the outreach message, and
even that is a suggestion the operator sends themselves. Apologising to a
guest is a brand decision, not something to automate behind their back.
"""

import os
import traceback

from anthropic import Anthropic

from db import db

anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

# Look back far enough to catch a worker that was down, not so far that we
# surface ancient stays nobody can act on.
LOOKBACK_DAYS = 5

# What counts as "slow" before it becomes a review risk on its own.
SLOW_HOURS_URGENT = 24
SLOW_HOURS_ROUTINE = 48


def find_stays_with_issues():
    """Recently checked-out guest stays that had maintenance during them.

    Joins bookings to requests by overlap: the request was created between
    check-in and checkout, on that unit.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              b.id AS booking_id,
              b.unit_id,
              b.checkin_date,
              b.checkout_date,
              b.guest_label,
              p.company_id,
              p.name AS property_name,
              u.unit_number,
              json_agg(json_build_object(
                'id', mr.id,
                'description', mr.description,
                'urgency', mr.urgency,
                'status', mr.status,
                'created_at', mr.created_at,
                'closed_at', mr.closed_at,
                'resolved', mr.status IN ('completed','closed'),
                'hours_to_resolve',
                  CASE WHEN mr.closed_at IS NOT NULL
                       THEN EXTRACT(EPOCH FROM (mr.closed_at - mr.created_at)) / 3600
                       ELSE NULL END
              ) ORDER BY mr.created_at) AS issues
            FROM traxkey.bookings b
            JOIN traxkey.units u ON u.id = b.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            JOIN traxkey.maintenance_requests mr
              ON mr.unit_id = b.unit_id
             AND mr.created_at::date >= b.checkin_date
             AND mr.created_at::date <= b.checkout_date
            WHERE NOT b.is_blocked
              AND b.checkout_date <= CURRENT_DATE
              AND b.checkout_date >= CURRENT_DATE - %s::int
              AND NOT EXISTS (
                SELECT 1 FROM traxkey.review_risks rr WHERE rr.booking_id = b.id
              )
            GROUP BY b.id, b.unit_id, b.checkin_date, b.checkout_date, b.guest_label,
                     p.company_id, p.name, u.unit_number
            """,
            (LOOKBACK_DAYS,),
        )
        return cur.fetchall()


def assess(issues):
    """Deterministic severity. Returns (severity, reason) or None if the stay
    was handled well enough that flagging it would just be noise."""
    unresolved = [i for i in issues if not i["resolved"]]
    emergencies = [i for i in issues if i["urgency"] == "emergency"]

    slow = []
    for i in issues:
        hrs = i.get("hours_to_resolve")
        if hrs is None:
            continue
        limit = SLOW_HOURS_URGENT if i["urgency"] in ("emergency", "urgent") else SLOW_HOURS_ROUTINE
        if hrs > limit:
            slow.append((i, round(hrs)))

    # An unresolved problem the guest lived with is the worst case.
    if unresolved:
        unresolved_emergency = [i for i in unresolved if i["urgency"] == "emergency"]
        if unresolved_emergency or len(unresolved) > 1:
            return (
                "high",
                f"{len(unresolved)} issue(s) were still unresolved when the guest checked out"
                + (", including an emergency" if unresolved_emergency else "")
                + ".",
            )
        return ("medium", "An issue was still unresolved when the guest checked out.")

    # Everything got fixed, but slowly.
    if slow:
        worst = max(slow, key=lambda s: s[1])
        return (
            "medium",
            f"Everything was resolved, but one issue took {worst[1]} hours while the guest was in the unit.",
        )

    # An emergency during a stay is worth a courtesy check even if handled fast.
    if emergencies:
        return (
            "low",
            "An emergency came up during the stay. It was resolved quickly, but the guest was affected.",
        )

    return None


def draft_outreach(row, severity, reason, issues):
    """AI writes the message. Suggestion only, never sent automatically."""
    issue_lines = "\n".join(
        f"- {i['description']} ({i['urgency']}, "
        + ("resolved" if i["resolved"] else "NOT resolved")
        + (f", took {round(i['hours_to_resolve'])}h" if i.get("hours_to_resolve") else "")
        + ")"
        for i in issues
    )
    unit = f"{row['property_name']}{' Unit ' + row['unit_number'] if row['unit_number'] else ''}"

    prompt = f"""A guest just checked out of {unit} after a stay from
{row['checkin_date']} to {row['checkout_date']}. During their stay:

{issue_lines}

Assessment: {reason}

Write a short message the property manager can send this guest.

Rules:
- 2 to 4 sentences. This is a text or a quick message, not a letter.
- Acknowledge the specific problem honestly. Don't be vague about it.
- Do not offer a refund, discount, or compensation. That's the operator's
  decision to make, not yours to promise on their behalf.
- Warm and human, not corporate. No "we sincerely apologize for any
  inconvenience".
- Don't beg for a good review or mention reviews at all.
- No greeting placeholder like [Guest Name], just start the message.
- Never use em dashes."""

    response = anthropic_client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=250,
        temperature=0.5,
        messages=[{"role": "user", "content": prompt}],
    )
    text = response.content[0].text.strip()
    # The prompt asks for no em/en dashes, but that instruction isn't
    # reliably followed. Strip them deterministically rather than trusting it.
    return text.replace(" — ", ", ").replace("—", ", ").replace("–", "-")


def run_review_risk_checks():
    """One pass over recent checkouts."""
    for row in find_stays_with_issues():
        try:
            issues = row["issues"]
            verdict = assess(issues)
            if not verdict:
                continue
            severity, reason = verdict

            try:
                outreach = draft_outreach(row, severity, reason, issues)
            except Exception:
                # The flag matters more than the draft. Never lose the flag
                # because the model call failed.
                traceback.print_exc()
                outreach = None

            with db() as conn, conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO traxkey.review_risks
                      (company_id, unit_id, booking_id, checkout_date, severity, reason,
                       request_ids, suggested_outreach)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    -- Predicate repeated: ON CONFLICT can't match a partial unique
                    -- index without it.
                    ON CONFLICT (booking_id) WHERE booking_id IS NOT NULL DO NOTHING
                    """,
                    (
                        row["company_id"], row["unit_id"], row["booking_id"],
                        row["checkout_date"], severity, reason,
                        [i["id"] for i in issues], outreach,
                    ),
                )

            unit = f"{row['property_name']}{' Unit ' + row['unit_number'] if row['unit_number'] else ''}"
            print(f"Review risk [{severity}] {unit}: {reason}")
        except Exception:
            traceback.print_exc()
