import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';

const STATUS_COLOR = {
  submitted: 'bg-slate-500/15 text-slate-400',
  triaged: 'bg-sky-500/15 text-sky-400',
  needs_vendor: 'bg-red-500/15 text-red-400',
  awaiting_approval: 'bg-amber-500/15 text-amber-400',
  assigned: 'bg-sky-500/15 text-sky-400',
  scheduled: 'bg-teal-500/15 text-teal-400',
  in_progress: 'bg-sky-500/15 text-sky-400',
  on_hold: 'bg-amber-500/15 text-amber-400',
  completed: 'bg-green-500/15 text-green-400',
  closed: 'bg-green-500/15 text-green-400',
};

const EVENT_LABEL = {
  submitted: 'Submitted',
  triaged: 'Diagnosed',
  needs_vendor: 'No vendor available',
  approval_needed: 'Needs approval',
  approved: 'Approved',
  dispatched: 'Dispatched',
  followed_up: 'Followed up',
  verified: 'Verified',
  invoiced: 'Invoiced',
  closed: 'Closed',
};

function RequestCard({ request, onApproved }) {
  const [expanded, setExpanded] = useState(false);
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState('');
  const needsApproval = request.status === 'awaiting_approval';

  async function approve(e) {
    e.stopPropagation();
    setApproving(true);
    setApproveError('');
    try {
      await apiRequest('traxkey-approve-request', { method: 'POST', body: { requestId: request.id } });
      onApproved();
    } catch (err) {
      setApproveError(err.message || 'Could not approve');
      setApproving(false);
    }
  }

  return (
    <div className="bg-slate-900 border border-white/5 rounded-2xl p-5 mb-3">
      <button onClick={() => setExpanded(v => !v)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3 mb-1">
          <p className="text-sm font-medium flex-1">{request.description}</p>
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STATUS_COLOR[request.status] || 'bg-slate-500/15 text-slate-400'}`}>
            {request.status.replace('_', ' ')}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          {request.property_name ? `${request.property_name}${request.unit_number ? ` — Unit ${request.unit_number}` : ''} · ` : ''}
          {request.category || 'not yet classified'}
          {request.urgency ? ` · ${request.urgency}` : ''}
          {request.vendor_name ? ` · assigned to ${request.vendor_name}` : ''}
          {request.quoted_cost ? ` · est. $${Math.round(request.quoted_cost)}` : ''}
        </p>
      </button>

      {needsApproval && (
        <div className="mt-3 pt-3 border-t border-amber-400/20 flex items-center gap-2">
          <button onClick={approve} disabled={approving}
            className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50">
            {approving ? 'Approving…' : 'Approve dispatch'}
          </button>
          <span className="text-xs text-amber-400">Waiting on you before this gets sent to a vendor.</span>
          {approveError && <span className="text-xs text-red-400">{approveError}</span>}
        </div>
      )}

      {expanded && (
        <div className="mt-4 pt-4 border-t border-white/5 space-y-2.5">
          {request.events.map((e, i) => (
            <div key={i} className="flex items-start gap-3 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1 shrink-0" />
              <div>
                <span className="font-bold text-teal-300">{EVENT_LABEL[e.event_type] || e.event_type}</span>
                <span className="text-slate-500"> — {new Date(e.created_at).toLocaleString()}</span>
                {e.content && <p className="text-slate-400 mt-0.5">{e.content}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ActivityPage() {
  const [requests, setRequests] = useState(null);
  const [error, setError] = useState('');

  function load() {
    apiRequest('traxkey-get-activity')
      .then(json => setRequests(json.filter(r => r.id)))
      .catch(err => setError(err.message || 'Could not load activity'));
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-500 hover:text-white">← Dashboard</Link>
        <div className="mt-2 mb-6">
          <p className="text-xs text-teal-400 font-semibold uppercase tracking-wide mb-1">AI Activity</p>
          <h1 className="text-2xl font-bold">Maintenance Coordinator</h1>
          <p className="text-sm text-slate-400 mt-1">Every request, and every step the AI took on it. Click one to expand its trail.</p>
        </div>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
        {!requests && !error && <p className="text-sm text-slate-500">Loading…</p>}
        {requests && requests.length === 0 && (
          <div className="bg-slate-900 border border-white/5 rounded-2xl p-8 text-center">
            <p className="text-sm text-slate-400">No maintenance requests yet.</p>
          </div>
        )}
        {requests && requests.map(r => <RequestCard key={r.id} request={r} onApproved={load} />)}
      </div>
    </div>
  );
}
