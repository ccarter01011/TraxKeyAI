import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
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
  const [properties, setProperties] = useState([]);
  const [unitId, setUnitId] = useState('');
  const [calendar, setCalendar] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    apiRequest('traxkey-get-properties').then(p => {
      const list = (p || []).filter(x => x.id);
      setProperties(list);
      const first = list.flatMap(pr => pr.units.map(u => ({ ...u, propertyName: pr.name })))
        .find(u => u.base_nightly_rate);
      if (first) setUnitId(first.id);
    }).catch(() => {});
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
    setBusy(false);
    if (!ok) { setMsg(j.error || 'Could not compute suggestions'); return; }
    loadCalendar();
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
                  'No revenue-management vendor is connected yet. The engine is built vendor-agnostic on purpose, so plugging in PriceLabs or another provider later is a one-file swap.',
                  'Accepting a suggestion locks it as the applied rate for that night. A booked night keeps the rate it was actually booked at.',
                ]}
                note="This is a prototype, not the real pricing intelligence a connected vendor would provide. Every suggestion shows its reasoning so it's never mistaken for market data."
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
              <ReservationForm unitId={unitId} onCreated={loadCalendar} />
              <BuyoutForm propertyId={unit?.propertyId} onCreated={loadCalendar} />
            </div>
            {calendar?.rates?.length > 0 ? (
              <div className="space-y-2">
                {calendar.rates.map(r => {
                  const day = r.stay_date.slice(0, 10);
                  const booked = isBooked(day);
                  return (
                    <div key={day} className={`flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 border ${booked
                      ? 'bg-teal-500/10 border-teal-400/30' : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/5'}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs font-mono text-slate-500 w-20 shrink-0">{day}</span>
                        {booked ? (
                          <span className="text-xs font-bold text-teal-700 dark:text-teal-400">Booked @ {money(bookedRate(day))}</span>
                        ) : (
                          <span className="text-xs text-slate-500 truncate" title={(r.factors || []).join(' · ')}>
                            {(r.factors || []).slice(1).join(' · ') || 'No adjustments'}
                          </span>
                        )}
                      </div>
                      {!booked && (
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-slate-400">base {money(r.base_rate)}</span>
                          <span className="text-sm font-bold text-teal-600 dark:text-teal-400">suggest {money(r.suggested_rate)}</span>
                          {r.applied_rate ? (
                            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-500/15 text-green-700 dark:text-green-400">applied {money(r.applied_rate)}</span>
                          ) : (
                            <button onClick={() => applyRate(day, r.suggested_rate)} className="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline">Accept</button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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
