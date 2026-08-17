import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import FlowHelp from '../components/FlowHelp.jsx';
import AnimatedNumber from '../components/AnimatedNumber.jsx';
import { RevealBar, useInView } from '../components/AnimatedBar.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const hdrs = () => ({ Authorization: `Bearer ${localStorage.getItem('tk_token')}` });
const money = n => (n === null || n === undefined ? '—'
  : Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }));

const TABS = ['Occupancy', 'Rental Activity', 'Financial', 'Owner Statements'];

// `raw` + `format` animates a single number (occupancy %, a count, a dollar
// total). Composite displays like "3 / 10" pass `value` as plain text
// instead, since there's no single number to tick toward.
function StatTile({ label, value, raw, format, tone = 'text-slate-900 dark:text-white' }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>
        {raw !== undefined ? <AnimatedNumber value={raw} format={format} /> : value}
      </p>
    </div>
  );
}

function Card({ children }) {
  return <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5">{children}</div>;
}

function OccupancyView({ d }) {
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Occupancy" raw={d.occupancyPct} format={v => `${Math.round(v)}%`} tone="text-teal-600 dark:text-teal-400" />
        <StatTile label="Occupied units" value={`${d.occupied} / ${d.totalUnits}`} />
        <StatTile label="Turns completed (90d)" raw={d.turnsCompleted90d} />
        <StatTile label="Avg days vacant (90d)" value={d.avgDaysVacant90d ?? '—'} raw={d.avgDaysVacant90d ?? undefined} />
      </div>
      <Card>
        <h3 className="font-bold mb-3">By property</h3>
        <div className="space-y-2">
          {d.byProperty.map(p => {
            const pct = p.units ? Math.round((p.occupied / p.units) * 100) : 0;
            return (
              <div key={p.id}>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-sm">{p.name}</span>
                  <span className="text-xs text-slate-500">{p.occupied} / {p.units} · {pct}%</span>
                </div>
                <RevealBar pct={pct} />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// Columns grow from the baseline (scaleY, transform-origin bottom) once the
// chart scrolls into view, and each count ticks up alongside its own bar
// rather than appearing pre-filled the instant the numbers load.
function WeeklyBarChart({ weekly }) {
  const { ref, shown: played } = useInView();
  const max = Math.max(...weekly.map(x => x.opened), 1);
  return (
    <div ref={ref} className="flex items-end gap-2 h-32">
      {weekly.map((w, i) => (
        <div key={w.week} className="flex-1 flex flex-col items-center justify-end h-full">
          <div
            className="w-full bg-teal-400 rounded-t origin-bottom"
            style={{
              height: `${(w.opened / max) * 100}%`,
              minHeight: w.opened ? '4px' : 0,
              transform: played ? 'scaleY(1)' : 'scaleY(0)',
              transition: `transform 500ms cubic-bezier(.22,.61,.36,1) ${i * 40}ms`,
            }}
          />
          <span className="text-[10px] text-slate-500 mt-1">
            {played ? <AnimatedNumber value={w.opened} duration={500} /> : 0}
          </span>
        </div>
      ))}
    </div>
  );
}

function RentalActivityView({ d }) {
  if (!d) return null;
  const t = d.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatTile label="Leases started" raw={t.leases_started} />
        <StatTile label="Renewals offered" raw={t.renewals_offered} />
        <StatTile label="Turns completed" raw={t.turns_completed} />
        <StatTile label="Requests opened" raw={t.requests_opened} />
        <StatTile label="Requests closed" raw={t.requests_closed} />
      </div>
      <Card>
        <h3 className="font-bold mb-1">Requests opened by week</h3>
        <p className="text-xs text-slate-500 mb-4">Last {d.period_days} days.</p>
        {d.weekly.length === 0 ? <p className="text-sm text-slate-400">Nothing in this period.</p> : (
          <WeeklyBarChart weekly={d.weekly} />
        )}
      </Card>
    </div>
  );
}

function FinancialView({ d }) {
  if (!d) return null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile label="Total spend" raw={d.totalSpend} format={money} tone="text-slate-900 dark:text-white" />
        <StatTile label="Maintenance" raw={d.maintenanceSpend} format={money} />
        <StatTile label="Orders (parts/materials)" raw={d.orderSpend} format={money} />
      </div>
      <Card>
        <h3 className="font-bold mb-3">Spend by property</h3>
        <div className="space-y-1.5">
          {d.byProperty.map(p => (
            <div key={p.property_name} className="flex items-center justify-between text-sm py-1 border-b border-slate-100 dark:border-white/5 last:border-0">
              <span>{p.property_name}</span>
              <span className="text-slate-500">{money(p.spend)}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h3 className="font-bold mb-3">Spend by vendor</h3>
        {d.byVendor.length === 0 ? <p className="text-sm text-slate-400">No paid jobs in this period.</p> : (
          <div className="space-y-1.5">
            {d.byVendor.map(v => (
              <div key={v.name} className="flex items-center justify-between text-sm py-1 border-b border-slate-100 dark:border-white/5 last:border-0">
                <span>{v.name}</span>
                <span className="text-slate-500">{money(v.spend)} · {v.jobs} job{v.jobs !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function OwnerStatementsView({ d }) {
  if (!d) return null;
  if (d.owners.length === 0) {
    return (
      <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-8 text-center">
        <p className="text-sm font-bold mb-1">No owners yet</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Add owners and assign properties on the <Link to="/owners" target="_blank" rel="noopener noreferrer" className="underline">Owners page</Link> to see statements here.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400 -mt-1">
        Scheduled rent from active lease terms, not confirmed collected rent. TraxKey doesn't process payments, so it has no record of what was actually paid.
      </p>
      {d.owners.map(o => {
        const net = o.scheduledRentMonthly - o.spendPeriod;
        return (
          <Card key={o.id}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <p className="font-bold">{o.name}</p>
              <span className="text-xs text-slate-500">{o.properties} properties · {o.units} units</span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-400">Scheduled rent / mo</p>
                <p className="font-bold"><AnimatedNumber value={o.scheduledRentMonthly} format={money} /></p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Spend ({d.period_days}d)</p>
                <p className="font-bold text-red-600 dark:text-red-400"><AnimatedNumber value={o.spendPeriod} format={money} /></p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Estimated net</p>
                <p className={`font-bold ${net >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                  <AnimatedNumber value={net} format={money} />
                </p>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('Occupancy');
  const [days, setDays] = useState(90);

  async function load() {
    try {
      const res = await fetch(`${AGENT_BASE}/analytics?days=${days}`, { headers: hdrs() });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not load analytics');
      setData(j);
    } catch (err) { setError(err.message); }
  }
  useEffect(() => { load(); }, [days]);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Analytics &amp; Reporting</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              How the business is doing
              <FlowHelp
                title="Dashboard vs. Analytics & Reporting"
                steps={[
                  'The Operator Dashboard is what needs you today: approvals waiting, turns in progress, what the AI just did.',
                  'Analytics & Reporting is the rollup: occupancy, activity, and spend over a period, for a periodic review rather than a daily one.',
                  'Owner Statements shows scheduled rent from lease terms next to spend, explicitly labeled as scheduled, not confirmed collected rent.',
                  'Nothing here processes a payment. TraxKey shows spend and what is owed, it never moves money.',
                ]}
              />
            </h1>
          </div>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm">
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last 12 months</option>
          </select>
        </div>

        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

        <div className="flex flex-wrap gap-1 mb-5 border-b border-slate-200 dark:border-white/10">
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-sm font-semibold px-4 py-2 -mb-px border-b-2 transition whitespace-nowrap ${tab === t
                ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t}
            </button>
          ))}
        </div>

        {!data ? <p className="text-sm text-slate-400">Loading…</p> : (
          <>
            {tab === 'Occupancy' && <OccupancyView d={data.occupancy} />}
            {tab === 'Rental Activity' && <RentalActivityView d={data.rentalActivity} />}
            {tab === 'Financial' && <FinancialView d={data.financial} />}
            {tab === 'Owner Statements' && <OwnerStatementsView d={data.ownerStatements} />}
          </>
        )}
      </div>
    </div>
  );
}
