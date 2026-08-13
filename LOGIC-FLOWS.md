# TraxKey AI — Logic Flows

Reference for how each automated flow actually works end to end. Keep this
current, it's the source for the in-app "How this works" hovers and for
explaining the product to customers.

Last updated: 2026-08-13

---

## 1. AI Maintenance Coordinator

The core flow. Runs on a polling worker (default every 15 min).

```
Resident/guest submits issue
  ↓  (their own invite link, unit already known)
LOAD CONTEXT              [SQL]  request + company threshold + occupancy
  ↓
DIAGNOSE                  [AI]   category, urgency, owner-vs-tenant
  ↓                              occupancy fed in as context
FIND VENDOR               [SQL]  ranked: completion rate → rating → cost
  ↓
  ├─ no vendor for trade → NEEDS VENDOR (human assigns)
  ↓
CHECK APPROVAL            [SQL]  cost vs company threshold
  ↓
  ├─ over threshold      → AWAITING APPROVAL
  ├─ vendor has no       → AWAITING APPROVAL
  │  cost history               (unknown cost ≠ cheap cost)
  ↓
DISPATCH                         status = scheduled
  ↓
NOTIFY VENDOR             [email] job details, location, urgency
  ↓
VENDOR MARKS IN PROGRESS  [vendor portal]
  ↓
PM MARKS COMPLETE         final cost + rating
  ↓
UPDATE VENDOR SCORE       [SQL]  feeds the next dispatch decision
```

**Design rule:** only DIAGNOSE uses AI. Every threshold, ranking, and gate
is deterministic SQL. An LLM can't hallucinate a vendor choice or approve
a cost.

**Human-in-the-loop:** approval is required whenever cost is over threshold
*or* unknown. A vendor earns autonomy by accumulating real cost history.

---

## 2. Occupancy-aware urgency (STR)

```
Airbnb/Vrbo iCal feed
  ↓  (public standard, no API key needed)
SYNC (hourly)             fetch → parse VEVENTs → upsert bookings
  ↓
  ├─ "Reserved" / guest name  → real booking
  └─ "Not available"/"Blocked" → owner block (excluded from occupancy)
  ↓
OCCUPANCY                 [SQL]  occupied now? checkout when? next arrival?
  ↓
Fed into DIAGNOSE as context
```

**Why it matters:** the same broken AC is an emergency with a guest in the
unit and a routine task in a unit vacant for two weeks.

**Cancellations:** a booking that disappears from the feed is deleted, scoped
to current/future only so history survives.

---

## 3. Turn management (vacant → ready)

One engine for both a long-term move-out turnover and a short-term cleaning
turn. Same lifecycle, different timeline.

```
Unit goes vacant
  ↓
START TURN                unit → vacant, blocks a second active turn
  ↓
INSPECTING                (timestamp stamped once)
  ↓
ADD REPAIRS               PM-created maintenance requests, linked to turn
  ↓                       → each flows through the AI Coordinator above
REPAIRS IN PROGRESS
  ↓
READY                     unit_ready_at stamped, days-vacant clock stops
  ↓
RELISTED
  ↓
OCCUPIED                  unit → occupied, turn closed
```

**Cost rollup:** `total_cost` is recomputed from linked repairs on every
stage change, always correct rather than tracking a running total.

**Timestamps** are stamped only the first time each stage is reached, so
re-advancing never overwrites real history.

**The metric that matters:** days vacant. Every day counted is a day not
earning.

### 3a. Auto-opened cleaning turns (STR)

Where calendar sync becomes operational work:

```
Guest checkout date passes
  ↓  (detected on the hourly calendar sync)
Unit has no active turn?
  ↓  yes
OPEN CLEANING TURN        auto_created = true, unit → vacant
  ↓
DEADLINE = next guest's check-in
  ↓
  ├─ next guest arrives same day → "hours, not days"
  ├─ arrives in N days           → N days to get ready
  └─ nothing booked              → no hard deadline
```

**Owner blocks never trigger a turn**, an owner-blocked unit is unavailable
but nobody stayed in it, so there's nothing to clean.

**Idempotent:** the triggering booking is recorded on the turn, so repeated
worker passes can't open duplicate turns for the same checkout.

**Why this is defensible:** seeing a same-day turnaround requires having the
booking calendar and the work engine in the same system. Turnover-only tools
don't have the maintenance side; maintenance-only tools don't have the
calendar.

---

## 3b. Pre-arrival readiness check (STR)

Catches the failure that costs an operator a bad review.

```
Guest arriving within 2 days
  ↓
Unit has open maintenance, or a turn not yet ready?
  ↓  yes
ALERT                     logged to the audit trail + emailed to the operator
  ↓
Once per unit per arrival   (worker runs hourly, nobody wants it hourly)
```

**Why small operators miss this:** it needs the booking calendar, open
maintenance, and turn status looked at together. Most tools hold only one of
the three.

**Window is 2 days** deliberately: enough lead time to actually fix
something, not so far out that it cries wolf.

---

## 4. Auth model

Three separate principals, deliberately never sharing a session store:

| Who | Table | Session table | Access |
|---|---|---|---|
| Company staff | `users` | `sessions` | their own company's data |
| Vendors | `vendors` | `vendor_sessions` | only jobs assigned to them |
| TraxKey admin | `admins` | `admin_sessions` | platform metrics |

Residents/guests have **no login at all**, they use a per-resident token
link that already identifies their unit.

**Tenant isolation:** every write checks the target belongs to the caller's
own company, via `WHERE EXISTS` against the property/company chain.

---

## Recurring implementation gotchas

Bugs found in production, worth not repeating:

1. **`alwaysOutputData` on conditional updates.** An UPDATE whose WHERE
   matches zero rows emits no items, and the chain silently dies. Any node
   that might match nothing needs this flag or the steps after it never run.
2. **Don't read `$json.id` after a bare UPDATE.** No RETURNING means no id.
   Reference the earlier node that does return one.
3. **Unknown cost is not zero cost.** A new vendor with no history defaulted
   to a $0 estimate, which auto-approved past every threshold. Unknown must
   route to human approval.
4. **Zero-row SELECTs return `[{}]`, not `[]`.** Filter on a real field
   client-side.
