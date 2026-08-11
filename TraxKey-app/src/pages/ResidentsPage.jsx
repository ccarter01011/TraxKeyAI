import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';

const TENANT_PORTAL_BASE = 'https://tenant.traxkey.ai';

function AddResidentForm({ units, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ unitId: '', name: '', email: '', phone: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [newInvite, setNewInvite] = useState(null);

  function update(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const json = await apiRequest('traxkey-create-resident', { method: 'POST', body: form });
      setNewInvite(`${TENANT_PORTAL_BASE}/?token=${json.accessToken}`);
      setForm({ unitId: '', name: '', email: '', phone: '' });
      onCreated();
    } catch (err) {
      setError(err.message || 'Could not add resident');
    } finally {
      setSaving(false);
    }
  }

  if (newInvite) {
    return (
      <div className="bg-teal-500/10 border border-teal-400/20 rounded-2xl p-5 mb-6">
        <p className="text-sm font-bold mb-2">Resident added. Send them this link:</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-teal-300 overflow-x-auto whitespace-nowrap">{newInvite}</code>
          <button onClick={() => navigator.clipboard.writeText(newInvite)} className="shrink-0 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-2 rounded-lg transition">Copy</button>
        </div>
        <button onClick={() => setNewInvite(null)} className="text-xs text-slate-400 hover:text-white mt-3">+ Add another</button>
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
        + Add resident
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-slate-900 border border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm mb-1">New resident</p>
      <select required value={form.unitId} onChange={update('unitId')}
        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400">
        <option value="">Select a unit…</option>
        {units.map(u => (
          <option key={u.id} value={u.id}>{u.propertyName}{u.unit_number ? ` — Unit ${u.unit_number}` : ''}</option>
        ))}
      </select>
      <input required placeholder="Resident name" value={form.name} onChange={update('name')}
        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      <input placeholder="Email (optional)" type="email" value={form.email} onChange={update('email')}
        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      <input placeholder="Phone (optional)" type="tel" value={form.phone} onChange={update('phone')}
        className="w-full bg-slate-950 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg transition disabled:opacity-50">
          {saving ? 'Saving…' : 'Add resident'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-400 hover:text-white px-3">Cancel</button>
      </div>
      {units.length === 0 && <p className="text-xs text-amber-400">No units yet, add a property and unit first.</p>}
    </form>
  );
}

export default function ResidentsPage() {
  const [residents, setResidents] = useState(null);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  async function load() {
    try {
      const [residentsJson, propertiesJson] = await Promise.all([
        apiRequest('traxkey-get-residents'),
        apiRequest('traxkey-get-properties'),
      ]);
      setResidents(residentsJson.filter(r => r.id));
      const flatUnits = propertiesJson
        .filter(p => p.id)
        .flatMap(p => p.units.map(u => ({ ...u, propertyName: p.name })));
      setUnits(flatUnits);
    } catch (err) {
      setError(err.message || 'Could not load residents');
    }
  }

  useEffect(() => { load(); }, []);

  function copyLink(resident) {
    const link = `${TENANT_PORTAL_BASE}/?token=${resident.access_token}`;
    navigator.clipboard.writeText(link);
    setCopiedId(resident.id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/properties" className="text-xs text-slate-500 hover:text-white">← Properties</Link>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-400 font-semibold uppercase tracking-wide mb-1">Residents</p>
            <h1 className="text-2xl font-bold">Tenant invites</h1>
          </div>
          <AddResidentForm units={units} onCreated={load} />
        </div>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
        {!residents && !error && <p className="text-sm text-slate-500">Loading…</p>}
        {residents && residents.length === 0 && (
          <div className="bg-slate-900 border border-white/5 rounded-2xl p-8 text-center">
            <p className="text-sm text-slate-400">No residents yet. Add one above, each gets their own maintenance-reporting link, no shared code, no address typing required.</p>
          </div>
        )}
        {residents && residents.map(r => (
          <div key={r.id} className="bg-slate-900 border border-white/5 rounded-2xl p-4 mb-3 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-medium">{r.name}</p>
              <p className="text-xs text-slate-500">{r.property_name}{r.unit_number ? ` — Unit ${r.unit_number}` : ''}{r.phone ? ` · ${r.phone}` : ''}</p>
            </div>
            <button onClick={() => copyLink(r)} className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition">
              {copiedId === r.id ? 'Copied' : 'Copy link'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
