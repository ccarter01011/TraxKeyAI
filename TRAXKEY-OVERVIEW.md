# TraxKey AI — Product Overview

*Written for someone who has not seen the code. Paste into Google Docs and
the headings, tables and lists carry over intact.*

**Last updated:** 14 August 2026

---

## 1. What TraxKey AI is

Software for people who rent out property, that does the coordinating work
instead of just recording it.

Most property software is a filing cabinet. A tenant reports a broken heater,
the software makes a ticket, and a human still has to read it, work out which
trade it needs, decide who to call, and chase them. TraxKey does that part.

---

## 2. The problem we chose

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
| **Orders** | Parts and materials a job is waiting on, flagged when late and when late means a turn will slip. |
| **Supplies & damage** | Consumables per unit with reorder levels; checkout damage tied to the stay it happened during. |
| **Vendor portal** | Vendors log in, see their jobs, mark them in progress. |
| **Tenant portal** | Residents and guests report problems, with a warm AI assistant and a "talk to a person" escape hatch. |
| **Daily briefing** | A short read every morning: what is urgent, what is handled, what is waiting on a decision. |

---

## 4. The design rule everything follows

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

This matters commercially, not just technically. It is why TraxKey can show
an operator the reason for every decision, and why the AI **cannot** invent a
cost, choose a vendor it likes, or quietly change a rule the operator set.

---

## 5. Things we deliberately do not build

Stated plainly because it is a strategy, not a gap:

| Not building | Why |
|---|---|
| Rent collection, trust accounting | Regulated, and a mistake is the operator's legal problem. It sits alongside whatever already moves their money. |
| Tenant screening scores | Governed by fair-credit law. We would integrate a licensed provider, never score anyone ourselves. |
| Deposit deduction amounts | Governed by state law that varies everywhere. TraxKey records what changed and a human decides. |
| Dynamic pricing | Needs market data we do not have. PriceLabs already does it well. |
| Writing back to Airbnb/Vrbo | Requires partner agreements we do not have. Reading their calendars does not, and is enough. |

The pattern: **TraxKey handles operations. It never handles money or makes a
legal determination.**

---

## 6. Who it is for

| Portfolio | Fit |
|---|---|
| Short-term only | Works, but Breezeway and Hostaway have deeper turnover tooling. Worth switching only if maintenance is the weak spot. |
| **Both long-term and short-term** | **The one nobody else serves.** This is the customer. |
| Long-term only | Works well, unless accounting is needed today. Then AppFolio or Buildium is the right answer. |

Built for roughly **5 to 150 units**. Above that, the incumbents' depth wins
and we would rather say so.

---

## 7. Pricing

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

## 8. Honest position, as of today

Worth stating directly because anyone evaluating this will find it out.

**Where we are behind.** Hostaway, Guesty, Hospitable, Lodgify and Buildium
are established businesses with large teams. Their short-term turnover
tooling and their accounting are more mature than ours. All five have also
shipped their own AI assistant, so AI alone is no longer a differentiator in
this market.

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

**Status.** The platform is built and running. No paying customers yet. The
current bottleneck is distribution, not features.

---

## 9. How it is built

Four separate web addresses, one shared database:

- **traxkey.ai** — the marketing site
- **app.traxkey.ai** — the operator dashboard
- **tenant.traxkey.ai** — where residents and guests report problems
- **A vendor portal** — where contractors see their jobs

Behind them: a workflow engine handling web requests, a separate always-on
service running the AI and the scheduled work, and a Postgres database. The
two services share only the database and never call each other, so a fault in
one cannot take down the other.

Every company's data is isolated at the database level on every single query.
Residents, vendors, staff and administrators use four separate login systems
that never share a session.

---

## 10. What is next

| Next | Why |
|---|---|
| Text-message updates | Email works today. Text is what residents actually read. |
| Owner portal | Owners are the property manager's customer, and there is no way to show them anything yet. |
| Tenant logins for long-term residents | Request history, documents, renewal offers. Short-term guests keep the no-login link. |
| Subscription billing | Plans exist; taking payment does not yet. |
| Document storage | Leases, insurance, notices. Unglamorous and its absence is disqualifying. |
