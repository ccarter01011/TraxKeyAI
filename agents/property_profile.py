"""Property onboarding profile and inventory.

Two things that answer the same underlying question: what do we actually
know about this property?

The onboarding profile is the SOP made durable. Every operator holds this
knowledge (where the water shutoff is, which breaker trips, that the
upstairs fan is loud but fine) and almost nobody writes it down. That means
the AI cannot use it when a resident asks, and neither can a new employee.

The inventory is the digital twin: what's in the unit, what it cost, and
how to replace it. Used today for replace-on-breakage and damage
assessment, and deliberately built as the shared spine for the separate
setup/procurement product in PLATFORM-ROADMAP.md.

Every read is tenant-scoped through properties.company_id in SQL, never
trusted from the client.
"""

from urllib.parse import urlparse

from db import db

# React's href={value} does not validate URL schemes, only warns in dev — a
# stored javascript: URL renders as a live link in PropertyProfilePage's
# "Buy a replacement" anchor and executes on click, in the clicking user's own
# session. Requires an authenticated same-company user to plant, not
# anonymous, but that is privilege escalation between roles inside a tenant
# (e.g. staff planting a link an admin later clicks) rather than no risk.
#
# Validated at write time so every current AND future render site inherits
# the guard, rather than trusting each new place these are displayed to
# remember to check.
def _safe_url(value):
    value = (value or "").strip()
    if not value:
        return ""
    try:
        parsed = urlparse(value)
    except ValueError:
        return ""
    scheme = parsed.scheme.lower()
    if scheme in ("http", "https"):
        return value
    # No scheme at all (someone pasted "amazon.com/dp/xyz") is the common
    # case for a real link and shouldn't be rejected outright — assume https.
    # Any OTHER scheme (javascript, data, vbscript, ...) is rejected, not
    # coerced, since silently rewriting a hostile one is riskier than telling
    # the operator their link didn't save.
    if not scheme and value and not value.startswith("//"):
        return f"https://{value}"
    return ""

PROFILE_FIELDS = [
    "year_built", "square_feet", "parking_notes", "access_notes",
    "utilities_notes", "water_shutoff_location", "electrical_panel_location",
    "hvac_type", "hvac_filter_size", "water_heater_notes", "appliance_notes",
    "known_quirks", "wifi_notes", "trash_day", "pet_policy", "smoking_policy",
    "emergency_notes", "insurance_carrier", "insurance_policy_number",
    "insurance_deductible",
]

# Fields that make a profile genuinely useful to the resident assistant.
# Onboarding completeness is measured against these rather than every column,
# so an operator isn't nagged for an insurance policy number to hit 100%.
CORE_FIELDS = [
    "access_notes", "water_shutoff_location", "electrical_panel_location",
    "hvac_type", "hvac_filter_size", "known_quirks", "trash_day",
    "emergency_notes",
]

_CAMEL = {f: "".join(w if i == 0 else w.capitalize()
                     for i, w in enumerate(f.split("_")))
          for f in PROFILE_FIELDS}


def get_profile(company_id, property_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.id AS property_id, p.name, p.rental_mode, pr.*
            FROM traxkey.properties p
            LEFT JOIN traxkey.property_profiles pr ON pr.property_id = p.id
            WHERE p.id = %s::uuid AND p.company_id = %s
            """,
            (property_id, company_id),
        )
        row = cur.fetchone()
    if not row:
        return None
    d = dict(row)
    filled = sum(1 for f in CORE_FIELDS if d.get(f) not in (None, ""))
    d["completeness"] = round(filled / len(CORE_FIELDS) * 100)
    return d


def save_profile(company_id, property_id, body):
    """Upsert. Tenant scope is enforced by the SELECT feeding the INSERT, so
    a property_id from another company writes nothing."""
    values = {}
    for f in PROFILE_FIELDS:
        raw = body.get(_CAMEL[f])
        if raw is None:
            continue
        raw = str(raw).strip()
        if f in ("year_built", "square_feet"):
            values[f] = int(raw) if raw.isdigit() else None
        elif f == "insurance_deductible":
            try:
                values[f] = float(raw) if raw else None
            except ValueError:
                values[f] = None
        else:
            values[f] = raw or None

    if not values:
        return {"ok": False, "error": "Nothing to save."}

    cols = list(values)
    set_clause = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols)
    col_list = ", ".join(cols)
    placeholders = ", ".join(f"%({c})s" for c in cols)
    params = dict(values)
    params["pid"] = property_id
    params["cid"] = company_id

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO traxkey.property_profiles
              (property_id, company_id, {col_list}, onboarding_completed_at)
            SELECT p.id, p.company_id, {placeholders}, now()
            FROM traxkey.properties p
            WHERE p.id = %(pid)s::uuid AND p.company_id = %(cid)s
            ON CONFLICT (property_id) DO UPDATE
              SET {set_clause}, updated_at = now()
            RETURNING property_id
            """,
            params,
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Property not found."}


def list_inventory(company_id, property_id=None):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT i.*, p.name AS property_name, u.unit_number
            FROM traxkey.property_inventory i
            JOIN traxkey.properties p ON p.id = i.property_id
            LEFT JOIN traxkey.units u ON u.id = i.unit_id
            WHERE i.company_id = %(c)s
              AND (%(p)s = '' OR i.property_id = NULLIF(%(p)s, '')::uuid)
            ORDER BY p.name, i.room NULLS LAST, i.name
            """,
            {"c": company_id, "p": property_id or ""},
        )
        return [dict(r) for r in cur.fetchall()]


def add_inventory(company_id, body):
    name = (body.get("name") or "").strip()
    prop = (body.get("propertyId") or "").strip()
    if not name:
        return {"ok": False, "error": "Name the item."}
    if not prop:
        return {"ok": False, "error": "Pick a property."}

    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.property_inventory
              (company_id, property_id, unit_id, room, name, category, quantity,
               brand, model_sku, purchase_price, purchased_on, purchase_url,
               warranty_expires_on, replacement_url, condition, notes)
            SELECT p.company_id, p.id,
                   (SELECT u.id FROM traxkey.units u
                     WHERE u.id = NULLIF(%(unit)s, '')::uuid AND u.property_id = p.id),
                   NULLIF(%(room)s, ''), %(name)s,
                   COALESCE(NULLIF(%(cat)s, ''), 'ffe'),
                   GREATEST(COALESCE(NULLIF(%(qty)s, '')::int, 1), 1),
                   NULLIF(%(brand)s, ''), NULLIF(%(sku)s, ''),
                   NULLIF(%(price)s, '')::numeric, NULLIF(%(bought)s, '')::date,
                   NULLIF(%(url)s, ''), NULLIF(%(warranty)s, '')::date,
                   NULLIF(%(repl)s, ''),
                   COALESCE(NULLIF(%(cond)s, ''), 'good'), NULLIF(%(notes)s, '')
            FROM traxkey.properties p
            WHERE p.id = %(prop)s::uuid AND p.company_id = %(c)s
            RETURNING id
            """,
            {"c": company_id, "prop": prop,
             "unit": (body.get("unitId") or "").strip(),
             "room": (body.get("room") or "").strip(),
             "name": name,
             "cat": (body.get("category") or "").strip(),
             "qty": str(body.get("quantity") or "").strip(),
             "brand": (body.get("brand") or "").strip(),
             "sku": (body.get("modelSku") or "").strip(),
             "price": str(body.get("purchasePrice") or "").strip(),
             "bought": (body.get("purchasedOn") or "").strip(),
             "url": _safe_url(body.get("purchaseUrl")),
             "warranty": (body.get("warrantyExpiresOn") or "").strip(),
             "repl": _safe_url(body.get("replacementUrl")),
             "cond": (body.get("condition") or "").strip(),
             "notes": (body.get("notes") or "").strip()},
        )
        row = cur.fetchone()
    return {"ok": True, "id": str(row["id"])} if row else {"ok": False, "error": "Property not found."}


def set_inventory_condition(company_id, item_id, condition):
    if condition not in ("new", "good", "fair", "poor", "damaged", "missing"):
        return {"ok": False, "error": "Unknown condition."}
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            UPDATE traxkey.property_inventory
            SET condition = %s, updated_at = now()
            WHERE id = %s::uuid AND company_id = %s
            RETURNING id
            """,
            (condition, item_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}


def delete_inventory(company_id, item_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM traxkey.property_inventory WHERE id = %s::uuid AND company_id = %s RETURNING id",
            (item_id, company_id),
        )
        row = cur.fetchone()
    return {"ok": True} if row else {"ok": False, "error": "Not found."}


def onboarding_status(company_id):
    """Which properties still need their profile filled in. Drives the
    dashboard's 'step 1' prompt."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.id, p.name,
                   (pr.property_id IS NOT NULL) AS started,
                   pr.onboarding_completed_at,
                   (SELECT count(*) FROM traxkey.property_inventory i
                     WHERE i.property_id = p.id) AS inventory_items
            FROM traxkey.properties p
            LEFT JOIN traxkey.property_profiles pr ON pr.property_id = p.id
            WHERE p.company_id = %s
            ORDER BY p.name
            """,
            (company_id,),
        )
        rows = [dict(r) for r in cur.fetchall()]
    return {
        "properties": rows,
        "needsProfile": [r["name"] for r in rows if not r["started"]],
        "needsInventory": [r["name"] for r in rows if r["inventory_items"] == 0],
    }


def context_for_unit(unit_id):
    """The property nuances the resident assistant should know, for one unit.

    Deliberately excludes anything sensitive: no insurance policy numbers, no
    wifi passwords, nothing about the operator's other clients. A resident
    chat is a public-ish surface; only put in it what you'd tell a resident.
    """
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.name AS property_name, u.unit_number,
                   pr.hvac_type, pr.hvac_filter_size, pr.water_shutoff_location,
                   pr.electrical_panel_location, pr.water_heater_notes,
                   pr.appliance_notes, pr.known_quirks, pr.trash_day,
                   pr.parking_notes, pr.access_notes, pr.pet_policy,
                   pr.smoking_policy, pr.emergency_notes, pr.wifi_notes
            FROM traxkey.units u
            JOIN traxkey.properties p ON p.id = u.property_id
            LEFT JOIN traxkey.property_profiles pr ON pr.property_id = p.id
            WHERE u.id = %s
            """,
            (unit_id,),
        )
        row = cur.fetchone()
    if not row:
        return ""

    d = dict(row)
    where = d["property_name"] + (f" Unit {d['unit_number']}" if d.get("unit_number") else "")
    labels = [
        ("hvac_type", "Heating/cooling system"),
        ("hvac_filter_size", "HVAC filter size"),
        ("water_shutoff_location", "Water shutoff"),
        ("electrical_panel_location", "Electrical panel"),
        ("water_heater_notes", "Water heater"),
        ("appliance_notes", "Appliances"),
        ("known_quirks", "Known quirks (normal for this property)"),
        ("trash_day", "Trash day"),
        ("parking_notes", "Parking"),
        ("access_notes", "Access"),
        ("pet_policy", "Pet policy"),
        ("smoking_policy", "Smoking policy"),
        ("emergency_notes", "Emergency info"),
        ("wifi_notes", "Wi-Fi"),
    ]
    lines = [f"- {label}: {d[key]}" for key, label in labels if d.get(key)]
    if not lines:
        return f"\nTHIS UNIT: {where}. No property profile has been filled in yet, so you do not know anything specific about this building. Do not guess at details like filter sizes or shutoff locations.\n"
    return f"\nTHIS UNIT: {where}. What we know about this specific property:\n" + "\n".join(lines) + "\n"
