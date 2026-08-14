# TraxKey AI — Platform Roadmap

**Decision (2026-08-13):** build toward a full AI property operations
platform, **excluding accounting, trust ledgers, and rent collection**. Those
carry real legal and compliance exposure and are well served elsewhere.
TraxKey handles operations; money stays with QuickBooks, Stripe, or whatever
the operator already uses.

**Why this exists:** a prospective customer evaluated TraxKey and said it
was "not even at the base level of competitors." They were right. We had one
workflow done well, not a platform. This is the list that closes that gap.

---

## The AI specialist model

Each specialist owns a workflow end to end, the same way the Maintenance
Coordinator does today: deterministic facts, AI only for judgment, human
approval where money or reputation is at stake.

| # | Specialist | Status | Serves |
|---|---|---|---|
| 1 | **Maintenance Coordinator** | ✅ built | Both |
| 2 | **Turnover Coordinator** | 🟡 cleaner assignment built, checklist/app open | Both |
| 3 | **Lease Agent** | 🟡 built, pending migration | Long-term |
| 4 | **Renewal Agent** | 🟡 built, pending migration | Long-term |
| 5 | **Resident Communications** | ❌ | Long-term |
| 6 | **Guest Experience** | ❌ | Short-term |
| 7 | **Inspection Agent** | ❌ | Both |
| 8 | **Owner Relations** | ❌ | Both |
| 9 | **Supply & Inventory** | ❌ | Short-term |
| 10 | **Leasing / Applications** | ❌ | Long-term |
| 11 | **Business Memory** | ✅ built 2026-08-14 | Both |
| 12 | **Inspections** | 🔨 building now | Both |
| 13 | **Stripe subscriptions** | ⏭️ next | Both |
| 14 | **Tenant logins (LTR only)** | ⏭️ planned | Long-term |
| 15 | **Resident & Guest Comms (email)** | ✅ built 2026-08-14 | Both |
| 16 | **SMS notifications** | ⏭️ next week 2026-08-21 | Both |
| 17 | **Portfolio Insights** | 📋 spec'd | Both |

---

## Long-term rental gaps (in build order)

### 1. Leases and lease tracking — BUILT (schema v15)
Cannot credibly call this a PM platform without it. Lease start/end, rent
amount, deposit, terms, documents. **We track rent amounts; we don't collect
them.**

*AI angle:* flag expirations, surface below-market rents, catch missing
documents.

### 2. Renewal Agent — BUILT (folded into the Lease Agent)
Lease expiring in 90/60/30 days, draft the renewal offer, track response.
Renewals are the single highest-leverage retention lever a PM has and most
tools treat it as a calendar reminder.

*AI angle:* drafts the offer using the resident's actual history (payment
timeliness, maintenance behaviour, tenure).

### 3. Inspection Agent
Move-in, move-out, periodic. Photo checklists, condition comparison.

*AI angle:* compare move-out photos to move-in, identify damage beyond
normal wear, draft the deposit deduction rationale. This one is genuinely
differentiated and directly feeds turn management, which already exists.

### 4. Resident Communications
Every message with a resident in one thread. Announcements, notices.

*AI angle:* drafts responses to routine questions, escalates the rest.

### 5. Document storage
Leases, insurance certificates, inspection reports, notices. Unglamorous,
but its absence is disqualifying.

### 6. Leasing / Applications
Application intake, screening (integrate, don't build), showing scheduling.

*Note:* screening touches FCRA. Integrate a licensed provider, never build
our own scoring.

---

## Short-term rental gaps (in build order)

### 1. Turnover Coordinator — cleaner assignment BUILT, checklist/app still open
A cleaning turn now assigns a cleaner automatically the same pass it opens,
ranked by the same completion-rate/rating/cost history as any vendor. No
checklist UI or cleaner-facing app yet, cleaners currently work off the
existing vendor portal built for repairs.

*AI angle:* assigns based on cleaner performance history, same engine as
vendor scoring.

### 2. Guest Experience Agent
Pre-arrival instructions, check-in details, mid-stay check, post-checkout.

*AI angle:* answers routine guest questions, escalates real problems into
maintenance requests automatically.

### 3. Supply & Inventory
Cleaners report what's low. Consumables tracked per unit.

*AI angle:* predicts restock timing from turnover frequency.

### 4. Access codes / smart locks
Per-stay codes, auto-expiring. Needs per-vendor integration (August, Yale,
Schlage, Seam covers several at once).

### 5. Damage and incident capture
Photo evidence at checkout, tied to the turn and the booking.

---

## Business Memory & Insights — NEXT (targeted 2026-08-14)

How TraxKey gets smarter about *this specific* operator's business over time.

**What this is not:** retraining or fine-tuning a model on customer data.
That is not how this system works, and claiming it would break the one rule
the platform runs on. "Memory" here means durable rows in Postgres that the
AI reads as facts, exactly like every other fact it uses.

### 1. `business_memory` table — explicit rules the operator sets once

The seed already exists: `companies.cost_approval_threshold` is per-company
AI behaviour stored in the database. This generalises it.

```
business_memory
  company_id, key, value, scope (global | trade | property | unit),
  scope_ref, set_by, note, created_at, updated_at
```

Examples an operator would actually set:
- "Always require approval over $200 for HVAC specifically"
- "Never auto-dispatch after 8pm"
- "Vendor X gets first refusal on plumbing regardless of ranking"
- "Unit 4B's owner wants to approve everything, no exceptions"

Read in `load_context()` and applied in `check_approval()` / `find_vendor()`
as deterministic overrides. Not AI judgment, configuration the AI obeys.

### 2. Surface the learning that already happens

`vendor_performance` means every company's AI already makes different vendor
calls, because every company's vendors have different track records. That is
per-business learning already shipping, it is just invisible. Show it: "your
AI has learned X about your vendors from Y completed jobs."

### 3. `business_insights` — pattern surfacing, never pattern acting

Aggregate SQL over `maintenance_requests`, `vendor_performance`, `turns`,
`leases`, then the concierge narrates. Same deterministic-facts-then-AI-
narrates split used everywhere else.

- "Your HVAC vendor's average response time doubled over 90 days."
- "Three emergency requests on Unit B in two months, all plumbing."
- "Unit 12 is $300/mo under your portfolio average at renewal."
- "Same-day turnarounds fail readiness checks 40% of the time."

### Hard constraint

The AI **never** infers an unstated rule from behaviour and applies it
silently. "I noticed you always approve HVAC over threshold, want me to
raise the limit?" is acceptable **only as a question**. Anything that
quietly changes the system's own risk posture is out, that is exactly the
class of thing that fails silently and destroys trust in one incident.

---

## Stripe subscriptions — NEXT AFTER INSPECTIONS

Same pattern as TraxSail AI. Today `plan` and `plan_status` are columns
nobody writes to and the admin dashboard's MRR figure is explicitly labelled
"estimated from plan tier, no billing integration yet." That label is honest,
but it means there is no way to actually take money.

Scope:
- Stripe Checkout for the four tiers (Free 1 unit, Starter $99, Growth $249,
  Pro $549).
- Webhook to sync `plan` / `plan_status` on
  `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`.
- Customer portal link for self-serve card and cancellation changes, rather
  than building that UI.
- Unit-count enforcement at the tier boundary. Currently unenforced, a free
  account can add 50 units.

**Constraint:** never store card details. Stripe Checkout and the hosted
customer portal only. Same reasoning as excluding rent collection and trust
accounting, that class of data is not worth the liability for what it buys.

---

## Tenant logins — planned, LTR only

Today residents and guests have no login at all, only a token link
(`tenant.traxkey.ai/?token=...`). That was a deliberate choice and it stays
correct for short-term guests: nobody staying three nights creates an
account to report a broken lamp, and forcing one costs real reports.

For long-term tenants it is the wrong answer. A tenant on a twelve month
lease has a genuine reason to sign in: their request history, their lease
documents, their renewal offer, notices sent to them.

So the split is:
- **STR guests:** token link only, unchanged. No account, no password.
- **LTR tenants (a resident with a `lease_id`):** optional account.

Needs: `residents.password_hash`, a `resident_sessions` table (a fourth
auth principal, never sharing a session store with users/vendors/admins),
signup-from-invite, login, password reset, and portal pages for history and
documents. Token links keep working either way, an account is an upgrade,
never a prerequisite for reporting a problem.

---

## SMS notifications — NEXT WEEK (targeted 2026-08-21)

Resident and guest email updates shipped 2026-08-14 (`agents/resident_notify.py`).
SMS is the same three moments over a second channel.

`resident_notifications` already records `channel`, and its UNIQUE constraint
is `(request_id, notification_type, channel)`, so SMS can be added without
touching the dedupe logic or re-sending anything already emailed.

Needs: Twilio credentials (the user already has an account from the Elevated
Skin Studio project), a `residents.sms_opt_in` flag, and per-message
truncation since the email bodies are too long for SMS.

**Constraint:** SMS to a resident who never opted in is a legal problem in
several jurisdictions, not just an annoyance. Opt-in must be explicit and
recorded, and every message needs a STOP path.

---

## Portfolio Insights — SPEC

The completion of Business Memory. That feature stores the rules an operator
sets; this one surfaces the patterns they have not noticed.

### The shape it must NOT take

A "Reports" page. Every competitor has one and they are all ignored, because
a report is something you go look at and interpret, which is work added
rather than removed. TraxKey's whole argument is that it does the noticing.

### Three rules

1. **Every number is deterministic SQL.** The LLM only narrates. Same split
   as everywhere else in this system.
2. **No metric without a decision attached.** "Occupancy 94%" is trivia.
   "Unit 12 is $300 under market and its lease ends in 34 days" is money.
   If a number does not imply an action, it does not ship.
3. **It feeds the concierge, it does not live in a silo.** The best outcome
   is a morning briefing saying "your HVAC vendor has gotten 40% slower since
   June" and the operator never opening an insights page at all. The page is
   the archive; the briefing is the product.

### The questions it answers

Chosen specifically because they are unanswerable in a split LTR/STR stack,
which is exactly the gap TraxKey exists to fill:

| Question | Needs |
|---|---|
| Which unit costs most per month, and is it the unit or the tenant? | maintenance_requests + units + residents |
| When did a vendor start slowing down? | vendor_performance over time |
| Am I losing more to vacancy or to maintenance on this property? | turns + maintenance_requests |
| Do same-day turnarounds fail readiness checks more often? | bookings + turns + readiness |
| Which units generate repeat requests for the same trade? | maintenance_requests grouped |
| Is a lease under market for its unit type? | leases across the portfolio |

The fourth needs the booking calendar and the maintenance engine in one
system. No competitor can answer it, which makes it the one worth leading on.

### Schema

`vendor_performance` is a rolling snapshot with no history, so "when did this
start" cannot be answered today. Needs `vendor_performance_history`
(vendor_id, captured_at, jobs_completed, avg_response_hours, avg_cost,
completion_rate, avg_rating), appended by the worker weekly. Everything else
is derivable from existing tables.

### Hard constraint

An insight is an observation, never an action. The AI may say "you approve
HVAC over threshold nine times out of ten, want to raise the limit?" but
never raises it. Same rule as Business Memory: nothing silently changes the
system's own risk posture.

---

## Deliberately NOT building

| Thing | Why |
|---|---|
| Accounting, trust ledgers, rent collection | Legal and compliance exposure. Integrate instead. |
| Tenant screening scoring | FCRA-regulated. Integrate a licensed provider. |
| Dynamic pricing | PriceLabs and Beyond own it, needs market data we don't have. |
| Channel management (write-back) | Gated APIs, Hostaway/Guesty territory. Read-only iCal is enough. |

---

## Honest scope note

This is 6 to 12 months of work at a realistic pace, not weeks. The order
above is deliberate: each item is sequenced by whether its absence blocks an
evaluation, not by how interesting it is to build.

The highest-value single conversation is still with the operator who gave
the "not base level" feedback: ask which three of these would have changed
their answer. That would cut this list roughly in half.
