# TraxKey AI — Product Overview

*Written for someone who has not seen the code.*

**Live Google Doc:**
https://docs.google.com/document/d/1_D7RtDMF5wKSyNJDyOv06Oxsz9jS2FHMw-Vt79f7SkI/edit
(v6 — v1 through v5 are superseded and can be deleted. v4 in particular
rendered as raw escaped markdown text, not real Doc formatting — the
create_file call used contentMimeType text/plain, which uploads literal
characters rather than parsing markdown syntax. Fixed in v5/v6 by
generating real HTML with contentMimeType text/html instead, which Drive's
converter turns into actual headings, bold, and tables.)

This markdown file is the source. There is no way to update a Doc's content
in place (Drive's update tool only changes title/location, not the body),
so a material change here means a NEW Doc and a new link, not an edit to
the old one. Update this link when that happens.

**Last updated:** 15 August 2026

---

## 1. What TraxKey AI is

A dedicated team of **10 specialized AI agents** that work a rental portfolio 24/7,
across both long-term units and short-term rentals, in one system.

They diagnose repairs, dispatch vendors, turn units between guests, and
watch every lease. Short-term tools don't do leases. Property software
doesn't do calendars. TraxKey does both, which is why it knows a guest is
in the unit when the AC fails.

Not a single bot bolted onto a ticketing tool. Each of the ten owns one
workflow end to end, and they share the portfolio, the vendor network, and
the operator's rules. Section 4 names all ten.

Most property software is a filing cabinet: it records what happened and
leaves a human to make every decision. TraxKey decides the ones that are
safe to decide, and hands a human exactly the ones that need a human, with
the reasoning attached. That is the difference between software that tracks
your business and a platform that runs alongside it.

### The pain points this replaces, not just maintenance

- **A 10pm broken heater** that needs triage, a vendor call, an approval,
  and a tenant update, done by a person, every time. (§2)
- **A guest checkout at 11 and check-in at 4** that someone has to notice
  and race to turn around. (§3, Turnover Coordinator)
- **A lease that quietly expires** because nobody was watching the
  calendar 90 days out. (§3, Lease Agent)
- **A vendor who has gotten slower over six months** and nobody noticed
  because nobody was comparing this month to March. (§4, Insights Agent)
- **An owner who calls to ask how their property is doing** because they
  have no way to check themselves. (§10, addresses table)
- **A property manager who cannot tell if the business itself is
  healthy** — which vendor is worth keeping, which unit is underpriced,
  which turn pattern is costing them nights. TraxKey's Insights Agent
  surfaces exactly this, unprompted, from the portfolio's own history.

---

## 2. The problem we chose

### The day this replaces

A tenant texts at 10pm that the heating has died. Someone reads it, works out
it is an HVAC job not a plumbing one, digs out which contractor was any good
last time, calls three of them, waits, approves a price, and remembers to
tell the tenant something is happening. Multiply by every unit, every week.

That work is not skilled. It is coordination, and it is the reason a property
business stops scaling at the point where one person can no longer hold it
all in their head.

| The pain | What TraxKey does |
|---|---|
| Every request needs a human to read and triage it | AI reads it and classifies the trade, urgency and responsibility |
| Picking a vendor from memory or a spreadsheet | Ranked on that vendor's own completion rate, rating and real cost |
| Chasing approval on every job, however small | Under your limit with a proven vendor it just goes; over it, one click |
| The tenant hears nothing and chases you | Emailed automatically when a vendor is assigned and when it is done |
| A guest complains about something you did not know was broken | The calendar tells the AI someone is in the unit, so it escalates |
| Finding out a unit was not ready when the guest arrives | Checked before arrival, flagged while there is still time |
| Discovering at renewal that a unit has been under-rented for a year | Surfaced 90 days out, with the gap against your own average |
| Not knowing which vendor is quietly getting worse, or which unit keeps breaking | The Insights Agent watches for it and tells you, unprompted |

### Why nobody has solved it for this operator

Property operators fall into two camps, and the software market matches them:

- **Long-term rentals.** Leases, renewals, tenants. Served by AppFolio,
  Buildium, Rentvine.
- **Short-term rentals.** Airbnb, Vrbo, guests, cleaning turnarounds. Served
  by Hostaway, Guesty, Hospitable, Lodgify.

A growing number of operators run **both**. Two houses on annual leases and
three cabins on Airbnb is an ordinary portfolio now.

Those people are served by nobody. Short-term platforms have no concept of a
lease. Long-term platforms have no concept of a booking calendar. So the
operator buys two subscriptions and personally becomes the integration
between them.

**That gap is the entire reason TraxKey exists.** It is checkable: you can
visit any of those five products and confirm it in about ten minutes.

---

## 3. What it does today

### The AI Maintenance Coordinator

The core loop, and it runs without a human in the middle:

1. A resident or guest reports a problem through their own link. No app, no
   account, no password.
2. AI reads the description and works out the trade, how urgent it is, and
   whether it is the owner's responsibility or the tenant's.
3. TraxKey picks the vendor, ranked on that vendor's actual completed-job
   history: completion rate, rating, and real cost.
4. If the expected cost is under the operator's limit and the vendor has a
   track record, it dispatches automatically and emails them.
5. If it is over the limit, or the vendor is new, it stops and waits for one
   click.
6. The resident is emailed when someone is assigned, and again when it is done.

Every step is written to a log the operator can read, in plain language,
including the reason for each decision.

### Everything else built

| Area | What it does |
|---|---|
| **Calendar** | Every unit on one timeline. Guest bookings, owner blocks, leases and turn deadlines together. |
| **Leases & renewals** | Terms, rent, deposits. Flags every lease 90 days before it ends and tracks the renewal offer. |
| **Turns** | Vacant-to-ready tracking. A guest checkout opens a cleaning turn automatically with the next arrival as its deadline. |
| **Cleaner assignment** | A cleaning turn assigns a cleaner by itself, ranked the same way any vendor is. |
| **Inspections** | Move-in and move-out condition records, and exactly what changed between them. |
| **Business Memory** | Rules the AI obeys: approval limits, quiet hours, preferred vendors, set per trade, property or unit. |
| **Insights** | Patterns in the operator's own data: vendors slowing down, units that keep breaking, rents below their own average. |
| **Orders** | Parts and materials a job is waiting on, flagged when late, and when late means a turn will slip. Suppliers are chased by email once an item goes past its expected date, with a CC address and an on/off switch per item. Adapted from our own supply-chain product, TraxSail AI, which chases suppliers on purchase orders. |
| **Property profile (onboarding)** | The nuances only the operator knows, captured once per property: water shutoff and panel locations, HVAC filter size, which quirks are normal, trash day, emergency info, insurance carrier and deductible. Feeds the resident assistant and the damage assessment. |
| **Property inventory** | What is actually in each unit: appliances and furniture with brand, model, price, purchase date, warranty, condition, and a replacement link. Used for replace-on-breakage and to check warranty before anyone pays for a repair. |
| **Direct booking & pricing (prototype)** | A reservation system outside Airbnb/Vrbo, with nightly rate suggestions from a vendor-agnostic pricing engine (weekend lift, last-minute discount, occupancy adjustment). No PriceLabs MCP or API is connected — no such connector exists to connect. Built vendor-agnostic so a real provider can be swapped in later without a rebuild. Marked as a test feature on the dashboard. |
| **Experiential STR / micro-resort mode** | A per-property toggle (on the Onboarding page, next to the property picker) for multi-unit properties sharing amenities — a compound with a pool, dock, or clubhouse across several cabins. Adds shared-amenity tracking with its own status and maintenance thread, a "notify every guest currently on the property" action, and whole-property buyout bookings for weddings and retreats that block every unit at once. |
| **Invoices** | What you're owed, bucketed by how overdue it is, with reminders sent automatically until someone answers. CC address and auto-reminder switch per customer, overridable per invoice. TraxKey tracks and chases; it never processes a payment or holds funds. |
| **Analytics & Reporting** | Occupancy trend, rental activity rollups, spend by property and vendor, and owner statements — how the business is doing over a period, distinct from the daily-action dashboard. |
| **Supplies & damage** | Consumables per unit with reorder levels; checkout damage tied to the stay it happened during. |
| **Vendor portal** | Vendors log in, see their jobs, mark them in progress. |
| **Owner portal** | Owners you manage for see occupancy, spend, and activity for their own properties, read-only. Never see another owner's properties or any tenant's identity. |
| **Tenant portal** | Residents and guests report problems, with a warm AI assistant and a "talk to a person" escape hatch. Can also report an issue with a shared amenity instead of their own unit, on experiential-mode properties. |
| **Daily briefing** | A short read every morning: what is urgent, what is handled, what is waiting on a decision. |

---

## 4. The specialised AI agents

Each owns one workflow end to end and runs on its own schedule. They share
the portfolio, the vendor network, and the operator's rules, which is what
makes them a platform rather than a bundle of features.

| Agent | What it owns | Runs |
|---|---|---|
| **Maintenance Coordinator** | Diagnose a reported problem, match a vendor, gate on cost, dispatch | On every new request |
| **Turnover Coordinator** | Open a cleaning turn on checkout, set the deadline from the next arrival, assign a cleaner | Hourly |
| **Lease Agent** | Activate and end lease terms, flag silent renewal offers, open move-out turns | Hourly |
| **Readiness Agent** | Check a unit is actually ready before a guest arrives | Hourly |
| **Review-Risk Agent** | Flag a stay that ended with an issue still open | Hourly |
| **Insights Agent** | Vendor slowdowns, repeat-failure units, below-average rents, late parts blocking a turn | Daily |
| **Follow-up Agent** | Keep residents and guests informed; chase leads who never converted | Every 15 min |
| **Vendor Chase Agent** | Nudge a dispatched vendor who has gone silent, escalate to you after two tries | Every 15 min |
| **Damage Assessor** | On a broken item, gathers cost, deductible, warranty, inventory match and who was in the unit, then recommends occupant charge, insurance claim, or owner cost. Names what is missing rather than guessing. Recommends; never decides. | On demand |
| **Invoice Chase Agent** | Remind a customer an invoice is past due, and a supplier that a part is late; hand both to you after two tries | Hourly |

### The three assistants, and why they sound different

Three separate AI personalities, because they are talking to three different
people in three different situations. Using one voice for all three would be
a mistake.

**1. The operator concierge** (dashboard). Briefs a professional on their own
portfolio. Terse, ranked by urgency, no softening. Opens with the single most
important thing, then a short list of what to do today. Every number in it is
counted from real data, never estimated.

**2. The resident and guest assistant** (reporting page). Talks to someone
who may be cold, flooded, or locked out, and who never chose this software.
Warm, short sentences, acknowledges the problem before solving it. Helps them
describe the fault clearly, which is what gets the right trade sent first
time. It also defines what Routine, Urgent, and Emergency mean in plain
terms, walks through genuinely safe first fixes (a breaker, a GFCI reset, a
stuck toilet flapper), and knows the specific property it's talking about —
the HVAC filter size, where the water shutoff is, which quirks are normal for
that building — without ever exposing anything sensitive like an insurance
policy number.

It is also the **most restricted** AI in the platform. It cannot promise a
time, a cost, who pays, or that anything will be fixed, because it cannot see
the schedule or the lease. For a gas smell or fire it says leave and call 911
before anything else. A "talk to a person" button is always one tap away, and
if the operator has switched off automated handling for that resident, the AI
step is skipped entirely.

**3. The sales assistant** (public site). Answers prospect questions from a
fixed product brief with no database access. It is instructed to name
competitors where they are genuinely better, and it does.

### What "learning" does and does not mean here

Worth being exact, because the honest version is a selling point.

| Mechanism | What it is |
|---|---|
| **Vendor performance** | Every completed job updates that vendor's record. The AI's next choice differs because the evidence changed. Genuine learning from outcomes. |
| **Business Memory** | Rules the operator sets: approval limits, quiet hours, preferred vendors, per trade, property or unit. The AI reads these as facts and obeys them. |
| **Insights** | Patterns computed from the operator's own history and surfaced as suggestions. |

**The AI never rewrites its own rules.** It can tell an operator "you have
approved HVAC over your limit nine times out of ten, want to raise it?" It
cannot raise it. Nothing silently changes the system's risk posture, which is
the failure mode that destroys trust in one incident.

There is no model fine-tuning on customer data. "Memory" is durable database
rows, which is why it is inspectable and reversible.

---

## 5. The design rule everything follows

**The AI classifies. Software decides.**

The only thing the AI is trusted with is reading a free-text description
written by a stressed human and working out what it means. That is a genuine
language problem and AI is good at it.

Everything after that is ordinary, testable logic:

| Step | How it works |
|---|---|
| Understand "the boiler is making a banging noise" | **AI** |
| Which vendor is best for this | Arithmetic on their job history |
| Is this within the spending limit | Comparison |
| Is a guest in the unit right now | The booking calendar |
| Is this unit ready for the next arrival | Checklist state |
| Is this vendor slower than they used to be | Their own history |
| Should a damaged item be billed to the occupant, claimed on insurance, or absorbed | Cost, deductible, warranty and occupancy compared in SQL; AI only classifies whether the description reads as accidental, misuse, wear, or mechanical failure |

This matters commercially, not just technically. It is why TraxKey can show
an operator the reason for every decision, and why the AI **cannot** invent a
cost, choose a vendor it likes, or quietly change a rule the operator set.

---

## 6. Things we deliberately do not build

Stated plainly because it is a strategy, not a gap:

| Not building | Why |
|---|---|
| Rent collection, trust accounting | Regulated, and a mistake is the operator's legal problem. It sits alongside whatever already moves their money. |
| Tenant screening scores | Governed by fair-credit law. We would integrate a licensed provider, never score anyone ourselves. |
| Deposit deduction amounts | Governed by state law that varies everywhere. TraxKey records what changed and a human decides. |
| Real market-data pricing | A prototype pricing engine exists (§3), but it is a deterministic heuristic, not real market intelligence. No revenue-management vendor is connected, and no PriceLabs MCP exists to connect to. Built vendor-agnostic so one can be swapped in without a rebuild. |
| Writing back to Airbnb/Vrbo | Requires partner agreements we do not have. Reading their calendars does not, and is enough. |

The pattern: **TraxKey handles operations. It never handles money or makes a
legal determination.**

---

## 7. Who it is for

| Portfolio | Fit |
|---|---|
| Short-term only | Works, but Breezeway and Hostaway have deeper turnover tooling. Worth switching only if maintenance is the weak spot. |
| **Both long-term and short-term** | **The one nobody else serves.** This is the customer. |
| Long-term only | Works well, unless accounting is needed today. Then AppFolio or Buildium is the right answer. |
| Multi-unit with shared amenities (a compound: several cabins, one pool/lake) | Structurally fits TraxKey's property→units model today. Experiential mode adds amenity-level tracking on top. A real, underserved niche — too boutique for hotel PMS, and no single-unit STR tool has an amenity concept at all. |

Built for roughly **5 to 150 units**. Above that, the incumbents' depth wins
and we would rather say so.

---

## 8. Pricing

| Tier | Units | Price |
|---|---|---|
| Free | 1 | $0 |
| Starter | 2–10 | $99/mo |
| Growth | 11–50 | $249/mo |
| Pro | 51–150 | $549/mo |

No credit card to start. No per-seat charge, so adding staff costs nothing.

The comparison that matters is not TraxKey against any single competitor. A
mixed operator today pays for a short-term platform **and** a property
management system, often with a maintenance tool on top. TraxKey is one
subscription covering both.

---

## 9. Honest position, as of today

Worth stating directly because anyone evaluating this will find it out.

**Where we are behind.** Hostaway, Guesty, Hospitable, Lodgify and Buildium
are established businesses with large teams. Their short-term turnover
tooling and their accounting are more mature than ours. All five have also
shipped their own AI assistant (Hostaway calls theirs "AI CoHost"), so AI
alone is no longer a differentiator in this market. What TraxKey's concierge
has that a single-purpose assistant cannot: it reads leases and booking
calendars together, so it can tell an operator a guest is in the unit where
the AC just failed.

**Where we are genuinely ahead.**

1. **Both sides in one system.** Structural, not cosmetic. A short-term
   platform would need to build leasing; a property system would need to
   build channel calendars. Neither is a quick addition.
2. **Occupancy-aware urgency.** A broken air conditioner with a guest inside
   is treated differently from the same fault in a unit empty for two weeks.
   This requires the booking calendar and the maintenance engine in the same
   system, which is exactly what nobody else has.
3. **A readable audit trail.** Every AI decision is logged with its reasoning
   in plain language. Most AI tools cannot show this.
4. **AI that cannot overrule the operator.** Rules are facts the AI obeys and
   never rewrites. It can suggest raising a limit. It cannot raise one.
5. **Chasing without touching money.** Invoice/AR and supplier POs are
   tracked and chased by email on the same deterministic ladder as the
   Vendor Chase Agent. TraxKey never processes a payment or holds funds —
   this is visibility and follow-up, not accounting.

**Status.** The platform is built and running. No paying customers yet. The
current bottleneck is distribution, not features.

---

## 10. How it is built

### Addresses

| Address | Who uses it |
|---|---|
| `traxkey.ai` | Public marketing site |
| `traxkey.ai/short-term-rentals` | Short-term operator landing page |
| `traxkey.ai/demo` | Interactive dashboard demo, no signup |
| `traxkey.ai/blog` | Marketing blog: tips, trends, and insights for property and STR managers |
| `app.traxkey.ai` | Operator dashboard (the main product) |
| `vendors.traxkey.ai` | Vendor portal, where contractors see and update their jobs |
| `owners.traxkey.ai` | Owner portal: a read-only view of an owner's own properties, occupancy, 12-month spend, and recent work |
| `app.traxkey.ai/admin` | Internal admin, our own metrics. Not customer facing |
| `tenant.traxkey.ai` | Residents and guests report problems. No login |

### Inside the operator dashboard

Onboarding (Step 1, includes the Standard STR / Experiential-Micro-Resort
toggle) · Calendar · AI Activity · Turns · Orders · Invoicing · Analytics &
Reporting · Inspections · Properties & Units · Residents & Guests · Leases ·
Insights · Supplies & Damage · Vendors · Owners · Business Memory · Direct
Booking & Pricing (test) · Connect Airbnb & Vrbo

Behind them: a workflow engine handling web requests, a separate always-on
service running the AI and the scheduled work, and a Postgres database. The
two services share only the database and never call each other, so a fault in
one cannot take down the other.

Every company's data is isolated at the database level on every single query.
Residents, vendors, staff, owners, and administrators use separate login
systems that never share a session, so a compromise in one cannot reach
another.

---

## 11. What is next

| Next | Why |
|---|---|
| Text-message updates | Email works today. Text is what residents actually read. |
| Inbound reply handling | Today TraxKey **sends** updates but does not read replies. Competitors auto-answer inbound guest messages; we do not yet. |
| Tenant logins for long-term residents | Request history, documents, renewal offers. Short-term guests keep the no-login link. |
| Subscription billing | Plans exist; taking payment does not yet. |
| Document storage | Leases, insurance, notices. Unglamorous and its absence is disqualifying. |
| A real revenue-management connection | The pricing engine (§3, §6) is vendor-agnostic by design; connecting PriceLabs or a similar provider replaces the heuristic with real market intelligence. No such connector exists today. |
| STR setup & procurement | A separate, adjacent product (not a TraxKey feature): a project-management and procurement platform for furnishing a rental before launch — FF&E/OS&E scope, budget, purchase orders, delivery tracking, launch-readiness. Shares TraxKey's ordered-items engine and property inventory as the spine between the two products. Recorded in the roadmap, not yet validated with customer interviews. |
