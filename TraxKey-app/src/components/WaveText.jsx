// Renders text as one span per character, each animated on a stagger via
// the tk-wave keyframe in index.css. Used for the "thinking" placeholder so
// the concierge visibly signals it's working before any real text arrives.
export default function WaveText({ text, className = '' }) {
  return (
    <span className={className}>
      {text.split('').map((ch, i) => (
        <span key={i} className="tk-wave-letter" style={{ animationDelay: `${i * 0.04}s` }}>
          {ch === ' ' ? ' ' : ch}
        </span>
      ))}
    </span>
  );
}
