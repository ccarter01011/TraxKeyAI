import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import ImportExport from '../components/ImportExport.jsx';
import FilterBar, { useFiltered } from '../components/FilterBar.jsx';

const STATUS_OPTIONS = [
  { value: 'ordered', label: 'Ordered' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const fld = 'w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400';

function auth() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token')}` };
}

function post(route, body) {
  return fetch(`${AGENT_BASE}${route}`, { method: 'POST', headers: auth(), body: JSON.stringify(body) })
    .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));
}

// Inline, quick-add supplier so ordering something from a brand-new
// supplier doesn't mean leaving this form to go set one up first.
function AddSupplierInline({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', contactEmail: '', contactPhone: '' });
  const [err, setErr] = useState('');
  const [saving, setSaving] = useState(false);
  const up = k => e => setF(s => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setErr(''); setSaving(true);
    const { ok, j } = await post('/suppliers', f);
    setSaving(false);
    if (!ok) { setErr(j.error || 'Could not save'); return; }
    setF({ name: '', contactEmail: '', contactPhone: '' });
    setOpen(false);
    onCreated(j.supplier);
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="text-xs text-teal-600 dark:text-teal-400 font-semibold hover:underline">+ New supplier</button>;
  }

  return (
    <form onSubmit={submit} className="bg-slate-100 dark:bg-slate-950/60 border border-slate-200 dark:border-white/10 rounded-lg p-3 space-y-2">
      <input required placeholder="Supplier name" value={f.name} onChange={up('name')} className={fld} />
      <div className="grid grid-cols-2 gap-2">
        <input type="email" placeholder="Contact email (to chase)" value={f.contactEmail} onChange={up('contactEmail')} className={fld} />
        <input placeholder="Phone (optional)" value={f.contactPhone} onChange={up('contactPhone')} className={fld} />
      </div>
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition">{saving ? 'Saving…' : 'Add supplier'}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 px-2">Cancel</button>
      </div>
    </form>
  );
}

function AddForm({ units, suppliers, onCreated, onSupplierCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ description: '', supplierId: '', reference: '', cost: '', expectedOn: '', unitId: '', ccEmail: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const up = k => e => setF(s => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    const { ok, j } = await post('/ordered-items', f);
    setSaving(false);
    if (!ok) { setError(j.error || 'Could not save that'); return; }
    setF({ description: '', supplierId: '', reference: '', cost: '', expectedOn: '', unitId: '', ccEmail: '' });
    setOpen(false);
    onCreated();
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">+ Add order</button>;
  }

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm">Something you've ordered</p>
      <input required placeholder="What was ordered (e.g. Water heater, 50 gal)" value={f.description} onChange={up('description')} className={fld} />
      <div className="grid grid-cols-2 gap-3">
        <select value={f.supplierId} onChange={up('supplierId')} className={fld}>
          <option value="">No supplier on file</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input placeholder="Order / PO number" value={f.reference} onChange={up('reference')} className={fld} />
      </div>
      <AddSupplierInline onCreated={s => { onSupplierCreated(); setF(prev => ({ ...prev, supplierId: s.id })); }} />
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Expected</span>
          <input type="date" value={f.expectedOn} onChange={up('expectedOn')} className={fld} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Cost</span>
          <input type="number" min="0" step="1" placeholder="820" value={f.cost} onChange={up('cost')} className={fld} />
        </label>
      </div>
      <select value={f.unitId} onChange={up('unitId')} className={fld}>
        <option value="">Not for a specific unit</option>
        {units.map(u => <option key={u.id} value={u.id}>{u.propertyName}{u.unit_number ? ` — Unit ${u.unit_number}` : ''}</option>)}
      </select>
      <input type="email" placeholder="CC email for this order (optional)" value={f.ccEmail} onChange={up('ccEmail')} className={fld} />
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Give it an expected date and TraxKey will tell you when it's late, and whether it's holding up a turn.
        Pick a supplier with a contact email and TraxKey will chase them for you once it goes late.
      </p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3">Cancel</button>
      </div>
    </form>
  );
}

function EmailPrefs({ route, idKey, id, cc, auto, inheritNote, onChanged }) {
  const [open, setOpen] = useState(false);
  const [ccEmail, setCc] = useState(cc || '');
  const [msg, setMsg] = useState('');

  async function save(nextAuto) {
    setMsg('');
    const { ok, j } = await post(route, { action: 'email-prefs', [idKey]: id, ccEmail, autoEmailEnabled: nextAuto });
    if (!ok) { setMsg(j.error || 'Could not save'); return; }
    setOpen(false); onChanged();
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-white/5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${auto
          ? 'bg-green-500/15 text-green-700 dark:text-green-400'
          : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'}`}>
          {auto ? 'Auto-chase on' : 'Auto-chase off'}
        </span>
        {cc && <span className="text-[10px] text-slate-500">CC {cc}</span>}
        <button onClick={() => save(!auto)} className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline">
          {auto ? 'Turn off' : 'Turn on'}
        </button>
        <button onClick={() => setOpen(o => !o)} className="text-[11px] text-slate-500 hover:underline">
          {open ? 'Cancel' : 'Edit CC'}
        </button>
      </div>
      {inheritNote && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">{inheritNote}</p>}
      {open && (
        <div className="flex gap-2 mt-2">
          <input type="email" placeholder="CC email (blank to clear)" value={ccEmail} onChange={e => setCc(e.target.value)} className={fld + ' text-xs py-2'} />
          <button onClick={() => save(auto)} className="shrink-0 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 rounded-lg">Save</button>
        </div>
      )}
      {msg && <p className="text-[11px] text-red-500 mt-1">{msg}</p>}
    </div>
  );
}

function Row({ item, onChanged }) {
  const [busy, setBusy] = useState(false);
  const late = item.status === 'ordered' && item.days_late != null && item.days_late > 0;
  const where = item.property_name
    ? `${item.property_name}${item.unit_number ? ` Unit ${item.unit_number}` : ''}` : null;

  async function mark(status) {
    setBusy(true);
    try {
      await post('/ordered-items', { action: 'status', itemId: item.id, status });
      onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className={`border rounded-xl p-4 ${late ? 'border-red-400/30 bg-red-500/5' : 'border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">{item.description}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {[item.supplier, where, item.reference, item.cost ? `$${Math.round(item.cost)}` : null]
              .filter(Boolean).join(' · ') || 'No supplier on file'}
          </p>
          {item.turn_deadline && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
              Turn due {item.turn_deadline}
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          {item.status === 'received' ? (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400">Received</span>
          ) : late ? (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/15 text-red-600 dark:text-red-400">
              {item.days_late}d late
            </span>
          ) : item.expected_on ? (
            <span className="text-xs text-slate-400 dark:text-slate-500">due {item.expected_on}</span>
          ) : (
            <span className="text-xs text-slate-400 dark:text-slate-500">no date</span>
          )}
        </div>
      </div>
      {item.status === 'ordered' && (
        <>
          <div className="flex gap-3 mt-3">
            <button disabled={busy} onClick={() => mark('received')} className="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline disabled:opacity-50">Mark received</button>
            <button disabled={busy} onClick={() => mark('cancelled')} className="text-xs text-slate-400 hover:text-red-500 disabled:opacity-50">Cancel</button>
          </div>
          {item.supplier_id ? (
            <EmailPrefs
              route="/ordered-items" idKey="itemId" id={item.id}
              cc={item.effective_cc_email} auto={item.effective_auto_email}
              inheritNote={item.auto_email_enabled === null
                ? `Following ${item.supplier}'s default. Changing it here overrides just this order.` : null}
              onChanged={onChanged}
            />
          ) : (
            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 pt-2 border-t border-slate-200 dark:border-white/5">
              No supplier on file, nothing to chase. Add one from the Suppliers tab, or edit this order to pick one.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function SupplierRow({ supplier, onChanged }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function remove() {
    await post('/suppliers', { action: 'delete', supplierId: supplier.id });
    onChanged();
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-sm truncate">{supplier.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {[supplier.contact_email, supplier.contact_phone].filter(Boolean).join(' · ') || 'No contact info on file'}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-slate-500">
            {supplier.total_orders} order{supplier.total_orders !== 1 ? 's' : ''}
            {supplier.open_count > 0 ? ` · ${supplier.open_count} open` : ''}
          </p>
          {supplier.on_time_rate !== null && (
            <p className={`text-xs font-bold ${supplier.on_time_rate >= 70 ? 'text-green-600 dark:text-green-400'
              : supplier.on_time_rate >= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
              {supplier.on_time_rate}% on time
            </p>
          )}
        </div>
      </div>
      <EmailPrefs
        route="/suppliers" idKey="supplierId" id={supplier.id}
        cc={supplier.cc_email} auto={supplier.auto_email_enabled}
        inheritNote="This is the default for every order from this supplier."
        onChanged={onChanged}
      />
      <div className="mt-2 pt-2 border-t border-slate-200 dark:border-white/5">
        {confirmingDelete ? (
          <span className="text-xs text-slate-500">
            Remove {supplier.name}? Past orders keep their history, they just lose the link.{' '}
            <button onClick={remove} className="text-red-500 font-semibold hover:underline">Yes, remove</button>{' '}
            <button onClick={() => setConfirmingDelete(false)} className="hover:underline">Cancel</button>
          </span>
        ) : (
          <button onClick={() => setConfirmingDelete(true)} className="text-[11px] text-slate-400 hover:text-red-500">Remove supplier</button>
        )}
      </div>
    </div>
  );
}

export default function OrderedItemsPage() {
  const [items, setItems] = useState(null);
  const [suppliers, setSuppliers] = useState([]);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('orders');
  const [filters, setFilters] = useState({ status: '', from: '', to: '', q: '' });
  const filtered = useFiltered(items, filters, {
    dateField: 'expected_on',
    searchFields: ['description', 'supplier', 'reference', 'property_name', 'unit_number'],
  });

  async function load() {
    try {
      const [ordersRes, suppliersRes, props] = await Promise.all([
        fetch(`${AGENT_BASE}/ordered-items`, { headers: auth() }).then(r => r.json()),
        fetch(`${AGENT_BASE}/suppliers`, { headers: auth() }).then(r => r.json()),
        apiRequest('traxkey-get-properties').catch(() => []),
      ]);
      setItems(ordersRes.items || []);
      setSuppliers(suppliersRes.suppliers || []);
      setUnits((props || []).filter(p => p.id).flatMap(p => p.units.map(u => ({ ...u, propertyName: p.name }))));
    } catch { setError('Could not load orders'); }
  }
  useEffect(() => { load(); }, []);

  const outstanding = (items || []).filter(i => i.status === 'ordered');
  const lateCount = outstanding.filter(i => i.days_late > 0).length;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
          <ThemeToggle />
        </div>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Purchase Orders</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              What you're waiting on
              <FlowHelp
                title="Why this is here"
                steps={[
                  'Add a supplier once, with the email a late order should be chased at.',
                  'Log anything you ordered against that supplier: a water heater, flooring, appliances, linens.',
                  'Give it an expected date and the unit or turn it belongs to.',
                  'When the date passes, TraxKey flags it as late and chases the supplier if auto-chase is on.',
                  'If a late item is holding up a turn with a deadline, that shows up in Insights and your morning briefing.',
                ]}
                note="This is not procurement. No terms, no approvals, no invoices. It exists for one reason: a late part is the most common reason a unit isn't ready on time, and nothing else in your stack connects those two facts."
              />
            </h1>
          </div>
          {tab === 'orders' && <AddForm units={units} suppliers={suppliers} onCreated={load} onSupplierCreated={load} />}
        </div>

        {tab === 'orders' && (
          <div className="mb-4">
            <ImportExport kind="orders" onImported={load} />
          </div>
        )}

        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

        {items && outstanding.length > 0 && tab === 'orders' && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
              <p className="text-xs uppercase text-slate-400 dark:text-slate-500 mb-1">Outstanding</p>
              <p className="text-2xl font-bold">{outstanding.length}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
              <p className="text-xs uppercase text-slate-400 dark:text-slate-500 mb-1">Late</p>
              <p className={`text-2xl font-bold ${lateCount ? 'text-red-500 dark:text-red-400' : ''}`}>{lateCount}</p>
            </div>
          </div>
        )}

        <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-white/10">
          {['orders', 'suppliers'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-sm font-semibold px-4 py-2 -mb-px border-b-2 transition ${tab === t
                ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t === 'orders' ? 'Orders' : 'Suppliers'}
            </button>
          ))}
        </div>

        {!items ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        ) : tab === 'orders' ? (
          items.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
              <p className="text-sm font-bold mb-1">Nothing on order</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Add the parts and materials a turn is waiting on, and TraxKey will tell you when one is about to make you miss a deadline.
              </p>
            </div>
          ) : (
            <>
              <FilterBar
                statusOptions={STATUS_OPTIONS}
                searchPlaceholder="Search description, supplier, PO#…"
                onChange={setFilters}
              />
              {filtered.length === 0 ? (
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Nothing matches those filters.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filtered.map(i => <Row key={i.id} item={i} onChanged={load} />)}
                </div>
              )}
            </>
          )
        ) : (
          <div className="space-y-3">
            <AddSupplierInline onCreated={load} />
            {suppliers.length === 0 ? (
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
                <p className="text-sm font-bold mb-1">No suppliers yet</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Add one above, with the email a late order should be chased at.</p>
              </div>
            ) : (
              suppliers.map(s => <SupplierRow key={s.id} supplier={s} onChanged={load} />)
            )}
          </div>
        )}
      </div>
    </div>
  );
}
