import { useState } from 'react';

const AGENT_BASE = 'https://langgraph-production-42ef.up.railway.app';

/**
 * Matches TraxSail's suggestion box. Identity is never asked for, it comes
 * from the session server-side, so a customer types the idea and nothing
 * else. Asking a paying customer to re-enter their name and email to tell
 * you how to improve your product is a reliable way to get fewer ideas.
 */
export default function SuggestionModal({ onClose }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSending(true);
    setError('');
    try {
      const res = await fetch(`${AGENT_BASE}/suggestions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('tk_token')}`,
        },
        body: JSON.stringify({ subject, message }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send that');
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl w-full max-w-md p-6 relative"
        onClick={e => e.stopPropagation()}
      >
        <button onClick={onClose} aria-label="Close"
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-900 dark:hover:text-white text-xl leading-none">
          ×
        </button>

        {sent ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 bg-teal-500/15 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M8 12L11 15L16 9" stroke="#2dd4bf" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <h2 className="text-lg font-bold mb-1">Thanks for the idea!</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">We read every suggestion. If we build it, you'll be the first to know.</p>
          </div>
        ) : (
          <>
            <h2 className="text-lg font-bold mb-1">Suggest a feature</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
              Got an idea for something TraxKey should do? Tell us, this goes straight to the team building it.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <input required maxLength={200} placeholder="What's the idea?" value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
              <textarea maxLength={4000} rows={4} placeholder="Describe it, and what problem it'd solve for you…" value={message}
                onChange={e => setMessage(e.target.value)}
                className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button disabled={sending} type="submit"
                className="w-full bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl transition active:scale-95 duration-150">
                {sending ? 'Sending…' : 'Send suggestion'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
