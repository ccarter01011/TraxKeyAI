import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

const PAID_PLANS = ['starter', 'growth', 'pro'];

export default function SignupPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const plan = params.get('plan');
  const paidPlan = PAID_PLANS.includes(plan) ? plan : null;
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

      // A tier link from the marketing site carries its plan through here.
      // Every account still starts on Free (the signup endpoint itself
      // knows nothing about paid tiers) — this just sends a brand-new
      // Free account straight into Stripe checkout for the plan they
      // actually clicked, instead of stranding them on the dashboard
      // still on Free with no obvious way to finish what they started.
      if (paidPlan) {
        try {
          const checkout = await apiRequest('create-checkout-session', { method: 'POST', body: { plan: paidPlan } });
          if (checkout.checkoutUrl) {
            window.location.href = checkout.checkoutUrl;
            return;
          }
        } catch (checkoutErr) {
          // Account exists and is logged in either way; a checkout hiccup
          // shouldn't strand them on the signup form. They land on Free
          // and can upgrade from the dashboard/pricing page instead.
        }
      }
      navigate('/');
    } catch (err) {
      setError(err.message || 'Signup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center px-6 py-12">
      <div className="max-w-sm w-full">
        <h1 className="text-2xl font-bold mb-1">TraxKey <span className="text-teal-500 dark:text-teal-400">AI</span></h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">Create your property management company account</p>
        {paidPlan && (
          <p className="text-xs font-semibold text-teal-600 dark:text-teal-400 mb-6 uppercase tracking-wide">
            Signing up for the {paidPlan} plan &mdash; you'll be sent to secure checkout after this step
          </p>
        )}
        {!paidPlan && <div className="mb-6" />}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input required type="text" placeholder="Company name" value={form.companyName} onChange={update('companyName')}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          <input required type="text" placeholder="Your name" value={form.name} onChange={update('name')}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          <input required type="email" placeholder="Email" value={form.email} onChange={update('email')}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          <input required type="password" placeholder="Password" value={form.password} onChange={update('password')}
            className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-teal-400" />
          {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
          <button disabled={loading} type="submit"
            className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold py-3 rounded-xl transition disabled:opacity-50">
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>
        <p className="text-sm text-slate-500 mt-6">Already have an account? <Link to="/login" className="text-teal-600 dark:text-teal-400 underline">Log in</Link></p>
      </div>
    </div>
  );
}
