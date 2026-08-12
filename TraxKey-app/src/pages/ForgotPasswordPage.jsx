import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('traxkey-request-reset', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-1">TraxKey <span className="text-teal-400">AI</span></h1>
        {sent ? (
          <>
            <p className="text-sm text-slate-300 mb-6">If that email has an account, a reset link is on its way. Check your inbox (and spam).</p>
            <Link to="/login" className="text-sm text-teal-400 underline">Back to login</Link>
          </>
        ) : (
          <>
            <p className="text-sm text-slate-400 mb-8">Enter your email and we'll send a reset link.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input required type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button disabled={loading} type="submit"
                className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-3 rounded-xl transition disabled:opacity-50">
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
            <p className="text-sm text-slate-500 mt-6"><Link to="/login" className="text-teal-400 underline">Back to login</Link></p>
          </>
        )}
      </div>
    </div>
  );
}
