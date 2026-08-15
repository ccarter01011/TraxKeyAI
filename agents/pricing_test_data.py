"""Seeds a test direct-booking property with dynamic pricing, on demand.

Not wired into the sample-data flow (`sample_data.py`) on purpose: this is
for demonstrating the pricing engine specifically, not the general "try the
whole product" demo. Callable directly, or via a worker route if the
dashboard ever wants a button for it.

Everything created here is tagged is_sample and named "Test:" so it's
obviously not real data, matching the convention sample_data.py already
uses, and removable the same way.
"""

from datetime import date, timedelta

from db import db
from pricing_engine import suggest_rates, create_reservation

UNITS = [
    ("Test: Lakeside A", 220),
    ("Test: Lakeside B", 220),
    ("Test: Ridge Cabin", 340),
]


def seed(company_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.properties (company_id, name, address_line1, city, state, zip, property_type, is_sample)
            VALUES (%s, 'Test: Cedar Lake Compound', '1 Cedar Lake Rd', 'Boone', 'NC', '28607', 'multifamily', true)
            RETURNING id
            """,
            (company_id,),
        )
        prop_id = cur.fetchone()["id"]

        unit_ids = []
        for name, rate in UNITS:
            cur.execute(
                """
                INSERT INTO traxkey.units (property_id, unit_number, bedrooms, bathrooms, status, base_nightly_rate)
                VALUES (%s, %s, 2, 1, 'occupied', %s)
                RETURNING id
                """,
                (prop_id, name, rate),
            )
            unit_ids.append(cur.fetchone()["id"])

    today = date.today()
    for uid in unit_ids:
        suggest_rates(company_id, str(uid), today, today + timedelta(days=45))

    # A couple of confirmed direct reservations, so the calendar isn't empty
    # and rate-locking (a booked night keeps its booked rate) has something
    # to demonstrate.
    create_reservation(company_id, {
        "unitId": str(unit_ids[0]), "guestName": "Test: J. Alvarez",
        "guestEmail": "test@example.com",
        "checkinDate": str(today + timedelta(days=5)),
        "checkoutDate": str(today + timedelta(days=8)),
        "nightlyRate": "260", "source": "test",
    })
    create_reservation(company_id, {
        "unitId": str(unit_ids[2]), "guestName": "Test: R. Chen",
        "guestEmail": "test@example.com",
        "checkinDate": str(today + timedelta(days=12)),
        "checkoutDate": str(today + timedelta(days=15)),
        "nightlyRate": "390", "source": "test",
    })

    return {"ok": True, "propertyId": str(prop_id), "unitIds": [str(u) for u in unit_ids]}


def remove(company_id):
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM traxkey.properties
            WHERE company_id = %s AND is_sample = true AND name LIKE 'Test: %%'
            RETURNING id
            """,
            (company_id,),
        )
        removed = cur.rowcount
    return {"ok": True, "removed": removed}
