import { useRef, useState } from 'react';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const hdrs = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token')}` });

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

const TONE = {
  new: 'bg-green-500/15 text-green-700 dark:text-green-400',
  duplicate: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  error: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

/**
 * kind: 'invoices' | 'orders'
 * Import is two steps on purpose. Nothing is written until the operator has
 * seen what will be created and what will be skipped.
 */
export default function ImportExport({ kind, onImported }) {
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [autoEmail, setAutoEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef(null);

  const noun = kind === 'invoices' ? 'invoices' : 'orders';

  function reset() {
    setCsv(''); setFileName(''); setPreview(null); setErr(''); setAutoEmail(false);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function pick(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(''); setPreview(null);
    const text = await f.text();
    setCsv(text); setFileName(f.name);
    setBusy(true);
    try {
      const res = await fetch(`${AGENT_BASE}/import`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({ kind, action: 'preview', csv: text }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setErr(j.error || 'Could not read that file'); return; }
      setPreview(j);
    } catch { setErr('Could not read that file'); } finally { setBusy(false); }
  }

  async function commit() {
    setBusy(true); setErr('');
    try {
      const res = await fetch(`${AGENT_BASE}/import`, {
        method: 'POST', headers: hdrs(),
        body: JSON.stringify({ kind, action: 'commit', csv, autoEmailEnabled: autoEmail }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { setErr(j.error || 'Import failed'); return; }
      reset(); setOpen(false); onImported();
    } catch { setErr('Import failed'); } finally { setBusy(false); }
  }

  async function grab(query, fallbackName) {
    setErr('');
    try {
      const res = await fetch(`${AGENT_BASE}/export?${query}`, { headers: hdrs() });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.csv) { setErr(j.error || 'Could not build that file'); return; }
      download(j.filename || fallbackName, j.csv);
    } catch { setErr('Could not build that file'); }
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(true)} className="text-xs text-teal-600 dark:text-teal-400 font-semibold hover:underline">Import CSV</button>
        <button onClick={() => grab(`kind=${kind}`, `traxkey-${kind}.csv`)} className="text-xs text-slate-500 hover:underline">Export CSV</button>
      </div>
    );
  }

  const c = preview?.counts;

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 mb-6">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-bold text-sm">Import {noun} from a spreadsheet</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Nothing is saved until you've seen what will be created.
          </p>
        </div>
        <button onClick={() => { reset(); setOpen(false); }} className="text-xs text-slate-500 hover:underline shrink-0">Close</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={pick}
          className="text-xs file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-teal-500 file:text-slate-950 file:font-bold file:text-xs hover:file:bg-teal-400" />
        <button onClick={() => grab(`kind=${kind}&template=1`, `traxkey-${kind}-template.csv`)}
          className="text-xs text-slate-500 hover:underline">Download a template</button>
      </div>

      <p className="text-[11px] text-slate-400 mb-3">
        {kind === 'invoices'
          ? 'Needs columns for invoice number, customer, amount and due date. An email column lets it create customers it has not seen before. Headers from QuickBooks or a plain sheet both work.'
          : 'Needs a description column at minimum. Supplier, PO number, cost, expected date and supplier email are all optional but make the chasing work.'}
      </p>

      {busy && <p className="text-xs text-slate-400">Reading…</p>}
      {err && <p className="text-xs text-red-500 mb-2">{err}</p>}

      {preview && (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${TONE.new}`}>{c.new} to create</span>
            {c.new_customers > 0 && <span className="text-[11px] font-bold px-2 py-1 rounded-full bg-teal-500/15 text-teal-700 dark:text-teal-400">{c.new_customers} new customer{c.new_customers !== 1 ? 's' : ''}</span>}
            {c.duplicate > 0 && <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${TONE.duplicate}`}>{c.duplicate} already here</span>}
            {c.error > 0 && <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${TONE.error}`}>{c.error} can't be read</span>}
            <span className="text-[11px] text-slate-400 py-1">from {fileName}</span>
          </div>

          <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-white/10 rounded-lg mb-3">
            <table className="w-full text-xs">
              <tbody>
                {preview.rows.map(r => (
                  <tr key={r.row} className="border-b border-slate-100 dark:border-white/5 last:border-0">
                    <td className="px-2 py-1.5 text-slate-400 w-10">{r.row}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${TONE[r.status]}`}>{r.status}</span>
                    </td>
                    <td className="px-2 py-1.5 font-medium truncate max-w-[9rem]">
                      {kind === 'invoices' ? r.invoice_number : r.description}
                    </td>
                    <td className="px-2 py-1.5 text-slate-500 truncate">
                      {kind === 'invoices'
                        ? [r.customer, r.amount != null ? `$${r.amount}` : null].filter(Boolean).join(' · ')
                        : [r.supplier, r.reference].filter(Boolean).join(' · ')}
                    </td>
                    <td className="px-2 py-1.5 text-slate-400 truncate max-w-[12rem]">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <label className="flex items-start gap-2 mb-3 cursor-pointer">
            <input type="checkbox" checked={autoEmail} onChange={e => setAutoEmail(e.target.checked)} className="mt-0.5" />
            <span className="text-xs text-slate-600 dark:text-slate-300">
              Start chasing these automatically
              <span className="block text-[11px] text-slate-400">
                Off by default. Importing history shouldn't email everyone in it. You can switch any row on later.
              </span>
            </span>
          </label>

          <div className="flex gap-2">
            <button disabled={busy || !c.new} onClick={commit}
              className="bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg transition">
              {busy ? 'Importing…' : `Import ${c.new} ${noun}`}
            </button>
            <button onClick={reset} className="text-sm text-slate-500 px-3">Choose another file</button>
          </div>
        </>
      )}
    </div>
  );
}
