// Renders the small subset of markdown the AI chat backends actually
// produce: **bold**, numbered lists ("1. "), bullet lists ("- "), and line
// breaks. Not a full markdown parser on purpose — these replies come from
// a system prompt we wrote, not arbitrary user content, so the only things
// worth handling are the ones the model actually uses. Everything else
// renders as plain text rather than silently eating characters like a
// stray asterisk.

function renderInline(text, keyPrefix) {
  // Splits on **bold** without eating the asterisks of an unmatched pair -
  // an odd number of ** in one line just renders literally rather than
  // hiding text or crashing.
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

export default function MarkdownLite({ text, className }) {
  const lines = String(text || '').split('\n');
  const blocks = [];
  let list = null; // { type: 'ul' | 'ol', items: [] }

  function flushList() {
    if (!list) return;
    const Tag = list.type;
    blocks.push(
      <Tag key={`list-${blocks.length}`} className={list.type === 'ol' ? 'list-decimal pl-4 space-y-1' : 'list-disc pl-4 space-y-1'}>
        {list.items.map((item, i) => <li key={i}>{renderInline(item, `li-${blocks.length}-${i}`)}</li>)}
      </Tag>
    );
    list = null;
  }

  lines.forEach((rawLine, i) => {
    const line = rawLine.trim();
    // A bare "---" or "***" is a markdown horizontal rule, not a bullet
    // (the bullet regex below would otherwise treat "-- -" as a bullet with
    // an empty/odd item). Drop it rather than rendering the dashes literally.
    if (/^(-{3,}|\*{3,})$/.test(line)) { flushList(); return; }
    const bullet = line.match(/^[-*]\s+(.*)/);
    const numbered = line.match(/^\d+\.\s+(.*)/);

    if (bullet) {
      if (!list || list.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(bullet[1]);
      return;
    }
    if (numbered) {
      if (!list || list.type !== 'ol') { flushList(); list = { type: 'ol', items: [] }; }
      list.items.push(numbered[1]);
      return;
    }
    flushList();
    if (!line) return; // collapse blank lines rather than rendering empty <p>s
    blocks.push(<p key={`p-${i}`}>{renderInline(line, `p-${i}`)}</p>);
  });
  flushList();

  return <div className={`space-y-1.5 ${className || ''}`}>{blocks}</div>;
}
