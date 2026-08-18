import { useEffect, useRef, useState } from 'react';
import { useInView } from './AnimatedBar.jsx';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', onChange) : mq.addListener(onChange);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', onChange) : mq.removeListener(onChange));
  }, []);
  return reduced;
}

const easeOutExpo = t => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

/**
 * Ticks from its previous value to a new one, not from zero every time a
 * dashboard re-fetches. Re-animating from zero on every poll would make a
 * count that only changed by one look like it reset — the point is drawing
 * attention to a real change, not replaying an intro animation on a timer.
 */
export function useAnimatedNumber(target, { duration = 700 } = {}) {
  const numeric = Number(target);
  const valid = Number.isFinite(numeric);
  const reduced = usePrefersReducedMotion();
  const [display, setDisplay] = useState(valid ? numeric : 0);
  const fromRef = useRef(valid ? numeric : 0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!valid) return;
    if (reduced) { setDisplay(numeric); fromRef.current = numeric; return; }
    const from = fromRef.current;
    if (from === numeric) return;
    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    function tick(now) {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (numeric - from) * easeOutExpo(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = numeric;
    }
    rafRef.current = requestAnimationFrame(tick);

    // requestAnimationFrame does not run while the document is hidden, so
    // without this the tick never fires and the tile keeps rendering the
    // value it started from — 0 — indefinitely. Landing on the real number
    // matters more than the animation that was supposed to reach it, so
    // anything unfinished past the animation's own duration is snapped.
    const settle = setTimeout(() => {
      setDisplay(numeric);
      fromRef.current = numeric;
    }, duration + 400);

    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(settle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [numeric, valid, reduced, duration]);

  return valid ? display : target;
}

/**
 * Formatted count-up. Pass a `format` function for currency, percent, etc.
 *
 * Held at 0 until the element scrolls into view, then ticks up to `value` —
 * a stat tile that's already showing its final number the instant the page
 * loads has nothing left to animate by the time anyone actually looks at
 * it. Held, not skipped: this is what makes a below-the-fold dashboard
 * number count up on first sight rather than just sitting there static.
 */
export default function AnimatedNumber({ value, format, duration = 700, className }) {
  const { ref, shown } = useInView();
  const numeric = Number(value);
  const valid = Number.isFinite(numeric);
  const display = useAnimatedNumber(shown ? numeric : 0, { duration });
  if (!valid) return <span ref={ref} className={className}>{value ?? '—'}</span>;
  const out = format ? format(display) : Math.round(display).toLocaleString();
  return <span ref={ref} className={className}>{out}</span>;
}
