import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import { useAuth } from '../lib/AuthContext.jsx';

const fld = 'w-full px-3 py-2 border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-slate-950 dark:text-white rounded-lg text-sm focus:outline-none focus:border-teal-400';
const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5';
const label = 'text-xs font-semibold text-slate-500 dark:text-slate-400 block mb-1';
const btn = 'bg-slate-900 dark:bg-teal-500 text-white dark:text-slate-950 font-semibold px-5 py-2.5 rounded-lg disabled:opacity-50 transition-all active:scale-95 duration-150 text-sm';

function InfoCard() {
  const { updateUserName } = useAuth();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiRequest('my-profile', { method: 'POST' })
      .then(j => setForm({ name: j.name || '', phone: j.phone || '', email: j.email || '', role: j.role || '' }))
      .catch(err => setError(err.message || 'Failed to load profile.'))
      .finally(() => setLoading(false));
  }, []);

  function update(field, value) {
    setForm(f => ({ ...f, [field]: value }));
    setSaved(false);
  }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setError(''); setSaved(false);
    try {
      await apiRequest('update-my-profile', { method: 'POST', body: { name: form.name, phone: form.phone } });
      updateUserName(form.name);
      setSaved(true);
    } catch (err) {
      setError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className={card}><p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p></div>;
  if (!form) return <div className={card}><p className="text-sm text-red-500">{error}</p></div>;

  return (
    <div className={card}>
      <h2 className="font-bold mb-1 dark:text-white">Your Info</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
        {form.email} · <span className="capitalize">{form.role.replace('_', ' ')}</span>
      </p>
      <form onSubmit={save} className="space-y-3">
        <div>
          <label className={label}>Name</label>
          <input required value={form.name} onChange={e => update('name', e.target.value)} className={fld} />
        </div>
        <div>
          <label className={label}>Phone (optional)</label>
          <input type="tel" value={form.phone} onChange={e => update('phone', e.target.value)} placeholder="e.g. (555) 123-4567" className={fld} />
        </div>
        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        {saved && <p className="text-green-600 dark:text-green-400 text-sm">Saved!</p>}
        <button type="submit" disabled={saving} className={btn}>{saving ? 'Saving…' : 'Save Changes'}</button>
      </form>
    </div>
  );
}

function ChangeEmailCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail);
  const canSubmit = currentPassword && emailValid;

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      await apiRequest('traxkey-change-email', { method: 'POST', body: { currentPassword, newEmail } });
      setSaved(true);
      setCurrentPassword(''); setNewEmail('');
    } catch (err) {
      setError(err.message || 'That email may already be in use.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={card}>
      <h2 className="font-bold mb-1 dark:text-white">Change Login Email</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">This is the email you log in with.</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>New Email</label>
          <input type="email" required value={newEmail} onChange={e => setNewEmail(e.target.value)} className={fld} />
          {newEmail && !emailValid && <p className="text-red-600 text-xs mt-1">Enter a valid email address.</p>}
        </div>
        <div>
          <label className={label}>Current Password</label>
          <input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className={fld} />
        </div>
        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        {saved && <p className="text-green-600 dark:text-green-400 text-sm">Email updated! Use it next time you log in.</p>}
        <button type="submit" disabled={!canSubmit || saving} className={btn}>{saving ? 'Saving…' : 'Change Email'}</button>
      </form>
    </div>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const passwordsMatch = newPassword && newPassword === confirmPassword;
  const canSubmit = currentPassword && newPassword.length >= 8 && passwordsMatch;

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true); setError(''); setSaved(false);
    try {
      await apiRequest('traxkey-change-password', { method: 'POST', body: { currentPassword, newPassword } });
      setSaved(true);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Failed to change password. Check your current password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={card}>
      <h2 className="font-bold mb-1 dark:text-white">Change Password</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Update the password you use to log in.</p>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label className={label}>Current Password</label>
          <input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className={fld} />
        </div>
        <div>
          <label className={label}>New Password</label>
          <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className={fld} />
          {newPassword && newPassword.length < 8 && <p className="text-red-600 text-xs mt-1">Must be at least 8 characters.</p>}
        </div>
        <div>
          <label className={label}>Confirm New Password</label>
          <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={fld} />
          {confirmPassword && !passwordsMatch && <p className="text-red-600 text-xs mt-1">Passwords don't match.</p>}
        </div>
        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        {saved && <p className="text-green-600 dark:text-green-400 text-sm">Password updated!</p>}
        <button type="submit" disabled={!canSubmit || saving} className={btn}>{saving ? 'Saving…' : 'Change Password'}</button>
      </form>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-lg mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="mt-2 mb-6">
          <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Your Account</p>
          <h1 className="text-2xl font-bold">Profile</h1>
        </div>
        <div className="space-y-5">
          <InfoCard />
          <ChangeEmailCard />
          <ChangePasswordCard />
        </div>
      </div>
    </div>
  );
}
