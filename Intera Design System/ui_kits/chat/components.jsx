/* ============================================================
   Intera — Chat UI Kit · shared components
   React (UMD) + Babel. Exports to window for app.jsx.
   ============================================================ */
const { useState, useRef, useEffect } = React;

/* ── Inline icon set (Lucide paths, stroke 1.75) ── */
const ICONS = {
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4 20-9z',
  pen: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z',
  paperclip: 'M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  history: 'M3 3v5h5 M3.05 13A9 9 0 1 0 6 5.3L3 8 M12 7v5l4 2',
  chevronLeft: 'M15 18l-6-6 6-6',
  x: 'M18 6L6 18 M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  search: 'M21 21l-4.3-4.3 M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  book: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  sparkles: 'M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z',
  package: 'M16.5 9.4l-9-5.19 M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05 M12 22.08V12',
};
function Icon({ name, size = 18, stroke = 1.75, className = '', style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={style} aria-hidden="true">
      {ICONS[name].split(' M').map((d, i) => <path key={i} d={(i ? 'M' : '') + d} />)}
    </svg>
  );
}

/* ── Liquid-glass background (orbs + grain) ── */
function LiquidGlass() {
  return (
    <div className="liquid-glass-root" aria-hidden="true">
      <div className="liquid-glass-base"></div>
      <div className="liquid-glass-orb orb-1"></div>
      <div className="liquid-glass-orb orb-2"></div>
      <div className="liquid-glass-orb orb-3"></div>
      <div className="liquid-glass-orb orb-4"></div>
      <div className="liquid-glass-grain"></div>
      <div className="liquid-glass-frost"></div>
      <div className="liquid-glass-edges"></div>
    </div>
  );
}

/* ── Status pill — agent state ── */
function StatusPill({ status }) {
  const LABEL = { online: 'Online', thinking: 'Thinking', working: 'Working', waiting: 'Waiting' };
  return (
    <div className="glass-pill inline-flex items-center" style={{ gap: 8, padding: '8px 16px' }}>
      {status === 'thinking' && (
        <span className="dot-ping"><span className="ring"></span><span className="core"></span></span>
      )}
      {status === 'working' && <span className="dot-spin"></span>}
      {status === 'online' && <span className="dot" style={{ background: 'var(--malachite)', animation: 'breathe 2s ease-in-out infinite' }}></span>}
      {status === 'waiting' && <span className="dot" style={{ background: 'var(--amber)' }}></span>}
      <span className="pill-label">Intera AI</span>
      <span className="pill-sub">· {LABEL[status]}</span>
    </div>
  );
}

/* ── User identity pill ── */
function UserPill({ label, onClick }) {
  return (
    <button className="user-pill" onClick={onClick} title="Switch user">
      <span className="avatar"><Icon name="user" size={13} /></span>
      <span>{label}</span>
    </button>
  );
}

/* ── Header ── */
function ChatHeader({ user, status, onNewChat, onSwitchUser }) {
  return (
    <header className="chat-header">
      <div className="flex items-center" style={{ gap: 8 }}>
        <UserPill label={user} onClick={onSwitchUser} />
        <button className="icon-btn" onClick={onNewChat} title="New chat" aria-label="New chat">
          <Icon name="pen" size={16} stroke={1.75} />
        </button>
      </div>
      <StatusPill status={status} />
      <button className="icon-btn" title="Case history" aria-label="Case history">
        <Icon name="history" size={16} stroke={1.75} />
      </button>
    </header>
  );
}

/* ── Welcome (empty) state ── */
function WelcomeScreen() {
  return (
    <div className="welcome">
      <h1 className="brand-wordmark welcome-word">Intera</h1>
      <p className="welcome-sub">How can I help you?</p>
    </div>
  );
}

/* ── Message bubble ── */
function MessageBubble({ role, children }) {
  return (
    <div className={`msg-row ${role}`}>
      <div className={`msg-bubble ${role === 'user' ? 'glass-chat-user' : 'glass-chat-assistant'}`}>
        {children}
      </div>
    </div>
  );
}

/* ── Responding bubble (the verb-cycling thinking indicator) ── */
function RespondingBubble({ verb }) {
  return (
    <div className="msg-row assistant">
      <div className="responding-bubble">
        <span className="resp-dots">
          <span className="rd rd-1"></span><span className="rd rd-2"></span><span className="rd rd-3"></span>
        </span>
        <span className="responding-verb">{verb}…</span>
      </div>
    </div>
  );
}

/* ── Composer ── */
function Composer({ onSend, responding, placeholder }) {
  const [value, setValue] = useState('');
  const ref = useRef(null);
  const submit = () => {
    const t = value.trim();
    if (!t) return;
    onSend(t);
    setValue('');
    if (ref.current) ref.current.style.height = 'auto';
  };
  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };
  const grow = (e) => {
    setValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
  };
  return (
    <div className="composer-wrap">
      <button className="attach-btn" title="Attach image" aria-label="Attach image">
        <Icon name="paperclip" size={18} stroke={1.75} />
      </button>
      <div className="glass-input-composer">
        <textarea
          ref={ref} rows={1} className="composer-field" value={value}
          onChange={grow} onKeyDown={onKey}
          placeholder={placeholder || 'Describe your issue… (Shift+Enter for new line)'}
        />
        <button className="send-btn" onClick={submit} disabled={!value.trim()} aria-label="Send">
          <Icon name="send" size={18} stroke={1.75} />
        </button>
      </div>
    </div>
  );
}

Object.assign(window, {
  Icon, LiquidGlass, StatusPill, UserPill, ChatHeader,
  WelcomeScreen, MessageBubble, RespondingBubble, Composer,
});
