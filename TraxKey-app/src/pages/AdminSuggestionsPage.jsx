import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const hdrs = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_admin_token')}` });

const STATUS = {
  new: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  considering: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  planned: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  built: 'bg-green-500/15 text-green-600 dark:text-green-400',
  declined: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
};

function Row({ s, onChanged }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function move(status) {
    setBusy(true);
    try {
      await fetch(`${AGENT_BASE}/suggestions`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({ action: 'status', suggestionId: s.id, status, note }),
      });
      onChanged();
    } finally { setBusy(false); }
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold">{s.subject}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {s.submitted_by_name} · {s.company_name} · {new Date(s.created_at).toLocaleDateString()}
          </p>
        </div>
        <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS[s.status]}`}>{s.status}</span>
      </div>
      {s.message && <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 whitespace-pre-wrap">{s.message}</p>}
      {s.admin_note && <p className="text-xs text-slate-400 dark:text-slate-500 mt-2 italic">Note: {s.admin_note}</p>}

      <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-white/5">
        <input placeholder="Note (optional)" value={note} onChange={e => setNote(e.target.value)}
          className="flex-1 min-w-[140px] bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-teal-400" />
        {['new', 'considering', 'planned', 'built', 'declined'].filter(x => x !== s.status).map(x => (
          <button key={x} disabled={busy} onClick={() => move(x)}
            className="text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/10 hover:border-teal-400/50 transition disabled:opacity-50">
            {x}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function AdminSuggestionsPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  async function load() {
    const res = await fetch(`${AGENT_BASE}/suggestions`, { headers: hdrs() });
    if (!res.ok) { setError('Could not load suggestions'); return; }
    const j = await res.json();
    setRows(j.suggestions || []);
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/admin" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Admin</Link>
        <h1 className="text-2xl font-bold mt-2 mb-6">Customer suggestions</h1>
        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}
        {!rows ? <p className="text-sm text-slate-400">Loading…</p>
          : rows.length === 0 ? <p className="text-sm text-slate-400">No suggestions yet.</p>
          : <div className="space-y-3">{rows.map(s => <Row key={s.id} s={s} onChanged={load} />)}</div>}
      </div>
    </div>
  );
}
