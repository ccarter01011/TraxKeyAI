import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const OWNER_PORTAL = 'https://owners.traxkey.ai';
const hdrs = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token')}` });
const fld = 'w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400';

function AddOwner({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', phone: '' });
  const [err, setErr] = useState('');
  const up = k => e => setF(s => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setErr('');
    const res = await fetch(`${AGENT_BASE}/owners`, { method: 'POST', headers: hdrs(), body: JSON.stringify(f) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error || 'Could not save'); return; }
    setF({ name: '', email: '', phone: '' }); setOpen(false); onCreated();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">+ Add owner</button>;

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm">New owner</p>
      <input required placeholder="Name" value={f.name} onChange={up('name')} className={fld} />
      <input type="email" placeholder="Email (needed for portal access)" value={f.email} onChange={up('email')} className={fld} />
      <input placeholder="Phone (optional)" value={f.phone} onChange={up('phone')} className={fld} />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">Save</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 px-3">Cancel</button>
      </div>
    </form>
  );
}

function OwnerCard({ owner, properties, onChanged }) {
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [msg, setMsg] = useState('');
  const [assign, setAssign] = useState('');

  async function grant(e) {
    e.preventDefault(); setMsg('');
    const res = await fetch(`${AGENT_BASE}/owner-access`, {
      method: 'POST', headers: hdrs(), body: JSON.stringify({ ownerId: owner.id, password: pw }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(j.error || 'Could not enable'); return; }
    setPw(''); setShowPw(false); setMsg('Access enabled. Send them the link and password.');
    onChanged();
  }

  async function attach(propertyId) {
    await fetch(`${AGENT_BASE}/owners`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ action: 'assign', propertyId, ownerId: owner.id }),
    });
    setAssign(''); onChanged();
  }
  async function detach(propertyId) {
    await fetch(`${AGENT_BASE}/owners`, {
      method: 'POST', headers: hdrs(),
      body: JSON.stringify({ action: 'assign', propertyId, ownerId: '' }),
    });
    onChanged();
  }

  const unassigned = properties.filter(p => !p.owner_id);

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-sm">{owner.name}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{owner.email || 'No email on file'}{owner.phone ? ` · ${owner.phone}` : ''}</p>
        </div>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
          owner.portal_enabled ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'}`}>
          {owner.portal_enabled ? 'Portal on' : 'No access'}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(owner.properties || []).map(p => (
          <span key={p.id} className="inline-flex items-center gap-1.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-full px-2.5 py-1">
            {p.name}
            <button onClick={() => detach(p.id)} className="text-slate-400 hover:text-red-500" title="Unassign">×</button>
          </span>
        ))}
        {(owner.properties || []).length === 0 && (
          <span className="text-xs text-slate-400 dark:text-slate-500">No properties assigned, so they'd see an empty portal.</span>
        )}
      </div>

      {unassigned.length > 0 && (
        <select value={assign} onChange={e => e.target.value && attach(e.target.value)} className={`${fld} mt-3 text-xs py-2`}>
          <option value="">Assign a property…</option>
          {unassigned.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      <div className="mt-3 pt-3 border-t border-slate-200 dark:border-white/5">
        {!owner.email ? (
          <p className="text-xs text-slate-400 dark:text-slate-500">Add an email before you can give them portal access.</p>
        ) : showPw ? (
          <form onSubmit={grant} className="flex flex-wrap items-center gap-2">
            <input required minLength={8} type="text" placeholder="Set a password (8+ chars)" value={pw} onChange={e => setPw(e.target.value)}
              className="flex-1 min-w-[180px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-teal-400" />
            <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg">Enable</button>
            <button type="button" onClick={() => setShowPw(false)} className="text-xs text-slate-400">Cancel</button>
          </form>
        ) : (
          <button onClick={() => setShowPw(true)} className="text-xs font-bold text-teal-600 dark:text-teal-400 hover:underline">
            {owner.portal_enabled ? 'Reset their password' : 'Give portal access'}
          </button>
        )}
        {msg && <p className="text-xs text-teal-600 dark:text-teal-400 mt-2">{msg}</p>}
      </div>
    </div>
  );
}

export default function OwnersPage() {
  const [owners, setOwners] = useState(null);
  const [properties, setProperties] = useState([]);
  const [copied, setCopied] = useState(false);

  async function load() {
    const [o, p] = await Promise.all([
      fetch(`${AGENT_BASE}/owners`, { headers: hdrs() }).then(r => r.json()).catch(() => ({ owners: [] })),
      apiRequest('traxkey-get-properties').catch(() => []),
    ]);
    setOwners(o.owners || []);
    // Which properties are already claimed, so the assign list only offers free ones.
    const claimed = new Set((o.owners || []).flatMap(x => (x.properties || []).map(y => y.id)));
    setProperties((p || []).filter(x => x.id).map(x => ({ ...x, owner_id: claimed.has(x.id) ? 'taken' : null })));
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
          <ThemeToggle />
        </div>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Owners</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              Who you manage for
              <FlowHelp
                title="How the owner portal works"
                steps={[
                  'Add an owner and assign the properties that belong to them.',
                  'Give them portal access by setting a password, then send them the link.',
                  'They sign in and see only their own properties: occupancy, maintenance spend, recent work, and any unit being turned over.',
                  'It is read-only. They can see, not act, because approving spend and dealing with tenants is what they pay you for.',
                ]}
                note="An owner never sees another owner's properties, even though both belong to you. Tenant names and contact details are not shown either, that relationship stays yours."
              />
            </h1>
          </div>
          <AddOwner onCreated={load} />
        </div>

        <div className="bg-teal-500/10 border border-teal-400/20 rounded-xl p-4 mb-6 flex items-center gap-2">
          <code className="flex-1 text-xs text-teal-700 dark:text-teal-300 overflow-x-auto whitespace-nowrap">{OWNER_PORTAL}</code>
          <button onClick={() => { navigator.clipboard.writeText(OWNER_PORTAL); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="shrink-0 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition">
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        {!owners ? <p className="text-sm text-slate-400">Loading…</p>
          : owners.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
              <p className="text-sm font-bold mb-1">No owners yet</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">If you manage property for other people, add them here and they can check on it themselves instead of calling you.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {owners.map(o => <OwnerCard key={o.id} owner={o} properties={properties} onChanged={load} />)}
            </div>
          )}
      </div>
    </div>
  );
}
