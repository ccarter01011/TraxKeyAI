import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import FlowHelp from '../components/FlowHelp.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';

function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function parse(s) { return new Date(`${s}T00:00:00`); }

/**
 * Rows are units, columns are days. This is the multi-calendar shape every
 * short-term rental platform uses, because it is the right one: an operator
 * scans down a column to see what a single day looks like across the whole
 * portfolio.
 *
 * What no competitor's version does is put long-term units on the same grid.
 * Their calendars only know about bookings. Here a lease runs as one
 * continuous bar with its end date marked, so a mixed operator sees both
 * halves of the business in a single timeline.
 */
export default function CalendarPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const VISIBLE = 21;

  useEffect(() => {
    fetch(`${AGENT_BASE}/calendar`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('tk_token')}` },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load the calendar'))))
      .then(setData)
      .catch(err => setError(err.message));
  }, []);

  if (error) {
    return <Shell><p className="text-sm text-red-500">{error}</p></Shell>;
  }
  if (!data) {
    return <Shell><p className="text-sm text-slate-400 dark:text-slate-500">Loading calendar…</p></Shell>;
  }

  const start = addDays(parse(data.start), offset);
  const days = Array.from({ length: VISIBLE }, (_, i) => addDays(start, i));
  const todayIso = iso(new Date());

  // Group by property so a fourplex reads as one block, not four unrelated rows.
  const groups = [];
  data.units.forEach(u => {
    let g = groups.find(x => x.id === u.property_id);
    if (!g) { g = { id: u.property_id, name: u.property_name, units: [] }; groups.push(g); }
    g.units.push(u);
  });

  return (
    <Shell>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setOffset(o => o - 7)}
            className="text-xs border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 hover:border-teal-400/50 transition">←</button>
          <button onClick={() => setOffset(0)}
            className="text-xs border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 hover:border-teal-400/50 transition">Today</button>
          <button onClick={() => setOffset(o => o + 7)}
            className="text-xs border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 hover:border-teal-400/50 transition">→</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
          <Legend cls="bg-sky-500/70" label="Guest booking" />
          <Legend cls="bg-slate-500/50" label="Owner block" />
          <Legend cls="bg-teal-500/60" label="Lease" />
          <Legend cls="bg-amber-400" label="Turn due" />
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 dark:border-white/5 rounded-2xl">
        <div className="min-w-[860px]">
          {/* header */}
          <div className="flex sticky top-0 bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-white/5">
            <div className="w-48 shrink-0 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">Unit</div>
            <div className="flex-1 flex">
              {days.map(d => {
                const isToday = iso(d) === todayIso;
                const weekend = d.getDay() === 0 || d.getDay() === 6;
                return (
                  <div key={iso(d)} className={`flex-1 text-center py-2 text-[10px] leading-tight border-l border-slate-200 dark:border-white/5 ${
                    isToday ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400 font-bold'
                    : weekend ? 'text-slate-400 dark:text-slate-600' : 'text-slate-500 dark:text-slate-400'}`}>
                    <div>{d.toLocaleDateString(undefined, { weekday: 'narrow' })}</div>
                    <div>{d.getDate()}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {groups.map(g => (
            <div key={g.id}>
              <div className="px-3 py-1.5 bg-slate-100/60 dark:bg-slate-950/50 text-[11px] font-bold text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/5">
                {g.name}
              </div>
              {g.units.map(u => (
                <UnitRow key={u.id} unit={u} days={days} todayIso={todayIso} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
        Short-term rows come from your synced Airbnb and Vrbo calendars. Long-term rows come from
        the lease. Both live here so you only look in one place.
      </p>
    </Shell>
  );
}

function Legend({ cls, label }) {
  return <span className="inline-flex items-center gap-1.5"><span className={`w-3 h-2 rounded ${cls}`} />{label}</span>;
}

function UnitRow({ unit, days, todayIso }) {
  const label = unit.unit_number ? `Unit ${unit.unit_number}` : 'Whole property';
  const kind = unit.is_str ? 'STR' : unit.is_ltr ? 'LTR' : null;

  // A day is "covered" by a booking from check-in up to (not including)
  // checkout, which is how nights work: a guest leaving on the 5th does not
  // occupy the night of the 5th, and that night is available to sell.
  function cellFor(d) {
    const day = iso(d);
    for (const b of unit.bookings) {
      if (day >= b.checkin && day < b.checkout) {
        return b.isBlocked
          ? { cls: 'bg-slate-500/40', title: b.label || 'Owner block' }
          : { cls: 'bg-sky-500/60', title: b.label || 'Guest booking' };
      }
    }
    if (unit.lease) {
      const endsBefore = unit.lease.end && day > unit.lease.end;
      if (day >= unit.lease.start && !endsBefore) {
        return { cls: 'bg-teal-500/45', title: unit.lease.residentName || 'Leased' };
      }
    }
    return null;
  }

  const turnDays = new Set(unit.turns.map(t => t.deadline).filter(Boolean));
  const leaseEnd = unit.lease?.end;

  return (
    <div className="flex border-b border-slate-200 dark:border-white/5 last:border-0">
      <div className="w-48 shrink-0 px-3 py-2 flex items-center gap-2">
        <span className="text-sm truncate">{label}</span>
        {kind && (
          <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${
            kind === 'STR' ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                           : 'bg-teal-500/15 text-teal-600 dark:text-teal-400'}`}>
            {kind}
          </span>
        )}
      </div>
      <div className="flex-1 flex">
        {days.map(d => {
          const day = iso(d);
          const cell = cellFor(d);
          const isTurn = turnDays.has(day);
          const isLeaseEnd = leaseEnd === day;
          return (
            <div key={day}
              title={[cell?.title, isTurn ? 'Turn due' : null, isLeaseEnd ? 'Lease ends' : null].filter(Boolean).join(' · ')}
              className={`flex-1 h-9 border-l border-slate-200 dark:border-white/5 relative ${
                day === todayIso ? 'bg-teal-500/5' : ''}`}>
              {cell && <div className={`absolute inset-y-1.5 inset-x-0 ${cell.cls}`} />}
              {isTurn && <div className="absolute inset-x-0 bottom-0.5 mx-auto w-1.5 h-1.5 rounded-full bg-amber-400" />}
              {isLeaseEnd && <div className="absolute inset-y-0 right-0 w-0.5 bg-amber-400" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-6xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="mb-6 mt-2">
          <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Calendar</p>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">
            Everything, one timeline
            <FlowHelp
              title="What's on this calendar"
              steps={[
                'Short-term rows show guest bookings pulled from your synced Airbnb and Vrbo calendars.',
                'Owner blocks appear in grey, so you can see why a night is unavailable, not just that it is.',
                'Long-term rows show the lease as one continuous bar, with a marker on the day it ends.',
                'An amber dot marks a turn deadline, the day a unit has to be ready.',
              ]}
              note="Every other platform's calendar shows short-term bookings only, because that is all they track. Putting long-term units on the same grid is the point of running both in one system."
            />
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}
