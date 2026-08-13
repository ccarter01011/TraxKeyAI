import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';

// Same vocabulary the Activity page uses. Kept in sync deliberately: a
// status meaning one thing on the dashboard and another on Activity would
// be worse than a little duplication.
const STATUS_COLOR = {
  submitted: 'bg-slate-500/15 text-slate-500 dark:text-slate-400',
  triaged: 'bg-sky-500/15 text-sky-400',
  needs_vendor: 'bg-red-500/15 text-red-500 dark:text-red-400',
  awaiting_approval: 'bg-amber-500/15 text-amber-400',
  needs_human_review: 'bg-amber-500/15 text-amber-400',
  assigned: 'bg-sky-500/15 text-sky-400',
  scheduled: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  in_progress: 'bg-sky-500/15 text-sky-400',
  on_hold: 'bg-amber-500/15 text-amber-400',
  completed: 'bg-green-500/15 text-green-400',
  closed: 'bg-green-500/15 text-green-400',
};

const EVENT_LABEL = {
  submitted: 'Submitted',
  triaged: 'Diagnosed',
  needs_vendor: 'No vendor available',
  needs_human_review: 'Held for review',
  approval_needed: 'Needs approval',
  approved: 'Approved',
  dispatched: 'Dispatched',
  followed_up: 'Followed up',
  verified: 'Verified',
  invoiced: 'Invoiced',
  closed: 'Closed',
  readiness_alert: 'Guest arriving, not ready',
  in_progress: 'Vendor started work',
};

/**
 * Task detail in a modal, so acting on a dashboard item never costs the
 * operator their place. Reuses traxkey-get-activity rather than adding an
 * endpoint: it already returns every request with its full event timeline,
 * and one extra round trip on open is cheaper than a new workflow to
 * maintain and re-import.
 */
export default function TaskModal({ requestId, onClose, onChanged }) {
  const [request, setRequest] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [finalCost, setFinalCost] = useState('');
  const [rating, setRating] = useState('');

  useEffect(() => {
    let cancelled = false;
    apiRequest('traxkey-get-activity')
      .then(rows => {
        if (cancelled) return;
        const found = (rows || []).find(r => String(r.id) === String(requestId));
        if (!found) setError('That request could not be found.');
        else setRequest(found);
      })
      .catch(err => !cancelled && setError(err.message || 'Could not load this task'));
    return () => { cancelled = true; };
  }, [requestId]);

  // Escape closes, matching every other modal convention.
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function approve() {
    setBusy('approve');
    setError('');
    try {
      await apiRequest('traxkey-approve-request', { method: 'POST', body: { requestId } });
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not approve');
      setBusy('');
    }
  }

  async function complete() {
    setBusy('complete');
    setError('');
    try {
      await apiRequest('traxkey-complete-request', {
        method: 'POST',
        body: { requestId, finalCost: finalCost || undefined, rating: rating || undefined },
      });
      onChanged?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not mark complete');
      setBusy('');
    }
  }

  const needsApproval = request?.status === 'awaiting_approval';
  const canComplete = request?.status === 'scheduled' || request?.status === 'in_progress';

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6 relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-900 dark:hover:text-white text-xl leading-none"
        >
          ×
        </button>

        {!request && !error && (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading task…</p>
        )}

        {error && !request && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}

        {request && (
          <>
            <div className="flex items-start justify-between gap-3 mb-2 pr-6">
              <p className="text-base font-bold flex-1">{request.description}</p>
              <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                STATUS_COLOR[request.status] || 'bg-slate-500/15 text-slate-500 dark:text-slate-400'}`}>
                {request.status.replace(/_/g, ' ')}
              </span>
            </div>

            <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">
              {request.property_name ? `${request.property_name}${request.unit_number ? ` — Unit ${request.unit_number}` : ''} · ` : ''}
              {request.category || 'not yet classified'}
              {request.urgency ? ` · ${request.urgency}` : ''}
              {request.vendor_name ? ` · assigned to ${request.vendor_name}` : ''}
              {request.quoted_cost ? ` · est. $${Math.round(request.quoted_cost)}` : ''}
              {request.final_cost ? ` · final $${Math.round(request.final_cost)}` : ''}
            </p>

            {error && <p className="text-xs text-red-500 dark:text-red-400 mb-3">{error}</p>}

            {needsApproval && (
              <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-400/20">
                <p className="text-xs text-amber-600 dark:text-amber-400 mb-2">
                  Waiting on you before this gets sent to a vendor.
                </p>
                <button onClick={approve} disabled={!!busy}
                  className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                  {busy === 'approve' ? 'Approving…' : 'Approve dispatch'}
                </button>
              </div>
            )}

            {canComplete && (
              <div className="mb-4 p-3 rounded-xl bg-teal-500/10 border border-teal-400/20 flex flex-wrap items-center gap-2">
                <input type="number" placeholder="Final cost $" value={finalCost} onChange={e => setFinalCost(e.target.value)}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs w-28 focus:outline-none focus:border-teal-400" />
                <select value={rating} onChange={e => setRating(e.target.value)}
                  className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-teal-400">
                  <option value="">Rating (optional)</option>
                  {[5, 4, 3, 2, 1].map(n => <option key={n} value={n}>{n}★</option>)}
                </select>
                <button onClick={complete} disabled={!!busy}
                  className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50">
                  {busy === 'complete' ? 'Saving…' : 'Mark complete'}
                </button>
              </div>
            )}

            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
              What the AI did
            </p>
            <div className="space-y-2.5">
              {(request.events || []).map((e, i) => (
                <div key={i} className="flex items-start gap-3 text-xs">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400 mt-1 shrink-0" />
                  <div>
                    <span className="font-bold text-teal-600 dark:text-teal-300">{EVENT_LABEL[e.event_type] || e.event_type}</span>
                    <span className="text-slate-400 dark:text-slate-500"> — {new Date(e.created_at).toLocaleString()}</span>
                    {e.content && <p className="text-slate-500 dark:text-slate-400 mt-0.5">{e.content}</p>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
