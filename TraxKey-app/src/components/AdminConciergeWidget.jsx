import { useEffect, useRef, useState } from 'react';
import ConciergeOrb from './ConciergeOrb.jsx';
import useTypedSequence from '../lib/useTypedSequence.js';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';

export default function AdminConciergeWidget() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const orbRef = useRef(null);

  const segments = data ? [data.briefing || '', ...(data.todos || [])] : [];
  const { shown, done } = useTypedSequence(segments, orbRef);

  useEffect(() => {
    const token = localStorage.getItem('tk_admin_token');
    if (!token) return;
    fetch(`${AGENT_BASE}/admin-concierge`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;

  const typedTodos = shown.slice(1);
  const lastActive = typedTodos.reduce((acc, t, i) => (t ? i : acc), -1);

  return (
    <div className="bg-gradient-to-r from-teal-500/10 to-sky-500/10 border border-teal-400/20 rounded-xl p-5 mb-6">
      <div className="flex items-start gap-4">
        <ConciergeOrb ref={orbRef} active={!data || !done} size={44} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wide mb-1.5">
            Where the business stands
          </p>

          {!data ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">Reading the numbers…</p>
          ) : (
            <p className={`text-sm text-slate-700 dark:text-slate-200 leading-relaxed ${
              !done && lastActive === -1 ? 'tk-caret' : ''}`}>
              {shown[0] || ''}
            </p>
          )}

          {typedTodos.some(Boolean) && (
            <ul className="mt-3 space-y-1.5 list-none">
              {typedTodos.map((todo, i) => todo ? (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-teal-500 dark:bg-teal-400" />
                  <span className={!done && i === lastActive ? 'tk-caret' : ''}>{todo}</span>
                </li>
              ) : null)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
