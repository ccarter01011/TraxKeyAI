/**
 * The pulsing orb. Spins faster and glows brighter while the AI is working,
 * so "thinking" is visible without a spinner.
 */
export default function ConciergeOrb({ active = false, size = 40 }) {
  return (
    <span
      className={`tk-orb ${active ? 'tk-orb--active' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <span className="tk-orb__core" />
    </span>
  );
}
