import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';

const SOURCES = [
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'vrbo', label: 'Vrbo' },
  { value: 'booking', label: 'Booking.com' },
  { value: 'direct', label: 'Direct / own site' },
  { value: 'other', label: 'Other' },
];

function AddCalendarForm({ units, onCreated }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ unitId: '', source: 'airbnb', icalUrl: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function update(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiRequest('traxkey-add-calendar', { method: 'POST', body: form });
      setForm({ unitId: '', source: 'airbnb', icalUrl: '' });
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err.message || 'Could not add calendar');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
        + Connect calendar
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm mb-1">Connect a booking calendar</p>
      <select required value={form.unitId} onChange={update('unitId')}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400">
        <option value="">Select a unit…</option>
        {units.map(u => (
          <option key={u.id} value={u.id}>{u.propertyName}{u.unit_number ? ` — Unit ${u.unit_number}` : ''}</option>
        ))}
      </select>
      <select value={form.source} onChange={update('source')}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400">
        {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
      </select>
      <input required type="url" placeholder="https://www.airbnb.com/calendar/ical/12345.ics?s=…" value={form.icalUrl} onChange={update('icalUrl')}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400" />
      <p className="text-xs text-slate-400 dark:text-slate-500">
        In Airbnb: Calendar → Availability → Connect to another website → Export calendar. Vrbo and Booking.com have the same under calendar sync settings.
      </p>
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg transition disabled:opacity-50">
          {saving ? 'Connecting…' : 'Connect'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3">Cancel</button>
      </div>
      {units.length === 0 && <p className="text-xs text-amber-500 dark:text-amber-400">No units yet, add a property and unit first.</p>}
    </form>
  );
}

function CalendarRow({ calendar, onChanged }) {
  const [removing, setRemoving] = useState(false);

  async function remove() {
    setRemoving(true);
    try {
      await apiRequest('traxkey-delete-calendar', { method: 'POST', body: { calendarId: calendar.id } });
      onChanged();
    } catch {
      setRemoving(false);
    }
  }

  const synced = calendar.last_synced_at
    ? new Date(calendar.last_synced_at).toLocaleString()
    : 'not yet';

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-4 mb-3">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <p className="font-medium">
            {calendar.property_name}{calendar.unit_number ? ` — Unit ${calendar.unit_number}` : ''}
          </p>
          <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{calendar.ical_url}</p>
        </div>
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-400">
          {calendar.source}
        </span>
      </div>

      <div className="flex items-center gap-3 mt-2 flex-wrap">
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {calendar.upcoming_bookings} upcoming · last synced {synced}
        </span>
        <button onClick={remove} disabled={removing}
          className="ml-auto text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition disabled:opacity-50">
          {removing ? 'Removing…' : 'Remove'}
        </button>
      </div>

      {calendar.last_sync_error && (
        <p className="text-xs text-red-500 dark:text-red-400 mt-2">Last sync failed: {calendar.last_sync_error}</p>
      )}
    </div>
  );
}

export default function CalendarsPage() {
  const [calendars, setCalendars] = useState(null);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [calendarsJson, propertiesJson] = await Promise.all([
        apiRequest('traxkey-get-calendars'),
        apiRequest('traxkey-get-properties'),
      ]);
      setCalendars(calendarsJson.filter(c => c.id));
      setUnits(
        propertiesJson.filter(p => p.id).flatMap(p => p.units.map(u => ({ ...u, propertyName: p.name })))
      );
    } catch (err) {
      setError(err.message || 'Could not load calendars');
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Booking calendars</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              Short-term rental sync
              <FlowHelp
                title="How calendar sync works"
                steps={[
                  'Paste the unit\'s export link from Airbnb, Vrbo, or Booking.com.',
                  'TraxKey checks it hourly for new bookings and cancellations.',
                  'Real reservations count as occupancy, owner-side blocks don\'t.',
                  'The AI uses this to judge urgency: a guest in the unit changes what counts as an emergency.',
                ]}
                note="Read-only. TraxKey never changes your listing or your bookings. You can revoke the link any time from the platform."
              />
            </h1>
          </div>
          <AddCalendarForm units={units} onCreated={load} />
        </div>

        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          Connect a unit's Airbnb or Vrbo calendar and TraxKey knows when someone's actually staying there.
          A broken AC with a guest in the unit gets treated differently than the same issue in a unit that's empty for two weeks.
        </p>

        {error && <p className="text-sm text-red-500 dark:text-red-400 mb-4">{error}</p>}
        {!calendars && !error && <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>}
        {calendars && calendars.length === 0 && (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No calendars connected yet. Long-term units don't need one, this is for short-term rentals.</p>
          </div>
        )}
        {calendars && calendars.map(c => <CalendarRow key={c.id} calendar={c} onChanged={load} />)}
      </div>
    </div>
  );
}
