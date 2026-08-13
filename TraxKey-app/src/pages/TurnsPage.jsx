import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';

// Deliberately generalized: an annual long-term move-out turnover and a
// same-week short-term cleaning turn are the same lifecycle, only the
// timeline differs. One engine serves both inventory types.
const STAGES = [
  { value: 'vacancy_started', label: 'Vacancy started' },
  { value: 'inspecting', label: 'Inspecting' },
  { value: 'repairs_in_progress', label: 'Repairs in progress' },
  { value: 'ready', label: 'Ready' },
  { value: 'relisted', label: 'Relisted' },
  { value: 'occupied', label: 'Occupied' },
];

const STAGE_COLOR = {
  vacancy_started: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  inspecting: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  repairs_in_progress: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
  ready: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  relisted: 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
  occupied: 'bg-green-500/15 text-green-600 dark:text-green-400',
};

function StartTurnForm({ units, onCreated }) {
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await apiRequest('traxkey-start-turn', { method: 'POST', body: { unitId } });
      setUnitId('');
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err.message || 'Could not start turn');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
        + Start a turn
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm mb-1">Start a turn</p>
      <select required value={unitId} onChange={e => setUnitId(e.target.value)}
        className="w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400">
        <option value="">Select a unit…</option>
        {units.map(u => (
          <option key={u.id} value={u.id}>{u.propertyName}{u.unit_number ? ` — Unit ${u.unit_number}` : ''}</option>
        ))}
      </select>
      {error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2 rounded-lg transition disabled:opacity-50">
          {saving ? 'Starting…' : 'Start turn'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3">Cancel</button>
      </div>
    </form>
  );
}

function AddRepairForm({ turnId, onCreated, onClose }) {
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiRequest('traxkey-create-turn-repair', { method: 'POST', body: { turnId, description, urgency: 'routine' } });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message || 'Could not add repair');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 mt-3">
      <input required placeholder="What needs fixing?" value={description} onChange={e => setDescription(e.target.value)}
        className="flex-1 min-w-[200px] bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-teal-400" />
      <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50">
        {saving ? 'Adding…' : 'Add repair'}
      </button>
      <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-slate-900 dark:hover:text-white">Cancel</button>
      {error && <p className="text-xs text-red-500 dark:text-red-400 w-full">{error}</p>}
    </form>
  );
}

function deadlineInfo(turn) {
  if (!turn.deadline_at) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(turn.deadline_at + 'T00:00:00');
  const days = Math.round((due - today) / 86400000);

  if (days < 0) return { label: `Guest arrived ${-days}d ago`, tone: 'bg-red-500/15 text-red-600 dark:text-red-400' };
  if (days === 0) return { label: 'Next guest arrives TODAY', tone: 'bg-red-500/15 text-red-600 dark:text-red-400' };
  if (days === 1) return { label: 'Next guest arrives tomorrow', tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' };
  return { label: `${days} days until next guest`, tone: 'bg-slate-500/15 text-slate-500 dark:text-slate-400' };
}

function TurnCard({ turn, onChanged }) {
  const [addingRepair, setAddingRepair] = useState(false);
  const [advancing, setAdvancing] = useState(false);

  const stageIndex = STAGES.findIndex(s => s.value === turn.status);
  const nextStage = STAGES[stageIndex + 1];
  const isDone = turn.status === 'occupied';
  const deadline = deadlineInfo(turn);

  async function advance() {
    if (!nextStage) return;
    setAdvancing(true);
    try {
      await apiRequest('traxkey-advance-turn', { method: 'POST', body: { turnId: turn.id, newStatus: nextStage.value } });
      onChanged();
    } catch {
      setAdvancing(false);
    }
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-5 mb-3">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <p className="font-medium">{turn.property_name}{turn.unit_number ? ` — Unit ${turn.unit_number}` : ''}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            {isDone ? `${turn.days_vacant} days vacant` : `Day ${turn.days_vacant} of vacancy`}
            {turn.total_cost > 0 ? ` · $${Math.round(turn.total_cost)} in repairs` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {turn.turn_type === 'cleaning' && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-400">
              Cleaning
            </span>
          )}
          <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${STAGE_COLOR[turn.status]}`}>
            {turn.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>

      {deadline && !isDone && (
        <div className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full mt-2 ${deadline.tone}`}>
          {deadline.label}
        </div>
      )}
      {turn.auto_created && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2">
          Opened automatically from the booking calendar.
        </p>
      )}

      {turn.repairs.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {turn.repairs.map(r => (
            <div key={r.id} className="flex items-center gap-3 text-xs bg-slate-100 dark:bg-slate-950/40 rounded-lg px-3 py-2">
              <span className="flex-1">{r.description}</span>
              {r.final_cost && <span className="text-slate-400 dark:text-slate-500">${Math.round(r.final_cost)}</span>}
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{r.status.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}

      {addingRepair ? (
        <AddRepairForm turnId={turn.id} onCreated={onChanged} onClose={() => setAddingRepair(false)} />
      ) : (
        <div className="flex items-center gap-3 mt-3">
          {!isDone && (
            <button onClick={() => setAddingRepair(true)} className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-500">
              + Add repair
            </button>
          )}
          {nextStage && (
            <button onClick={advance} disabled={advancing}
              className="ml-auto bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50">
              {advancing ? 'Saving…' : `Move to ${nextStage.label}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TurnsPage() {
  const [turns, setTurns] = useState(null);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [turnsJson, propertiesJson] = await Promise.all([
        apiRequest('traxkey-get-turns'),
        apiRequest('traxkey-get-properties'),
      ]);
      setTurns(turnsJson.filter(t => t.id));
      setUnits(propertiesJson.filter(p => p.id).flatMap(p => p.units.map(u => ({ ...u, propertyName: p.name }))));
    } catch (err) {
      setError(err.message || 'Could not load turns');
    }
  }

  useEffect(() => { load(); }, []);

  const active = (turns || []).filter(t => t.status !== 'occupied');
  const avgDays = active.length
    ? Math.round(active.reduce((sum, t) => sum + t.days_vacant, 0) / active.length)
    : 0;

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Dashboard</Link>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Turns</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              Vacant to ready
              <FlowHelp
                title="How a turn works"
                steps={[
                  'Start a turn when a unit goes vacant, the unit is marked vacant and the days-vacant clock starts.',
                  'Inspect, then add each repair you find.',
                  'Every repair runs through the AI Coordinator: diagnosed, vendor matched, dispatched.',
                  'Mark ready when the work is done, that stops the clock.',
                  'Relist, then mark occupied when the next resident or guest moves in.',
                ]}
                note="Same flow for a long-term move-out and a short-term cleaning turn, only the timeline differs. Repair costs roll up automatically."
              />
            </h1>
          </div>
          <StartTurnForm units={units} onCreated={load} />
        </div>

        {active.length > 0 && (
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
              <p className="text-xs uppercase text-slate-400 dark:text-slate-500 mb-1">Turns in progress</p>
              <p className="text-2xl font-bold">{active.length}</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
              <p className="text-xs uppercase text-slate-400 dark:text-slate-500 mb-1">Avg days vacant</p>
              <p className="text-2xl font-bold text-amber-500 dark:text-amber-400">{avgDays}</p>
            </div>
          </div>
        )}

        <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
          One engine for both: a long-term move-out turnover and a short-term cleaning turn are the same cycle, vacant to ready. Every day counted here is a day not earning.
        </p>

        {error && <p className="text-sm text-red-500 dark:text-red-400 mb-4">{error}</p>}
        {!turns && !error && <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>}
        {turns && turns.length === 0 && (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-2xl p-8 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No turns yet. Start one when a unit goes vacant.</p>
          </div>
        )}
        {turns && turns.map(t => <TurnCard key={t.id} turn={t} onChanged={load} />)}
      </div>
    </div>
  );
}
