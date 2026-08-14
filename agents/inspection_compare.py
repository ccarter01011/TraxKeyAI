"""Move-in vs move-out condition comparison.

The differentiated bit of inspections, and it is pure SQL. For each
area+item present in both a unit's move-in and move-out inspection for the
same lease, report whether the condition got worse, and by how many steps.

Deliberately NOT AI, and this is the important design decision. A model
looking at two photos and pronouncing "this is damage beyond normal wear"
would be:
  1. wrong often enough to matter, and
  2. producing a conclusion with legal weight in a deposit dispute.

Deposit deductions are governed by state law with itemisation and timing
rules that vary by jurisdiction. So this function reports a factual
condition delta, "Kitchen / Countertops went from good to damaged", and
stops there. A person marks `beyond_normal_wear`. Evidence, not adjudication.
"""

from db import db

# Ordered worst to best. The index difference is the "how many steps worse"
# number, which is a fact about what the inspector recorded, not a judgment.
CONDITION_ORDER = ["missing", "damaged", "poor", "fair", "good"]
CONDITION_RANK = {c: i for i, c in enumerate(CONDITION_ORDER)}


def compare(move_in_id, move_out_id):
    """Condition changes between two inspections of the same unit.

    Returns a list of dicts, worst regression first. Items present in only
    one inspection are reported separately rather than silently dropped: an
    item that appears only at move-out is usually something that was missed
    at move-in, and the operator should see that rather than have it hidden.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT area, item, condition, notes, photo_urls
            FROM traxkey.inspection_items WHERE inspection_id = %s
            """,
            (move_in_id,),
        )
        before = {(r["area"].strip().lower(), r["item"].strip().lower()): dict(r)
                  for r in cur.fetchall()}

        cur.execute(
            """
            SELECT id, area, item, condition, notes, photo_urls, beyond_normal_wear
            FROM traxkey.inspection_items WHERE inspection_id = %s
            """,
            (move_out_id,),
        )
        after = [dict(r) for r in cur.fetchall()]

    changes, new_items = [], []
    for a in after:
        key = (a["area"].strip().lower(), a["item"].strip().lower())
        b = before.get(key)
        if not b:
            new_items.append({
                "area": a["area"], "item": a["item"],
                "condition": a["condition"],
                "note": "Not recorded at move-in, so there is nothing to compare it to.",
            })
            continue

        steps = CONDITION_RANK[b["condition"]] - CONDITION_RANK[a["condition"]]
        if steps <= 0:
            continue  # same or better, not a finding

        changes.append({
            "item_id": str(a["id"]),
            "area": a["area"],
            "item": a["item"],
            "before": b["condition"],
            "after": a["condition"],
            "steps_worse": steps,
            "move_in_photos": b.get("photo_urls") or [],
            "move_out_photos": a.get("photo_urls") or [],
            "move_out_notes": a.get("notes"),
            # Whatever a person decided, or None if nobody has yet. Never
            # inferred here.
            "beyond_normal_wear": a.get("beyond_normal_wear"),
        })

    changes.sort(key=lambda c: c["steps_worse"], reverse=True)
    return {"changes": changes, "new_items": new_items}


def find_comparable(unit_id, lease_id=None):
    """The move-in and move-out inspection to compare for a tenancy.

    Scoped to a lease when given, so a unit with five years of turnovers
    compares the right pair instead of the oldest move-in against the newest
    move-out.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              (SELECT id FROM traxkey.inspections
                WHERE unit_id = %(u)s AND inspection_type = 'move_in'
                  AND status = 'completed'
                  AND (%(l)s::uuid IS NULL OR lease_id = %(l)s::uuid)
                ORDER BY created_at DESC LIMIT 1) AS move_in_id,
              (SELECT id FROM traxkey.inspections
                WHERE unit_id = %(u)s AND inspection_type = 'move_out'
                  AND status = 'completed'
                  AND (%(l)s::uuid IS NULL OR lease_id = %(l)s::uuid)
                ORDER BY created_at DESC LIMIT 1) AS move_out_id
            """,
            {"u": unit_id, "l": lease_id},
        )
        row = cur.fetchone()
    if not row or not row["move_in_id"] or not row["move_out_id"]:
        return None
    return str(row["move_in_id"]), str(row["move_out_id"])
