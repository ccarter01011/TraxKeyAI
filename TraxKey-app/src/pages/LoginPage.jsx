import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const json = await apiRequest('traxkey-login', { method: 'POST', body: { email, password } });
      login(json);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-1">TraxKey <span className="text-teal-400">AI</span></h1>
        <p className="text-sm text-slate-400 mb-8">Log in to your dashboard</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input required type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          <input required type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button disabled={loading} type="submit"
            className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-3 rounded-xl transition disabled:opacity-50">
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </form>
        <p className="text-sm text-slate-500 mt-4"><Link to="/forgot-password" className="text-teal-400 underline">Forgot password?</Link></p>
        <p className="text-sm text-slate-500 mt-2">No account? <Link to="/signup" className="text-teal-400 underline">Sign up</Link></p>
      </div>
    </div>
  );
}
