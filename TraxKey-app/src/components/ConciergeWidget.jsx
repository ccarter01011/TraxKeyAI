import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ConciergeOrb from './ConciergeOrb.jsx';

// The concierge lives in the agents service, not n8n, because that's where
// the Anthropic key already is and where all other AI in this system runs.
const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';

const STATUS_LABEL = {
  awaiting_approval: 'Needs your approval',
  needs_vendor: 'No vendor available',
  scheduled: 'Dispatched',
  in_progress: 'In progress',
};

function useTypedText(fullText, speed = 18) {
  const [shown, setShown] = useState('');
  const [done, setDone] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    if (!fullText) return;
    setShown('');
    setDone(false);
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      setShown(fullText.slice(0, i));
      if (i >= fullText.length) {
        clearInterval(timer.current);
        setDone(true);
      }
    }, speed);
    return () => clearInterval(timer.current);
  }, [fullText, speed]);

  return { shown, done };
}

export default function ConciergeWidget() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  const { shown, done } = useTypedText(data?.greeting || '');

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

  return (
    <div className="bg-gradient-to-r from-teal-500/10 to-sky-500/10 border border-teal-400/20 rounded-xl p-5 mb-6">
      <div className="flex items-start gap-4">
        <ConciergeOrb active={thinking || !done} size={40} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wide mb-1.5">
            TraxKey AI
          </p>

          {thinking ? (
            <p className="text-sm text-slate-400 dark:text-slate-500">Looking over your portfolio…</p>
          ) : (
            <p className={`text-sm text-slate-700 dark:text-slate-200 leading-relaxed ${done ? '' : 'tk-caret'}`}>
              {shown}
            </p>
          )}

          {done && data?.action_items?.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {data.action_items.map(item => (
                <Link
                  key={item.id}
                  to="/activity"
                  className="flex items-start gap-2.5 text-xs bg-white/50 dark:bg-slate-950/40 rounded-lg px-3 py-2 hover:bg-white dark:hover:bg-slate-950/70 transition"
                >
                  <span className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${
                    item.status === 'awaiting_approval' ? 'bg-amber-400'
                    : item.status === 'needs_vendor' ? 'bg-red-400' : 'bg-teal-400'}`} />
                  <span className="flex-1 text-slate-700 dark:text-slate-300">{item.description}</span>
                  <span className="shrink-0 text-slate-400 dark:text-slate-500">
                    {STATUS_LABEL[item.status] || item.status.replace(/_/g, ' ')}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
