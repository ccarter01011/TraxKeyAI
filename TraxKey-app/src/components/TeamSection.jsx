import { useEffect, useState } from 'react';
import { apiRequest } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const ROLE_LABEL = { owner: 'Admin', ops_manager: 'Manager', staff: 'Staff' };
const fld = 'px-3 py-2 border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950 dark:text-white rounded-lg text-sm focus:outline-none focus:border-teal-400';

function RoleSelect({ value, onChange }) {
  return (
    <select value={value} onChange={onChange} className={fld}>
      <option value="staff">Staff</option>
      <option value="ops_manager">Manager</option>
      <option value="owner">Admin</option>
    </select>
  );
}

function AddUserForm({ onAdded }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const canSubmit = name.trim() !== '' && EMAIL_RE.test(email);

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true); setError(''); setSent(false);
    try {
      await apiRequest('team-add-user', { method: 'POST', body: { name, email, role } });
      setSent(true);
      setName(''); setEmail(''); setRole('staff');
      onAdded();
    } catch (err) {
      setError(err.message || 'Failed to send invite.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row sm:flex-wrap gap-2 mb-4">
      <input placeholder="Name" required value={name} onChange={e => setName(e.target.value)} className={`flex-1 ${fld}`} />
      <input type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} className={`flex-1 ${fld}`} />
      <RoleSelect value={role} onChange={e => setRole(e.target.value)} />
      <button type="submit" disabled={saving || !canSubmit}
        className="bg-teal-500 hover:bg-teal-400 disabled:opacity-40 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg whitespace-nowrap">
        {saving ? 'Sending…' : 'Invite'}
      </button>
      {error && <p className="text-red-600 dark:text-red-400 text-xs w-full">{error}</p>}
      {sent && <p className="text-green-600 dark:text-green-400 text-xs w-full">Invite sent! They'll get an email to set their password.</p>}
    </form>
  );
}

export default function TeamSection() {
  const { user } = useAuth();
  const isOwner = user?.role === 'owner';
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');

  function load() {
    apiRequest('team-list-users', { method: 'POST' })
      .then(j => setUsers(j.users || []))
      .catch(err => setError(err.message || 'Failed to load team.'));
  }

  useEffect(() => { load(); }, []);

  async function changeRole(userId, role) {
    try {
      await apiRequest('team-update-role', { method: 'POST', body: { userId, role } });
      load();
    } catch (err) {
      alert(err.message || 'Failed to update role.');
    }
  }

  async function remove(userId, name) {
    if (!confirm(`Remove ${name}'s access to this account?`)) return;
    try {
      await apiRequest('team-remove-user', { method: 'POST', body: { userId } });
      load();
    } catch (err) {
      alert(err.message || 'Failed to remove teammate.');
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5">
      <h2 className="font-bold mb-1 dark:text-white">Team</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        {isOwner ? 'Invite teammates and manage who has access to this account.' : 'People with access to this account.'}
      </p>

      {isOwner && <AddUserForm onAdded={load} />}

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</p>}
      {!users && !error && <p className="text-slate-500 dark:text-slate-400 text-sm">Loading…</p>}

      {users && (
        <div className="space-y-2">
          {users.map(u => {
            const isSelf = user?.email && u.email?.toLowerCase() === user.email.toLowerCase();
            return (
              <div key={u.id} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium dark:text-white">
                    {u.name}
                    {isSelf && <span className="text-slate-400 font-normal"> (you)</span>}
                    {u.is_pending && (
                      <span className="ml-2 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 align-middle">Pending Invite</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{u.email}</p>
                </div>
                {isOwner && !isSelf ? (
                  <div className="flex items-center gap-2">
                    <RoleSelect value={u.role} onChange={e => changeRole(u.id, e.target.value)} />
                    <button onClick={() => remove(u.id, u.name)} className="text-red-600 dark:text-red-400 hover:underline text-xs">Remove</button>
                  </div>
                ) : (
                  <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{ROLE_LABEL[u.role] || u.role}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
