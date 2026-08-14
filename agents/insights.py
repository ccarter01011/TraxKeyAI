"""Portfolio Insights: patterns the operator has not noticed.

The payoff for Business Memory. That feature stores the rules an operator
sets deliberately; this one surfaces the things they would only catch by
staring at months of data.

Three rules, from the spec:

1. Every number is deterministic SQL. No LLM anywhere in this file.
2. No insight without a decision attached. "Occupancy is 94%" is trivia.
   "Unit 12 is $300 under portfolio average and its lease ends in 34 days"
   is money. If it does not imply an action it does not ship.
3. It feeds the concierge. The best outcome is the morning briefing saying
   "your HVAC vendor has gotten 40% slower since June" and the operator
   never opening an insights page at all.

An insight is an observation, never an action. Nothing here changes any
setting, and nothing here writes to a table the coordinator reads.
"""

from db import db
from ordered_items import blocking_insights
from str_ops import low_supply_insights

# A vendor whose response time grew by at least this much, against a
# baseline at least this old, is worth flagging. Below this it is noise.
SLOWDOWN_RATIO = 1.4
BASELINE_MIN_DAYS = 21
# Repeat trouble threshold: this many requests of the same trade on one unit.
REPEAT_MIN = 3
# A lease this far under the portfolio average for its bedroom count.
UNDER_MARKET_PCT = 0.10


def snapshot_vendor_performance():
    """Append today's vendor numbers. Idempotent per day via the unique
    constraint, so running hourly is harmless."""
    with db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO traxkey.vendor_performance_history
              (vendor_id, captured_at, jobs_completed, avg_response_hours, avg_cost, completion_rate, avg_rating)
            SELECT vendor_id, CURRENT_DATE, jobs_completed, avg_response_hours, avg_cost, completion_rate, avg_rating
            FROM traxkey.vendor_performance
            ON CONFLICT (vendor_id, captured_at) DO NOTHING
            """
        )


def _vendor_slowdowns(cur, company_id):
    cur.execute(
        """
        WITH latest AS (
          SELECT DISTINCT ON (h.vendor_id) h.vendor_id, h.captured_at, h.avg_response_hours
          FROM traxkey.vendor_performance_history h
          JOIN traxkey.vendors v ON v.id = h.vendor_id
          WHERE v.company_id = %(c)s AND h.avg_response_hours IS NOT NULL
          ORDER BY h.vendor_id, h.captured_at DESC
        ),
        baseline AS (
          SELECT DISTINCT ON (h.vendor_id) h.vendor_id, h.captured_at, h.avg_response_hours
          FROM traxkey.vendor_performance_history h
          JOIN traxkey.vendors v ON v.id = h.vendor_id
          WHERE v.company_id = %(c)s AND h.avg_response_hours IS NOT NULL
          ORDER BY h.vendor_id, h.captured_at ASC
        )
        SELECT v.name, v.trade, b.avg_response_hours AS was, l.avg_response_hours AS now_hours,
               b.captured_at AS since
        FROM latest l
        JOIN baseline b ON b.vendor_id = l.vendor_id
        JOIN traxkey.vendors v ON v.id = l.vendor_id
        WHERE b.avg_response_hours > 0
          AND l.avg_response_hours >= b.avg_response_hours * %(ratio)s
          AND (l.captured_at - b.captured_at) >= %(mindays)s
        """,
        {"c": company_id, "ratio": SLOWDOWN_RATIO, "mindays": BASELINE_MIN_DAYS},
    )
    out = []
    for r in cur.fetchall():
        pct = round((float(r["now_hours"]) / float(r["was"]) - 1) * 100)
        out.append({
            "kind": "vendor_slowdown",
            "severity": "medium",
            "text": f"{r['name']} is responding {pct}% slower than when you started tracking them "
                    f"({float(r['was']):.1f}h then, {float(r['now_hours']):.1f}h now).",
            "action": f"Worth a conversation, or set a preferred {r['trade']} vendor in Business Memory.",
        })
    return out


def _repeat_offenders(cur, company_id):
    cur.execute(
        """
        SELECT p.name AS property_name, u.unit_number, mr.category, count(*) AS n
        FROM traxkey.maintenance_requests mr
        JOIN traxkey.units u ON u.id = mr.unit_id
        JOIN traxkey.properties p ON p.id = u.property_id
        WHERE mr.company_id = %s
          AND mr.created_at > now() - interval '180 days'
          AND mr.category IS NOT NULL
        GROUP BY p.name, u.unit_number, mr.category
        HAVING count(*) >= %s
        ORDER BY count(*) DESC
        LIMIT 5
        """,
        (company_id, REPEAT_MIN),
    )
    out = []
    for r in cur.fetchall():
        where = f"{r['property_name']}{' Unit ' + r['unit_number'] if r['unit_number'] else ''}"
        out.append({
            "kind": "repeat_issue",
            "severity": "medium",
            "text": f"{where} has had {r['n']} {r['category']} requests in six months.",
            "action": "Repeat calls on one trade usually mean the underlying thing needs replacing, not fixing again.",
        })
    return out


def _under_market_leases(cur, company_id):
    """Compares each active lease against the portfolio average for the same
    bedroom count. Explicitly NOT market data, we have none. The honest claim
    is 'under your own average', which is still actionable at renewal."""
    cur.execute(
        """
        WITH avg_by_beds AS (
          SELECT u.bedrooms, avg(l.rent_amount) AS avg_rent, count(*) AS n
          FROM traxkey.leases l
          JOIN traxkey.units u ON u.id = l.unit_id
          JOIN traxkey.properties p ON p.id = u.property_id
          WHERE p.company_id = %(c)s AND l.status = 'active' AND l.rent_amount IS NOT NULL
          GROUP BY u.bedrooms
          HAVING count(*) >= 2
        )
        SELECT p.name AS property_name, u.unit_number, l.rent_amount, a.avg_rent, l.end_date,
               (l.end_date - CURRENT_DATE) AS days_left
        FROM traxkey.leases l
        JOIN traxkey.units u ON u.id = l.unit_id
        JOIN traxkey.properties p ON p.id = u.property_id
        JOIN avg_by_beds a ON a.bedrooms = u.bedrooms
        WHERE p.company_id = %(c)s AND l.status = 'active'
          AND l.rent_amount < a.avg_rent * (1 - %(pct)s)
          AND l.end_date IS NOT NULL
          AND l.end_date <= CURRENT_DATE + 120
        ORDER BY l.end_date
        LIMIT 5
        """,
        {"c": company_id, "pct": UNDER_MARKET_PCT},
    )
    out = []
    for r in cur.fetchall():
        where = f"{r['property_name']}{' Unit ' + r['unit_number'] if r['unit_number'] else ''}"
        gap = round(float(r["avg_rent"]) - float(r["rent_amount"]))
        out.append({
            "kind": "under_average_rent",
            "severity": "high" if r["days_left"] <= 60 else "medium",
            "text": f"{where} is ${gap}/mo below your own average for that size, and its lease ends in {r['days_left']} days.",
            "action": "Renewal is the one moment you can reset it.",
        })
    return out


def _turn_pressure(cur, company_id):
    """The insight only a system holding calendars AND maintenance can
    produce: do same-day turnarounds actually fail more often?"""
    cur.execute(
        """
        SELECT
          count(*) FILTER (WHERE t.deadline_at = t.vacancy_started_at::date) AS same_day,
          count(*) FILTER (WHERE t.deadline_at = t.vacancy_started_at::date
                             AND t.unit_ready_at IS NULL) AS same_day_unfinished,
          count(*) FILTER (WHERE t.deadline_at > t.vacancy_started_at::date) AS multi_day,
          count(*) FILTER (WHERE t.deadline_at > t.vacancy_started_at::date
                             AND t.unit_ready_at IS NULL) AS multi_day_unfinished
        FROM traxkey.turns t
        WHERE t.company_id = %s AND t.turn_type = 'cleaning' AND t.deadline_at IS NOT NULL
        """,
        (company_id,),
    )
    r = cur.fetchone()
    if not r or (r["same_day"] or 0) < 3:
        return []
    same_rate = (r["same_day_unfinished"] or 0) / r["same_day"]
    multi_rate = ((r["multi_day_unfinished"] or 0) / r["multi_day"]) if r["multi_day"] else 0
    if same_rate <= multi_rate:
        return []
    return [{
        "kind": "same_day_pressure",
        "severity": "medium",
        "text": f"Same-day turnarounds run late {round(same_rate * 100)}% of the time, "
                f"against {round(multi_rate * 100)}% when there's more than a day.",
        "action": "Worth a minimum gap on the calendar, or a second cleaner for same-day dates.",
    }]


def get_insights(company_id):
    with db() as conn, conn.cursor() as cur:
        found = (
            blocking_insights(company_id)
            + low_supply_insights(company_id)
            + _vendor_slowdowns(cur, company_id)
            + _under_market_leases(cur, company_id)
            + _repeat_offenders(cur, company_id)
            + _turn_pressure(cur, company_id)
        )
    order = {"high": 0, "medium": 1, "low": 2}
    found.sort(key=lambda i: order.get(i["severity"], 3))
    return {"insights": found}
