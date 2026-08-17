import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const hdrs = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token')}` });
const fld = 'bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400';

const iso = d => d.toISOString().slice(0, 10);
const money = n => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(0)}`);

function post(route, body) {
  return fetch(`${AGENT_BASE}${route}`, { method: 'POST', headers: hdrs(), body: JSON.stringify(body) })
    .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));
}

function ReservationForm({ unitId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ guestName: '', checkinDate: '', checkoutDate: '', nightlyRate: '' });
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setErr('');
    const { ok, j } = await post('/reservations', { ...f, unitId, source: 'direct' });
    if (!ok) { setErr(j.error || 'Could not save'); return; }
    setF({ guestName: '', checkinDate: '', checkoutDate: '', nightlyRate: '' });
    setOpen(false); onCreated();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-teal-600 dark:text-teal-400 font-semibold hover:underline">+ New reservation</button>;

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-2 my-3">
      <div className="grid grid-cols-2 gap-2">
        <input required placeholder="Guest name" value={f.guestName} onChange={e => setF(s => ({ ...s, guestName: e.target.value }))} className={fld} />
        <input required type="number" step="0.01" placeholder="Nightly rate" value={f.nightlyRate} onChange={e => setF(s => ({ ...s, nightlyRate: e.target.value }))} className={fld} />
        <input required type="date" value={f.checkinDate} onChange={e => setF(s => ({ ...s, checkinDate: e.target.value }))} className={fld} />
        <input required type="date" value={f.checkoutDate} onChange={e => setF(s => ({ ...s, checkoutDate: e.target.value }))} className={fld} />
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg">Save</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">Cancel</button>
      </div>
    </form>
  );
}

const SOURCE_BADGE = {
  market_heuristic: { label: 'Market', cls: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' },
  heuristic: { label: 'Rule-based', cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-400' },
};

// Sunday-first grid of whole weeks covering every month the rates span, so
// a 30-day range starting mid-month renders as two real months rather than
// one ragged block. Days outside the rate range render as empty cells.
function monthGrids(rates) {
  if (!rates.length) return [];
  const days = rates.map(r => r.stay_date.slice(0, 10));
  const first = new Date(`${days[0]}T00:00:00`);
  const last = new Date(`${days[days.length - 1]}T00:00:00`);

  const grids = [];
  const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
  while (cursor <= last) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const startPad = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    while (cells.length % 7 !== 0) cells.push(null);
    grids.push({
      label: new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
      cells,
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return grids;
}

// A quick read on the 30-day window before scanning the grid: what it's
// projected to earn, how full it already is, how many nights still need a
// decision, and whether the market pull is nudging rates up or down.
function PricingStats({ rates, isBooked, bookedRate }) {
  let projected = 0, bookedNights = 0, pendingNights = 0, marketPulls = 0, marketPullSum = 0;
  for (const r of rates) {
    const day = r.stay_date.slice(0, 10);
    if (isBooked(day)) {
      bookedNights += 1;
      projected += Number(bookedRate(day)) || 0;
    } else if (r.applied_rate) {
      projected += Number(r.applied_rate);
    } else {
      pendingNights += 1;
      projected += Number(r.suggested_rate) || 0;
    }
    if (r.source === 'market_heuristic' && r.base_rate && r.suggested_rate) {
      marketPulls += 1;
      marketPullSum += (Number(r.suggested_rate) - Number(r.base_rate)) / Number(r.base_rate);
    }
  }
  const nights = rates.length;
  const occupancy = nights ? Math.round((bookedNights / nights) * 100) : 0;
  const avgPull = marketPulls ? Math.round((marketPullSum / marketPulls) * 100) : null;

  const Stat = ({ label, value, sub }) => (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">{label}</p>
      <p className="text-lg font-black">{value}</p>
      {sub && <p className="text-[11px] text-slate-400 dark:text-slate-500">{sub}</p>}
    </div>
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
      <Stat label="Projected, 30 nights" value={money(projected)} sub={`${bookedNights} booked, ${pendingNights} pending`} />
      <Stat label="Occupancy" value={`${occupancy}%`} sub={`${bookedNights} of ${nights} nights`} />
      <Stat label="Needs a decision" value={pendingNights} sub={pendingNights ? 'Suggested, not yet applied' : 'All caught up'} />
      <Stat label="Market pull" value={avgPull === null ? '—' : `${avgPull > 0 ? '+' : ''}${avgPull}%`}
        sub={avgPull === null ? 'No AirROI coverage this window' : 'Avg. shift from comp-set data'} />
    </div>
  );
}

function RateCalendar({ rates, isBooked, bookedRate, onApply }) {
  const [selected, setSelected] = useState(null);
  const byDay = Object.fromEntries(rates.map(r => [r.stay_date.slice(0, 10), r]));
  const grids = monthGrids(rates);
  const detail = selected ? byDay[selected] : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3">
        <span className="font-bold text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Legend</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-teal-500/30 border-2 border-teal-500" />Booked</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-green-500/20 border-2 border-green-500" />Applied rate</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-indigo-500/20 border-2 border-indigo-500" />Market comp data</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-slate-400/20 border-2 border-slate-400" />Rule-based estimate</span>
      </div>

      {grids.map(g => (
        <div key={g.label}>
          <p className="text-sm font-bold mb-2">{g.label}</p>
          <div className="grid grid-cols-7 gap-1.5">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} className="text-[10px] font-bold text-slate-400 dark:text-slate-500 text-center py-1">{d}</div>
            ))}
            {g.cells.map((day, i) => {
              const r = day && byDay[day];
              if (!r) return <div key={i} className="aspect-square rounded-xl bg-slate-50/40 dark:bg-slate-900/20" />;
              const booked = isBooked(day);
              const weekend = new Date(`${day}T00:00:00`).getDay() % 6 === 0;
              const badge = SOURCE_BADGE[r.source];
              const shown = booked ? bookedRate(day) : (r.applied_rate ?? r.suggested_rate);
              const sourceRing = booked ? 'border-teal-500' : r.applied_rate ? 'border-green-500'
                : r.source === 'market_heuristic' ? 'border-indigo-400/70' : 'border-slate-300 dark:border-white/10';
              return (
                <button
                  key={i}
                  onClick={() => setSelected(selected === day ? null : day)}
                  title={(r.factors || []).join(' · ')}
                  className={`aspect-square rounded-xl border-2 p-1 flex flex-col items-center justify-center gap-0.5 transition shadow-sm hover:shadow-md hover:-translate-y-0.5
                    ${booked ? 'bg-teal-500/10' : r.applied_rate ? 'bg-green-500/5' : weekend ? 'bg-slate-100/70 dark:bg-slate-800/40' : 'bg-slate-50 dark:bg-slate-900'}
                    ${sourceRing}
                    ${selected === day ? 'ring-2 ring-offset-1 ring-teal-400 dark:ring-offset-slate-950' : ''}`}
                >
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 leading-none">{Number(day.slice(8))}</span>
                  <span className={`text-xs font-bold leading-none ${booked
                    ? 'text-teal-700 dark:text-teal-400'
                    : r.applied_rate ? 'text-green-700 dark:text-green-400' : 'text-slate-900 dark:text-slate-100'}`}>
                    {money(shown)}
                  </span>
                  {!booked && badge && (
                    <span className={`text-[8px] font-bold px-1 rounded leading-tight ${badge.cls}`}>{badge.label}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {detail && (
        <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold">{selected}</p>
            {isBooked(selected) ? (
              <span className="text-xs font-bold text-teal-700 dark:text-teal-400">Booked @ {money(bookedRate(selected))}</span>
            ) : detail.applied_rate ? (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400">applied {money(detail.applied_rate)}</span>
            ) : (
              <button onClick={() => onApply(selected, detail.suggested_rate)}
                className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg">
                Accept {money(detail.suggested_rate)}
              </button>
            )}
          </div>
          <ul className="space-y-1">
            {(detail.factors || []).map((f, i) => (
              <li key={i} className="text-xs text-slate-500 dark:text-slate-400">· {f}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function MarketDataStatus() {
  const [configured, setConfigured] = useState(null);

  useEffect(() => {
    fetch(`${AGENT_BASE}/market-data`, { headers: hdrs() })
      .then(r => r.json()).then(j => setConfigured(!!j.configured)).catch(() => setConfigured(false));
  }, []);

  if (configured === null) return null;
  return (
    <span className="text-xs text-slate-500">
      Market data:{' '}
      <span className={`font-bold ${configured ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-200'}`}>
        {configured ? 'AirROI comp set connected' : 'not connected'}
      </span>
    </span>
  );
}

function BaseRateForm({ unitId, currentRate, onSet }) {
  const [editing, setEditing] = useState(false);
  const [rate, setRate] = useState(currentRate || '');
  const [err, setErr] = useState('');

  useEffect(() => { setRate(currentRate || ''); }, [currentRate, unitId]);

  async function save(e) {
    e.preventDefault(); setErr('');
    const { ok, j } = await post('/pricing', { action: 'set-base-rate', unitId, rate });
    if (!ok) { setErr(j.error || 'Could not save'); return; }
    setEditing(false); onSet();
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">
        Base rate: <span className="font-bold text-slate-700 dark:text-slate-200">{currentRate ? money(currentRate) : 'not set'}</span> · edit
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex items-center gap-2">
      <input autoFocus type="number" step="0.01" min="0" value={rate} onChange={e => setRate(e.target.value)}
        placeholder="Nightly rate" className={`${fld} w-32`} />
      <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-2.5 py-1.5 rounded-lg">Save</button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500">Cancel</button>
      {err && <span className="text-xs text-red-500">{err}</span>}
    </form>
  );
}

function BuyoutForm({ propertyId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ guestName: '', checkinDate: '', checkoutDate: '', totalRate: '' });
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setErr('');
    const { ok, j } = await post('/buyouts', { ...f, propertyId });
    if (!ok) { setErr(j.error || 'Could not save'); return; }
    setF({ guestName: '', checkinDate: '', checkoutDate: '', totalRate: '' });
    setOpen(false); onCreated();
  }

  if (!propertyId) return null;
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white hover:underline">+ Whole-property buyout</button>;

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-4 space-y-2 my-3">
      <p className="text-xs text-slate-500 mb-1">Blocks every unit on the property for these dates. For a full buyout: weddings, retreats, reunions.</p>
      <div className="grid grid-cols-2 gap-2">
        <input required placeholder="Guest / group name" value={f.guestName} onChange={e => setF(s => ({ ...s, guestName: e.target.value }))} className={fld} />
        <input required type="number" step="0.01" placeholder="Total rate" value={f.totalRate} onChange={e => setF(s => ({ ...s, totalRate: e.target.value }))} className={fld} />
        <input required type="date" value={f.checkinDate} onChange={e => setF(s => ({ ...s, checkinDate: e.target.value }))} className={fld} />
        <input required type="date" value={f.checkoutDate} onChange={e => setF(s => ({ ...s, checkoutDate: e.target.value }))} className={fld} />
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg">Book buyout</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500">Cancel</button>
      </div>
    </form>
  );
}

export default function PricingPage() {
  const [params, setParams] = useSearchParams();
  const [properties, setProperties] = useState([]);
  const [unitId, setUnitIdState] = useState(params.get('unitId') || '');
  const [calendar, setCalendar] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // Kept in the URL so a page reload (used after computing suggestions,
  // see computeSuggestions below) lands back on the same unit instead of
  // resetting the picker to blank.
  function setUnitId(id) {
    setUnitIdState(id);
    setParams(id ? { unitId: id } : {}, { replace: true });
  }

  useEffect(() => {
    apiRequest('traxkey-get-properties').then(p => {
      const list = (p || []).filter(x => x.id);
      setProperties(list);
      const fromUrl = params.get('unitId');
      const all = list.flatMap(pr => pr.units.map(u => ({ ...u, propertyName: pr.name })));
      const wanted = (fromUrl && all.find(u => u.id === fromUrl)) || all[0];
      if (wanted) setUnitId(wanted.id);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allUnits = properties.flatMap(p => p.units.map(u => ({ ...u, propertyName: p.name, propertyId: p.id })));
  const unit = allUnits.find(u => u.id === unitId);

  async function loadCalendar() {
    if (!unitId) return;
    const start = new Date(); const end = new Date(); end.setDate(end.getDate() + 30);
    const res = await fetch(`${AGENT_BASE}/pricing?unitId=${unitId}&startDate=${iso(start)}&endDate=${iso(end)}`, { headers: hdrs() });
    const j = await res.json().catch(() => ({ rates: [], reservations: [] }));
    setCalendar(j);
  }
  useEffect(() => { loadCalendar(); }, [unitId]);

  async function computeSuggestions() {
    if (!unitId) return;
    setBusy(true); setMsg('');
    const start = new Date(); const end = new Date(); end.setDate(end.getDate() + 30);
    const { ok, j } = await post('/pricing', { unitId, startDate: iso(start), endDate: iso(end) });
    if (!ok) { setBusy(false); setMsg(j.error || 'Could not compute suggestions'); return; }
    // A full reload rather than re-fetching in place: unitId is already
    // carried in the URL (see setUnitId above), so this lands back on the
    // same unit with the freshly computed calendar, guaranteed current.
    window.location.reload();
  }

  async function applyRate(stayDate, rate) {
    await post('/pricing', { action: 'apply', unitId, stayDate, rate });
    loadCalendar();
  }

  async function seedTestData() {
    setBusy(true); setMsg('');
    const { ok, j } = await post('/pricing-test-data', {});
    setBusy(false);
    if (!ok) { setMsg(j.error || 'Could not create test data'); return; }
    window.location.reload();
  }

  async function removeTestData() {
    setBusy(true);
    await post('/pricing-test-data', { action: 'remove' });
    window.location.reload();
  }

  const isBooked = day => (calendar?.reservations || []).some(r => day >= r.checkin_date.slice(0, 10) && day < r.checkout_date.slice(0, 10));
  const bookedRate = day => (calendar?.reservations || []).find(r => day >= r.checkin_date.slice(0, 10) && day < r.checkout_date.slice(0, 10))?.nightly_rate;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Direct Booking &amp; Pricing</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              Test calendar
              <FlowHelp
                title="What this is"
                steps={[
                  'A reservation system separate from Airbnb and Vrbo, for direct bookings TraxKey controls the price on.',
                  'Each night gets a suggested rate from the pricing engine, adjusted for weekend demand, lead time, and how full the property already is that week.',
                  'When AirROI has coverage for a unit\'s market, the internal heuristic is pulled toward the real comp-set average for that market. Otherwise the plain rule-based estimate runs on its own.',
                  'Accepting a suggestion locks it as the applied rate for that night. A booked night keeps the rate it was actually booked at.',
                ]}
                note="Each night is labeled with the tier that produced it, so a rule-of-thumb number is never mistaken for market intelligence. Market-data nights show how far the comp set moved the rate and how many active listings were behind it; the pull is capped so one thin market can't produce an absurd price."
              />
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-5">
          <select value={unitId} onChange={e => setUnitId(e.target.value)} className={fld}>
            <option value="">Select a unit…</option>
            {allUnits.map(u => (
              <option key={u.id} value={u.id}>
                {u.propertyName} — {u.unit_number || 'unit'} {u.base_nightly_rate ? `($${u.base_nightly_rate}/night)` : '(no base rate set)'}
              </option>
            ))}
          </select>
          <button onClick={computeSuggestions} disabled={busy || !unitId}
            className="bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-xs px-3 py-2 rounded-lg">
            {busy ? 'Working…' : 'Compute 30-day suggestions'}
          </button>
          <button onClick={seedTestData} disabled={busy} className="text-xs text-slate-500 hover:underline">Create test compound</button>
          <button onClick={removeTestData} disabled={busy} className="text-xs text-slate-400 hover:underline">Remove test data</button>
        </div>
        {msg && <p className="text-xs text-red-500 mb-3">{msg}</p>}

        {!unitId ? (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
            <p className="text-sm font-bold mb-1">No unit selected</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Pick a unit with a base nightly rate, or click "Create test compound" for sample data with three units already priced.</p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <BaseRateForm unitId={unitId} currentRate={calendar?.rates?.[0]?.base_rate ?? unit?.base_nightly_rate} onSet={loadCalendar} />
              <MarketDataStatus />
              <ReservationForm unitId={unitId} onCreated={loadCalendar} />
              <BuyoutForm propertyId={unit?.propertyId} onCreated={loadCalendar} />
            </div>
            {calendar?.rates?.length > 0 && (
              <PricingStats rates={calendar.rates} isBooked={isBooked} bookedRate={bookedRate} />
            )}
            {calendar?.rates?.length > 0 ? (
              <RateCalendar rates={calendar.rates} isBooked={isBooked} bookedRate={bookedRate} onApply={applyRate} />
            ) : (
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">No pricing computed yet for this unit. Click "Compute 30-day suggestions" above.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
