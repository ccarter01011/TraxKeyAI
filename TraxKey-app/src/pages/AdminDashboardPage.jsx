import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle.jsx';
import AdminConciergeWidget from '../components/AdminConciergeWidget.jsx';

const API_BASE = 'https://main-production-b95e.up.railway.app/webhook';

function Stat({ label, value, sub, accent }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
      <p className="text-xs uppercase text-slate-400 dark:text-slate-500 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${accent || ''}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

export default function AdminDashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = localStorage.getItem('tk_admin_token');
    if (!token) { navigate('/admin/login'); return; }
    fetch(`${API_BASE}/traxkey-admin-metrics`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async res => {
        const json = await res.json().catch(() => ({}));
        if (res.status === 401) { localStorage.removeItem('tk_admin_token'); navigate('/admin/login'); return; }
        if (!res.ok) throw new Error(json.error || 'Could not load metrics');
        setData(json);
      })
      .catch(err => setError(err.message));
  }, [navigate]);

  function logout() {
    localStorage.removeItem('tk_admin_token');
    navigate('/admin/login');
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Internal</p>
            <h1 className="text-2xl font-bold">TraxKey AI Admin</h1>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <button onClick={logout} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white">Log out</button>
          </div>
        </div>

        {error && <p className="text-sm text-red-500 dark:text-red-400 mb-4">{error}</p>}
        {!data && !error && <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>}

        {data && (
          <>
            <AdminConciergeWidget />

            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">Accounts</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Stat label="Total companies" value={data.total_companies} />
              <Stat label="On trial" value={data.trial_companies} accent="text-amber-500 dark:text-amber-400" />
              <Stat label="Paying" value={data.paying_companies} accent="text-green-600 dark:text-green-400" />
              <Stat label="New (30d)" value={data.new_companies_30d} />
            </div>

            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">Revenue</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
              <Stat label="Estimated MRR" value={`$${Number(data.estimated_mrr).toLocaleString()}`} accent="text-teal-600 dark:text-teal-400" />
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-8">
              Estimated from plan tier, not collected payments. There's no billing integration yet, so this is what active accounts would bill at.
            </p>

            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">Portfolio under management</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Stat label="Units" value={data.total_units} />
              <Stat label="Properties" value={data.total_properties} />
              <Stat label="Residents" value={data.total_residents} />
              <Stat label="Vendors" value={data.total_vendors} />
            </div>

            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">AI activity</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
              <Stat label="Total requests" value={data.total_requests} />
              <Stat label="Requests (30d)" value={data.requests_30d} />
              <Stat label="Completed" value={data.completed_requests} accent="text-green-600 dark:text-green-400" />
              <Stat label="Calendars synced" value={data.connected_calendars} />
            </div>

            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-3">Companies</p>
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm min-w-[520px]">
                <thead className="bg-slate-100 dark:bg-slate-950 text-left text-xs uppercase text-slate-400 dark:text-slate-500">
                  <tr><th className="p-3">Company</th><th className="p-3">Plan</th><th className="p-3">Status</th><th className="p-3">Units</th><th className="p-3">Joined</th></tr>
                </thead>
                <tbody>
                  {(data.companies || []).map((c, i) => (
                    <tr key={i} className="border-t border-slate-200 dark:border-white/5">
                      <td className="p-3 font-medium">{c.name}</td>
                      <td className="p-3">{c.plan}</td>
                      <td className="p-3">
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                          c.plan_status === 'active' ? 'bg-green-500/15 text-green-600 dark:text-green-400'
                          : c.plan_status === 'trialing' ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                          : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'}`}>
                          {c.plan_status}
                        </span>
                      </td>
                      <td className="p-3">{c.unit_count}</td>
                      <td className="p-3 text-slate-400 dark:text-slate-500">{new Date(c.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mt-8 mb-3">
              Leads {data.leads?.length ? `(${data.leads.length})` : ''}
            </p>
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-slate-100 dark:bg-slate-950 text-left text-xs uppercase text-slate-400 dark:text-slate-500">
                  <tr>
                    <th className="p-3">Name</th><th className="p-3">Email</th><th className="p-3">Company</th>
                    <th className="p-3">Portfolio</th><th className="p-3">Source</th><th className="p-3">Received</th><th className="p-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.leads || []).length === 0 && (
                    <tr><td colSpan={7} className="p-4 text-center text-slate-400 dark:text-slate-500">No leads yet.</td></tr>
                  )}
                  {(data.leads || []).map((l) => {
                    const hoursOld = (Date.now() - new Date(l.created_at).getTime()) / 3600000;
                    return (
                      <tr key={l.id} className="border-t border-slate-200 dark:border-white/5 align-top">
                        <td className="p-3 font-medium">{l.name}</td>
                        <td className="p-3">
                          <a href={`mailto:${l.email}`} className="text-teal-600 dark:text-teal-400 hover:underline">{l.email}</a>
                        </td>
                        <td className="p-3">{l.company || '—'}</td>
                        <td className="p-3 text-slate-400 dark:text-slate-500">{l.portfolio_size || '—'}</td>
                        <td className="p-3 text-slate-400 dark:text-slate-500">{l.source || '—'}</td>
                        <td className="p-3 text-slate-400 dark:text-slate-500">{new Date(l.created_at).toLocaleDateString()}</td>
                        <td className="p-3">
                          {l.contacted_at ? (
                            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-400">
                              Followed up
                            </span>
                          ) : hoursOld >= 48 ? (
                            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                              Due for follow-up
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-500 dark:text-slate-400">
                              New
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
              A lead who hasn't converted to a customer gets an automatic invite-and-feedback email 48 hours after coming in. "Followed up" means that email went out, not that they replied.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
