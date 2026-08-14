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


---

## Lease and renewal flow

1. Operator adds a lease: unit, term, rent, deposit, notice period.
   The unit is marked occupied.
2. TraxKey surfaces the lease **90 days** before its end date, chosen because
   most leases need 30 to 60 days notice. Anything later means the operator is
   reacting, not deciding.
3. Operator offers a renewal at a rent they choose. The offer and its date are
   recorded on the lease.
4. **Accepted** → a follow-on term is written as a `draft` lease starting the
   day after the current one ends. It is draft, not active, because a partial
   unique index allows only one active lease per unit and a term that has not
   started is not in force.
5. **Declined or no answer** → nothing happens yet. The lease still runs to its
   end date.
6. Hourly, the Lease Agent (`agents/lease_agent.py`) does four things:
   - activates draft terms whose start date has arrived
   - ends fixed terms past their end date (month-to-month leases have a NULL
     end date and are skipped — an open tenancy is real, not missing data)
   - flags renewal offers unanswered for 14 days as `no_response`
   - opens a **move-out turn** automatically when a lease ends with no
     follow-on term, and marks the unit vacant

Step 6's last item is the reason leases and turns belong in one system: the
days-vacant clock starts on the real move-out date, not whenever somebody
remembered to log it.

**No LLM runs anywhere in this flow.** Dates and thresholds are facts.


---

## Cleaner assignment flow

1. A cleaning turn opens (checkout_turns.py, automatic, or the operator
   starts one by hand).
2. The same pass, `agents/cleaner_assignment.py` opens a cleaning job on that
   turn: a `maintenance_requests` row with `category = 'cleaning'`, already
   marked urgent if the turn has a deadline (a next guest booked), routine if
   not.
3. Because category, urgency, and responsibility are already known facts,
   `graph.py`'s `diagnose()` step skips its LLM call entirely and goes
   straight to `find_vendor`, the exact function that ranks any vendor by
   completion rate, rating, and cost history. A cleaner is found the same way
   a plumber is, because it's the same question: who has done good, reliable
   work.
4. Dispatch and approval follow the normal path. An unfamiliar cleaner with
   no job history still requires approval, same as any new vendor.
5. The assigned cleaner's name and status show up directly in the turn's
   repair list on the Turns page.

No separate cleaner engine exists. This is the same maintenance coordinator,
pointed at a pre-classified job instead of free text.

---

## Business Memory flow

1. Operator opens Business Memory, picks a rule type (approval threshold
   override, always require approval, quiet hours, or preferred vendor),
   scopes it (everywhere, one trade, one property, or one unit), and saves.
2. Every request that reaches `graph.py`'s `load_context` loads every active
   rule for the company in one query.
3. `find_vendor` checks for a `preferred_vendor` rule first. If one applies
   and that vendor still exists and still does the trade, it wins outright,
   no ranking. If the vendor was deleted or changed trades, the rule is
   ignored and normal ranking runs, the request never fails over a stale
   reference.
4. `check_approval` resolves `approval_threshold`, `always_require_approval`,
   and `quiet_hours` for this request's trade/property/unit. Precedence,
   most specific wins:

   ```
   unit  >  property  >  trade  >  global  >  company default
   ```

5. Every rule can only make the gate **stricter** than the company default,
   never looser. There is no rule type that widens auto-dispatch.
6. Whichever rule fires writes an honest reason into the same
   `maintenance_events` log every other decision uses, e.g. *"Estimated
   cost $480 is over your $200 limit for this (trade), set in Business
   Memory"* or *"Held for approval: outside your quiet hours
   (20:00-07:00)"*. That reason surfaces directly in the dashboard's task
   modal, the actual place the operator is already looking, not a separate
   summary that could drift from what really happened.

**No LLM ever sees these rules.** They are Python-level overrides applied
before and after the one AI call in the graph, not something the model
weighs as a suggestion. Verified end-to-end against real dispatch for all
four rule types on 2026-08-14: threshold override, preferred vendor beating
a better-ranked competitor, forced approval on an otherwise-auto-approved
job, and quiet hours blocking an otherwise-auto-dispatched cleaning job.

---

## Inspection flow

1. Operator starts an inspection on a unit: move-in, move-out, periodic, or
   as part of a turn.
2. They add each area and item with a condition (good / fair / poor /
   damaged / missing). The items are the operator's own, not a fixed
   checklist, because a studio and a four bedroom house do not have the same
   rooms and an STR turn checks different things than an annual move-out.
3. Mark complete.
4. Once a unit has a completed move-in **and** a completed move-out,
   `agents/inspection_compare.py` reports the delta: for each area+item in
   both, how many steps the condition dropped, worst first. Improvements are
   ignored. Items that appear only at move-out are listed separately as "not
   recorded at move-in" rather than silently treated as damage, because that
   is usually something missed at move-in and the operator should see it.

**The hard line:** TraxKey records condition and reports what changed. It
never decides whether a change is beyond normal wear, and never computes
what may be withheld from a deposit. Those are governed by state law with
itemisation and timing rules that vary by jurisdiction, and a wrong call is
a real legal liability for the operator. `beyond_normal_wear` exists on an
item but is only ever set by a person. Same reasoning that keeps trust
accounting and rent collection out of the product: evidence, not
adjudication.

**No LLM anywhere in this flow.** A model comparing two photos and declaring
"damage beyond normal wear" would be wrong often enough to matter and would
be producing a conclusion with legal weight. Condition deltas are arithmetic
on what a human recorded.

---

## Resident & guest communication flow

Runs on the fast loop (every 15 min), not the hourly one, because someone
waiting to hear that a plumber is coming should not wait an extra hour.

1. `agents/resident_notify.py` finds requests whose **current status** has
   earned a notification the resident has not been sent:

   | Status | Notification |
   |---|---|
   | submitted, triaged | **received** |
   | assigned, scheduled, in_progress | **dispatched** |
   | completed, closed | **completed** |

2. Sends it by email (Resend), then writes a `resident_notifications` row.
   The UNIQUE constraint on `(request_id, notification_type, channel)` is
   what makes this safe on a polling loop, without it every pass would
   re-email everyone.
3. On a send failure nothing is logged, so the next pass retries. A late
   email beats a resident who never hears back.

**Keyed on current status, not on transitions.** A request that goes from
submitted to scheduled between two passes gets only the "someone's been
assigned" note, never a pointless "we got it" thirty seconds beforehand.

**What is deliberately never sent:**
- Approval pauses. "Your landlord is deciding whether to spend money on this"
  is the operator's business and invites a conversation the resident cannot
  resolve.
- Any cost, quoted or final. That is between operator and vendor.
- Vendor phone numbers. The operator owns that relationship.

**Who, never when.** There is no appointment scheduling in this system, so
any specific timing would be invented. The tenant portal previously promised
"we'll text you with updates, including who's coming and when" while nothing
contacted residents at all; that copy now says what the system actually does.

Addresses on reserved documentation domains (`example.com` and friends) are
skipped, the seeded demo data uses them and mailing them every pass would
bounce and cost real sender reputation.

---

## Unified calendar

Rows are units, columns are days, which is the multi-calendar shape every
STR platform uses. An operator scans down a column to see one day across the
whole portfolio.

What no competitor's calendar does is put long-term units on the same grid,
because their products only know about bookings. Here:

- **Short-term rows** draw guest bookings from synced Airbnb/Vrbo feeds.
  Owner blocks are kept and shown grey rather than filtered out, an operator
  needs to know *why* a night is unavailable, not just that it is.
- **Long-term rows** draw the active lease as one continuous bar with a
  marker on its end date.
- **Turn deadlines** appear as an amber dot on the day the unit must be ready.

A booking covers check-in up to but not including checkout, because that is
how nights work: a guest leaving on the 5th does not occupy the night of the
5th, and that night is sellable.

Served by `agents/calendar_view.py` (`GET /calendar`), one query per concern
assembled in Python. A single join across bookings, turns and leases would
multiply rows against each other.

---

## Portfolio Insights

Five detectors, all deterministic SQL, no LLM anywhere:

| Detector | Fires when |
|---|---|
| Late item blocking a turn | An ordered item is past its expected date and its turn has a deadline |
| Under-average rent | An active lease is 10%+ below the portfolio average for that bedroom count, ending within 120 days |
| Vendor slowdown | Response time grew 1.4x against a baseline at least 21 days old |
| Repeat issue | 3+ requests of the same trade on one unit in 180 days |
| Same-day turn pressure | Same-day turnarounds finish late more often than multi-day ones |

The thresholds exist so a bad week is not mistaken for a trend. Showing
nothing is better than showing a pattern that is not real.

**"Under-average", never "under-market".** We have no market data. The honest
claim is that a unit is below the operator's own average for that size, which
is still actionable at renewal.

**An insight is an observation, never an action.** Nothing in `insights.py`
writes to a table the coordinator reads, and nothing changes a setting. It
can say a vendor has slowed down; it will never switch vendors.

---

## Ordered items

The narrow half of TraxSail's PO tracking: an item, an expected date, and
what it blocks. Not procurement, no terms, approvals, catalogue or invoices.

The payoff is one insight that needs both halves of TraxKey:

> "Vinyl plank flooring is 5 days late from FloorSource, and the turn at Oak
> Block Unit 4B is due in 2 days."

A procurement tool knows the item is late. A property tool knows the turn is
due. Only a system holding both knows the late item is *why* the unit will
not be ready.

---

## Owner portal

The fifth auth principal. Read-only, scoped one level tighter than everywhere
else in the platform: not to a company, but to one owner *inside* a company.
Two owners paying the same manager must never see each other's properties.

1. Manager adds an owner and assigns properties to them (Owners page).
2. Manager sets a password to enable access. Off by default, exactly like
   vendors, so an owner never has portal access until the manager decides.
3. Owner signs in at the owner portal (separate domain, separate session
   table, `owner_sessions`, never shared with users/vendors/admins/residents).
4. They see: occupancy, maintenance spend over the last 12 months, recent
   work with vendor names, and any unit currently mid-turn. All queries join
   through `properties.owner_id`, never through `company_id` alone, which is
   what keeps two owners of the same manager apart.

**Deliberately read-only.** An owner can see, not act. Approving spend,
editing a lease, or messaging a tenant is what the manager is paid to do.

**Deliberately withheld:** resident names and contact details. That
relationship belongs to the manager, not the owner.

Verified before shipping: two owners in the same company see completely
disjoint property lists (zero overlap), a wrong password is rejected, a
forged token is rejected, and enabling access for an owner in a different
company is refused by the SQL itself, not just the application layer.
