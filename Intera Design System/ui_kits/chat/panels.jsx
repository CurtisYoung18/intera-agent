/* ============================================================
   Intera — Chat UI Kit · login + case panel
   ============================================================ */

/* ── User login gate ── */
function UserLoginScreen({ onSelect, onAnonymous }) {
  const USERS = [
    { label: 'User 1', memberId: 'JAYA113C88F' },
    { label: 'User 2', memberId: 'JAYA114BBAA' },
    { label: 'User 3', memberId: 'JAYA11327F2' },
    { label: 'User 4', memberId: 'JAYA1188F57' },
    { label: 'User 5', memberId: 'JAYA11C5184' },
  ];
  return (
    <div className="login-gate">
      <div className="login-card animate-fade-up">
        <div className="brand-wordmark login-brand">Intera</div>
        <h2 className="login-title">Select test user</h2>
        <p className="login-sub">Choose a test account to log in with</p>
        <div className="login-list">
          {USERS.map((u) => (
            <button key={u.memberId} className="login-user" onClick={() => onSelect(u)}>
              <span className="lu-label">{u.label}</span>
              <span className="lu-id">{u.memberId}</span>
            </button>
          ))}
        </div>
        <div className="login-foot">
          <button className="login-anon" onClick={onAnonymous}>Continue as Anonymous</button>
        </div>
      </div>
    </div>
  );
}

/* ── Case panel — live investigation, stacked cards ── */
function CasePanel({ open, caseData }) {
  if (!open || !caseData) return null;
  const TONE = {
    progress: { c: 'var(--indigo)', bg: 'rgba(91,138,247,.09)', bd: 'rgba(91,138,247,.2)', label: 'In progress' },
    resolved: { c: 'var(--malachite)', bg: 'rgba(46,160,74,.09)', bd: 'rgba(46,160,74,.2)', label: 'Resolved' },
    waiting:  { c: 'var(--amber)', bg: 'rgba(212,145,46,.11)', bd: 'rgba(212,145,46,.22)', label: 'Waiting' },
  };
  const tone = TONE[caseData.status] || TONE.progress;
  return (
    <aside className="case-panel animate-slide-left">
      <div className="case-card">
        <div className="case-top">
          <span className="case-eyebrow">Case</span>
          <span className="case-status" style={{ color: tone.c, background: tone.bg, borderColor: tone.bd }}>
            <span className="dot" style={{ background: tone.c }}></span>{tone.label}
          </span>
        </div>
        <div className="case-title">{caseData.title}</div>
        <div className="case-id">{caseData.id}</div>
        <div className="case-steps">
          {caseData.steps.map((s, i) => (
            <div key={i} className={`case-step ${s.done ? 'done' : s.active ? 'active' : ''}`}>
              <span className="step-mark">
                {s.done ? <Icon name="check" size={12} stroke={2.25} />
                  : s.active ? <span className="step-spin"></span>
                  : <span className="step-dot"></span>}
              </span>
              <span className="step-icon"><Icon name={s.icon} size={14} stroke={1.75} /></span>
              <span className="step-label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

Object.assign(window, { UserLoginScreen, CasePanel });
