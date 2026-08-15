import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { apiRequest } from '../lib/api.js';
import ThemeToggle from '../components/ThemeToggle.jsx';
import ConciergeWidget from '../components/ConciergeWidget.jsx';
import SuggestionModal from '../components/SuggestionModal.jsx';

const TENANT_PORTAL_BASE = 'https://tenant.traxkey.ai';

// A lease inside this window needs a renewal decision. Matches
// RENEWAL_WINDOW_DAYS in LeasesPage.
const RENEWAL_WINDOW_DAYS = 90;
const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';

/** A new account is an empty dashboard, which is the worst first impression
 *  for a product whose value is the AI noticing things: with nothing to
 *  notice, it looks broken. Borrowed from Buildium's sample-data trial. */
function SampleData({ isEmpty, hasSample, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function call(action) {
    setBusy(true); setError('');
    try {
      const res = await fetch(`${AGENT_BASE}/sample-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('tk_token')}`,
        },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'That did not work');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (hasSample) {
    return (
      <div className="flex items-center justify-between gap-3 bg-amber-500/10 border border-amber-400/20 rounded-xl px-4 py-3 mb-6">
        <p className="text-xs text-amber-700 dark:text-amber-400">
          You're looking at sample data. Remove it whenever you're ready to add your own.
        </p>
        <button onClick={() => call('remove')} disabled={busy}
          className="shrink-0 text-xs font-bold text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-50">
          {busy ? 'Removing…' : 'Remove sample data'}
        </button>
      </div>
    );
  }

  if (!isEmpty) return null;

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-6 mb-6 text-center">
      <p className="font-bold mb-1">Nothing here yet</p>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Add your first property, or load a sample portfolio to see how TraxKey handles a real day.
        It's a mix of long-term and short-term, and you can remove it in one click.
      </p>
      <div className="flex items-center justify-center gap-3">
        <Link to="/properties" target="_blank" rel="noopener noreferrer" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
          Add a property
        </Link>
        <button onClick={() => call('seed')} disabled={busy}
          className="border border-slate-300 dark:border-white/15 hover:border-teal-400/50 text-sm font-bold px-4 py-2.5 rounded-lg transition disabled:opacity-50">
          {busy ? 'Loading…' : 'Load sample data'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500 mt-3">{error}</p>}
    </div>
  );
}

function TenantPortalLink() {
  const [profile, setProfile] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiRequest('traxkey-company-profile').then(setProfile).catch(() => {});
  }, []);

  if (!profile) return null;

  const link = `${TENANT_PORTAL_BASE}/?co=${profile.portal_slug}`;

  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <details className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl mb-6">
      <summary className="cursor-pointer px-4 py-3 text-sm text-slate-600 dark:text-slate-300 select-none">
        Fallback company code for residents
      </summary>
      <div className="px-4 pb-4">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Prefer inviting residents individually, each gets their own link and TraxKey already
          knows their unit. This shared code is only a fallback for before residents are set up.{' '}
          <Link to="/residents" target="_blank" rel="noopener noreferrer" className="underline text-teal-600 dark:text-teal-300">Invite residents →</Link>
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs text-teal-700 dark:text-teal-300 overflow-x-auto whitespace-nowrap">{link}</code>
          <button onClick={copy} className="shrink-0 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-2 rounded-lg transition">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </details>
  );
}

/** A nav tile that carries live state. The badge is the point: "Turns" tells
 *  an operator nothing, "Turns, 1 due today" answers the question without a
 *  click. Badge is omitted entirely when there is nothing to say, an empty
 *  or zero badge is noise. */
function Tile({ to, title, blurb, badge, tone = 'neutral' }) {
  const toneCls = {
    urgent: 'bg-red-500/15 text-red-600 dark:text-red-400',
    attention: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    neutral: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  }[tone];

  return (
    <Link
      to={to}
      target="_blank"
      rel="noopener noreferrer"
      className="block bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5 hover:border-teal-400/50 dark:hover:border-teal-400/30 transition"
    >
      <div className="flex items-start justify-between gap-3 mb-1">
        <p className="font-bold">{title} →</p>
        {badge && (
          <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${toneCls}`}>
            {badge}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400">{blurb}</p>
    </Link>
  );
}

function Section({ label, hint, children }) {
  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-2 mb-3">
        <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
        <p className="text-xs text-slate-400 dark:text-slate-600">{hint}</p>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [counts, setCounts] = useState(null);

  // Reuses the endpoints each page already calls rather than adding a
  // dashboard-summary workflow. Three extra reads on load, and zero new n8n
  // workflows to import and keep in sync.
  function load() {
    Promise.all([
      apiRequest('traxkey-get-properties').catch(() => []),
      apiRequest('traxkey-get-turns').catch(() => []),
      apiRequest('traxkey-get-leases').catch(() => []),
      apiRequest('traxkey-get-inspections').catch(() => []),
      apiRequest('traxkey-get-activity').catch(() => []),
    ]).then(([properties, turns, leases, inspections, activity]) => {
      const props = (properties || []).filter(p => p.id);
      const openTurns = (turns || []).filter(t => t.id && t.status !== 'occupied');
      const dueToday = openTurns.filter(
        t => t.deadline_at && new Date(t.deadline_at) <= new Date(new Date().toDateString())
      );
      const expiring = (leases || []).filter(l => {
        if (!l.id || l.status !== 'active' || !l.end_date) return false;
        const days = Math.round((new Date(`${l.end_date}T00:00:00`) - new Date()) / 86400000);
        return days <= RENEWAL_WINDOW_DAYS;
      });
      const openInspections = (inspections || []).filter(i => i.id && i.status === 'in_progress');
      const needsYou = (activity || []).filter(
        r => r.id && ['awaiting_approval', 'needs_vendor', 'needs_human_review'].includes(r.status)
      );
      setCounts({
        isEmpty: props.length === 0,
        hasSample: props.some(p => (p.name || '').startsWith('Sample: ')),
        openTurns: openTurns.length,
        dueToday: dueToday.length,
        expiring: expiring.length,
        openInspections: openInspections.length,
        needsYou: needsYou.length,
      });
    });
  }

  useEffect(() => { load(); }, []);

  const c = counts || {};

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Operator Dashboard</p>
            <h1 className="text-2xl font-bold">Welcome, {user?.name || 'there'}</h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button onClick={logout} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">Log out</button>
          </div>
        </div>

        <ConciergeWidget />

        <SampleData isEmpty={c.isEmpty} hasSample={c.hasSample} onChanged={load} />

        {/* Grouped by how often an operator touches each thing, not by
            lifecycle stage. Lifecycle grouping (onboarding, setup,
            operations) optimises for week one and then leaves dead weight in
            prime position for years. Daily work belongs at the top. */}
        <Section label="Start here" hint="do this once per property, everything else works better after">
          <Tile
            to="/onboarding" title="Step 1 &middot; Onboard a property"
            blurb="Capture the nuances only you know: where the shutoff is, the filter size, which quirks are normal. Plus the inventory of what's in the unit."
          />
        </Section>

        <Section label="Daily operations" hint="what you touch most">
          <Tile
            to="/calendar" title="Calendar"
            blurb="Every unit on one timeline. Guest bookings, owner blocks, leases, and turn deadlines together."
          />
          <Tile
            to="/activity" title="AI Activity"
            blurb="Every request and every step the AI Coordinator took on it."
            badge={c.needsYou ? `${c.needsYou} need you` : null}
            tone="urgent"
          />
          <Tile
            to="/turns" title="Turns"
            blurb="Vacant-to-ready tracking for move-out turnovers and cleaning turns."
            badge={c.dueToday ? `${c.dueToday} due today` : c.openTurns ? `${c.openTurns} open` : null}
            tone={c.dueToday ? 'urgent' : 'attention'}
          />
          <Tile
            to="/orders" title="Orders"
            blurb="Parts and materials a job is waiting on. Flagged when late, and when late means a turn will slip."
          />
          <Tile
            to="/invoices" title="Invoices"
            blurb="What you're owed, how overdue it is, and reminders sent for you until someone answers."
          />
          <Tile
            to="/inspections" title="Inspections"
            blurb="Move-in and move-out condition records, and what changed between them."
            badge={c.openInspections ? `${c.openInspections} in progress` : null}
            tone="attention"
          />
        </Section>

        <Section label="Portfolio records" hint="changes now and then">
          <Tile
            to="/insights" title="Insights"
            blurb="Patterns in your own data: vendors slowing down, units that keep breaking, rents below your average."
          />
          <Tile
            to="/properties" title="Properties &amp; units"
            blurb="Your properties and units, what TraxKey AI's agents monitor and act on."
          />
          <Tile
            to="/residents" title="Residents &amp; guests"
            blurb="Invite each resident or short-term guest with their own reporting link."
          />
          <Tile
            to="/owners" title="Owners"
            blurb="If you manage for other people, give them a read-only view of their own properties."
          />
          <Tile
            to="/leases" title="Leases"
            blurb="Terms, rent, and renewal dates. Flagged 90 days before they end."
            badge={c.expiring ? `${c.expiring} need a decision` : null}
            tone="attention"
          />
        </Section>

        <Section label="Analytics & Reporting" hint="how the business is doing, not what needs you today">
          <Tile
            to="/analytics" title="Occupancy, activity &amp; financials"
            blurb="Occupancy trend, rental activity rollups, spend by property and vendor, and owner statements."
          />
        </Section>

        <Section label="Setup" hint="set once, revisit rarely">
          <Tile
            to="/vendors" title="Vendors"
            blurb="The network the AI dispatches to, ranked by their real job history."
          />
          <Tile
            to="/str-ops" title="Supplies &amp; damage"
            blurb="Consumables per unit with reorder levels, and checkout damage tied to the stay it happened during."
          />

          <Tile
            to="/calendars" title="Connect Airbnb &amp; Vrbo"
            blurb="Paste a calendar link once. This is setup, not the day-to-day calendar."
          />
          <Tile
            to="/business-memory" title="Business Memory"
            blurb="Rules the AI follows: approval limits, quiet hours, preferred vendors."
          />
          <TenantPortalLink />
        </Section>
      </div>

      <button
        onClick={() => setSuggestOpen(true)}
        className="fixed bottom-6 right-6 z-40 bg-teal-500 hover:bg-teal-400 text-slate-950 rounded-full w-14 h-14 shadow-lg shadow-teal-500/30 flex items-center justify-center transition active:scale-95"
        aria-label="Suggest a feature"
        title="Suggest a feature"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M9 18H15M12 3C8.5 3 6 5.5 6 9C6 11.5 7.5 13 8.5 14C9 14.5 9 15 9 15.5V16H15V15.5C15 15 15 14.5 15.5 14C16.5 13 18 11.5 18 9C18 5.5 15.5 3 12 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>

      {suggestOpen && <SuggestionModal onClose={() => setSuggestOpen(false)} />}
    </div>
  );
}
