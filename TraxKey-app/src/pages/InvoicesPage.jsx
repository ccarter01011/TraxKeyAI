import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import FlowHelp from '../components/FlowHelp.jsx';
import ImportExport from '../components/ImportExport.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const hdrs = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token')}` });
const fld = 'w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400';

const money = n => (n === null || n === undefined ? '—'
  : Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD' }));

function post(route, body) {
  return fetch(`${AGENT_BASE}${route}`, { method: 'POST', headers: hdrs(), body: JSON.stringify(body) })
    .then(async r => ({ ok: r.ok, j: await r.json().catch(() => ({})) }));
}

function AddCustomer({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', email: '', ccEmail: '' });
  const [err, setErr] = useState('');
  const up = k => e => setF(s => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setErr('');
    const { ok, j } = await post('/invoice-customers', f);
    if (!ok) { setErr(j.error || 'Could not save'); return; }
    setF({ name: '', email: '', ccEmail: '' }); setOpen(false); onCreated();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-teal-600 dark:text-teal-400 font-semibold hover:underline">+ Add customer</button>;

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm">New customer</p>
      <input required placeholder="Name" value={f.name} onChange={up('name')} className={fld} />
      <input required type="email" placeholder="Email (where reminders go)" value={f.email} onChange={up('email')} className={fld} />
      <input type="email" placeholder="CC email (optional)" value={f.ccEmail} onChange={up('ccEmail')} className={fld} />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">Save</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 px-3">Cancel</button>
      </div>
    </form>
  );
}

function AddInvoice({ customers, onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ customerId: '', invoiceNumber: '', amount: '', issuedOn: '', dueOn: '', notes: '' });
  const [err, setErr] = useState('');
  const up = k => e => setF(s => ({ ...s, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault(); setErr('');
    const { ok, j } = await post('/invoices', f);
    if (!ok) { setErr(j.error || 'Could not save'); return; }
    setF({ customerId: '', invoiceNumber: '', amount: '', issuedOn: '', dueOn: '', notes: '' });
    setOpen(false); onCreated();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">+ Add invoice</button>;

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm">New invoice</p>
      <select required value={f.customerId} onChange={up('customerId')} className={fld}>
        <option value="">Select customer…</option>
        {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input required placeholder="Invoice number" value={f.invoiceNumber} onChange={up('invoiceNumber')} className={fld} />
      <input required type="number" step="0.01" min="0" placeholder="Amount" value={f.amount} onChange={up('amount')} className={fld} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-slate-500 dark:text-slate-400">Issued
          <input type="date" value={f.issuedOn} onChange={up('issuedOn')} className={fld} />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">Due
          <input required type="date" value={f.dueOn} onChange={up('dueOn')} className={fld} />
        </label>
      </div>
      <input placeholder="Notes (optional)" value={f.notes} onChange={up('notes')} className={fld} />
      {err && <p className="text-xs text-red-500">{err}</p>}
      <div className="flex gap-2">
        <button type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">Save</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 px-3">Cancel</button>
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
    const { ok, j } = await post(route, {
      action: 'email-prefs', [idKey]: id, ccEmail, autoEmailEnabled: nextAuto,
    });
    if (!ok) { setMsg(j.error || 'Could not save'); return; }
    setOpen(false); onChanged();
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${auto
          ? 'bg-green-500/15 text-green-700 dark:text-green-400'
          : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'}`}>
          {auto ? 'Auto-reminders on' : 'Auto-reminders off'}
        </span>
        {cc && <span className="text-[10px] text-slate-500 dark:text-slate-400">CC {cc}</span>}
        <button onClick={() => save(!auto)} className="text-[11px] text-teal-600 dark:text-teal-400 hover:underline">
          {auto ? 'Turn off' : 'Turn on'}
        </button>
        <button onClick={() => setOpen(o => !o)} className="text-[11px] text-slate-500 hover:underline">
          {open ? 'Cancel' : 'Edit CC'}
        </button>
      </div>
      {inheritNote && <p className="text-[10px] text-slate-400 mt-1">{inheritNote}</p>}
      {open && (
        <div className="flex gap-2 mt-2">
          <input type="email" placeholder="CC email (blank to clear)" value={ccEmail}
            onChange={e => setCc(e.target.value)} className={fld} />
          <button onClick={() => save(auto)} className="shrink-0 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 rounded-lg">Save</button>
        </div>
      )}
      {msg && <p className="text-xs text-red-500 mt-1">{msg}</p>}
    </div>
  );
}

function InvoiceRow({ inv, onChanged }) {
  const overdue = inv.days_overdue;
  const settled = inv.status !== 'open';

  async function setStatus(status) {
    await post('/invoices', { action: 'status', invoiceId: inv.id, status });
    onChanged();
  }

  return (
    <div className={`bg-slate-50 dark:bg-slate-900 border rounded-xl p-4 ${overdue
      ? 'border-amber-400/40' : 'border-slate-200 dark:border-white/5'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-sm truncate">
            {inv.invoice_number} <span className="text-slate-400 font-normal">· {inv.customer_name}</span>
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {money(inv.amount)} · due {inv.due_on}
            {settled && inv.paid_on && ` · paid ${inv.paid_on}`}
          </p>
          {overdue > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-semibold mt-1">
              {overdue} day{overdue !== 1 ? 's' : ''} overdue
              {inv.chase_count > 0 && ` · ${inv.chase_count} reminder${inv.chase_count !== 1 ? 's' : ''} sent`}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {inv.status === 'open' && (
            <>
              <button onClick={() => setStatus('paid')} className="text-xs bg-green-500/15 text-green-700 dark:text-green-400 font-semibold px-3 py-1.5 rounded-lg hover:bg-green-500/25">Mark paid</button>
              <button onClick={() => setStatus('cancelled')} className="text-xs text-slate-500 px-3 py-1 hover:underline">Cancel</button>
            </>
          )}
          {settled && (
            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${inv.status === 'paid'
              ? 'bg-green-500/15 text-green-700 dark:text-green-400'
              : 'bg-slate-500/15 text-slate-500'}`}>{inv.status}</span>
          )}
        </div>
      </div>
      {inv.status === 'open' && (
        <EmailPrefs
          route="/invoices" idKey="invoiceId" id={inv.id}
          cc={inv.effective_cc_email} auto={inv.effective_auto_email}
          inheritNote={inv.auto_email_enabled === null
            ? `Following the ${inv.customer_name} default. Changing it here overrides just this invoice.` : null}
          onChanged={onChanged}
        />
      )}
    </div>
  );
}

export default function InvoicesPage() {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('invoices');

  async function load() {
    const j = await fetch(`${AGENT_BASE}/invoices`, { headers: hdrs() })
      .then(r => r.json()).catch(() => ({ invoices: [], customers: [], summary: {} }));
    setData(j);
  }
  useEffect(() => { load(); }, []);

  const s = data?.summary || {};
  const invoices = data?.invoices || [];
  const customers = data?.customers || [];

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Invoices</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              What you're owed
              <FlowHelp
                title="How invoice chasing works"
                steps={[
                  'Add a customer once, with the email reminders should go to.',
                  'Add invoices against that customer with an amount and a due date.',
                  'Once an invoice goes past due, TraxKey sends a reminder, then a firmer one a week later with you copied.',
                  'After two reminders it stops and tells you. Chasing further is a business call, not an automated one.',
                  'Turn reminders off per customer or per invoice any time.',
                ]}
                note="TraxKey tracks and chases, it never collects. No payment is processed here and no funds pass through TraxKey. Marking an invoice paid is a note you make after the money arrives elsewhere."
              />
            </h1>
          </div>
          <AddInvoice customers={customers} onCreated={load} />
        </div>

        <div className="mb-4">
          <ImportExport kind="invoices" onImported={load} />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            ['Outstanding', s.total_open, 'text-slate-900 dark:text-white'],
            ['Not yet due', s.current_amt, 'text-slate-500'],
            ['1–30 days over', s.overdue_1_30, 'text-amber-600 dark:text-amber-400'],
            ['60+ days over', s.overdue_60_plus, 'text-red-600 dark:text-red-400'],
          ].map(([label, val, tone]) => (
            <div key={label} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</p>
              <p className={`text-lg font-bold mt-0.5 ${tone}`}>{money(val)}</p>
            </div>
          ))}
        </div>

        <div className="flex gap-1 mb-4 border-b border-slate-200 dark:border-white/10">
          {['invoices', 'customers'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-sm font-semibold px-4 py-2 -mb-px border-b-2 transition ${tab === t
                ? 'border-teal-500 text-teal-600 dark:text-teal-400'
                : 'border-transparent text-slate-400 hover:text-slate-600'}`}>
              {t === 'invoices' ? 'Invoices' : 'Customers'}
            </button>
          ))}
        </div>

        {!data ? <p className="text-sm text-slate-400">Loading…</p>
          : tab === 'invoices' ? (
            invoices.length === 0 ? (
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
                <p className="text-sm font-bold mb-1">Nothing outstanding</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Add a customer, then add an invoice against them and TraxKey will chase it once it goes past due.</p>
              </div>
            ) : <div className="space-y-3">{invoices.map(i => <InvoiceRow key={i.id} inv={i} onChanged={load} />)}</div>
          ) : (
            <div className="space-y-3">
              <AddCustomer onCreated={load} />
              {customers.length === 0
                ? <p className="text-xs text-slate-500">No customers yet.</p>
                : customers.map(c => (
                  <div key={c.id} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{c.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{c.email}</p>
                      </div>
                      <p className="text-xs text-slate-500 shrink-0">
                        {c.open_count || 0} open · {money(c.open_amount)}
                      </p>
                    </div>
                    <EmailPrefs
                      route="/invoice-customers" idKey="customerId" id={c.id}
                      cc={c.cc_email} auto={c.auto_email_enabled}
                      inheritNote="This is the default for every invoice on this customer."
                      onChanged={load}
                    />
                  </div>
                ))}
            </div>
          )}
      </div>
    </div>
  );
}
