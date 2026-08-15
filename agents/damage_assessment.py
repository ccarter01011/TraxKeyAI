"""Guest/tenant charge, insurance claim, or operator absorbs it?

When something breaks, the operator has to answer a question with real money
attached. TraxKey gathers the facts and recommends. It does not decide,
because this is a liability call with legal exposure and state-specific
rules about what can be withheld from a deposit.

The split between what SQL decides and what the LLM decides is the usual
one, and it matters more here than almost anywhere else:

    SQL decides   every fact and every threshold: the deductible, the
                  replacement cost, whether the estimate clears the
                  deductible, who was in the unit, what the item cost new.
    LLM decides   only whether the free-text description reads as accidental
                  damage, normal wear, or a pre-existing fault.

A wrong recommendation here costs a customer relationship or an insurance
premium, so the output always names what is missing rather than filling a
gap with a plausible guess.
"""

import json
import os
import traceback

from anthropic import Anthropic

from db import db

anthropic_client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

CAUSE_PROMPT = """You classify what caused damage in a rental property, from
the description given. Reply with JSON only:

{"cause": "accidental|misuse|normal_wear|mechanical_failure|unclear",
 "confidence": "high|low",
 "reasoning": "one short sentence"}

Definitions:
- accidental: someone broke it by accident (dropped, spilled, knocked over)
- misuse: used in a way it clearly shouldn't be (grease down the drain)
- normal_wear: expected deterioration from ordinary use over time
- mechanical_failure: the thing failed on its own (compressor died)
- unclear: the description genuinely doesn't say

If the description doesn't establish a cause, say unclear with low
confidence. Do not infer blame from tone. Do not guess."""


def _classify_cause(description):
    try:
        msg = anthropic_client.messages.create(
            model="claude-sonnet-4-5",
            max_tokens=200,
            system=CAUSE_PROMPT,
            messages=[{"role": "user", "content": description[:1500]}],
        )
        text = msg.content[0].text.strip()
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
    except Exception:
        traceback.print_exc()
    return {"cause": "unclear", "confidence": "low",
            "reasoning": "Could not classify the description."}


def assess(company_id, request_id):
    """Gather everything relevant, then recommend. All facts from SQL."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT mr.id, mr.description, mr.category, mr.urgency, mr.status,
                   mr.quoted_cost, mr.final_cost, mr.created_at,
                   u.id AS unit_id, u.unit_number,
                   p.id AS property_id, p.name AS property_name,
                   pr.insurance_carrier, pr.insurance_deductible,
                   (SELECT count(*) FROM traxkey.bookings b
                     WHERE b.unit_id = u.id
                       AND b.checkin_date <= mr.created_at::date
                       AND b.checkout_date >= mr.created_at::date) AS guest_in_unit,
                   (SELECT count(*) FROM traxkey.leases l
                     WHERE l.unit_id = u.id AND l.status = 'active') AS has_active_lease
            FROM traxkey.maintenance_requests mr
            JOIN traxkey.units u ON u.id = mr.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            LEFT JOIN traxkey.property_profiles pr ON pr.property_id = p.id
            WHERE mr.id = %s::uuid AND p.company_id = %s
            """,
            (request_id, company_id),
        )
        req = cur.fetchone()
        if not req:
            return {"ok": False, "error": "Request not found."}
        req = dict(req)

        # Matching inventory: what the item cost new, and how old it is.
        cur.execute(
            """
            SELECT name, purchase_price, purchased_on, warranty_expires_on,
                   replacement_url, condition
            FROM traxkey.property_inventory
            WHERE property_id = %s
              AND (%s ILIKE '%%' || name || '%%' OR name ILIKE '%%' || %s || '%%')
            LIMIT 5
            """,
            (req["property_id"], req["description"], req["description"][:60]),
        )
        matches = [dict(r) for r in cur.fetchall()]

    cause = _classify_cause(req["description"] or "")
    cost = req.get("final_cost") or req.get("quoted_cost")
    cost = float(cost) if cost is not None else None
    deductible = float(req["insurance_deductible"]) if req.get("insurance_deductible") is not None else None

    # --- Deterministic recommendation ---------------------------------
    missing = []
    if cost is None:
        missing.append("A cost estimate. Without one, nothing here can be compared to the deductible.")
    if deductible is None:
        missing.append("The insurance deductible for this property. Add it to the property profile.")
    if not req.get("insurance_carrier"):
        missing.append("The insurance carrier for this property.")
    if cause["cause"] == "unclear":
        missing.append("A clearer description of what happened. The cause could not be determined from the report.")
    if not matches:
        missing.append("A matching inventory item, so replacement cost and warranty can be checked.")

    occupant = ("guest" if req["guest_in_unit"] else
                "resident" if req["has_active_lease"] else "nobody")

    warranty_hit = next(
        (m for m in matches
         if m.get("warranty_expires_on") and m["warranty_expires_on"] >= req["created_at"].date()),
        None,
    )

    # Warranty only short-circuits when the thing failed on its own. A
    # manufacturer's warranty does not cover a guest dropping a pan on it,
    # so accidental and misuse skip straight past this.
    if warranty_hit and cause["cause"] in ("mechanical_failure", "normal_wear", "unclear"):
        rec, why = "warranty", (
            f"\"{warranty_hit['name']}\" is still under warranty "
            f"(through {warranty_hit['warranty_expires_on']}) and this reads as the unit "
            f"failing rather than being damaged. Check the warranty before anything else."
        )
        if cause["cause"] == "unclear":
            why += " Confirm nobody damaged it, a warranty won't cover accidental damage."
    elif cause["cause"] in ("normal_wear", "mechanical_failure"):
        rec, why = "operator", (
            "This reads as wear or a component failing on its own, not something "
            "the occupant did. Normally the owner's cost, not chargeable."
        )
    elif cost is None or deductible is None:
        rec, why = "needs_info", "Not enough information to compare cost against the deductible."
    elif cause["cause"] in ("accidental", "misuse") and occupant != "nobody":
        if cost > deductible * 2:
            rec, why = "insurance", (
                f"Estimated ${cost:,.0f} is well above the ${deductible:,.0f} deductible, "
                f"and the cause looks like {cause['cause']}. Worth a claim."
            )
        else:
            rec, why = "charge_occupant", (
                f"Estimated ${cost:,.0f} is at or below the ${deductible:,.0f} deductible, "
                f"so a claim would cost more than it recovers. Bill the {occupant} instead if your agreement allows."
            )
    elif cost is not None and deductible is not None and cost > deductible * 2:
        rec, why = "insurance", (
            f"Estimated ${cost:,.0f} clears the ${deductible:,.0f} deductible comfortably."
        )
    else:
        rec, why = "operator", "Below the deductible with no clear occupant fault. Likely the owner's cost."

    assessment = {
        "recommendation": rec,
        "reasoning": why,
        "cause": cause,
        "facts": {
            "estimatedCost": cost,
            "deductible": deductible,
            "carrier": req.get("insurance_carrier"),
            "occupant": occupant,
            "where": req["property_name"] + (f" Unit {req['unit_number']}" if req.get("unit_number") else ""),
            "inventoryMatches": [
                {"name": m["name"],
                 "purchasePrice": float(m["purchase_price"]) if m.get("purchase_price") is not None else None,
                 "purchasedOn": str(m["purchased_on"]) if m.get("purchased_on") else None,
                 "warrantyExpiresOn": str(m["warranty_expires_on"]) if m.get("warranty_expires_on") else None,
                 "replacementUrl": m.get("replacement_url")}
                for m in matches
            ],
        },
        "missingInfo": missing,
        "disclaimer": ("A recommendation, not a decision. What may be charged to a "
                       "resident or withheld from a deposit is governed by your lease "
                       "and your state's rules. TraxKey does not process the charge or "
                       "file the claim."),
    }

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE traxkey.maintenance_requests SET damage_assessment = %s WHERE id = %s::uuid",
            (json.dumps(assessment), request_id),
        )

    return {"ok": True, "assessment": assessment}
