import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const hdrs = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token')}` });
const fld = 'w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400 placeholder:text-slate-400 dark:placeholder:text-slate-600 placeholder:italic';

// The onboarding SOP, in the order an owner walkthrough actually happens.
// Grouped so a half-finished profile still reads as deliberate rather than
// abandoned, since most operators will fill this in over more than one sitting.
const SECTIONS = [
  {
    title: 'The basics',
    hint: 'What it is and how people get in.',
    fields: [
      ['yearBuilt', 'Year built', 'number'],
      ['squareFeet', 'Square feet', 'number'],
      ['accessNotes', 'Access', 'text', 'e.g. Lockbox on the gas meter, back door sticks in winter'],
      ['parkingNotes', 'Parking', 'text', 'e.g. Two spots in the alley, guest parking on the street after 6pm'],
    ],
  },
  {
    title: 'The things you get asked at 10pm',
    hint: 'This is the section that pays for itself. The AI uses it to answer residents directly.',
    core: true,
    fields: [
      ['waterShutoffLocation', 'Water shutoff location', 'text', 'e.g. Basement, back wall behind the stairs'],
      ['electricalPanelLocation', 'Electrical panel location', 'text', 'e.g. Garage, left of the door'],
      ['hvacType', 'Heating / cooling type', 'text', 'e.g. Gas furnace + central AC'],
      ['hvacFilterSize', 'HVAC filter size', 'text', 'e.g. 16x25x1'],
      ['waterHeaterNotes', 'Water heater', 'text', 'e.g. Gas, in the utility closet. Pilot goes out occasionally.'],
      ['applianceNotes', 'Appliances', 'text', 'e.g. Whirlpool dishwasher, GE range, LG stacked washer/dryer'],
      ['emergencyNotes', 'Emergency info', 'text', 'e.g. Gas shutoff at the meter, north side'],
    ],
  },
  {
    title: 'Nuances only you know',
    hint: 'The "that\'s normal, not a fault" list. Stops a service call for something that was never broken.',
    core: true,
    fields: [
      ['knownQuirks', 'Known quirks', 'textarea', 'e.g. Upstairs bath fan is loud. This is normal.\nFront door needs a firm pull to latch.'],
      ['wifiNotes', 'Wi-Fi', 'text', 'e.g. Network name and where the router is. Never put the password here.'],
      ['trashDay', 'Trash day', 'text', 'e.g. Tuesday, bins out Monday night'],
      ['utilitiesNotes', 'Utilities', 'text', 'e.g. Owner pays water and trash, resident pays gas and electric'],
    ],
  },
  {
    title: 'Rules',
    fields: [
      ['petPolicy', 'Pet policy', 'text', 'e.g. Cats only, no dogs, $300 deposit'],
      ['smokingPolicy', 'Smoking policy', 'text', 'e.g. No smoking anywhere on the property'],
    ],
  },
  {
    title: 'Insurance',
    hint: 'Used by the damage assessment to compare a repair estimate against your deductible. Never shown to residents.',
    fields: [
      ['insuranceCarrier', 'Carrier', 'text', 'e.g. State Farm'],
      ['insurancePolicyNumber', 'Policy number', 'text'],
      ['insuranceDeductible', 'Deductible', 'number', 'e.g. 1000'],
    ],
  },
];

const CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged', 'missing'];

// React's href={value} does not check the scheme, so a stored javascript:
// URL would run in this user's own session on click. The backend now
// rejects a non-http(s) scheme at write time (agents/property_profile.py
// _safe_url), but checking again here means this render is safe even
// against a row written before that guard existed, or by a path that
// forgets to call it later.
function isSafeUrl(value) {
  // `new URL('', base)` resolves to the base itself rather than throwing, so
  // an empty value would otherwise read as "safe" here even though it's not
  // a link at all. Callers already guard on truthiness before reaching this,
  // but the check should be correct on its own, not just as currently used.
  if (!value) return false;
  try {
    return ['http:', 'https:'].includes(new URL(value, window.location.origin).protocol);
  } catch {
    return false;
  }
}
const CATEGORIES = [
  ['ffe', 'FF&E (furniture, fixtures, equipment)'],
  ['ose', 'OS&E (linens, kitchenware, supplies)'],
  ['appliance', 'Appliance'],
  ['safety', 'Safety (alarms, extinguisher, locks)'],
];

function InventoryForm({ propertyId, units, onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', room: '', category: 'ffe', quantity: '1', unitId: '', brand: '', modelSku: '', purchasePrice: '', purchasedOn: '', warrantyExpiresOn: '', replacementUrl: '', condition: 'good' });
  const [err, setErr] = useState('');
  const up = k => e => setF(s => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setErr('');
    const res = await fetch(`${AGENT_BASE}/inventory`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ ...f, propertyId }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { setErr(j.error || 'Could not save'); return; }
    setF({ name: '', room: '', category: 'ffe', quantity: '1', unitId: '', brand: '', modelSku: '', purchasePrice: '', purchasedOn: '', warrantyExpiresOn: '', replacementUrl: '', condition: 'good' });
    setOpen(false); onCreated();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg transition">+ Add item</button>;

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-5">
      <p className="font-bold text-sm">Add an inventory item</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <input required placeholder="What is it (Whirlpool dishwasher)" value={f.name} onChange={up('name')} className={fld} />
        <input placeholder="Room (Kitchen)" value={f.room} onChange={up('room')} className={fld} />
        <select value={f.category} onChange={up('category')} className={fld}>
          {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={f.unitId} onChange={up('unitId')} className={fld}>
          <option value="">Whole property</option>
          {units.map(u => <option key={u.id} value={u.id}>Unit {u.unit_number || '—'}</option>)}
        </select>
        <input placeholder="Brand" value={f.brand} onChange={up('brand')} className={fld} />
        <input placeholder="Model / SKU" value={f.modelSku} onChange={up('modelSku')} className={fld} />
        <input type="number" min="1" placeholder="Quantity" value={f.quantity} onChange={up('quantity')} className={fld} />
        <input type="number" step="0.01" placeholder="Purchase price" value={f.purchasePrice} onChange={up('purchasePrice')} className={fld} />
        <label className="text-xs text-slate-500">Purchased<input type="date" value={f.purchasedOn} onChange={up('purchasedOn')} className={fld} /></label>
        <label className="text-xs text-slate-500">Warranty expires<input type="date" value={f.warrantyExpiresOn} onChange={up('warrantyExpiresOn')} className={fld} /></label>
      </div>
      <input placeholder="Replacement link (where to buy another)" value={f.replacementUrl} onChange={up('replacementUrl')} className={fld} />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg">Save</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 px-3">Cancel</button>
      </div>
    </form>
  );
}

const AMENITY_CATEGORIES = [
  ['pool', 'Pool'], ['water', 'Water (lake, dock, river)'], ['fire', 'Fire (firepit, grill)'],
  ['sport', 'Sport / recreation'], ['gathering', 'Gathering space'], ['other', 'Other'],
];
const AMENITY_STATUS_CLS = {
  open: 'bg-green-500/15 text-green-700 dark:text-green-400',
  maintenance: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  closed: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

function AddAmenityForm({ propertyId, onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', category: 'other', capacity: '' });
  const [err, setErr] = useState('');

  async function submit(e) {
    e.preventDefault(); setErr('');
    const res = await fetch(`${AGENT_BASE}/amenities`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ ...f, propertyId }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { setErr(j.error || 'Could not save'); return; }
    setF({ name: '', category: 'other', capacity: '' }); setOpen(false); onCreated();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg transition">+ Add amenity</button>;

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-5">
      <p className="font-bold text-sm">Add a shared amenity</p>
      <div className="grid sm:grid-cols-3 gap-3">
        <input required placeholder="Main pool" value={f.name} onChange={e => setF(s => ({ ...s, name: e.target.value }))} className={fld} />
        <select value={f.category} onChange={e => setF(s => ({ ...s, category: e.target.value }))} className={fld}>
          {AMENITY_CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input type="number" min="1" placeholder="Capacity (optional)" value={f.capacity} onChange={e => setF(s => ({ ...s, capacity: e.target.value }))} className={fld} />
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg">Save</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 px-3">Cancel</button>
      </div>
    </form>
  );
}

function AmenityRow({ amenity, onChanged }) {
  const [note, setNote] = useState('');
  const [notifyMsg, setNotifyMsg] = useState('');
  const [notifyResult, setNotifyResult] = useState(null);
  const [busy, setBusy] = useState(false);

  async function setStatus(status) {
    await fetch(`${AGENT_BASE}/amenities`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'status', amenityId: amenity.id, status, note }) });
    setNote(''); onChanged();
  }
  async function remove() {
    await fetch(`${AGENT_BASE}/amenities`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'delete', amenityId: amenity.id }) });
    onChanged();
  }
  async function notify() {
    if (!notifyMsg.trim()) return;
    setBusy(true);
    const res = await fetch(`${AGENT_BASE}/amenity-notify`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ amenityId: amenity.id, message: notifyMsg }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    setNotifyResult(j);
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4 mb-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">{amenity.name}</p>
          <p className="text-xs text-slate-500 mt-0.5">
            {AMENITY_CATEGORIES.find(([v]) => v === amenity.category)?.[1] || amenity.category}
            {amenity.capacity ? ` · up to ${amenity.capacity}` : ''}
            {amenity.open_issues > 0 ? ` · ${amenity.open_issues} open issue${amenity.open_issues !== 1 ? 's' : ''}` : ''}
          </p>
          {amenity.status_note && <p className="text-xs text-slate-500 mt-1 italic">{amenity.status_note}</p>}
        </div>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${AMENITY_STATUS_CLS[amenity.status]}`}>{amenity.status}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-3">
        {['open', 'maintenance', 'closed'].filter(s => s !== amenity.status).map(s => (
          <button key={s} onClick={() => setStatus(s)} className="text-xs font-semibold text-teal-600 dark:text-teal-400 hover:underline">
            Mark {s}
          </button>
        ))}
        <button onClick={remove} className="text-xs text-slate-400 hover:text-red-500 ml-auto">Remove</button>
      </div>
      {amenity.status !== 'open' && (
        <input placeholder="Status note (e.g. back online Thursday)" value={note} onChange={e => setNote(e.target.value)}
          className={`${fld} mt-2 text-xs`} />
      )}
      <details className="mt-3">
        <summary className="text-xs text-slate-500 cursor-pointer select-none">Notify guests currently on the property</summary>
        <div className="mt-2 flex gap-2">
          <input placeholder="e.g. Pool heater is being repaired, back online Thursday" value={notifyMsg}
            onChange={e => setNotifyMsg(e.target.value)} className={`${fld} text-xs`} />
          <button onClick={notify} disabled={busy} className="shrink-0 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-xs px-3 py-2 rounded-lg">
            {busy ? '…' : 'Send'}
          </button>
        </div>
        {notifyResult && (
          <p className="text-[11px] text-slate-500 mt-2">
            Notified {notifyResult.notified} of {notifyResult.totalActiveGuests} active guests by email.
            {notifyResult.unreachable?.length > 0 && (
              <> No email on file for: {notifyResult.unreachable.map(g => `${g.guestName || 'guest'} (${g.unitNumber || 'unit'})`).join(', ')}. Reach them another way.</>
            )}
          </p>
        )}
      </details>
    </div>
  );
}

function AmenitiesTab({ propertyId }) {
  const [amenities, setAmenities] = useState(null);

  async function load() {
    const res = await fetch(`${AGENT_BASE}/amenities?propertyId=${propertyId}`, { headers: hdrs() });
    const j = await res.json().catch(() => ({ amenities: [] }));
    setAmenities(j.amenities || []);
  }
  useEffect(() => { load(); }, [propertyId]);

  return (
    <>
      <AddAmenityForm propertyId={propertyId} onCreated={load} />
      {amenities === null ? <p className="text-sm text-slate-400">Loading…</p>
        : amenities.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
            <p className="text-sm font-bold mb-1">No shared amenities logged</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Add the pool, dock, firepit, or anything shared across units. An issue here affects every guest, so it lives separately from a single unit's maintenance.</p>
          </div>
        ) : amenities.map(a => <AmenityRow key={a.id} amenity={a} onChanged={load} />)}
    </>
  );
}

function RentalModeToggle({ propertyId, mode, onChanged }) {
  const [busy, setBusy] = useState(false);
  async function set(next) {
    if (next === mode) return;
    setBusy(true);
    await fetch(`${AGENT_BASE}/rental-mode`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ propertyId, mode: next }) });
    setBusy(false); onChanged();
  }
  return (
    <div className="inline-flex items-center bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg p-0.5 gap-0.5">
      {[['standard', 'Standard STR'], ['experiential', 'Experiential / Micro-Resort']].map(([v, l]) => (
        <button key={v} disabled={busy} onClick={() => set(v)}
          className={`px-3 py-1.5 rounded-md text-xs font-bold transition disabled:opacity-50 ${mode === v
            ? 'bg-teal-500 text-slate-950' : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function PropertyProfilePage() {
  const [params, setParams] = useSearchParams();
  const propertyId = params.get('propertyId') || '';
  const [properties, setProperties] = useState([]);
  const [profile, setProfile] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [form, setForm] = useState({});
  const [tab, setTab] = useState('profile');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiRequest('traxkey-get-properties')
      .then(p => {
        const list = (p || []).filter(x => x.id);
        setProperties(list);
        if (!propertyId && list.length) setParams({ propertyId: list[0].id }, { replace: true });
      })
      .catch(() => {});
  }, []);

  async function load() {
    if (!propertyId) return;
    const [prof, inv] = await Promise.all([
      fetch(`${AGENT_BASE}/property-profile?propertyId=${propertyId}`, { headers: hdrs() }).then(r => r.json()).catch(() => null),
      fetch(`${AGENT_BASE}/inventory?propertyId=${propertyId}`, { headers: hdrs() }).then(r => r.json()).catch(() => ({ items: [] })),
    ]);
    setProfile(prof);
    setInventory(inv.items || []);
    const f = {};
    SECTIONS.forEach(s => s.fields.forEach(([key]) => {
      const snake = key.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
      f[key] = prof?.[snake] ?? '';
    }));
    setForm(f);
    if (prof?.rental_mode !== 'experiential') setTab(t => (t === 'amenities' ? 'profile' : t));
  }
  useEffect(() => { load(); }, [propertyId]);

  async function save() {
    setSaving(true); setMsg('');
    const res = await fetch(`${AGENT_BASE}/property-profile`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ ...form, propertyId }) });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok || !j.ok) { setMsg(j.error || 'Could not save'); return; }
    setMsg('Saved'); load(); setTimeout(() => setMsg(''), 2000);
  }

  async function setCondition(itemId, condition) {
    await fetch(`${AGENT_BASE}/inventory`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'condition', itemId, condition }) });
    load();
  }
  async function removeItem(itemId) {
    await fetch(`${AGENT_BASE}/inventory`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'delete', itemId }) });
    load();
  }

  const current = properties.find(p => p.id === propertyId);
  const units = current?.units || [];
  const pct = profile?.completeness ?? 0;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="mt-2 mb-5">
          <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Step 1 · Onboarding</p>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">
            Know the property
            <FlowHelp
              title="Why this is step one"
              steps={[
                'Everything TraxKey does downstream gets better when it knows the property. A resident asking "what filter does my furnace take" gets an answer instead of a work order.',
                'Fill in what you know now, come back for the rest. A half-filled profile is far more useful than an empty one.',
                'The inventory is the list of what is actually in the unit, with what it cost and how to replace it.',
                'When something breaks, TraxKey uses the inventory and your deductible to recommend whether to bill the occupant, claim it, or absorb it.',
              ]}
              note="Insurance details and the section about quirks are never shown to residents. The resident assistant only sees practical things like the filter size and where the shutoff is."
            />
          </h1>
        </div>

        {/* The dashboard sends new users straight here as "Step 1", but this
            page can only profile a property that already exists. Without this
            branch a brand-new account landed on an empty picker with no way
            forward, which made TraxKey's own recommended first step a dead
            end. Send them to create one instead. */}
        {properties.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-8 text-center">
            <p className="text-sm font-bold mb-1">Add a property first</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
              This step captures the details of a property you already have on file. Once one exists, come back and it will be waiting here.
            </p>
            <Link to="/properties" className="inline-block bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
              Add a property →
            </Link>
          </div>
        ) : (
        <>
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <select value={propertyId} onChange={e => setParams({ propertyId: e.target.value })} className={`${fld} max-w-xs`}>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {profile && (
            <div className="flex items-center gap-2">
              <div className="w-28 h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${pct >= 75 ? 'bg-teal-400' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs text-slate-500">{pct}% of the key details</span>
            </div>
          )}
          {profile && propertyId && (
            <RentalModeToggle propertyId={propertyId} mode={profile.rental_mode || 'standard'} onChanged={load} />
          )}
        </div>

        <div className="flex gap-1 mb-5 border-b border-slate-200 dark:border-white/10">
          {[['profile', 'Property profile'], ['inventory', `Inventory (${inventory.length})`],
            ...(profile?.rental_mode === 'experiential' ? [['amenities', 'Shared amenities']] : [])].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`text-sm font-semibold px-4 py-2 -mb-px border-b-2 transition ${tab === k ? 'border-teal-500 text-teal-600 dark:text-teal-400' : 'border-transparent text-slate-400 hover:text-slate-600'}`}>{l}</button>
          ))}
        </div>

        {tab === 'amenities' ? (
          <AmenitiesTab propertyId={propertyId} />
        ) : tab === 'profile' ? (
          <>
            {SECTIONS.map(sec => (
              <div key={sec.title} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5 mb-4">
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className="font-bold text-sm">{sec.title}</h3>
                  {sec.core && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-400">Used by the AI</span>}
                </div>
                {sec.hint && <p className="text-xs text-slate-500 mb-4">{sec.hint}</p>}
                <div className="space-y-3">
                  {sec.fields.map(([key, label, type, ph]) => (
                    <label key={key} className="block">
                      <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">{label}</span>
                      {type === 'textarea'
                        ? <textarea rows={3} placeholder={ph} value={form[key] || ''} onChange={e => setForm(s => ({ ...s, [key]: e.target.value }))} className={fld} />
                        : <input type={type === 'number' ? 'number' : 'text'} placeholder={ph} value={form[key] || ''} onChange={e => setForm(s => ({ ...s, [key]: e.target.value }))} className={fld} />}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button onClick={save} disabled={saving || !propertyId} className="bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-sm px-5 py-2.5 rounded-lg transition">
                {saving ? 'Saving…' : 'Save profile'}
              </button>
              {msg && <span className="text-xs text-slate-500">{msg}</span>}
            </div>
          </>
        ) : (
          <>
            <InventoryForm propertyId={propertyId} units={units} onCreated={load} />
            {inventory.length === 0 ? (
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
                <p className="text-sm font-bold mb-1">Nothing logged yet</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Add the appliances and furniture in this property. When one breaks, TraxKey can tell you what it cost, whether it's under warranty, and where to buy another.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {inventory.map(i => (
                  <div key={i.id} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-bold">{i.name} {i.quantity > 1 && <span className="text-slate-400 font-normal">×{i.quantity}</span>}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {[i.room, i.unit_number ? `Unit ${i.unit_number}` : null, i.brand, i.model_sku,
                            i.purchase_price ? `$${Math.round(i.purchase_price)}` : null].filter(Boolean).join(' · ')}
                        </p>
                        {i.warranty_expires_on && (
                          <p className={`text-[11px] mt-1 ${new Date(i.warranty_expires_on) > new Date() ? 'text-green-600 dark:text-green-400' : 'text-slate-500'}`}>
                            Warranty {new Date(i.warranty_expires_on) > new Date() ? 'until' : 'expired'} {i.warranty_expires_on}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <select value={i.condition} onChange={e => setCondition(i.id, e.target.value)}
                          className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1 text-xs">
                          {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button onClick={() => removeItem(i.id)} className="text-xs text-slate-400 hover:text-red-500">Remove</button>
                      </div>
                    </div>
                    {i.replacement_url && isSafeUrl(i.replacement_url) && (
                      <a href={i.replacement_url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline mt-2 inline-block">Buy a replacement →</a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        </>
        )}
      </div>
    </div>
  );
}
