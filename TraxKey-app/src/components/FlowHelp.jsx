import { useState } from 'react';

/**
 * "How this works" hover. Shows customers the actual logic behind a flow,
 * in plain language, at the exact page where that flow runs.
 *
 * Doubles as a trust feature: as the AI starts spending money on their
 * behalf, being able to see the decision path is the thing that makes an
 * operator comfortable turning autonomy on. Kept in sync with LOGIC-FLOWS.md.
 */
export default function FlowHelp({ title, steps, note }) {
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-block">
      <button
        type="button"
        aria-label={title}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen(v => !v)}
        className="w-5 h-5 rounded-full border border-slate-300 dark:border-white/20 text-slate-400 dark:text-slate-500 hover:border-teal-400 hover:text-teal-500 dark:hover:text-teal-400 text-xs font-bold transition inline-flex items-center justify-center align-middle"
      >
        ?
      </button>

      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-7 z-50 w-80 max-w-[calc(100vw-3rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl p-4 shadow-xl text-left block"
        >
          <span className="block text-xs font-bold text-teal-600 dark:text-teal-400 uppercase tracking-wide mb-2">
            {title}
          </span>
          <span className="block space-y-1.5">
            {steps.map((s, i) => (
              <span key={i} className="flex items-start gap-2 text-xs">
                <span className="text-teal-500 dark:text-teal-400 shrink-0 font-mono">
                  {i === steps.length - 1 ? '└' : '├'}
                </span>
                <span className="text-slate-600 dark:text-slate-300">{s}</span>
              </span>
            ))}
          </span>
          {note && (
            <span className="block text-[11px] text-slate-400 dark:text-slate-500 mt-3 pt-3 border-t border-slate-200 dark:border-white/10">
              {note}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
