import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { apiRequest } from '../lib/api.js';

const TENANT_PORTAL_BASE = 'https://tenant.traxkey.ai';

function TenantPortalLink() {
  const [profile, setProfile] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    apiRequest('traxkey-company-profile').then(setProfile).catch(() => {});
  }, []);

  if (!profile) return null;

  const link = `${TENANT_PORTAL_BASE}/?co=${profile.portal_slug}`;

  function copy() {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="bg-teal-500/10 border border-teal-400/20 rounded-xl p-4 mb-6">
      <p className="text-xs font-bold text-teal-300 uppercase tracking-wide mb-1">Your resident maintenance link</p>
      <p className="text-sm text-slate-300 mb-3">Share this with residents so they can report issues straight into TraxKey AI.</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-slate-950 border border-white/10 rounded-lg px-3 py-2 text-xs text-teal-300 overflow-x-auto whitespace-nowrap">{link}</code>
        <button onClick={copy} className="shrink-0 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-2 rounded-lg transition">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs text-teal-400 font-semibold uppercase tracking-wide mb-1">Dashboard</p>
            <h1 className="text-2xl font-bold">Welcome, {user?.name || 'there'}</h1>
          </div>
          <button onClick={logout} className="text-sm text-slate-400 hover:text-white">Log out</button>
        </div>

        <TenantPortalLink />

        <Link to="/properties" className="block bg-slate-900 border border-white/5 rounded-2xl p-6 hover:border-teal-400/30 transition mb-4">
          <p className="font-bold mb-1">Properties &amp; units →</p>
          <p className="text-sm text-slate-400">Add your properties and units, this is what TraxKey AI's agents monitor and act on.</p>
        </Link>

        <div className="bg-slate-900 border border-white/5 rounded-2xl p-6">
          <p className="text-sm text-slate-400">
            The AI Maintenance Coordinator activity feed and vendor scorecard land here next.
          </p>
        </div>
      </div>
    </div>
  );
}
