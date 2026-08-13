import { useEffect, useRef, useState } from 'react';
import ConciergeOrb from './ConciergeOrb.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const SENTENCE_ENDERS = new Set(['.', '!', '?']);

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
    // Word by word at 90ms. See the note in ConciergeWidget: the orb's
    // impulse decay needs that gap between kicks to read as a pulse.
    const words = data.briefing.split(' ').filter(Boolean);
    let i = 0;
    const id = setInterval(() => {
      const prevWord = words[i - 1];
      const isSentenceStart = i === 0 || (prevWord && SENTENCE_ENDERS.has(prevWord.slice(-1)));
      if (isSentenceStart) orbRef.current?.flare(0.9);
      else orbRef.current?.pulse(0.3);

      i += 1;
      setShown(words.slice(0, i).join(' '));
      if (i >= words.length) { clearInterval(id); setDone(true); }
    }, 90);
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

          {done && data?.todos?.length > 0 && (
            <ul className="mt-3 space-y-1.5 list-none">
              {data.todos.map((todo, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
                  <span className="shrink-0 mt-1.5 w-1 h-1 rounded-full bg-teal-500 dark:bg-teal-400" />
                  <span>{todo}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
