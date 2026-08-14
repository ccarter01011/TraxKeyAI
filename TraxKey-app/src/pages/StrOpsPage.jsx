import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const hdrs = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token')}` });
const fld = 'bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-teal-400';

export default function StrOpsPage() {
  const [tab, setTab] = useState('supplies');
  const [supplies, setSupplies] = useState(null);
  const [damage, setDamage] = useState(null);
  const [units, setUnits] = useState([]);

  async function load() {
    const [s, d, p] = await Promise.all([
      fetch(`${AGENT_BASE}/supplies`, { headers: hdrs() }).then(r => r.json()).catch(() => ({ rows: [] })),
      fetch(`${AGENT_BASE}/damage`, { headers: hdrs() }).then(r => r.json()).catch(() => ({ rows: [] })),
      apiRequest('traxkey-get-properties').catch(() => []),
    ]);
    setSupplies(s.rows || []);
    setDamage(d.rows || []);
    setUnits((p || []).filter(x => x.id).flatMap(x => x.units.map(u => ({ ...u, propertyName: x.name }))));
  }
  useEffect(() => { load(); }, []);

  const lowCount = (supplies || []).filter(s => s.is_low).length;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="mb-5 mt-2">
          <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Short-term ops</p>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">
            Supplies and damage
            <FlowHelp
              title="How this fits together"
              steps={[
                'Set what each unit should be stocked with and the level that means "reorder".',
                'When stock drops to that level, it shows here and in your Insights and morning briefing.',
                'Record damage found at checkout with an estimated cost. TraxKey links it to the stay that just ended.',
                'Mark whether you are claiming it, so you can see what is outstanding.',
              ]}
              note="TraxKey records damage and links it to a stay. It never decides fault or files a claim for you, that is governed by platform policy and local law and it is your call."
            />
          </h1>
        </div>

        <div className="inline-flex bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-1 gap-1 mb-6">
          <button onClick={() => setTab('supplies')} className={`px-4 py-2 rounded-lg text-sm font-bold transition ${tab === 'supplies' ? 'bg-teal-500 text-slate-950' : 'text-slate-500 dark:text-slate-400'}`}>
            Supplies{lowCount ? ` · ${lowCount} low` : ''}
          </button>
          <button onClick={() => setTab('damage')} className={`px-4 py-2 rounded-lg text-sm font-bold transition ${tab === 'damage' ? 'bg-teal-500 text-slate-950' : 'text-slate-500 dark:text-slate-400'}`}>
            Damage
          </button>
        </div>

        {tab === 'supplies'
          ? <Supplies rows={supplies} units={units} reload={load} />
          : <Damage rows={damage} units={units} reload={load} />}
      </div>
    </div>
  );
}

function Supplies({ rows, units, reload }) {
  const [f, setF] = useState({ unitId: '', item: '', parLevel: '', currentLevel: '', reorderAt: '', unitLabel: '' });
  const up = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  const [err, setErr] = useState('');

  async function save(e) {
    e.preventDefault(); setErr('');
    const res = await fetch(`${AGENT_BASE}/supplies`, { method: 'POST', headers: hdrs(), body: JSON.stringify(f) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error || 'Could not save'); return; }
    setF({ unitId: '', item: '', parLevel: '', currentLevel: '', reorderAt: '', unitLabel: '' });
    reload();
  }
  async function remove(id) {
    await fetch(`${AGENT_BASE}/supplies`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'delete', supplyId: id }) });
    reload();
  }

  return (
    <>
      <form onSubmit={save} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 mb-6 space-y-3">
        <p className="font-bold text-sm">Track an item</p>
        <div className="grid grid-cols-2 gap-3">
          <select required value={f.unitId} onChange={up('unitId')} className={`${fld} w-full`}>
            <option value="">Which unit…</option>
            {units.map(u => <option key={u.id} value={u.id}>{u.propertyName}{u.unit_number ? ` — Unit ${u.unit_number}` : ''}</option>)}
          </select>
          <input required placeholder="Item (Bath towels)" value={f.item} onChange={up('item')} className={`${fld} w-full`} />
        </div>
        <div className="grid grid-cols-4 gap-3">
          <input type="number" min="0" placeholder="Full" value={f.parLevel} onChange={up('parLevel')} className={`${fld} w-full`} />
          <input type="number" min="0" placeholder="Have" value={f.currentLevel} onChange={up('currentLevel')} className={`${fld} w-full`} />
          <input type="number" min="0" placeholder="Reorder at" value={f.reorderAt} onChange={up('reorderAt')} className={`${fld} w-full`} />
          <input placeholder="sets" value={f.unitLabel} onChange={up('unitLabel')} className={`${fld} w-full`} />
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">Save item</button>
      </form>

      {!rows ? <p className="text-sm text-slate-400">Loading…</p>
        : rows.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
            <p className="text-sm font-bold mb-1">Nothing tracked yet</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Add the consumables a turn depends on, and you'll be told before a cleaner finds an empty cupboard.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(s => (
              <div key={s.id} className={`flex items-center justify-between gap-3 border rounded-xl px-4 py-3 ${s.is_low ? 'border-amber-400/30 bg-amber-500/5' : 'border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900'}`}>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.item}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {s.property_name}{s.unit_number ? ` Unit ${s.unit_number}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-sm font-bold ${s.is_low ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                    {s.current_level ?? '—'}{s.par_level ? ` / ${s.par_level}` : ''} {s.unit_label || ''}
                  </span>
                  <button onClick={() => remove(s.id)} className="text-xs text-slate-400 hover:text-red-500">Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}

function Damage({ rows, units, reload }) {
  const [f, setF] = useState({ unitId: '', description: '', estimatedCost: '', reportedBy: '' });
  const up = k => e => setF(s => ({ ...s, [k]: e.target.value }));
  const [err, setErr] = useState('');

  async function save(e) {
    e.preventDefault(); setErr('');
    const res = await fetch(`${AGENT_BASE}/damage`, { method: 'POST', headers: hdrs(), body: JSON.stringify(f) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.error || 'Could not save'); return; }
    setF({ unitId: '', description: '', estimatedCost: '', reportedBy: '' });
    reload();
  }
  async function mark(id, status) {
    await fetch(`${AGENT_BASE}/damage`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ action: 'status', damageId: id, status }) });
    reload();
  }

  const STATUS = {
    recorded: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
    claiming: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    resolved: 'bg-green-500/15 text-green-600 dark:text-green-400',
    dropped: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
  };

  return (
    <>
      <form onSubmit={save} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 mb-6 space-y-3">
        <p className="font-bold text-sm">Record damage found at checkout</p>
        <select required value={f.unitId} onChange={up('unitId')} className={`${fld} w-full`}>
          <option value="">Which unit…</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.propertyName}{u.unit_number ? ` — Unit ${u.unit_number}` : ''}</option>)}
        </select>
        <input required placeholder="What's damaged" value={f.description} onChange={up('description')} className={`${fld} w-full`} />
        <div className="grid grid-cols-2 gap-3">
          <input type="number" min="0" placeholder="Estimated cost" value={f.estimatedCost} onChange={up('estimatedCost')} className={`${fld} w-full`} />
          <input placeholder="Reported by" value={f.reportedBy} onChange={up('reportedBy')} className={`${fld} w-full`} />
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">TraxKey links this to the stay that just ended in that unit. Whether to claim it is your call.</p>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">Record</button>
      </form>

      {!rows ? <p className="text-sm text-slate-400">Loading…</p>
        : rows.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
            <p className="text-sm font-bold mb-1">Nothing recorded</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Damage logged here is tied to the stay it happened during, which is what makes it defensible later.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map(d => (
              <div key={d.id} className="border border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{d.description}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      {d.property_name}{d.unit_number ? ` Unit ${d.unit_number}` : ''}
                      {d.checkin_date ? ` · stay ${d.checkin_date} → ${d.checkout_date}` : ' · no stay matched'}
                      {d.estimated_cost ? ` · $${Math.round(d.estimated_cost)}` : ''}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS[d.claim_status]}`}>{d.claim_status}</span>
                </div>
                {d.claim_status === 'recorded' && (
                  <div className="flex gap-3 mt-3">
                    <button onClick={() => mark(d.id, 'claiming')} className="text-xs font-bold text-amber-600 dark:text-amber-400 hover:underline">Claiming it</button>
                    <button onClick={() => mark(d.id, 'dropped')} className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">Let it go</button>
                  </div>
                )}
                {d.claim_status === 'claiming' && (
                  <button onClick={() => mark(d.id, 'resolved')} className="text-xs font-bold text-green-600 dark:text-green-400 hover:underline mt-3">Mark resolved</button>
                )}
              </div>
            ))}
          </div>
        )}
    </>
  );
}
