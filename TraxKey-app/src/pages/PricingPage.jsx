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

function PriceLabsMapping({ unitId, currentListingId, onSet }) {
  const [configured, setConfigured] = useState(null);
  const [editing, setEditing] = useState(false);
  const [listingId, setListingId] = useState(currentListingId || '');
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`${AGENT_BASE}/pricelabs`, { headers: hdrs() })
      .then(r => r.json()).then(j => setConfigured(!!j.configured)).catch(() => setConfigured(false));
  }, []);
  useEffect(() => { setListingId(currentListingId || ''); }, [currentListingId, unitId]);

  async function save(e) {
    e.preventDefault(); setErr('');
    const { ok, j } = await post('/pricelabs', { unitId, listingId });
    if (!ok) { setErr(j.error || 'Could not save'); return; }
    setEditing(false); onSet();
  }

  if (configured === null) return null;

  if (!configured) {
    return (
      <p className="text-[11px] text-slate-400">
        PriceLabs isn't connected (no <code className="bg-slate-100 dark:bg-slate-950 px-1 rounded">PRICELABS_API_KEY</code> set). Every unit uses the internal heuristic until it is.
      </p>
    );
  }

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">
        PriceLabs listing: <span className="font-bold text-slate-700 dark:text-slate-200">{currentListingId || 'not mapped'}</span> · edit
      </button>
    );
  }
  return (
    <form onSubmit={save} className="flex items-center gap-2">
      <input value={listingId} onChange={e => setListingId(e.target.value)} placeholder="PriceLabs listing ID" className={`${fld} w-40`} />
      <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-2.5 py-1.5 rounded-lg">Save</button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-500">Cancel</button>
      {err && <span className="text-xs text-red-500">{err}</span>}
    </form>
  );
}

const SOURCE_BADGE = {
  pricelabs: { label: 'PriceLabs', cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' },
  market_heuristic: { label: 'Market', cls: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400' },
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

function RateCalendar({ rates, isBooked, bookedRate, onApply }) {
  const [selected, setSelected] = useState(null);
  const byDay = Object.fromEntries(rates.map(r => [r.stay_date.slice(0, 10), r]));
  const grids = monthGrids(rates);
  const detail = selected ? byDay[selected] : null;

  return (
    <div className="space-y-6">
      {grids.map(g => (
        <div key={g.label}>
          <p className="text-sm font-bold mb-2">{g.label}</p>
          <div className="grid grid-cols-7 gap-1">
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
              <div key={d} className="text-[10px] font-bold text-slate-400 text-center py-1">{d}</div>
            ))}
            {g.cells.map((day, i) => {
              const r = day && byDay[day];
              if (!r) return <div key={i} className="aspect-square rounded-lg bg-slate-50/50 dark:bg-slate-900/30" />;
              const booked = isBooked(day);
              const badge = SOURCE_BADGE[r.source];
              const shown = booked ? bookedRate(day) : (r.applied_rate ?? r.suggested_rate);
              return (
                <button
                  key={i}
                  onClick={() => setSelected(selected === day ? null : day)}
                  title={(r.factors || []).join(' · ')}
                  className={`aspect-square rounded-lg border p-1 flex flex-col items-center justify-center gap-0.5 transition
                    ${booked
                      ? 'bg-teal-500/10 border-teal-400/30'
                      : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/5 hover:border-teal-400/50'}
                    ${selected === day ? 'ring-2 ring-teal-400' : ''}`}
                >
                  <span className="text-[10px] text-slate-400 leading-none">{Number(day.slice(8))}</span>
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

      <div className="flex flex-wrap gap-3 text-[10px] text-slate-500">
        <span><span className="inline-block w-2 h-2 rounded-sm bg-teal-500/40 mr-1" />Booked</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-green-500/40 mr-1" />Applied rate</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-indigo-500/40 mr-1" />Market comp data</span>
        <span><span className="inline-block w-2 h-2 rounded-sm bg-sky-500/40 mr-1" />PriceLabs</span>
      </div>

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
                  'Each night gets a suggested rate from a pricing engine, adjusted for weekend demand, lead time, and how full the property already is that week.',
                  'Three pricing tiers, picked per unit. A unit mapped to a real PriceLabs listing (with PRICELABS_API_KEY set) gets a PriceLabs recommendation. Otherwise, if AIRROI_API_KEY is set, the internal heuristic is pulled toward the comp-set average for that market. Otherwise the plain heuristic runs on its own.',
                  'Accepting a suggestion locks it as the applied rate for that night. A booked night keeps the rate it was actually booked at.',
                ]}
                note="Each night is labeled with the tier that produced it, so a rule-of-thumb number is never mistaken for market intelligence. Market-data nights show how far the comp set moved the rate and how many comparable listings were behind it; the pull is capped so one thin market can't produce an absurd price."
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
              <PriceLabsMapping unitId={unitId} currentListingId={calendar?.pricelabsListingId} onSet={loadCalendar} />
              <MarketDataStatus />
              <ReservationForm unitId={unitId} onCreated={loadCalendar} />
              <BuyoutForm propertyId={unit?.propertyId} onCreated={loadCalendar} />
            </div>
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
