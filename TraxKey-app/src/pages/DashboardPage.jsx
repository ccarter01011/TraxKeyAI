import { useAuth } from '../lib/AuthContext.jsx';

export default function DashboardPage() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 px-6 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <p className="text-xs text-teal-400 font-semibold uppercase tracking-wide mb-1">Dashboard</p>
            <h1 className="text-2xl font-bold">Welcome, {user?.name || 'there'}</h1>
          </div>
          <button onClick={logout} className="text-sm text-slate-400 hover:text-white">Log out</button>
        </div>
        <div className="bg-slate-900 border border-white/5 rounded-2xl p-6">
          <p className="text-sm text-slate-400">
            Properties, units, vendors, and the AI Maintenance Coordinator activity feed land here next.
          </p>
        </div>
      </div>
    </div>
  );
}
