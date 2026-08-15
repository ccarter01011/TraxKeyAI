# TraxKey AI — Features & Differentiators

Living document. Source of truth for what we actually have, what makes us
different, and what we can honestly claim in marketing and sales.

**Rule for this document: nothing goes in the "Live" column that isn't
actually working in production.** Overclaiming is how you lose the first
customer, and we only get one shot at a first impression with a small
operator who talks to other small operators.

Last updated: 2026-08-13 (turn management + STR readiness shipped)

---

## Positioning

**Who we're for:** the mixed-portfolio operator, roughly 5–150 doors, some
long-term rentals, some short-term rentals, often both. Usually on Hostaway,
OwnerRez, or nothing formal at all.

**Who we're NOT for (yet):** 250+ unit property management companies. That's
Property Meld and Rentvine territory. Rentvine ships an AI maintenance agent
free in their base plan. We can't win that fight today and shouldn't
advertise into it.

**The one-line pitch:**
> Other tools tell you about the problem. TraxKey AI closes it.

**Why that's defensible:** every AI competitor in this space stops at
communication and triage. EliseAI, Vendoroo, and Property Meld all "triage
and route" a maintenance issue. None of them dispatch a vendor, hold the
cost gate, verify the work, and close the loop. That end-to-end execution is
the gap.

---

## Differentiators (ranked by how defensible they are)

### 1. Occupancy-aware maintenance urgency — LIVE
**The claim:** TraxKey knows whether someone is physically in the unit right
now, and factors that into how urgent a repair is.

**Why it matters:** a broken AC with a guest checking out Thursday is a
completely different problem than the same AC in a unit sitting empty for two
weeks. One is a refund and a bad review. The other is a Tuesday task.

**Why nobody else has it:** Property Meld and Vendoroo are long-term-rental
products, occupancy is assumed constant so it carries no signal. Breezeway is
short-term but built around *scheduled* turnovers, not unplanned mid-stay
maintenance. The overlap, unplanned maintenance in an occupied short-term
unit, is genuinely unserved.

**How it works:** iCal sync from Airbnb/Vrbo/Booking.com (a public standard,
no API key or partner agreement needed) gives us real booking data.
Occupancy is computed as a plain SQL fact and fed into the AI's urgency
decision as context.

**Honest caveat:** owner-side calendar blocks are distinguished from real
reservations via a text heuristic on the iCal SUMMARY field, since the spec
has no structured field for it. Unrecognised summaries are treated as real
bookings (the safer default).

**Testing note:** neither Airbnb nor Vrbo offers a sandbox/test iCal feed,
confirmed 2026-08-13. Both only issue a real export URL tied to a real live
listing. We test against a self-hosted `test-calendar.ics`
(`traxkey-marketing-site/test-calendar.ics`), hand-written to match Airbnb's
real export format exactly. Verified end-to-end against it over real HTTP
before ever needing a customer's real calendar.

---

### 1b. Same-day turnaround detection — LIVE
**The claim:** when a guest checks out and the next one arrives the same
day, TraxKey opens the cleaning turn automatically and marks it as hours,
not days.

**Why nobody else has it:** it requires the booking calendar and the work
engine in the same system. Breezeway schedules turnovers but doesn't run
maintenance. Property Meld runs maintenance but has no calendar. Neither can
see both halves of this.

---

### 1c. Pre-arrival readiness check — LIVE
**The claim:** a guest arrives in two days and the unit still has an open
repair, TraxKey says so before they show up.

**Why it matters:** this is the specific failure that produces a bad review,
and small operators miss it because it needs three separate things checked
together: the calendar, open maintenance, and turn status.

---

### 2. Mixed portfolio in one system — LIVE
**The claim:** long-term units and short-term rentals live side by side, one
dashboard, one vendor network, one maintenance history.

**Why it matters:** an operator with 40 long-term doors and 6 STRs runs two
systems today that don't talk. Duplicate vendor lists. Split maintenance
history. No single view.

**Why nobody else has it:** the market is cleanly split. LTR tools
(Property Meld, Vendoroo, AppFolio, Buildium) don't do STR. STR tools
(Breezeway, Turno, Guesty, Hostaway) don't do LTR. Nobody serves the operator
who is both.

**How it works:** a short-term guest is modeled as a resident with check-in
and check-out dates. Same reporting link, same AI diagnosis, same vendor
dispatch. No separate system, no separate data model.

---

### 3. Full audit trail of every AI decision — LIVE
**The claim:** every step the AI took, in order, with timestamps and the
reason. Nothing happens in a black box.

**Why it matters:** this is the objection that blocks the sale as AI systems
start spending money autonomously. "What did it do and why" needs an answer
before an operator will let software dispatch a $600 repair.

**Why it's a differentiator:** competitors treat this as a debug tool. We
surface it as a product feature (the AI Activity page). As agentic dispatch
becomes normal, auditability becomes the trust anchor.

**Example trail:**
```
submitted        → "AC not cooling, 95 degrees outside"
triaged          → hvac, emergency, owner responsibility.
                   Occupied now, checkout 2026-08-16.
approval_needed  → vendor has no completed jobs on file yet,
                   no cost history to auto-approve against
approved         → approved by a team member
dispatched       → dispatched after human approval
closed           → marked complete, $650, 4★
```

---

### 4. Vendor selection by real performance, not gut feel — LIVE
**The claim:** the vendor who gets the job is chosen by completion rate,
rating, and actual cost history. Not whoever answered the phone.

**Why it matters:** vendor choice is pure guesswork at small scale today.
Nobody's tracking who's actually reliable.

**Honest caveat:** this is a cold-start problem. A brand-new account has no
history, so early dispatches fall back to the human approval gate. We can't
beat a competitor with millions of work orders on data volume, we win on
*making the data visible*, which per research nobody displays well.

---

### 5. Cost-threshold human approval gate — LIVE
**The claim:** set a dollar threshold. Under it, the AI dispatches on its
own. Over it, or with an unproven vendor, it waits for one click.

**Why it matters:** it's the answer to "I'm not letting AI spend my money."
Autonomy is earned per-vendor as cost history accumulates.

**Design detail worth keeping:** a vendor with zero completed jobs always
requires approval, regardless of estimate. An unknown cost is not a cheap
cost. (This was a real bug we caught and fixed, a $0 default estimate would
have auto-dispatched every new vendor's first job.)

### 6. Invoice and PO chasing without touching money — LIVE
**The claim:** TraxKey tracks what a supplier owes you (a late part) and what
a customer owes you (an open invoice), and chases both by email on the same
deterministic ladder it uses to chase a silent vendor: reminder, firmer
reminder with the operator copied, then stop and hand it over. Per-invoice
and per-supplier CC address and an on/off switch, overridable at the item or
inherited from the customer/supplier default.

**Why it matters:** the operator's actual pain isn't "I need a ledger," it's
"I keep forgetting to follow up." Every property tool either ignores this
(Property Meld, Vendoroo) or bundles it into full accounting nobody under 50
units wants to run (AppFolio, Buildium, Yardi Breeze). TraxKey does the
followup without the accounting.

**Where the line is drawn, deliberately:** TraxKey shows the amount and
chases it. It never processes a payment, never holds funds, never touches a
trust account. Marking an invoice paid is a note the operator makes after
the money moves somewhere else. This is the same "AI decides what's safe to
decide, hands a human what needs a human" logic the whole platform runs on —
tracking and reminding is safe to automate, moving money is not.

**CSV import and export**, both directions: an operator's invoices and POs
almost always already exist in a spreadsheet or QuickBooks before they ever
touch TraxKey. Import previews every row before writing anything — what will
be created, what already exists, what's broken and why — so nobody discovers
a bad import after the fact. New customers/suppliers are created inline.
Export gets the full history back out as CSV any time; a tool that traps
your data is a tool people hesitate to adopt.

---

## Full feature inventory

### Live in production
| Feature | Notes |
|---|---|
| AI maintenance triage | LLM classifies trade, urgency, owner-vs-tenant responsibility from free text |
| Occupancy-aware urgency | via iCal sync, STR units |
| Deterministic vendor matching | ranked by completion rate, rating, avg cost |
| Cost-threshold approval gate | per-company configurable |
| Auto-dispatch | under threshold, with proven vendor |
| Vendor email notification | via Resend, on dispatch |
| Vendor portal | vendor login, see assigned jobs, mark in progress |
| Job completion + vendor scoring | final cost and rating feed back into vendor stats |
| Full audit trail | every AI decision logged and surfaced |
| Per-resident invite links | no app, no account, unit already known |
| Short-term guest support | check-in/check-out dates |
| iCal calendar sync | Airbnb, Vrbo, Booking.com, direct |
| Turn management | vacant-to-ready, one engine for LTR turnover and STR cleaning |
| Auto-opened cleaning turns | guest checkout opens a turn automatically |
| Same-day turnaround detection | next check-in becomes the turn deadline |
| Pre-arrival readiness check | guest arriving within 2 days + open work = alert |
| Properties, units, residents, vendors | data entry |
| Light/dark theme | |
| Password reset | |
| Vendor Chase Agent | nudges a silent dispatched vendor, escalates after two tries |
| Ordered items (PO tracking) | late-part detection, feeds turn-blocking insights, per-item supplier email/CC/auto-chase |
| Invoice / AR tracking | amounts, due dates, aging buckets, per-customer or per-invoice CC/auto-chase |
| Invoice + PO chase agent | reminder ladder for overdue invoices and late supplier orders, hourly |
| CSV import (invoices, orders) | preview-then-commit, creates new customers/suppliers inline |
| CSV export (invoices, orders) | full history, any time |
| Owner portal | separate login, read-only, scoped per-owner even within one company |
| Suggestion box | in-app feature requests, admin triage |

### Not built (be honest about these in sales conversations)
- Payment processing / rent collection / trust accounting — **deliberately
  not building**, legal and compliance exposure. Invoice and PO amounts are
  tracked and chased, but no payment is ever processed and no funds are ever
  held by TraxKey.
- Leasing, applications, tenant screening
- Owner statements as a formatted document (the owner portal itself is live)
- Inspections and checklists
- Listing syndication, channel management (beyond read-only iCal)
- Dynamic pricing
- Cleaning/turnover scheduling as a standalone product — Breezeway and Turno
  own this space
- Document storage, e-signature
- SMS notifications (email only today)

---

## Roadmap, in priority order

1. **Encrypt iCal URLs at rest** — do soon. `unit_calendars.ical_url` is
   stored in plain text today. It's effectively a bearer token: anyone who
   reads it can pull a customer's real booking dates and occupancy patterns
   indefinitely, no login required. Fine for our own testing, not fine once
   real customers connect real calendars. The customer can always revoke by
   regenerating the link in Airbnb/Vrbo settings, but we shouldn't rely on
   that as the only safeguard. Encrypt the column (or move to a secrets
   store) before the first real STR customer connects a live calendar.
2. **Owner reporting** — research flagged that every competitor still ships
   static PDFs. An AI that narrates portfolio performance and answers owner
   questions is unclaimed.
4. **SMS vendor notification** — needs Twilio credentials.
5. **Unit-count enforcement per pricing tier** — currently nothing stops a
   free account from adding 500 units.
6. **More AI specialists** — the "team of specialists" positioning needs a
   second specialist to be credible.

---

## Pricing

| Tier | Units | Price | Effective $/unit |
|---|---|---|---|
| Free | 1 | $0 | — |
| Starter | up to 10 | $99/mo | ~$9.90 |
| Growth | up to 50 | $249/mo | ~$5.00 |
| Pro | up to 150 | $549/mo | ~$3.66 |

**Competitive context:** Breezeway is $19.99/unit/mo for STR ops. We're well
under at every tier. Property Meld (LTR maintenance only) is $1.60–2.00/unit,
Vendoroo ~$3/unit. We sit above the pure-maintenance tools and below the
full-ops platforms, which matches what we actually deliver.

**$99 is the effective minimum**, same role AppFolio's $280 minimum plays for
their segment: it filters out the 1–2 unit hobbyist who costs the same
support effort as a 40-unit operator.

**Open question:** all of these numbers are unvalidated. No real operator has
reacted to them yet. First customer conversation should test the $99 floor.

---

## Known risks and honest weaknesses

1. **The core AI maintenance coordinator is becoming a commodity.** Vendoroo
   markets the identical concept. Property Meld is the funded incumbent.
   Rentvine ships it free in their base plan. Our defensibility is the
   *combination* (occupancy awareness + mixed portfolio + auditability), not
   any single feature.

2. **Cold-start on vendor data.** Vendor scoring needs history to be useful.
   Early accounts get the approval gate instead, which is honest but slower.

3. **No integrations with the big platforms.** AppFolio requires their MAX
   plan, Guesty gates partners. Hostaway and OwnerRez are genuinely
   self-serve and should be the integration targets if we build any.

4. **Unvalidated market size.** The mixed-portfolio segment is a reasoned bet,
   not a measured one. Nobody has confirmed it's big enough to be a business.
   This is the single biggest open risk.

5. **Feature breadth vs. Breezeway.** For a pure STR operator, Breezeway does
   more. We win only where maintenance matters more than turnover scheduling,
   or where the operator also has long-term units.
