/* ============================================================
   Intera — Console UI Kit · icons + shell + primitives
   ============================================================ */
const { useState: useCS, useRef: useCR, useEffect: useCE } = React;

/* ── Icon set (Lucide path data, multi-path as arrays) ── */
const IK = {
  message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  chart: ['M3 3v18h18', 'M18 17V9', 'M13 17V5', 'M8 17v-3'],
  book: ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z'],
  bot: ['M12 8V4H8', 'M4 8h16v12H4z M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'],
  puzzle: ['M19.4 13a1.7 1.7 0 0 0 .9 1.2 2 2 0 0 1-1.9 3.5 1.7 1.7 0 0 0-1.5 0 2 2 0 0 1-3.6 0 1.7 1.7 0 0 0-1.5 0 2 2 0 0 1-1.9-3.5 1.7 1.7 0 0 0 0-2.9A2 2 0 0 1 9.4 5.8'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
  layers: ['M12 2L2 7l10 5 10-5-10-5z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z', 'M21 21l-4.3-4.3'],
  plug: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v4a6 6 0 0 1-12 0V8z'],
  building: ['M3 21h18', 'M5 21V7l8-4v18', 'M19 21V11l-6-4', 'M9 9v.01', 'M9 12v.01', 'M9 15v.01'],
  chevL: ['M15 18l-6-6 6-6'], chevR: ['M9 18l6-6-6-6'], chevD: ['M6 9l6 6 6-6'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
  send: ['M22 2L11 13', 'M22 2l-7 20-4-9-9-4 20-9z'],
  play: ['M5 3l14 9-14 9z'],
  beaker: ['M4.5 3h15', 'M6 3v15a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V3', 'M6 11h12'],
  zap: ['M13 2L3 14h9l-1 8 10-12h-9z'],
  sparkles: ['M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z'],
  check: ['M20 6L9 17l-5-5'],
  x: ['M18 6L6 18', 'M6 6l12 12'],
  sliders: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  route: ['M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M9 16h7a3 3 0 0 0 3-3'],
  database: ['M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3z', 'M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5', 'M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6'],
  alert: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
  arrowR: ['M5 12h14', 'M12 5l7 7-7 7'],
  terminal: ['M4 17l6-6-6-6', 'M12 19h8'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 6v6l4 2'],
  brief: ['M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z', 'M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2'],
  activity: ['M22 12h-4l-3 9L9 3l-3 9H2'],
  key: ['M21 2l-2 2m-7.6 7.6a5 5 0 1 0-7 7 5 5 0 0 0 7-7zm0 0L15 8m0 0l3 3 3-3-3-3', 'M15 8l2.5-2.5'],
  refresh: ['M23 4v6h-6', 'M1 20v-6h6', 'M20.5 9a9 9 0 0 0-15-3.4L1 10', 'M23 14l-4.5 4.4A9 9 0 0 1 3.5 15'],
  flag: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'],
  gauge: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 12l4-4'],
};
function I({ k, s = 18, w = 1.75, style = {}, cls = '' }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w}
      strokeLinecap="round" strokeLinejoin="round" style={style} className={cls} aria-hidden="true">
      {IK[k].map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

/* ── Primitives ── */
function Switch({ on, onClick }) {
  return <div className={`switch ${on ? 'on' : ''}`} onClick={onClick} role="switch" aria-checked={on}><span className="knob"></span></div>;
}
function Seg({ value, options, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.v} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}
function Spill({ tone, children }) { return <span className={`spill ${tone}`}><span className="d"></span>{children}</span>; }

/* ── Sidebar ── */
const NAV = {
  build: [
    { id: 'playground', label: 'Preview & Debug', k: 'beaker', c: '#8b6ff5' },
    { id: 'agent', label: 'Agent Config', k: 'bot', c: '#2ea04a' },
    { id: 'guardrails', label: 'Guardrails', k: 'shield', c: '#e64539' },
    { id: 'tools', label: 'Tools & Skills', k: 'puzzle', c: '#5b8af7' },
    { id: 'caseTypes', label: 'Case Types', k: 'layers', c: '#d4912e' },
    { id: 'knowledge', label: 'Knowledge', k: 'search', c: '#14b8a6' },
    { id: 'channels', label: 'Channels', k: 'plug', c: '#7c3aed' },
  ],
  ops: [
    { id: 'dashboard', label: 'Dashboard', k: 'chart', c: '#14b8a6' },
    { id: 'chats', label: 'Live Chats', k: 'message', c: '#5b8af7' },
    { id: 'humanTasks', label: 'Human Tasks', k: 'flag', c: '#d4912e', badge: '3' },
    { id: 'users', label: 'Users', k: 'users', c: '#8b6ff5' },
  ],
};

function Sidebar({ route, setRoute, collapsed, setCollapsed }) {
  const Item = (it) => (
    <div key={it.id} className={`nav-item ${route === it.id ? 'active' : ''}`} onClick={() => setRoute(it.id)} title={collapsed ? it.label : undefined}>
      <span className="rail" style={{ background: `linear-gradient(180deg, ${it.c}, transparent)` }}></span>
      <span className="ni-ico" style={{ color: route === it.id ? it.c : 'var(--fog)', opacity: route === it.id ? 1 : 0.55 }}>
        <I k={it.k} s={18} w={route === it.id ? 2 : 1.6} />
      </span>
      <span className="ni-label">{it.label}</span>
      {it.badge && <span className="ni-badge">{it.badge}</span>}
    </div>
  );
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sb-head">
        <div className="sb-brand">
          {collapsed ? (
            <span className="sb-glyph"><InteraLogo collapsed size={15} /></span>
          ) : (
            <InteraLogo size={22} />
          )}
        </div>
        {!collapsed && (
          <button className="sb-toggle" onClick={() => setCollapsed(true)} aria-label="Collapse"><I k="chevL" s={15} w={2.2} /></button>
        )}
      </div>
      {collapsed && (
        <button className="sb-toggle" style={{ margin: '8px auto' }} onClick={() => setCollapsed(false)} aria-label="Expand"><I k="chevR" s={15} w={2.2} /></button>
      )}
      <nav className="sb-nav">
        <div>
          {!collapsed && <div className="nav-group-label">Build</div>}
          {NAV.build.map(Item)}
        </div>
        <div>
          {!collapsed && <div className="nav-group-label">Operate</div>}
          {NAV.ops.map(Item)}
        </div>
      </nav>
      <div className="sb-foot">
        <div className="org-switch">
          <span className="org-av"><I k="building" s={15} /></span>
          <span className="org-meta"><div className="org-name">Acme Support</div><div className="org-plan">Production · Pro</div></span>
          <span className="org-chev" style={{ color: 'var(--fog)' }}><I k="chevD" s={14} /></span>
        </div>
      </div>
    </aside>
  );
}

/* ── Topbar ── */
function Topbar({ title, subtitle, onTest, right }) {
  return (
    <header className="topbar">
      <div className="tb-title"><h1>{title}</h1><p>{subtitle}</p></div>
      <div className="tb-spacer"></div>
      {right}
      <div className="tb-search"><I k="search" s={15} /><input placeholder="Search cases, users…" /></div>
      {onTest && (
        <button className="btn btn-accent" onClick={onTest}><I k="beaker" s={15} />Test agent</button>
      )}
    </header>
  );
}

Object.assign(window, { I, Switch, Seg, Spill, Sidebar, Topbar, NAV });
