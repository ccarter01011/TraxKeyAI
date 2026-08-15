import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';
import FilterBar, { useFiltered } from '../components/FilterBar.jsx';

const STATUS_OPTIONS = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
];

const TYPES = [
  { value: 'move_in', label: 'Move-in' },
  { value: 'move_out', label: 'Move-out' },
  { value: 'periodic', label: 'Periodic' },
  { value: 'turn', label: 'Turn' },
];

const CONDITIONS = [
  { value: 'good', label: 'Good', cls: 'bg-green-500/15 text-green-600 dark:text-green-400' },
  { value: 'fair', label: 'Fair', cls: 'bg-teal-500/15 text-teal-600 dark:text-teal-400' },
  { value: 'poor', label: 'Poor', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' },
  { value: 'damaged', label: 'Damaged', cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  { value: 'missing', label: 'Missing', cls: 'bg-red-500/15 text-red-600 dark:text-red-400' },
];

// Ordered worst to best, matching agents/inspection_compare.py. Kept in sync
// deliberately: the page must rank a change the same way the backend does.
const RANK = { missing: 0, damaged: 1, poor: 2, fair: 3, good: 4 };

function condMeta(c) { return CONDITIONS.find(x => x.value === c) || CONDITIONS[0]; }
function typeLabel(t) { return TYPES.find(x => x.value === t)?.label || t; }

function StartInspectionForm({ units, onCreated }) {
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState('');
  const [inspectionType, setInspectionType] = useState('move_in');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      await apiRequest('traxkey-start-inspection', {
        method: 'POST', body: { unitId, inspectionType, notes },
      });
      setUnitId(''); setNotes(''); setOpen(false);
      onCreated();
    } catch (err) {
      setError(err.message || 'Could not start that inspection');
    } finally { setSaving(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
        + Start inspection
      </button>
    );
  }

  const field = 'w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400';
  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm mb-1">New inspection</p>
      <select required value={unitId} onChange={e => setUnitId(e.target.value)} className={field}>
        <option value="">Select a unit…</option>
        {units.map(u => (
          <option key={u.id} value={u.id}>{u.propertyName}{u.unit_number ? ` — Unit ${u.unit_number}` : ''}</option>
        ))}
      </select>
      <select value={inspectionType} onChange={e => setInspectionType(e.target.value)} className={field}>
        {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <input placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} className={field} />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
          {saving ? 'Starting…' : 'Start'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3">Cancel</button>
      </div>
    </form>
  );
}

function AddItemForm({ inspectionId, onAdded }) {
  const [area, setArea] = useState('');
  const [item, setItem] = useState('');
  const [condition, setCondition] = useState('good');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setError(''); setSaving(true);
    try {
      await apiRequest('traxkey-add-inspection-item', {
        method: 'POST', body: { inspectionId, area, item, condition, notes },
      });
      setItem(''); setNotes(''); setCondition('good');
      onAdded();
    } catch (err) {
      setError(err.message || 'Could not add that');
    } finally { setSaving(false); }
  }

  const f = 'bg-white dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-teal-400';
  return (
    <form onSubmit={submit} className="mt-3 pt-3 border-t border-slate-200 dark:border-white/5 flex flex-wrap items-center gap-2">
      <input required placeholder="Area (Kitchen)" value={area} onChange={e => setArea(e.target.value)} className={`${f} w-32`} />
      <input required placeholder="Item (Countertops)" value={item} onChange={e => setItem(e.target.value)} className={`${f} w-36`} />
      <select value={condition} onChange={e => setCondition(e.target.value)} className={f}>
        {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>
      <input placeholder="Notes" value={notes} onChange={e => setNotes(e.target.value)} className={`${f} flex-1 min-w-[120px]`} />
      <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50">
        {saving ? '…' : 'Add'}
      </button>
      {error && <span className="text-xs text-red-500 w-full">{error}</span>}
    </form>
  );
}

/**
 * Compares the most recent completed move-in against the most recent
 * completed move-out for a unit. Mirrors agents/inspection_compare.py
 * exactly, including its central limit: it reports what changed, never
 * whether a change is chargeable. That call is a person's, and it has legal
 * consequences that vary by state.
 */
function Comparison({ inspections, unitId }) {
  const done = inspections.filter(i => i.unit_id === unitId && i.status === 'completed');
  const moveIn = done.filter(i => i.inspection_type === 'move_in')[0];
  const moveOut = done.filter(i => i.inspection_type === 'move_out')[0];
  if (!moveIn || !moveOut) return null;

  const before = new Map();
  (moveIn.items || []).forEach(it => before.set(`${it.area.trim().toLowerCase()}|${it.item.trim().toLowerCase()}`, it));

  const changes = [];
  const newItems = [];
  (moveOut.items || []).forEach(it => {
    const b = before.get(`${it.area.trim().toLowerCase()}|${it.item.trim().toLowerCase()}`);
    if (!b) { newItems.push(it); return; }
    const steps = RANK[b.condition] - RANK[it.condition];
    if (steps > 0) changes.push({ ...it, before: b.condition, steps });
  });
  changes.sort((a, b) => b.steps - a.steps);

  if (!changes.length && !newItems.length) {
    return (
      <div className="bg-green-500/10 border border-green-400/20 rounded-xl p-4 mb-4">
        <p className="text-sm font-bold text-green-700 dark:text-green-400">No condition changes</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Everything recorded at move-in is in the same or better shape at move-out.</p>
      </div>
    );
  }

  return (
    <div className="bg-amber-500/10 border border-amber-400/20 rounded-xl p-4 mb-4">
      <p className="text-sm font-bold text-amber-700 dark:text-amber-400 mb-2">Move-in vs move-out</p>
      <div className="space-y-1.5">
        {changes.map((c, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="flex-1">{c.area} / {c.item}</span>
            <span className={`px-1.5 py-0.5 rounded ${condMeta(c.before).cls}`}>{condMeta(c.before).label}</span>
            <span className="text-slate-400">→</span>
            <span className={`px-1.5 py-0.5 rounded ${condMeta(c.condition).cls}`}>{condMeta(c.condition).label}</span>
          </div>
        ))}
        {newItems.map((n, i) => (
          <div key={`n${i}`} className="flex items-center gap-2 text-xs">
            <span className="flex-1 text-slate-500 dark:text-slate-400">{n.area} / {n.item}</span>
            <span className="text-slate-400 dark:text-slate-500">not recorded at move-in</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-3 leading-relaxed">
        TraxKey records what changed. Whether any of it is beyond normal wear, and what
        may be withheld from a deposit, is your decision and your state's rules, not
        something this software decides.
      </p>
    </div>
  );
}

function InspectionCard({ inspection, onChanged }) {
  const [expanded, setExpanded] = useState(false);
  const [completing, setCompleting] = useState(false);
  const isDone = inspection.status === 'completed';

  async function complete() {
    setCompleting(true);
    try {
      await apiRequest('traxkey-complete-inspection', { method: 'POST', body: { inspectionId: inspection.id } });
      onChanged();
    } catch { setCompleting(false); }
  }

  return (
    <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
      <button onClick={() => setExpanded(v => !v)} className="w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold">
              {typeLabel(inspection.inspection_type)} — {inspection.property_name}
              {inspection.unit_number ? ` Unit ${inspection.unit_number}` : ''}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {(inspection.items || []).length} item{(inspection.items || []).length === 1 ? '' : 's'}
              {' · '}{new Date(inspection.created_at).toLocaleDateString()}
            </p>
          </div>
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
            isDone ? 'bg-green-500/15 text-green-600 dark:text-green-400' : 'bg-sky-500/15 text-sky-600 dark:text-sky-400'}`}>
            {isDone ? 'Completed' : 'In progress'}
          </span>
        </div>
      </button>

      {expanded && (
        <>
          {(inspection.items || []).length > 0 && (
            <div className="mt-3 space-y-1">
              {inspection.items.map(it => (
                <div key={it.id} className="flex items-center gap-2 text-xs py-0.5">
                  <span className="flex-1">{it.area} / {it.item}</span>
                  {it.notes && <span className="text-slate-400 dark:text-slate-500 truncate max-w-[140px]">{it.notes}</span>}
                  <span className={`px-1.5 py-0.5 rounded ${condMeta(it.condition).cls}`}>{condMeta(it.condition).label}</span>
                </div>
              ))}
            </div>
          )}
          {!isDone && <AddItemForm inspectionId={inspection.id} onAdded={onChanged} />}
          {!isDone && (inspection.items || []).length > 0 && (
            <button onClick={complete} disabled={completing}
              className="mt-3 bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition disabled:opacity-50">
              {completing ? 'Saving…' : 'Mark complete'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default function InspectionsPage() {
  const [inspections, setInspections] = useState(null);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', from: '', to: '', q: '' });
  const filtered = useFiltered(inspections, filters, {
    dateField: 'created_at',
    searchFields: ['property_name', 'unit_number', 'inspection_type'],
  });

  async function load() {
    try {
      const [insp, props] = await Promise.all([
        apiRequest('traxkey-get-inspections'),
        apiRequest('traxkey-get-properties'),
      ]);
      setInspections(insp.filter(i => i.id));
      setUnits(props.filter(p => p.id).flatMap(p => p.units.map(u => ({ ...u, propertyName: p.name }))));
    } catch (err) {
      setError(err.message || 'Could not load inspections');
    }
  }

  useEffect(() => { load(); }, []);

  const unitsWithBoth = [...new Set((inspections || []).map(i => i.unit_id))].filter(uid => {
    const done = (inspections || []).filter(i => i.unit_id === uid && i.status === 'completed');
    return done.some(i => i.inspection_type === 'move_in') && done.some(i => i.inspection_type === 'move_out');
  });

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Inspections</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              Condition records
              <FlowHelp
                title="How inspections work"
                steps={[
                  'Start an inspection: move-in, move-out, periodic, or as part of a turn.',
                  'Add each area and item you check with its condition. Your own items, not a fixed checklist, since a studio and a four bedroom do not have the same rooms.',
                  'Mark it complete when you are done.',
                  'Once a unit has a completed move-in and move-out, TraxKey shows exactly what changed between them, worst first.',
                ]}
                note="TraxKey records condition and shows what changed. It never decides whether something is beyond normal wear or what may be withheld from a deposit, that is your call and your state's rules."
              />
            </h1>
          </div>
          <StartInspectionForm units={units} onCreated={load} />
        </div>

        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

        {unitsWithBoth.map(uid => <Comparison key={uid} inspections={inspections} unitId={uid} />)}

        {!inspections ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        ) : inspections.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
            <p className="text-sm font-bold mb-1">No inspections yet</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Record a move-in before a resident takes possession. Without it there is nothing to compare a move-out against.
            </p>
          </div>
        ) : (
          <>
            <FilterBar
              statusOptions={STATUS_OPTIONS}
              searchPlaceholder="Search property, unit, type…"
              onChange={setFilters}
            />
            {filtered.length === 0 ? (
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">Nothing matches those filters.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filtered.map(i => <InspectionCard key={i.id} inspection={i} onChanged={load} />)}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
