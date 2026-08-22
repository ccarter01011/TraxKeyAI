import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiRequest } from '../lib/api.js';
import FlowHelp from '../components/FlowHelp.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

const RULE_TYPES = [
  { value: 'approval_threshold', label: 'Approval threshold', valueLabel: 'Dollar amount', placeholder: '200', valueType: 'number' },
  { value: 'always_require_approval', label: 'Always require my approval', valueLabel: '(no value needed)', placeholder: '', valueType: 'fixed_true' },
  { value: 'quiet_hours', label: 'Quiet hours (no auto-dispatch)', valueLabel: 'Window, e.g. 20:00-07:00', placeholder: '20:00-07:00', valueType: 'text' },
  { value: 'preferred_vendor', label: 'Preferred vendor', valueLabel: 'Vendor', placeholder: '', valueType: 'vendor' },
];

const SCOPES = [
  { value: 'global', label: 'Everywhere' },
  { value: 'trade', label: 'A specific trade' },
  { value: 'property', label: 'A specific property' },
  { value: 'unit', label: 'A specific unit' },
];

const TRADES = ['hvac', 'plumbing', 'electrical', 'appliance', 'general', 'pest', 'locksmith', 'roofing', 'cleaning'];

function RULE_TYPE_LABEL(t) { return RULE_TYPES.find(r => r.value === t)?.label || t; }
function SCOPE_LABEL(s) { return SCOPES.find(x => x.value === s)?.label || s; }

function AddRuleForm({ units, vendors, onCreated }) {
  const [open, setOpen] = useState(false);
  const [ruleType, setRuleType] = useState('approval_threshold');
  const [scope, setScope] = useState('global');
  const [scopeRef, setScopeRef] = useState('');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const meta = RULE_TYPES.find(r => r.value === ruleType);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (scope !== 'global' && !scopeRef) {
      setError('Pick what this rule applies to.');
      return;
    }
    const finalValue = meta.valueType === 'fixed_true' ? 'true' : value;
    if (!finalValue) {
      setError('This rule needs a value.');
      return;
    }
    setSaving(true);
    try {
      await apiRequest('traxkey-set-business-memory', {
        method: 'POST',
        body: { ruleType, scope, scopeRef: scope === 'global' ? '' : scopeRef, value: finalValue, note },
      });
      setRuleType('approval_threshold'); setScope('global'); setScopeRef(''); setValue(''); setNote('');
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(err.message || 'Could not save that rule');
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
        + Add rule
      </button>
    );
  }

  const field = 'w-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-teal-400';

  return (
    <form onSubmit={submit} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-2xl p-5 space-y-3 mb-6">
      <p className="font-bold text-sm mb-1">New rule</p>

      <select value={ruleType} onChange={e => { setRuleType(e.target.value); setValue(''); }} className={field}>
        {RULE_TYPES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>

      <div className="grid grid-cols-2 gap-3">
        <select value={scope} onChange={e => { setScope(e.target.value); setScopeRef(''); }} className={field}>
          {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>

        {scope === 'trade' && (
          <select required value={scopeRef} onChange={e => setScopeRef(e.target.value)} className={field}>
            <option value="">Which trade…</option>
            {TRADES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {scope === 'property' && (
          <select required value={scopeRef} onChange={e => setScopeRef(e.target.value)} className={field}>
            <option value="">Which property…</option>
            {[...new Map(units.map(u => [u.propertyId, u.propertyName])).entries()].map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
        {scope === 'unit' && (
          <select required value={scopeRef} onChange={e => setScopeRef(e.target.value)} className={field}>
            <option value="">Which unit…</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>{u.propertyName}{u.unit_number ? ` — Unit ${u.unit_number}` : ''}</option>
            ))}
          </select>
        )}
      </div>

      {meta.valueType === 'number' && (
        <input required type="number" min="0" placeholder={meta.placeholder} value={value} onChange={e => setValue(e.target.value)} className={field} />
      )}
      {meta.valueType === 'text' && (
        <input required placeholder={meta.placeholder} value={value} onChange={e => setValue(e.target.value)} className={field} />
      )}
      {meta.valueType === 'vendor' && (
        <select required value={value} onChange={e => setValue(e.target.value)} className={field}>
          <option value="">Which vendor…</option>
          {vendors.map(v => <option key={v.id} value={v.id}>{v.name} ({v.trade})</option>)}
        </select>
      )}

      <input placeholder="Note (optional, why you set this)" value={note} onChange={e => setNote(e.target.value)} className={field} />

      {error && <p className="text-xs text-red-500">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button disabled={saving} type="submit" className="bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-slate-950 font-bold text-sm px-4 py-2.5 rounded-lg transition">
          {saving ? 'Saving…' : 'Save rule'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3">
          Cancel
        </button>
      </div>
    </form>
  );
}

function RuleRow({ rule, vendors, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const vendorName = rule.rule_type === 'preferred_vendor'
    ? vendors.find(v => v.id === rule.value)?.name || 'a vendor no longer on file'
    : null;

  async function remove() {
    setDeleting(true);
    try {
      await apiRequest('traxkey-delete-business-memory', { method: 'POST', body: { ruleId: rule.id } });
      onDeleted();
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="flex items-start justify-between gap-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold">{RULE_TYPE_LABEL(rule.rule_type)}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          {SCOPE_LABEL(rule.scope)}{rule.scope_ref ? ` — ${rule.scope_ref}` : ''}
          {rule.rule_type === 'approval_threshold' && ` · $${rule.value}`}
          {rule.rule_type === 'quiet_hours' && ` · ${rule.value}`}
          {rule.rule_type === 'preferred_vendor' && ` · ${vendorName}`}
        </p>
        {rule.note && <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 italic">"{rule.note}"</p>}
      </div>
      <button onClick={remove} disabled={deleting} className="shrink-0 text-xs text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition disabled:opacity-50">
        {deleting ? '…' : 'Remove'}
      </button>
    </div>
  );
}

export default function BusinessMemoryPage() {
  const [rules, setRules] = useState(null);
  const [units, setUnits] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [error, setError] = useState('');

  async function load() {
    try {
      const [rulesJson, propertiesJson, vendorsJson] = await Promise.all([
        apiRequest('traxkey-get-business-memory'),
        apiRequest('traxkey-get-properties'),
        apiRequest('traxkey-get-vendors'),
      ]);
      setRules(rulesJson.filter(r => r.id));
      setUnits(propertiesJson.filter(p => p.id).flatMap(p =>
        p.units.map(u => ({ ...u, propertyName: p.name, propertyId: p.id }))));
      setVendors((vendorsJson || []).filter(v => v.id));
    } catch (err) {
      setError(err.message || 'Could not load business memory');
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between lg:hidden">
          <Link to="/" className="text-xs text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white">← Operator Dashboard</Link>
          <ThemeToggle />
        </div>
        <div className="flex items-center justify-between mb-6 mt-2">
          <div>
            <p className="text-xs text-teal-600 dark:text-teal-400 font-semibold uppercase tracking-wide mb-1">Business Memory</p>
            <h1 className="text-2xl font-bold inline-flex items-center gap-2">
              Rules the AI follows
              <FlowHelp
                title="How Business Memory works"
                steps={[
                  'Set a rule: an approval threshold, quiet hours, a preferred vendor, or "always ask me."',
                  'Scope it as broad or narrow as you want: everywhere, one trade, one property, or one unit.',
                  'The most specific rule that applies wins. A unit-level rule beats a trade-level rule, which beats a global one.',
                  'The AI applies these before and after every decision. It never infers a new rule from your behavior and applies it on its own, only what you set here.',
                ]}
                note='This is what "the AI learns your business" means: rules you set, stored here, applied every time. Not the AI guessing at patterns and acting on its own.'
              />
            </h1>
          </div>
          <AddRuleForm units={units} vendors={vendors} onCreated={load} />
        </div>

        {error && <p className="text-sm text-red-500 mb-4">{error}</p>}

        {!rules ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">Loading…</p>
        ) : rules.length === 0 ? (
          <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-white/5 rounded-xl p-8 text-center">
            <p className="text-sm font-bold mb-1">No rules set yet</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              The AI uses your account's approval threshold until you add a rule here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map(r => <RuleRow key={r.id} rule={r} vendors={vendors} onDeleted={load} />)}
          </div>
        )}
      </div>
    </div>
  );
}
