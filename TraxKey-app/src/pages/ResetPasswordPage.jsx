import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.search).get('token');
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiRequest('traxkey-reset-password', { method: 'POST', body: { token, password } });
      setDone(true);
      setTimeout(() => navigate('/login'), 2000);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <h1 className="text-xl font-bold mb-2">Missing reset link</h1>
          <p className="text-sm text-slate-400 mb-6">This page needs a valid reset link. Request a new one below.</p>
          <Link to="/forgot-password" className="text-teal-400 underline text-sm">Request a reset link</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-1">TraxKey <span className="text-teal-400">AI</span></h1>
        {done ? (
          <p className="text-sm text-teal-400 mb-6">Password updated. Taking you to login…</p>
        ) : (
          <>
            <p className="text-sm text-slate-400 mb-8">Choose a new password.</p>
            <form onSubmit={handleSubmit} className="space-y-4">
              <input required type="password" placeholder="New password" value={password} onChange={e => setPassword(e.target.value)}
                className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button disabled={loading} type="submit"
                className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-3 rounded-xl transition disabled:opacity-50">
                {loading ? 'Saving…' : 'Reset password'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
