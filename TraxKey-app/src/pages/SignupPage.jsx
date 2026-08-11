import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

export default function SignupPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ companyName: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function update(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const json = await apiRequest('traxkey-signup', { method: 'POST', body: form });
      login({ token: json.token, name: form.name, role: 'owner' });
      navigate('/');
    } catch (err) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6 py-12">
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-1">TraxKey <span className="text-teal-400">AI</span></h1>
        <p className="text-sm text-slate-400 mb-8">Create your property management company account</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input required type="text" placeholder="Company name" value={form.companyName} onChange={update('companyName')}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          <input required type="text" placeholder="Your name" value={form.name} onChange={update('name')}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          <input required type="email" placeholder="Email" value={form.email} onChange={update('email')}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          <input required type="password" placeholder="Password" value={form.password} onChange={update('password')}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button disabled={loading} type="submit"
            className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-3 rounded-xl transition disabled:opacity-50">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="text-sm text-slate-500 mt-6">Already have an account? <Link to="/login" className="text-teal-400 underline">Log in</Link></p>
      </div>
    </div>
  );
}
