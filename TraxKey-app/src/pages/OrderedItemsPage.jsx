import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';
import ImportExport from '../components/ImportExport.jsx';
import FilterBar, { useFiltered } from '../components/FilterBar.jsx';

const STATUS_OPTIONS = [
  { value: 'ordered', label: 'Ordered' },
  { value: 'received', label: 'Received' },
  { value: 'cancelled', label: 'Cancelled' },
];

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';

function auth() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token')}` };
}

function AddForm({ units, onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ description: '', supplier: '', reference: '', cost: '', expectedOn: '', unitId: '', supplierEmail: '', ccEmail: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const up = k => e => setF(s => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      const res = await fetch(`${AGENT_BASE}/ordered-items`, { method: 'POST', headers: auth(), body: JSON.stringify(f) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save that');
      setF({ description: '', supplier: '', reference: '', cost: '', expectedOn: '', unitId: '', supplierEmail: '', ccEmail: '' });
      setOpen(false);
      onCreated();
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  if (!open) {
    return <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">+ Add order</button>;
  }

  const fld = 'w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400';
  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm">Something you've ordered</p>
      <input required placeholder="What was ordered (e.g. Water heater, 50 gal)" value={f.description} onChange={up('description')} className={fld} />
      <div className="grid grid-cols-2 gap-3">
        <input placeholder="Supplier" value={f.supplier} onChange={up('supplier')} className={fld} />
        <input placeholder="Order / PO number" value={f.reference} onChange={up('reference')} className={fld} />
      </div>
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
      <div className="grid grid-cols-2 gap-3">
        <input type="email" placeholder="Supplier email (to chase)" value={f.supplierEmail} onChange={up('supplierEmail')} className={fld} />
        <input type="email" placeholder="CC email (optional)" value={f.ccEmail} onChange={up('ccEmail')} className={fld} />
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Give it an expected date and TraxKey will tell you when it's late, and whether it's holding up a turn.
        Add a supplier email and it will chase them for you once it goes late.
      </p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">{saving ? 'Saving…' : 'Save'}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3">Cancel</button>
      </div>
    </form>
  );
}

function ItemEmailPrefs({ item, onChanged }) {
  const [open, setOpen] = useState(false);
  const [supplierEmail, setSupplierEmail] = useState(item.supplier_email || '');
  const [ccEmail, setCcEmail] = useState(item.cc_email || '');
  const [msg, setMsg] = useState('');
  const on = item.auto_email_enabled;
  const fld = 'w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-teal-400';

  async function save(nextAuto) {
    setMsg('');
    const res = await fetch(`${AGENT_BASE}/ordered-items`, {
      method: 'POST', headers: auth(),
      body: JSON.stringify({ action: 'email-prefs', itemId: item.id, supplierEmail, ccEmail, autoEmailEnabled: nextAuto }),
    });
    if (!res.ok) { setMsg('Could not save'); return; }
    setOpen(false); onChanged();
  }

  return (
    <div className="mt-2 pt-2 border-t border-slate-200 dark:border-white/5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${on && item.supplier_email
          ? 'bg-green-500/15 text-green-700 dark:text-green-400'
          : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'}`}>
          {!item.supplier_email ? 'No supplier email' : on ? 'Auto-chase on' : 'Auto-chase off'}
        </span>
        {item.cc_email && <span className="text-[10px] text-slate-500">CC {item.cc_email}</span>}
        {item.chase_count > 0 && (
          <span className="text-[10px] text-slate-500">{item.chase_count} sent</span>
        )}
        {item.supplier_email && (
          <button onClick={() => save(!on)} className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline">
            {on ? 'Turn off' : 'Turn on'}
          </button>
        )}
        <button onClick={() => setOpen(o => !o)} className="text-[11px] text-slate-500 hover:underline">
          {open ? 'Cancel' : 'Edit emails'}
        </button>
      </div>
      {open && (
        <div className="space-y-2 mt-2">
          <input type="email" placeholder="Supplier email (blank to clear)" value={supplierEmail} onChange={e => setSupplierEmail(e.target.value)} className={fld} />
          <input type="email" placeholder="CC email (blank to clear)" value={ccEmail} onChange={e => setCcEmail(e.target.value)} className={fld} />
          <button onClick={() => save(on)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg">Save</button>
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
      await fetch(`${AGENT_BASE}/ordered-items`, {
        method: 'POST', headers: auth(),
        body: JSON.stringify({ action: 'status', itemId: item.id, status }),
      });
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
          <ItemEmailPrefs item={item} onChanged={onChanged} />
        </>
      )}
    </div>
  );
}

export default function OrderedItemsPage() {
  const [items, setItems] = useState(null);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', from: '', to: '', q: '' });
  const filtered = useFiltered(items, filters, {
    dateField: 'expected_on',
    searchFields: ['description', 'supplier', 'reference', 'property_name', 'unit_number'],
  });

  async function load() {
    try {
      const [res, props] = await Promise.all([
        fetch(`${AGENT_BASE}/ordered-items`, { headers: auth() }).then(r => r.json()),
        apiRequest('traxkey-get-properties').catch(() => []),
      ]);
      setItems(res.items || []);
      setUnits((props || []).filter(p => p.id).flatMap(p => p.units.map(u => ({ ...u, propertyName: p.name }))));
    } catch { setError('Could not load orders'); }
  }
  useEffect(() => { load(); }, []);

  const outstanding = (items || []).filter(i => i.status === 'ordered');
  const lateCount = outstanding.filter(i => i.days_late > 0).length;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Orders</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              What you're waiting on
              <FlowHelp
                title="Why this is here"
                steps={[
                  'Log anything you ordered that a job depends on: a water heater, flooring, appliances, linens.',
                  'Give it an expected date and the unit or turn it belongs to.',
                  'When the date passes, TraxKey flags it as late.',
                  'If a late item is holding up a turn with a deadline, that shows up in Insights and your morning briefing.',
                ]}
                note="This is not procurement. No terms, no approvals, no invoices. It exists for one reason: a late part is the most common reason a unit isn't ready on time, and nothing else in your stack connects those two facts."
              />
            </h1>
          </div>
          <AddForm units={units} onCreated={load} />
        </div>

        <div className="mb-4">
          <ImportExport kind="orders" onImported={load} />
        </div>

        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

        {items && outstanding.length > 0 && (
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

        {!items ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        ) : items.length === 0 ? (
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
        )}
      </div>
    </div>
  );
}
