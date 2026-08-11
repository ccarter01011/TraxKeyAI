# AI Maintenance Coordinator — design

Same deterministic-vs-reasoning split used throughout this project: SQL for
facts and thresholds, an LLM only for judgment calls on ambiguous text.

## Trigger

Fires when a `maintenance_requests` row is inserted with `status = 'submitted'`
(from either the resident-token intake or the company-code fallback intake).

## Steps

1. **Load context** (deterministic SQL)
   Pull the request row, the company's `cost_approval_threshold`, and — if
   `unit_id` is set — the unit's property and any existing vendor history for
   that company.

2. **Diagnose** (LLM)
   Input: the tenant's raw `description`.
   Output: `category` (hvac / plumbing / electrical / appliance / general /
   pest / locksmith / roofing), a confirmed or corrected `urgency`, and
   `responsibility` (owner / tenant / unclear — e.g. a clogged drain from
   tenant misuse vs. a failed water heater).
   This is the one step that has to be an LLM call, a short free-text
   description doesn't parse with a regex.

3. **Find vendor** (deterministic SQL)
   `SELECT ... FROM vendors JOIN vendor_performance ... WHERE company_id = ?
   AND trade = ? ORDER BY completion_rate DESC, avg_rating DESC, avg_cost ASC
   LIMIT 1`. Same reliability-scoring approach as TraxSail's supplier score,
   no AI judgment on which vendor is "best," it's math over real history.
   No vendor on file for that trade → request goes to a `needs_vendor` state
   instead of stalling silently, and shows up in the exception-style feed for
   a human to assign manually.

4. **Estimate cost** (deterministic, clearly labeled as an estimate)
   Until a real vendor-bidding flow exists, `quoted_cost` = that vendor's
   `avg_cost` for the trade. Not a real quote, an estimate from history, UI
   must say so.

5. **Check approval threshold** (deterministic)
   `quoted_cost > company.cost_approval_threshold` → `requires_human_approval
   = true`, request pauses in an `awaiting_approval` state.
   Otherwise → proceeds straight to dispatch. This is the Level 4 "execute
   with approval" / Level 5 "autonomous within policy" split from the
   maturity model already shipped on the TraxSail marketing site, same idea,
   different product.

6. **Dispatch** (deterministic)
   Sets `status = 'scheduled'`, `assigned_vendor_id`, logs a
   `maintenance_events` row. (Follow-up, verify, invoice, close are the next
   increment after this lands, deliberately out of scope for v1.)

## New DB needs (not yet migrated)

- `maintenance_requests.category`, `.responsibility` already exist as nullable
  text/check columns from schema v1, no migration needed for those.
- A `needs_vendor` value has to be added to the `maintenance_requests.status`
  CHECK constraint (currently: submitted, triaged, assigned, scheduled,
  in_progress, on_hold, completed, closed) and an `awaiting_approval` value
  too. Small migration, not written yet, waiting to confirm where this runs
  before finalizing exact column needs.
