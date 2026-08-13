import { useEffect, useRef, useState } from 'react';
import ConciergeOrb from './ConciergeOrb.jsx';
import WaveText from './WaveText.jsx';
import TaskModal from './TaskModal.jsx';
import useTypedSequence from '../lib/useTypedSequence.js';

// The concierge lives in the agents service, not n8n, because that's where
// the Anthropic key already is and where all other AI in this system runs.
const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';

const STATUS_LABEL = {
  awaiting_approval: 'Needs your approval',
  needs_vendor: 'No vendor available',
  scheduled: 'Dispatched',
  in_progress: 'In progress',
};

export default function ConciergeWidget() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [openTaskId, setOpenTaskId] = useState(null);
  const orbRef = useRef(null);

  // Re-fetch the briefing after an approve/complete, so the item that was
  // just handled stops being listed as needing attention.
  function reload() {
    const token = localStorage.getItem('tk_token');
    if (!token) return;
    fetch(`${AGENT_BASE}/concierge`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => {});
  }

  // Lead sentence first, then one segment per bullet. The whole briefing
  // types as one continuous stream so it reads as live, not pasted.
  const segments = data ? [data.greeting || '', ...(data.todos || [])] : [];
  const { shown, done } = useTypedSequence(segments, orbRef);

  useEffect(() => {
    const token = localStorage.getItem('tk_token');
    if (!token) return;
    fetch(`${AGENT_BASE}/concierge`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  // Fail silently. A broken briefing should never be the first thing an
  // operator sees, and every number in it is available elsewhere anyway.
  if (failed) return null;

  const thinking = !data;
  const typedTodos = shown.slice(1);
  // Index of the bullet currently being written, so the caret sits there.
  const lastActive = typedTodos.reduce((acc, t, i) => (t ? i : acc), -1);

  return (
    <div className="bg-gradient-to-r from-teal-500/10 to-sky-500/10 border border-teal-400/20 rounded-xl p-5 mb-6">
      <div className="flex items-start gap-4">
        <ConciergeOrb ref={orbRef} active={thinking || !done} size={44} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wide mb-1.5">
            TraxKey AI
          </p>

          {thinking ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              <WaveText text="Looking over your portfolio…" />
            </p>
          ) : (
            <p className={`text-sm text-slate-700 dark:text-slate-200 leading-relaxed ${
              !done && lastActive === -1 ? 'tk-caret' : ''}`}>
              {shown[0] || ''}
            </p>
          )}

          {typedTodos.some(Boolean) && (
            <ul className="mt-2 list-none">
              {typedTodos.map((todo, i) => todo ? (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200 leading-snug py-0.5">
                  <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-teal-500 dark:bg-teal-400" />
                  <span className={!done && i === lastActive ? 'tk-caret' : ''}>{todo}</span>
                </li>
              ) : null)}
            </ul>
          )}

          {done && data?.action_items?.length > 0 && (
            <div className="mt-3">
              {data.action_items.map(item => (
                <button
                  key={item.id}
                  onClick={() => setOpenTaskId(item.id)}
                  className="w-full text-left flex items-start gap-2.5 text-xs rounded-lg px-2 py-1 leading-snug hover:bg-white/60 dark:hover:bg-slate-950/60 transition"
                >
                  <span className={`shrink-0 mt-1 w-1.5 h-1.5 rounded-full ${
                    item.status === 'awaiting_approval' ? 'bg-amber-400'
                    : item.status === 'needs_vendor' ? 'bg-red-400' : 'bg-teal-400'}`} />
                  <span className="flex-1 text-slate-700 dark:text-slate-300">{item.description}</span>
                  <span className="shrink-0 text-slate-400 dark:text-slate-500">
                    {STATUS_LABEL[item.status] || item.status.replace(/_/g, ' ')}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {openTaskId && (
        <TaskModal
          requestId={openTaskId}
          onClose={() => setOpenTaskId(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}
