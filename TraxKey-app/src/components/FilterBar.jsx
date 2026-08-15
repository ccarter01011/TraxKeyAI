import { useMemo, useState } from 'react';

const fld = 'bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-teal-400';

/**
 * Client-side filter bar: status dropdown, date range, free-text search.
 * All filtering happens in memory against the already-loaded list, there is
 * nothing worth paginating server-side yet at this scale, and doing it
 * client-side means results update instantly with no request in flight.
 *
 * statusOptions: [{value, label}]. Pass [] to hide the status dropdown.
 * searchPlaceholder: pass null to hide the search input.
 * onChange({status, from, to, q}) fires on every change.
 */
export default function FilterBar({ statusOptions = [], searchPlaceholder = 'Search…', onChange, extra }) {
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');

  function emit(next) {
    const state = { status, from, to, q, ...next };
    setStatus(state.status); setFrom(state.from); setTo(state.to); setQ(state.q);
    onChange(state);
  }

  const active = status || from || to || q;

  function clear() {
    emit({ status: '', from: '', to: '', q: '' });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      {searchPlaceholder !== null && (
        <input
          value={q} onChange={e => emit({ q: e.target.value })}
          placeholder={searchPlaceholder}
          className={`${fld} flex-1 min-w-[140px]`}
        />
      )}
      {statusOptions.length > 0 && (
        <select value={status} onChange={e => emit({ status: e.target.value })} className={fld}>
          <option value="">All statuses</option>
          {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
      <label className="flex items-center gap-1.5 text-xs text-slate-400">
        From
        <input type="date" value={from} onChange={e => emit({ from: e.target.value })} className={fld} />
      </label>
      <label className="flex items-center gap-1.5 text-xs text-slate-400">
        To
        <input type="date" value={to} onChange={e => emit({ to: e.target.value })} className={fld} />
      </label>
      {extra}
      {active && (
        <button onClick={clear} className="text-xs text-slate-400 hover:text-slate-900 dark:hover:text-white underline">
          Clear filters
        </button>
      )}
    </div>
  );
}

/**
 * Shared matching logic so every page filters the same way. dateField is
 * read as a plain date (YYYY-MM-DD prefix), so a full timestamp still
 * compares correctly against a date-only range picker.
 */
export function useFiltered(items, filters, { statusField = 'status', dateField, searchFields = [] } = {}) {
  return useMemo(() => {
    if (!items) return items;
    const { status, from, to, q } = filters;
    const query = (q || '').trim().toLowerCase();
    return items.filter(item => {
      if (status && item[statusField] !== status) return false;
      if (dateField && (from || to)) {
        const raw = item[dateField];
        if (!raw) return false;
        const d = String(raw).slice(0, 10);
        if (from && d < from) return false;
        if (to && d > to) return false;
      }
      if (query) {
        const hit = searchFields.some(f => String(item[f] || '').toLowerCase().includes(query));
        if (!hit) return false;
      }
      return true;
    });
  }, [items, filters, statusField, dateField, searchFields]);
}
