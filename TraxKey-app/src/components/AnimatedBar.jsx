import { useEffect, useRef, useState } from 'react';

function usePrefersReducedMotion() {
  const [reduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  return reduced;
}

/** Shared trigger: true once, the first time the ref'd element scrolls into
 * view (or immediately, under reduced motion / no IntersectionObserver). */
export function useInView() {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced || !ref.current || !('IntersectionObserver' in window)) { setShown(true); return; }
    const io = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { setShown(true); io.disconnect(); } }),
      { threshold: 0.4 }
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [reduced]);

  return { ref, shown };
}

/**
 * Grows from 0 to `pct` (0-100) once, the first time it scrolls into view,
 * rather than on every prop change — a bar that re-animates every time its
 * parent re-fetches reads as flickering, not as data changing. Width is
 * intentionally not what's transitioned directly (layout thrash); a scaleX
 * on the filled track is, which the parent element clips.
 */
export function useRevealBar(pct) {
  const { ref, shown } = useInView();
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  return {
    ref,
    shown,
    trackStyle: { transform: shown ? `scaleX(${clamped / 100})` : 'scaleX(0)' },
  };
}

/** A single horizontal bar (occupancy-by-property rows, vendor reliability). */
export function RevealBar({ pct, cls = 'bg-teal-400', trackCls = 'bg-slate-200 dark:bg-slate-800' }) {
  const { ref, trackStyle } = useRevealBar(pct);
  return (
    <div ref={ref} className={`h-1.5 rounded-full overflow-hidden ${trackCls}`}>
      <div
        className={`h-full rounded-full origin-left ${cls}`}
        style={{ ...trackStyle, transition: 'transform 700ms cubic-bezier(.22,.61,.36,1)' }}
      />
    </div>
  );
}

/** A single stacked-segment bar for aging buckets: several widths, one row. */
export function AgingBar({ segments, total }) {
  const { ref, shown } = useInView();
  const safeTotal = total > 0 ? total : 1;

  return (
    <div ref={ref}>
      <div className="h-3 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800 flex">
        {segments.map((s, i) => {
          const pct = (s.value / safeTotal) * 100;
          return (
            <div
              key={s.label}
              title={`${s.label}: ${pct.toFixed(0)}%`}
              className={`h-full origin-left ${s.cls}`}
              style={{
                width: `${pct}%`,
                transform: shown ? 'scaleX(1)' : 'scaleX(0)',
                transition: `transform 600ms cubic-bezier(.22,.61,.36,1) ${i * 80}ms`,
              }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] text-slate-500 dark:text-slate-400">
        {segments.map(s => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className={`w-2 h-2 rounded-sm ${s.cls}`} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
