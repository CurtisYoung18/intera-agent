/* ============================================================
   Intera — Console · screens (part 2)
   Dashboard · AgentConfig · Guardrails · Knowledge · Generic · Dock
   ============================================================ */

/* ── Dashboard ── */
function Dashboard() {
  const metrics = [
    { k: 'message', c: '#5b8af7', label: 'Messages (24h)', val: '1,284', delta: '+12%', up: true },
    { k: 'brief', c: '#d4912e', label: 'Active cases', val: '37', delta: '+5', up: true },
    { k: 'clock', c: '#2ea04a', label: 'Avg resolution', val: '4.2m', delta: '-0.6m', up: true },
    { k: 'shield', c: '#e64539', label: 'Guardrail hits', val: '18', delta: '+3', up: false },
  ];
  const cases = [
    ['case_8f21a0', 'Refund Request', 'resolved', '2m ago'],
    ['case_77c9b2', 'Order Inquiry', 'progress', '8m ago'],
    ['case_15de03', 'Escalation', 'escalated', '12m ago'],
    ['case_a930f1', 'Billing & Plans', 'waiting', '21m ago'],
    ['case_3b77e9', 'Order Inquiry', 'resolved', '34m ago'],
  ];
  const health = [['Web Chat', 'healthy'], ['LiveChat', 'healthy'], ['Slack', 'waiting'], ['Email', 'healthy']];
  return (
    <div className="scroll-area" style={{ padding: 24 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14, marginBottom: 18 }}>
        {metrics.map((m) => (
          <div key={m.label} className="metric">
            <div className="metric-head"><span className="metric-ic" style={{ background: m.c + '14' }}><I k={m.k} s={15} style={{ color: m.c }} /></span>
              <span className="metric-label">{m.label}</span></div>
            <div style={{ display: 'flex', alignItems: 'baseline' }}><span className="metric-val">{m.val}</span>
              <span className={`metric-delta ${m.up ? 'up' : 'down'}`}>{m.delta}</span></div>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16 }}>
        <div className="card card-pad">
          <div className="section-title" style={{ marginBottom: 14 }}><I k="brief" s={15} style={{ color: 'var(--fog)' }} />Recent cases</div>
          <table className="tbl">
            <thead><tr><th>Case ID</th><th>Type</th><th>Status</th><th>Updated</th></tr></thead>
            <tbody>{cases.map((c) => (
              <tr key={c[0]}><td className="mono" style={{ fontSize: 11 }}>{c[0]}</td><td>{c[1]}</td>
                <td><Spill tone={c[2]}>{c[2]}</Spill></td><td style={{ color: 'var(--fog)' }}>{c[3]}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <div className="card card-pad">
          <div className="section-title" style={{ marginBottom: 14 }}><I k="activity" s={15} style={{ color: 'var(--fog)' }} />Channel health</div>
          {health.map((h) => (
            <div key={h[0]} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13 }}>
                <span style={{ width: 8, height: 8, borderRadius: 9, background: h[1] === 'healthy' ? 'var(--malachite)' : 'var(--amber)' }}></span>{h[0]}</span>
              <span style={{ fontSize: 11, color: 'var(--fog)', textTransform: 'capitalize' }}>{h[1]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Agent Config (with docked preview) ── */
function AgentConfig({ cfg, setCfg, openDock }) {
  return (
    <div className="scroll-area" style={{ padding: 24, maxWidth: 760 }}>
      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="section-title" style={{ marginBottom: 4 }}><I k="bot" s={15} style={{ color: 'var(--malachite)' }} />Agent blueprint</div>
        <p style={{ fontSize: 12, color: 'var(--fog)', margin: '0 0 16px' }}>The core persona and instructions for this organization's agent.</p>
        <label className="field-label">System prompt</label>
        <textarea className="inp" rows={4} defaultValue={"You are Intera, Acme Support's AI agent. Be accurate and concise. Resolve the customer's case end-to-end; escalate to a human when a guardrail requires it."}></textarea>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <div><label className="field-label">Model</label>
            <Seg value={cfg.model} onChange={(v) => setCfg({ ...cfg, model: v })}
              options={[{ v: 'claude-sonnet', label: 'Claude' }, { v: 'minimax', label: 'MiniMax' }, { v: 'deepseek', label: 'DeepSeek' }]} /></div>
          <div><label className="field-label">Persona</label>
            <Seg value={cfg.persona} onChange={(v) => setCfg({ ...cfg, persona: v })}
              options={[{ v: 'concise', label: 'Concise' }, { v: 'warm', label: 'Warm' }]} /></div>
        </div>
      </div>
      <div className="card card-pad">
        <div className="cfg-row" style={{ padding: '4px 0' }}><div><div className="cfg-name">Case memory</div><div className="cfg-sub">Inject the customer's stored profile into context</div></div>
          <Switch on={cfg.memory} onClick={() => setCfg({ ...cfg, memory: !cfg.memory })} /></div>
        <div className="cfg-row"><div><div className="cfg-name">Knowledge base</div><div className="cfg-sub">Retrieve from connected GPTBots sources</div></div>
          <Switch on={cfg.knowledge} onClick={() => setCfg({ ...cfg, knowledge: !cfg.knowledge })} /></div>
        <div className="cfg-row"><div><div className="cfg-name">Debug Mode</div><div className="cfg-sub">Persist full LLM request / response payloads</div></div>
          <Switch on={cfg.debug} onClick={() => setCfg({ ...cfg, debug: !cfg.debug })} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
        <button className="btn btn-primary"><I k="check" s={15} />Save changes</button>
        <button className="btn btn-ghost" onClick={openDock}><I k="beaker" s={15} />Test in preview</button>
      </div>
      <div style={{ marginTop: 14, fontSize: 12, color: 'var(--fog)', display: 'flex', alignItems: 'center', gap: 7 }}>
        <I k="eye" s={14} style={{ color: 'var(--lavender)' }} />Tip: open the preview dock to test changes without leaving this page.
      </div>
    </div>
  );
}

/* ── Guardrails (richer, since trace links here) ── */
function Guardrails({ cfg, setCfg }) {
  const gr = cfg.guardrails;
  const ROWS = [
    { k: 'pii', name: 'PII redaction', sub: 'Mask emails, card & order numbers before logging', tone: 'progress' },
    { k: 'refundPolicy', name: 'Refund policy', sub: 'Auto-refunds ≤ $50 within a 30-day window', tone: 'resolved' },
    { k: 'profanity', name: 'Abuse / tone', sub: 'Detect hostility → de-escalate & hand off to a human', tone: 'escalated' },
    { k: 'escalation', name: 'Escalation rules', sub: 'Route to Tier-2 when confidence < 0.6', tone: 'waiting' },
  ];
  return (
    <div className="scroll-area" style={{ padding: 24, maxWidth: 760 }}>
      <div className="card card-pad">
        <div className="section-title" style={{ marginBottom: 14 }}><I k="shield" s={15} style={{ color: 'var(--vermillion)' }} />Guardrails</div>
        {ROWS.map((r) => (
          <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <Spill tone={r.tone}>{r.tone === 'escalated' ? 'block' : r.tone === 'waiting' ? 'route' : r.tone === 'resolved' ? 'allow' : 'mask'}</Spill>
            <div style={{ flex: 1 }}><div className="cfg-name">{r.name}</div><div className="cfg-sub">{r.sub}</div></div>
            <Switch on={gr[r.k]} onClick={() => setCfg({ ...cfg, guardrails: { ...gr, [r.k]: !gr[r.k] } })} />
          </div>
        ))}
        <div className="field-hint" style={{ marginTop: 14 }}>Toggling a guardrail changes how the agent behaves in the preview trace immediately.</div>
      </div>
    </div>
  );
}

/* ── Generic config screen (faithful-ish stubs) ── */
const STUBS = {
  tools: { k: 'puzzle', c: '#5b8af7', title: 'Tools & Skills', sub: 'System, special & business skills the agent can call',
    items: [['lookup_order', 'System'], ['get_carrier_status', 'System'], ['issue_refund', 'Business'], ['get_plan_catalog', 'Business'], ['kb_hybrid_retrieve', 'Special']] },
  caseTypes: { k: 'layers', c: '#d4912e', title: 'Case Types', sub: 'Stage / SOP definitions per case category',
    items: [['Refund Request', 'Verify → Apply policy → Resolve'], ['Order Inquiry', 'Identify → Look up → Resolve'], ['Billing & Plans', 'Clarify → Retrieve → Answer'], ['Escalation', 'De-escalate → Hand off']] },
  knowledge: { k: 'search', c: '#14b8a6', title: 'Knowledge', sub: 'Connected sources & retrieval parameters',
    items: [['Help Center (GPTBots)', '412 docs'], ['Refund Policy v3', '1 doc'], ['Shipping FAQ', '28 docs'], ['Plan & Pricing', '9 docs']] },
  channels: { k: 'plug', c: '#7c3aed', title: 'Channels', sub: 'Where customers reach the agent',
    items: [['Web Chat', 'Active'], ['LiveChat', 'Active'], ['Slack', 'Setup'], ['Email', 'Active']] },
  chats: { k: 'message', c: '#5b8af7', title: 'Live Chats', sub: 'Conversations in flight',
    items: [['case_77c9b2 · Order Inquiry', 'in progress'], ['case_a930f1 · Billing', 'waiting'], ['case_3b77e9 · Order Inquiry', 'resolved']] },
  humanTasks: { k: 'flag', c: '#d4912e', title: 'Human Tasks', sub: 'Escalations awaiting an operator',
    items: [['case_15de03 · Escalation', 'Tier-2 · 2m'], ['case_55a1c0 · Refund > $50', 'Approval · 6m'], ['case_9920ff · Abuse', 'Review · 9m']] },
  users: { k: 'users', c: '#8b6ff5', title: 'Users', sub: 'Customers who have contacted support',
    items: [['JAYA113C88F', '14 cases'], ['JAYA114BBAA', '3 cases'], ['JAYA11327F2', '8 cases'], ['JAYA1188F57', '1 case']] },
};
function GenericScreen({ id }) {
  const s = STUBS[id]; if (!s) return <div style={{ padding: 30, color: 'var(--fog)' }}>Coming soon.</div>;
  return (
    <div className="scroll-area" style={{ padding: 24, maxWidth: 760 }}>
      <div className="card card-pad">
        <div className="section-title" style={{ marginBottom: 2 }}><I k={s.k} s={15} style={{ color: s.c }} />{s.title}</div>
        <p style={{ fontSize: 12, color: 'var(--fog)', margin: '2px 0 14px' }}>{s.sub}</p>
        {s.items.map((it, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
            <span style={{ fontSize: 13, color: 'var(--mist)' }} className={/_|JAYA|case_/.test(it[0]) ? 'mono' : ''}>{it[0]}</span>
            <span className="chip">{it[1]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Docked preview (right slide-in on config screens) ── */
function Dock({ open, onClose, chat, cfg }) {
  const [tab, setTab] = useScS('chat');
  const sel = chat.selected;
  const trace = sel ? chat.traces[sel] : null;
  const meta = sel ? chat.metas[sel] : null;
  return (
    <React.Fragment>
      <div className={`dock-scrim ${open ? 'open' : ''}`} onClick={onClose}></div>
      <div className={`dock ${open ? 'open' : ''}`}>
        <div className="dock-head">
          <I k="beaker" s={16} style={{ color: 'var(--lavender)' }} />
          <strong style={{ fontSize: 13 }}>Agent preview</strong>
          <div className="tb-spacer"></div>
          <div className="seg"><button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>Chat</button>
            <button className={tab === 'trace' ? 'on' : ''} onClick={() => setTab('trace')}>Trace</button></div>
          <button className="icon-btn2" style={{ width: 30, height: 30 }} onClick={onClose}><I k="x" s={15} /></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
          {tab === 'chat'
            ? <TestChat chat={chat} persona={cfg.persona} />
            : <TraceInspector trace={trace} meta={meta} debug={cfg.debug} goto={() => {}} />}
        </div>
      </div>
    </React.Fragment>
  );
}

Object.assign(window, { Dashboard, AgentConfig, Guardrails, GenericScreen, Dock });
