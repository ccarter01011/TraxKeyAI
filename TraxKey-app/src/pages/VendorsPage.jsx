import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import FilterBar, { useFiltered } from '../components/FilterBar.jsx';

const TRADES = ['hvac', 'plumbing', 'electrical', 'appliance', 'general', 'pest', 'locksmith', 'roofing'];
const TRADE_OPTIONS = TRADES.map(t => ({ value: t, label: t }));

function AddVendorForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', trade: 'general', contactEmail: '', contactPhone: '', emergencyAvailable: false });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function update(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiRequest('traxkey-create-vendor', { method: 'POST', body: form });
      setForm({ name: '', trade: 'general', contactEmail: '', contactPhone: '', emergencyAvailable: false });
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err.message || 'Could not add vendor');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
        + Add vendor
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm mb-1">New vendor</p>
      <input required placeholder="Vendor name" value={form.name} onChange={update('name')}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      <select value={form.trade} onChange={update('trade')}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400">
        {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Email (optional)" type="email" value={form.contactEmail} onChange={update('contactEmail')}
          className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
        <input placeholder="Phone (optional)" type="tel" value={form.contactPhone} onChange={update('contactPhone')}
          className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
        <input type="checkbox" checked={form.emergencyAvailable} onChange={e => setForm(f => ({ ...f, emergencyAvailable: e.target.checked }))} />
        Available for emergencies
      </label>
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg transition disabled:opacity-50">
          {saving ? 'Saving…' : 'Save vendor'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3">Cancel</button>
      </div>
    </form>
  );
}

function EnablePortalAccess({ vendor }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest('traxkey-set-vendor-password', { method: 'POST', body: { vendorId: vendor.id, password } });
      setDone(true);
    } catch (err) {
      setError(err.message || 'Could not set password');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return <p className="text-xs text-teal-600 dark:text-teal-400 mt-2">Portal access enabled. Share the login (vendors.traxkey.ai) with {vendor.contact_email || 'this vendor'}.</p>;
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-300 mt-2">
        Enable portal access →
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2 mt-2">
      <input required type="text" placeholder="Set a password" value={password} onChange={e => setPassword(e.target.value)}
        className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs w-40 focus:outline-none focus:border-teal-400" />
      <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50">
        {saving ? 'Saving…' : 'Enable'}
      </button>
      {error && <span className="text-xs text-red-500 dark:text-red-400">{error}</span>}
    </form>
  );
}

function VendorRow({ vendor }) {
  const hasStats = vendor.jobs_completed > 0;
  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-4 mb-3">
      <div className="flex items-center justify-between mb-1">
        <p className="font-medium">{vendor.name}</p>
        <div className="flex items-center gap-2">
          {vendor.emergency_available && <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 dark:text-red-400">Emergency</span>}
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-400">{vendor.trade}</span>
        </div>
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-2">{vendor.contact_email || 'no email'}{vendor.contact_phone ? ` · ${vendor.contact_phone}` : ''}</p>
      {hasStats ? (
        <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>{vendor.jobs_completed} jobs</span>
          <span>{Math.round(vendor.completion_rate)}% completion</span>
          <span>${Math.round(vendor.avg_cost)} avg</span>
          <span>{Number(vendor.avg_rating).toFixed(1)}★</span>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-600">No jobs yet, TraxKey AI will start scoring this vendor once it dispatches work.</p>
      )}
      <EnablePortalAccess vendor={vendor} />
    </div>
  );
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', from: '', to: '', q: '' });
  const filtered = useFiltered(vendors, filters, {
    statusField: 'trade',
    searchFields: ['name', 'contact_email', 'contact_phone'],
  });

  async function load() {
    try {
      const json = await apiRequest('traxkey-get-vendors');
      setVendors(json);
    } catch (err) {
      setError(err.message || 'Could not load vendors');
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between lg:hidden">
          <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
          <ThemeToggle />
        </div>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Vendors</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              Your vendor network
              <FlowHelp
                title="How vendors get picked"
                steps={[
                  'Every completed job records the real cost and your rating.',
                  'That builds a score per vendor: completion rate, rating, average cost.',
                  'The AI dispatches to the best-scoring vendor for that trade.',
                  'A vendor with no history always needs your approval first.',
                ]}
                note="Vendor choice is plain math over your own job history, never an AI guess. A new vendor earns autonomy by building a track record."
              />
            </h1>
          </div>
          <AddVendorForm onCreated={load} />
        </div>

        {error && <p className="text-sm text-red-500 dark:text-red-400 mb-4">{error}</p>}
        {!vendors && !error && <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>}
        {vendors && vendors.length === 0 && (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No vendors yet. Add one per trade you work with, this is what the AI Maintenance Coordinator dispatches to.</p>
          </div>
        )}
        {vendors && vendors.length > 0 && (
          <FilterBar
            statusOptions={TRADE_OPTIONS}
            statusLabel="All trades"
            searchPlaceholder="Search name, email, phone…"
            showDates={false}
            onChange={setFilters}
          />
        )}
        {vendors && vendors.length > 0 && filtered.length === 0 && (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">Nothing matches those filters.</p>
          </div>
        )}
        {filtered && filtered.map(v => <VendorRow key={v.id} vendor={v} />)}
      </div>
    </div>
  );
}
