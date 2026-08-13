import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';

// A lease that ends inside this window is the renewal agent's problem. Ninety
// days is not arbitrary: most leases require 30 to 60 days notice, so anything
// shorter means the operator is already reacting instead of deciding.
const RENEWAL_WINDOW_DAYS = 90;

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const end = new Date(`${dateStr}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((end - today) / 86400000);
}

function money(n) {
  if (n === null || n === undefined || n === '') return '—';
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function urgency(days) {
  if (days === null) return { label: 'Month to month', cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-400' };
  if (days < 0) return { label: 'Expired', cls: 'bg-red-500/15 text-red-600 dark:text-red-400' };
  if (days <= 30) return { label: `${days}d left`, cls: 'bg-red-500/15 text-red-600 dark:text-red-400' };
  if (days <= 60) return { label: `${days}d left`, cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
  if (days <= RENEWAL_WINDOW_DAYS) return { label: `${days}d left`, cls: 'bg-sky-500/15 text-sky-600 dark:text-sky-400' };
  return { label: `${days}d left`, cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-400' };
}

const RENEWAL_LABEL = {
  offered: 'Renewal offered',
  accepted: 'Renewal accepted',
  declined: 'Resident declined',
  no_response: 'No response',
};

function AddLeaseForm({ units, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    unitId: '', startDate: '', endDate: '', rentAmount: '',
    depositAmount: '', rentDueDay: '1', noticeDays: '30',
  });
  const [monthToMonth, setMonthToMonth] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const update = field => e => setForm(f => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiRequest('traxkey-create-lease', {
        method: 'POST',
        body: { ...form, endDate: monthToMonth ? '' : form.endDate },
      });
      setForm({ unitId: '', startDate: '', endDate: '', rentAmount: '', depositAmount: '', rentDueDay: '1', noticeDays: '30' });
      setMonthToMonth(false);
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err.message || 'Could not create lease');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
        + Add lease
      </button>
    );
  }

  const field = 'w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400';

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm mb-1">New lease</p>

      <select required value={form.unitId} onChange={update('unitId')} className={field}>
        <option value="">Select a unit…</option>
        {units.map(u => (
          <option key={u.id} value={u.id}>{u.propertyName}{u.unit_number ? ` — Unit ${u.unit_number}` : ''}</option>
        ))}
      </select>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Start date</span>
          <input required type="date" value={form.startDate} onChange={update('startDate')} className={field} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">End date</span>
          <input type="date" required={!monthToMonth} disabled={monthToMonth}
            value={monthToMonth ? '' : form.endDate} onChange={update('endDate')}
            className={`${field} disabled:opacity-40`} />
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
        <input type="checkbox" checked={monthToMonth} onChange={e => setMonthToMonth(e.target.checked)}
          className="rounded border-slate-300 dark:border-white/20" />
        Month to month, no fixed end date
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Monthly rent</span>
          <input type="number" min="0" step="1" placeholder="1850" value={form.rentAmount} onChange={update('rentAmount')} className={field} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Deposit held</span>
          <input type="number" min="0" step="1" placeholder="1850" value={form.depositAmount} onChange={update('depositAmount')} className={field} />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Rent due on day</span>
          <input type="number" min="1" max="28" value={form.rentDueDay} onChange={update('rentDueDay')} className={field} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Notice required (days)</span>
          <input type="number" min="0" max="180" value={form.noticeDays} onChange={update('noticeDays')} className={field} />
        </label>
      </div>

      <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
        TraxKey records the rent amount so it can track renewals and flag below-market
        units. It does not collect rent or hold funds — keep using whatever you use today.
      </p>

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
          {saving ? 'Saving…' : 'Create lease'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3">
          Cancel
        </button>
      </div>
    </form>
  );
}

function RenewalActions({ lease, onChanged }) {
  const [busy, setBusy] = useState('');
  const [offering, setOffering] = useState(false);
  const [newRent, setNewRent] = useState(lease.rent_amount || '');

  async function act(path, body, key) {
    setBusy(key);
    try {
      await apiRequest(path, { method: 'POST', body: { leaseId: lease.id, ...body } });
      onChanged();
    } catch {
      setBusy('');
    }
  }

  const btn = 'text-xs font-bold px-3 py-1.5 rounded-lg transition disabled:opacity-50';

  if (lease.renewal_status === 'offered') {
    return (
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          Offered at {money(lease.renewal_rent_amount)}/mo. Did they accept?
        </span>
        <button disabled={!!busy} onClick={() => act('traxkey-update-renewal', { renewalStatus: 'accepted' }, 'a')}
          className={`${btn} bg-teal-500 hover:bg-teal-400 text-slate-950`}>Accepted</button>
        <button disabled={!!busy} onClick={() => act('traxkey-update-renewal', { renewalStatus: 'declined' }, 'd')}
          className={`${btn} bg-slate-200 dark:bg-white/10 hover:bg-slate-300 dark:hover:bg-white/20`}>Declined</button>
      </div>
    );
  }

  if (offering) {
    return (
      <div className="flex flex-wrap items-center gap-2 mt-3">
        <span className="text-xs text-slate-500 dark:text-slate-400">Renew at</span>
        <input type="number" min="0" value={newRent} onChange={e => setNewRent(e.target.value)}
          className="w-24 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-teal-400" />
        <button disabled={!!busy} onClick={() => act('traxkey-offer-renewal', { renewalRentAmount: newRent }, 'o')}
          className={`${btn} bg-teal-500 hover:bg-teal-400 text-slate-950`}>
          {busy ? 'Sending…' : 'Send offer'}
        </button>
        <button onClick={() => setOffering(false)} className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-white">Cancel</button>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button onClick={() => setOffering(true)} className={`${btn} bg-teal-500/15 text-teal-700 dark:text-teal-300 hover:bg-teal-500/25`}>
        Offer renewal
      </button>
    </div>
  );
}

function LeaseCard({ lease, onChanged }) {
  const days = lease.end_date ? daysUntil(lease.end_date) : null;
  const u = urgency(days);
  const inWindow = days !== null && days <= RENEWAL_WINDOW_DAYS && lease.status === 'active';

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-sm truncate">
            {lease.property_name}{lease.unit_number ? ` — Unit ${lease.unit_number}` : ''}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {lease.resident_name || 'No resident on file'}
          </p>
        </div>
        <span className={`shrink-0 text-xs font-bold px-2 py-1 rounded-lg ${u.cls}`}>{u.label}</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
        <div>
          <p className="text-slate-400 dark:text-slate-500">Rent</p>
          <p className="font-bold">{money(lease.rent_amount)}<span className="font-normal text-slate-400">/mo</span></p>
        </div>
        <div>
          <p className="text-slate-400 dark:text-slate-500">Term</p>
          <p className="font-bold">{lease.start_date} → {lease.end_date || 'open'}</p>
        </div>
        <div>
          <p className="text-slate-400 dark:text-slate-500">Deposit</p>
          <p className="font-bold">{money(lease.deposit_amount)}</p>
        </div>
      </div>

      {lease.renewal_status && lease.renewal_status !== 'none' && (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
          {RENEWAL_LABEL[lease.renewal_status] || lease.renewal_status}
        </p>
      )}

      {inWindow && lease.renewal_status !== 'accepted' && (
        <RenewalActions lease={lease} onChanged={onChanged} />
      )}
    </div>
  );
}

export default function LeasesPage() {
  const [leases, setLeases] = useState(null);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [leaseJson, propertiesJson] = await Promise.all([
        apiRequest('traxkey-get-leases'),
        apiRequest('traxkey-get-properties'),
      ]);
      setLeases(leaseJson.filter(l => l.id));
      setUnits(propertiesJson.filter(p => p.id).flatMap(p => p.units.map(u => ({ ...u, propertyName: p.name }))));
    } catch (err) {
      setError(err.message || 'Could not load leases');
    }
  }

  useEffect(() => { load(); }, []);

  const active = (leases || []).filter(l => l.status === 'active');
  const expiring = active.filter(l => {
    const d = l.end_date ? daysUntil(l.end_date) : null;
    return d !== null && d <= RENEWAL_WINDOW_DAYS;
  }).sort((a, b) => daysUntil(a.end_date) - daysUntil(b.end_date));
  const rest = active.filter(l => !expiring.includes(l));

  const monthlyRent = active.reduce((s, l) => s + Number(l.rent_amount || 0), 0);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Dashboard</Link>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Leases</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              Terms and renewals
              <FlowHelp
                title="How renewals work"
                steps={[
                  'Add a lease with its term, rent, and notice period.',
                  `TraxKey watches the end date and surfaces the lease ${RENEWAL_WINDOW_DAYS} days out, before your notice window closes.`,
                  'Offer a renewal at the rent you choose. TraxKey records what was offered and when.',
                  'Mark it accepted or declined. Accepting starts a new lease term and closes the old one.',
                  'A declined renewal starts a turn automatically, so the vacancy clock never runs unwatched.',
                ]}
                note="TraxKey records rent amounts to track renewals and flag below-market units. It never collects rent or holds funds."
              />
            </h1>
          </div>
          <AddLeaseForm units={units} onCreated={load} />
        </div>

        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

        {leases && (
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
              <p className="text-xs uppercase text-slate-400 dark:text-slate-500 mb-1">Active leases</p>
              <p className="text-2xl font-bold">{active.length}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
              <p className="text-xs uppercase text-slate-400 dark:text-slate-500 mb-1">Expiring soon</p>
              <p className={`text-2xl font-bold ${expiring.length ? 'text-amber-500 dark:text-amber-400' : ''}`}>{expiring.length}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
              <p className="text-xs uppercase text-slate-400 dark:text-slate-500 mb-1">Rent under management</p>
              <p className="text-2xl font-bold">{money(monthlyRent)}</p>
            </div>
          </div>
        )}

        {!leases ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading leases…</p>
        ) : active.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
            <p className="text-sm font-bold mb-1">No leases yet</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Add your first lease and TraxKey starts watching its renewal date.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {expiring.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400 mb-2">
                  Needs a renewal decision
                </p>
                <div className="space-y-3">
                  {expiring.map(l => <LeaseCard key={l.id} lease={l} onChanged={load} />)}
                </div>
              </div>
            )}
            {rest.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                  Everything else
                </p>
                <div className="space-y-3">
                  {rest.map(l => <LeaseCard key={l.id} lease={l} onChanged={load} />)}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
