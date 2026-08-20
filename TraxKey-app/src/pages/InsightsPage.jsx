import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import FlowHelp from '../components/FlowHelp.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';

const SEVERITY = {
  high: { cls: 'border-red-400/30 bg-red-500/5', dot: 'bg-red-400', label: 'Worth acting on now' },
  medium: { cls: 'border-amber-400/25 bg-amber-500/5', dot: 'bg-amber-400', label: 'Worth a look' },
  low: { cls: 'border-slate-200 dark:border-white/10', dot: 'bg-slate-400', label: 'Background' },
};

export default function InsightsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`${AGENT_BASE}/insights`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('tk_token')}` },
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('Could not load insights'))))
      .then(setData)
      .catch(err => setError(err.message));
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
          <ThemeToggle />
        </div>
        <div className="mb-6 mt-2">
          <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Insights</p>
          <h1 className="text-2xl font-bold inline-flex items-center gap-2">
            What you might not have noticed
            <FlowHelp
              title="How insights work"
              steps={[
                'Every number here is counted from your own data, not estimated and not from an outside benchmark.',
                'Nothing appears unless it suggests something you could actually do about it.',
                'A vendor slowdown needs at least three weeks of history before it will show, so a bad week is not mistaken for a trend.',
                'These also feed your morning briefing, so you can act on them without coming here.',
              ]}
              note="An insight is an observation, never an action. TraxKey will tell you a vendor has slowed down. It will never quietly switch vendors, or change a limit you set."
            />
          </h1>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        {!data && !error && <p className="text-sm text-slate-400 dark:text-slate-500">Looking for patterns…</p>}

        {data && data.insights.length === 0 && (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
            <p className="text-sm font-bold mb-1">Nothing worth flagging</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Either everything is running well, or there isn't enough history yet. Vendor trends need a
              few weeks of data before they mean anything, and we'd rather show you nothing than a
              pattern that isn't real.
            </p>
          </div>
        )}

        {data && data.insights.length > 0 && (
          <div className="space-y-3">
            {data.insights.map((i, n) => {
              const s = SEVERITY[i.severity] || SEVERITY.low;
              return (
                <div key={n} className={`border rounded-xl p-4 ${s.cls}`}>
                  <div className="flex items-start gap-3">
                    <span className={`shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full ${s.dot}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">{i.text}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5">{i.action}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
