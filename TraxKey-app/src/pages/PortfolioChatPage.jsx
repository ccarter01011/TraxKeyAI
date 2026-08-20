import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import FlowHelp from '../components/FlowHelp.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';
const hdrs = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('tk_token')}` });

// Questions that need both halves of the portfolio at once. They double as the
// pitch: none of these can be answered by a short-term platform or a long-term
// PMS alone, which is the whole reason this page exists.
const STARTERS = [
  'Which units earned the least per month this quarter?',
  'Where did maintenance cost me most, compared to what the unit earned?',
  'Which leases end soon, and would those units earn more short-term?',
  'How is my short-term side performing versus my long-term side?',
];

export default function PortfolioChatPage() {
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns, busy]);

  async function ask(question) {
    const q = (question ?? input).trim();
    if (!q || busy) return;
    setErr(''); setInput(''); setBusy(true);

    // The history sent up is what the user can see. Appending the question
    // before the request keeps the transcript honest if the call then fails.
    const history = turns.map(t => ({ role: t.role, content: t.content }));
    setTurns(t => [...t, { role: 'user', content: q }]);

    try {
      const res = await fetch(`${AGENT_BASE}/portfolio-chat`, {
        method: 'POST', headers: hdrs(), body: JSON.stringify({ question: q, history }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'Could not answer that'); return; }
      setTurns(t => [...t, { role: 'assistant', content: j.reply }]);
    } catch {
      setErr('Could not reach the assistant.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto flex flex-col min-h-[calc(100vh-4rem)]">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
          <ThemeToggle />
        </div>
        <div className="mb-6 mt-2">
          <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Portfolio Assistant</p>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">
            Ask about your whole portfolio
            <FlowHelp
              title="What this is"
              steps={[
                'Ask a question in plain language about your units, leases, bookings, or maintenance.',
                'The assistant runs fixed queries against your own data and answers from what comes back. It cannot write its own database queries, and it only ever sees your company.',
                'Every number in an answer comes from a query. It is told never to estimate, so if the data is not there it will say so rather than guess.',
                'It reads long-term and short-term together, which is the point: comparing a lease against nightly revenue needs both halves in one place.',
              ]}
              note="Contracted rent and realized short-term revenue are different kinds of number. Rent is what is promised; short-term revenue is what actually happened over a window. Answers say which is which, and flag when a conclusion rests on only a few booked nights."
            />
          </h1>
        </div>

        <div className="flex-1 space-y-4 mb-4">
          {turns.length === 0 && (
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-6">
              <p className="text-sm font-bold mb-1">Questions that need both sides</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                Your short-term platform has no leases. Your long-term software has no nightly rates. These need both.
              </p>
              <div className="space-y-2">
                {STARTERS.map(s => (
                  <button key={s} onClick={() => ask(s)} disabled={busy}
                    className="block w-full text-left text-xs px-3 py-2 rounded-lg bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 hover:border-teal-400/50 disabled:opacity-40">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
              <div className={`rounded-xl px-4 py-3 max-w-[90%] ${t.role === 'user'
                ? 'bg-teal-500 text-slate-950 font-semibold text-sm'
                : 'bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 text-sm whitespace-pre-wrap'}`}>
                {t.content}
              </div>
            </div>
          ))}

          {busy && (
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl px-4 py-3 text-sm text-slate-500">
              Looking at your portfolio…
            </div>
          )}
          {err && <p className="text-xs text-red-500">{err}</p>}
          <div ref={endRef} />
        </div>

        <form onSubmit={e => { e.preventDefault(); ask(); }} className="sticky bottom-0 bg-white dark:bg-slate-950 pt-2 flex gap-2">
          <input
            value={input} onChange={e => setInput(e.target.value)} disabled={busy}
            placeholder="Ask about units, leases, bookings, or costs…"
            className="flex-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-teal-400 disabled:opacity-50"
          />
          <button type="submit" disabled={busy || !input.trim()}
            className="bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-sm px-5 rounded-lg">
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
