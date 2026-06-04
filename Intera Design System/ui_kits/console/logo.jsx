/* ============================================================
   Intera — animated wordmark
   Cormorant Garamond italic. Two behaviours:
     • reveal      — letters stagger in on mount
     • collapse    — "Intera" ⇄ "I" monogram (Anthropic-style),
                     driven by `collapsed` prop OR auto-cycling
   ============================================================ */
const { useState: useLs, useEffect: useLe } = React;

function InteraLogo({ collapsed = false, size = 26, cycle = false, color = 'var(--mist)' }) {
  const [auto, setAuto] = useLs(false);
  const [revealed, setRevealed] = useLs(false);

  // one-time letter reveal on mount
  useLe(() => { const t = setTimeout(() => setRevealed(true), 60); return () => clearTimeout(t); }, []);

  // optional auto cycle (used on the spec card / splash)
  useLe(() => {
    if (!cycle) return;
    let on = false;
    const id = setInterval(() => { on = !on; setAuto(on); }, 2600);
    return () => clearInterval(id);
  }, [cycle]);

  const isCollapsed = collapsed || auto;
  const rest = 'ntera'.split('');

  return (
    <span className={`intera-logo ${revealed ? 'is-revealed' : ''} ${isCollapsed ? 'is-collapsed' : ''}`}
      style={{ fontSize: size, color }} aria-label="Intera">
      <span className="il-anchor">I</span>
      {rest.map((ch, i) => (
        <span key={i} className="il-letter" style={{ transitionDelay: `${(isCollapsed ? (rest.length - i) : i) * 28}ms` }}>{ch}</span>
      ))}
      <span className="il-dot" aria-hidden="true"></span>
    </span>
  );
}

window.InteraLogo = InteraLogo;
