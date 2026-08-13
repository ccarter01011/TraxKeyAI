import { useEffect, useRef, useState } from 'react';
import ConciergeOrb from './ConciergeOrb.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';

export default function AdminConciergeWidget() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);
  const orbRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem('tk_admin_token');
    if (!token) return;
    fetch(`${AGENT_BASE}/admin-concierge`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    if (!data?.briefing) return;
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(data.briefing.slice(0, i));
      const prev = data.briefing[i - 2];
      if (orbRef.current) {
        if (i === 1 || ['.', '!', '?'].includes(prev)) orbRef.current.flare(0.9);
        else orbRef.current.pulse(0.05);
      }
      if (i >= data.briefing.length) { clearInterval(id); setDone(true); }
    }, 14);
    return () => clearInterval(id);
  }, [data]);

  if (failed) return null;

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
            <p className={`text-sm text-slate-700 dark:text-slate-200 leading-relaxed ${done ? '' : 'tk-caret'}`}>
              {shown}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
