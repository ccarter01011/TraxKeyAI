"""Analytics & Reporting: rollups over time, distinct from the operational
pages (Activity, Turns) that show individual rows an operator acts on.

This answers "how is the business doing," not "what needs me today." All
SQL, all deterministic. Nothing here estimates or guesses a number that
isn't directly computable from the operator's own data.

Financial Reports stays on the same side of the money boundary as Invoices:
it shows spend and what's owed, it never processes a payment. Owner
Statements shows *scheduled* rent from lease terms, explicitly labeled as
such, because TraxKey does not process rent collection and so has no record
of what was actually paid.
"""

from db import db


def occupancy_summary(company_id):
    """Current occupancy, by property and portfolio-wide, plus how long
    units have sat vacant over the last 90 days of turns. No historical
    occupancy trend: TraxKey doesn't snapshot unit status over time today,
    so this reports what it can actually compute rather than inventing a
    trend line."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT p.id, p.name,
                   count(u.id) AS units,
                   count(u.id) FILTER (WHERE u.status = 'occupied') AS occupied
            FROM traxkey.properties p
            LEFT JOIN traxkey.units u ON u.property_id = p.id
            WHERE p.company_id = %s
            GROUP BY p.id
            ORDER BY p.name
            """,
            (company_id,),
        )
        by_property = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT avg(EXTRACT(DAY FROM (COALESCE(t.unit_ready_at, now()) - t.vacancy_started_at)))
                     AS avg_days_vacant,
                   count(*) AS turns_completed
            FROM traxkey.turns t
            JOIN traxkey.units u ON u.id = t.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %s
              AND t.status = 'occupied'
              AND t.vacancy_started_at > now() - interval '90 days'
            """,
            (company_id,),
        )
        turn_stats = dict(cur.fetchone() or {})

    total_units = sum(p["units"] for p in by_property)
    occupied = sum(p["occupied"] for p in by_property)
    return {
        "byProperty": by_property,
        "totalUnits": total_units,
        "occupied": occupied,
        "occupancyPct": round(occupied / total_units * 100) if total_units else 0,
        "avgDaysVacant90d": round(float(turn_stats["avg_days_vacant"]), 1) if turn_stats.get("avg_days_vacant") else None,
        "turnsCompleted90d": turn_stats.get("turns_completed", 0),
    }


def rental_activity_summary(company_id, days=90):
    """Portfolio-wide activity rollup over a period: leases signed, turns
    completed, maintenance opened/closed. The counting equivalent of what
    the Activity and Turns pages show row by row."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              (SELECT count(*) FROM traxkey.leases l
                 JOIN traxkey.units u ON u.id = l.unit_id
                 JOIN traxkey.properties p ON p.id = u.property_id
                WHERE p.company_id = %(c)s AND l.start_date > CURRENT_DATE - %(d)s::int
                  AND l.status = 'active') AS leases_started,
              (SELECT count(*) FROM traxkey.leases l
                 JOIN traxkey.units u ON u.id = l.unit_id
                 JOIN traxkey.properties p ON p.id = u.property_id
                WHERE p.company_id = %(c)s AND l.renewal_offered_at > now() - (%(d)s::text || ' days')::interval) AS renewals_offered,
              (SELECT count(*) FROM traxkey.turns t
                 JOIN traxkey.units u ON u.id = t.unit_id
                 JOIN traxkey.properties p ON p.id = u.property_id
                WHERE p.company_id = %(c)s AND t.status = 'occupied'
                  AND t.vacancy_started_at > now() - (%(d)s::text || ' days')::interval) AS turns_completed,
              (SELECT count(*) FROM traxkey.maintenance_requests mr
                 JOIN traxkey.units u ON u.id = mr.unit_id
                 JOIN traxkey.properties p ON p.id = u.property_id
                WHERE p.company_id = %(c)s AND mr.created_at > now() - (%(d)s::text || ' days')::interval) AS requests_opened,
              (SELECT count(*) FROM traxkey.maintenance_requests mr
                 JOIN traxkey.units u ON u.id = mr.unit_id
                 JOIN traxkey.properties p ON p.id = u.property_id
                WHERE p.company_id = %(c)s AND mr.status = 'closed'
                  AND mr.closed_at > now() - (%(d)s::text || ' days')::interval) AS requests_closed
            """,
            {"c": company_id, "d": days},
        )
        totals = dict(cur.fetchone())

        cur.execute(
            """
            SELECT date_trunc('week', mr.created_at)::date AS week, count(*) AS opened
            FROM traxkey.maintenance_requests mr
            JOIN traxkey.units u ON u.id = mr.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %(c)s AND mr.created_at > now() - (%(d)s::text || ' days')::interval
            GROUP BY 1 ORDER BY 1
            """,
            {"c": company_id, "d": days},
        )
        weekly = [dict(r) for r in cur.fetchall()]

    return {"period_days": days, "totals": totals, "weekly": weekly}


def financial_summary(company_id, days=90):
    """Spend and what's owed. Visibility only: nothing here processes a
    payment or moves money, same boundary as Invoices and Ordered items."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT COALESCE(sum(mr.final_cost), 0) AS maintenance_spend,
                   count(mr.id) FILTER (WHERE mr.final_cost IS NOT NULL) AS jobs_paid
            FROM traxkey.maintenance_requests mr
            JOIN traxkey.units u ON u.id = mr.unit_id
            JOIN traxkey.properties p ON p.id = u.property_id
            WHERE p.company_id = %(c)s AND mr.created_at > now() - (%(d)s::text || ' days')::interval
            """,
            {"c": company_id, "d": days},
        )
        maint = dict(cur.fetchone())

        cur.execute(
            """
            SELECT COALESCE(sum(oi.cost), 0) AS order_spend
            FROM traxkey.ordered_items oi
            WHERE oi.company_id = %(c)s AND oi.ordered_on > CURRENT_DATE - %(d)s::int
            """,
            {"c": company_id, "d": days},
        )
        orders = dict(cur.fetchone())

        cur.execute(
            """
            SELECT p.name AS property_name, COALESCE(sum(mr.final_cost), 0) AS spend
            FROM traxkey.properties p
            LEFT JOIN traxkey.units u ON u.property_id = p.id
            LEFT JOIN traxkey.maintenance_requests mr
              ON mr.unit_id = u.id AND mr.final_cost IS NOT NULL
             AND mr.created_at > now() - (%(d)s::text || ' days')::interval
            WHERE p.company_id = %(c)s
            GROUP BY p.name ORDER BY spend DESC
            """,
            {"c": company_id, "d": days},
        )
        by_property = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """
            SELECT v.name, COALESCE(sum(mr.final_cost), 0) AS spend, count(mr.id) AS jobs
            FROM traxkey.vendors v
            JOIN traxkey.maintenance_requests mr ON mr.assigned_vendor_id = v.id
              AND mr.final_cost IS NOT NULL AND mr.created_at > now() - (%(d)s::text || ' days')::interval
            WHERE v.company_id = %(c)s
            GROUP BY v.name ORDER BY spend DESC LIMIT 10
            """,
            {"c": company_id, "d": days},
        )
        by_vendor = [dict(r) for r in cur.fetchall()]

    return {
        "period_days": days,
        "maintenanceSpend": float(maint["maintenance_spend"]),
        "jobsPaid": maint["jobs_paid"],
        "orderSpend": float(orders["order_spend"]),
        "totalSpend": float(maint["maintenance_spend"]) + float(orders["order_spend"]),
        "byProperty": by_property,
        "byVendor": by_vendor,
    }


def owner_statements(company_id, days=30):
    """Per-owner: scheduled rent from active lease terms (NOT confirmed
    collected rent, TraxKey does not process payments so has no record of
    what was actually paid), spend attributed to their properties, and the
    difference as an estimate. Explicitly labeled 'scheduled' throughout so
    this can never be mistaken for a real income statement."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT o.id, o.name,
                   count(DISTINCT p.id) AS properties,
                   count(DISTINCT u.id) AS units,
                   COALESCE(sum(unit_rent.rent), 0) AS scheduled_rent_monthly,
                   COALESCE(sum(unit_spend.spend), 0) AS spend_period
            FROM traxkey.owners o
            LEFT JOIN traxkey.properties p ON p.owner_id = o.id
            LEFT JOIN traxkey.units u ON u.property_id = p.id
            LEFT JOIN LATERAL (
              SELECT sum(l.rent_amount) AS rent
              FROM traxkey.leases l
              WHERE l.unit_id = u.id AND l.status = 'active'
            ) unit_rent ON true
            LEFT JOIN LATERAL (
              SELECT sum(mr.final_cost) AS spend
              FROM traxkey.maintenance_requests mr
              WHERE mr.unit_id = u.id AND mr.final_cost IS NOT NULL
                AND mr.created_at > now() - (%(d)s::text || ' days')::interval
            ) unit_spend ON true
            WHERE o.company_id = %(c)s
            GROUP BY o.id
            ORDER BY o.name
            """,
            {"c": company_id, "d": days},
        )
        rows = [dict(r) for r in cur.fetchall()]

    for r in rows:
        r["scheduledRentMonthly"] = float(r.pop("scheduled_rent_monthly") or 0)
        r["spendPeriod"] = float(r.pop("spend_period") or 0)
    return {"period_days": days, "owners": rows}
