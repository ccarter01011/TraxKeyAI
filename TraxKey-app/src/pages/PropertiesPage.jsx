import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';

const PROPERTY_TYPES = [
  { value: 'single_family', label: 'Single-family' },
  { value: 'duplex', label: 'Duplex' },
  { value: 'apartment', label: 'Apartment' },
  { value: 'multifamily', label: 'Multifamily' },
];

function AddPropertyForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '', propertyType: 'single_family' });
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
      await apiRequest('traxkey-create-property', { method: 'POST', body: form });
      setForm({ name: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '', propertyType: 'single_family' });
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err.message || 'Could not add property');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
        + Add property
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm mb-1">New property</p>
      <input required placeholder="Property name (e.g. Maple Street Duplex)" value={form.name} onChange={update('name')}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      <input required placeholder="Address line 1" value={form.addressLine1} onChange={update('addressLine1')}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      <input placeholder="Address line 2 (optional)" value={form.addressLine2} onChange={update('addressLine2')}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      <div className="grid grid-cols-3 gap-2">
        <input required placeholder="City" value={form.city} onChange={update('city')}
          className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
        <input required placeholder="State" value={form.state} onChange={update('state')}
          className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
        <input required placeholder="ZIP" value={form.zip} onChange={update('zip')}
          className="bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      </div>
      <select value={form.propertyType} onChange={update('propertyType')}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400">
        {PROPERTY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg transition disabled:opacity-50">
          {saving ? 'Saving…' : 'Save property'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3">Cancel</button>
      </div>
    </form>
  );
}

function AddUnitForm({ propertyId, onCreated, onClose }) {
  const [form, setForm] = useState({ unitNumber: '', bedrooms: '', bathrooms: '' });
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
      await apiRequest('traxkey-create-unit', { method: 'POST', body: { propertyId, ...form } });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not add unit');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 bg-slate-100 dark:bg-slate-950/60 border border-slate-200 dark:border-white/5 rounded-lg p-3 mt-2">
      <input placeholder="Unit # (blank for single-family)" value={form.unitNumber} onChange={update('unitNumber')}
        className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs w-48 focus:outline-none focus:border-teal-400" />
      <input placeholder="Beds" type="number" min="0" value={form.bedrooms} onChange={update('bedrooms')}
        className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs w-20 focus:outline-none focus:border-teal-400" />
      <input placeholder="Baths" type="number" min="0" step="0.5" value={form.bathrooms} onChange={update('bathrooms')}
        className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs w-20 focus:outline-none focus:border-teal-400" />
      <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50">
        {saving ? 'Adding…' : 'Add unit'}
      </button>
      <button type="button" onClick={onClose} className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">Cancel</button>
      {error && <p className="text-xs text-red-500 dark:text-red-400 w-full">{error}</p>}
    </form>
  );
}

function PropertyCard({ property, onChanged }) {
  const [addingUnit, setAddingUnit] = useState(false);

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5 mb-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="font-bold">{property.name}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">{property.address_line1}{property.address_line2 ? `, ${property.address_line2}` : ''}, {property.city}, {property.state} {property.zip}</p>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-400 shrink-0">
          {property.property_type.replace('_', ' ')}
        </span>
      </div>

      <div className="space-y-1.5">
        {property.units.length === 0 && <p className="text-xs text-slate-400 dark:text-slate-500">No units yet.</p>}
        {property.units.map(u => (
          <div key={u.id} className="flex items-center gap-3 text-sm bg-slate-100 dark:bg-slate-950/40 rounded-lg px-3 py-2">
            <span className="font-medium">{u.unit_number || 'Whole property'}</span>
            <span className="text-slate-400 dark:text-slate-500 text-xs">{u.bedrooms ?? '–'} bd / {u.bathrooms ?? '–'} ba</span>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ml-auto ${u.status === 'vacant' ? 'bg-amber-500/15 text-amber-400' : 'bg-green-500/15 text-green-400'}`}>
              {u.status}
            </span>
          </div>
        ))}
      </div>

      {addingUnit ? (
        <AddUnitForm propertyId={property.id} onCreated={onChanged} onClose={() => setAddingUnit(false)} />
      ) : (
        <button onClick={() => setAddingUnit(true)} className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-300 mt-3">+ Add unit</button>
      )}
    </div>
  );
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    try {
      const json = await apiRequest('traxkey-get-properties');
      // A zero-result query still comes back as [{}] (an n8n quirk), filter
      // out anything without a real id instead of touching the workflow.
      setProperties(json.filter(p => p.id));
    } catch (err) {
      setError(err.message || 'Could not load properties');
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Properties</p>
            <h1 className="text-2xl font-bold">Your portfolio</h1>
          </div>
          <AddPropertyForm onCreated={load} />
        </div>

        {error && <p className="text-sm text-red-500 dark:text-red-400 mb-4">{error}</p>}
        {!properties && !error && <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>}
        {properties && properties.length === 0 && (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No properties yet. Add your first one above, this is what TraxKey AI's agents will monitor and act on.</p>
          </div>
        )}
        {properties && properties.map(p => (
          <PropertyCard key={p.id} property={p} onChanged={load} />
        ))}
      </div>
    </div>
  );
}
