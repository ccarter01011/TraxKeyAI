import { useEffect, useRef } from 'react';

/**
 * Animated concierge orb.
 *
 * The glow ring is CSS, but the core is a canvas: concentric arcs orbiting at
 * different speeds over a breathing radial pulse. A static core is what made
 * the earlier version feel dead, the movement has to be inside the orb, not
 * just around it.
 *
 * `active` speeds everything up and brightens it, so "thinking" reads without
 * a spinner.
 */
export default function ConciergeOrb({ active = false, size = 40 }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const activeRef = useRef(active);
  // Eased so the state change is a smooth ramp, not a jump.
  const intensityRef = useRef(active ? 1 : 0);

  useEffect(() => { activeRef.current = active; }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const c = size / 2;
    const maxR = size / 2 - 1;

    // Three arcs, different speeds and directions, so the motion never
    // looks like a single spinning object.
    const arcs = [
      { r: 0.82, from: 0.0, len: 1.5, speed: 0.9, w: 1.4, color: '45, 212, 191' },
      { r: 0.60, from: 2.2, len: 1.9, speed: -1.4, w: 1.2, color: '56, 189, 248' },
      { r: 0.38, from: 4.1, len: 1.2, speed: 2.1, w: 1.1, color: '167, 139, 250' },
    ];

    let t = 0;

    function frame() {
      const target = activeRef.current ? 1 : 0;
      intensityRef.current += (target - intensityRef.current) * 0.06;
      const k = intensityRef.current;

      t += reduced ? 0 : 0.016 * (1 + k * 1.8);

      ctx.clearRect(0, 0, size, size);

      // Breathing core.
      const pulse = 1 + Math.sin(t * 1.6) * (0.05 + k * 0.06);
      const coreR = maxR * 0.34 * pulse;
      const core = ctx.createRadialGradient(c, c, 0, c, c, coreR);
      core.addColorStop(0, `rgba(255,255,255,${0.5 + k * 0.35})`);
      core.addColorStop(0.5, `rgba(94,234,212,${0.28 + k * 0.3})`);
      core.addColorStop(1, 'rgba(15,23,42,0)');
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(c, c, coreR, 0, Math.PI * 2);
      ctx.fill();

      // Orbiting arcs.
      arcs.forEach((a, i) => {
        const wobble = Math.sin(t * 1.1 + i) * 0.04;
        const r = maxR * (a.r + wobble);
        const start = a.from + t * a.speed;
        ctx.beginPath();
        ctx.arc(c, c, r, start, start + a.len);
        ctx.strokeStyle = `rgba(${a.color},${0.35 + k * 0.45})`;
        ctx.lineWidth = a.w;
        ctx.lineCap = 'round';
        ctx.stroke();
      });

      rafRef.current = requestAnimationFrame(frame);
    }

    frame();
    return () => cancelAnimationFrame(rafRef.current);
  }, [size]);

  return (
    <span
      className={`tk-orb ${active ? 'tk-orb--active' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="tk-orb__canvas" style={{ width: size, height: size }} />
    </span>
  );
}
