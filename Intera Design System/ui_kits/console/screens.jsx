/* ============================================================
   Intera — Console · screens
   ConfigPanel · TestChat · TraceInspector · Playground
   Dashboard · AgentConfig (with docked preview) · Generic
   ============================================================ */
const { useState: useScS, useRef: useScR, useEffect: useScE } = React;

/* renders **bold** in serif prose */
function prose(text) {
  const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}
function jsonPeek(obj) {
  const s = JSON.stringify(obj, null, 2)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/"([^"]+)":/g, '<span class="jk">"$1"</span>:')
    .replace(/: "([^"]*)"/g, ': <span class="js">"$1"</span>')
    .replace(/: (\d+\.?\d*)/g, ': <span class="jn">$1</span>');
  return <div className="json-peek" dangerouslySetInnerHTML={{ __html: s }} />;
}

/* ── Config knobs (left rail) ── */
function ConfigPanel({ cfg, setCfg, goto }) {
  const gr = cfg.guardrails;
  const setGr = (k) => setCfg({ ...cfg, guardrails: { ...gr, [k]: !gr[k] } });
  return (
    <div className="pg-col pg-config">
      <div className="pg-colhead"><I k="sliders" s={15} style={{ color: 'var(--lavender)' }} /><span className="eyebrow">Active configuration</span></div>
      <div className="pg-colbody">
        <div className="cfg-block">
          <div className="cfg-row"><div><div className="cfg-name"><I k="bot" s={14} style={{ color: 'var(--malachite)' }} />Model</div></div>
            <Seg value={cfg.model} onChange={(v) => setCfg({ ...cfg, model: v })}
              options={[{ v: 'claude-sonnet', label: 'Claude' }, { v: 'minimax', label: 'MiniMax' }, { v: 'deepseek', label: 'DeepSeek' }]} />
          </div>
          <div className="cfg-row"><div><div className="cfg-name">Persona</div><div className="cfg-sub">Tone of replies</div></div>
            <Seg value={cfg.persona} onChange={(v) => setCfg({ ...cfg, persona: v })}
              options={[{ v: 'concise', label: 'Concise' }, { v: 'warm', label: 'Warm' }]} />
          </div>
          <div className="cfg-row"><div><div className="cfg-name">Case memory</div><div className="cfg-sub">Inject customer profile</div></div>
            <Switch on={cfg.memory} onClick={() => setCfg({ ...cfg, memory: !cfg.memory })} /></div>
          <div className="cfg-row"><div><div className="cfg-name">Knowledge base</div><div className="cfg-sub">GPTBots hybrid retrieval</div></div>
            <Switch on={cfg.knowledge} onClick={() => setCfg({ ...cfg, knowledge: !cfg.knowledge })} /></div>
        </div>

        <div className="eyebrow" style={{ marginBottom: 9 }}>Guardrails</div>
        <div className="cfg-pillrow">
          <div className={`gr-toggle ${gr.pii ? 'on' : ''}`} onClick={() => setGr('pii')}><span className="gd"></span>PII redaction</div>
          <div className={`gr-toggle ${gr.refundPolicy ? 'on' : ''}`} onClick={() => setGr('refundPolicy')}><span className="gd"></span>Refund policy</div>
          <div className={`gr-toggle ${gr.profanity ? 'on' : ''}`} onClick={() => setGr('profanity')}><span className="gd"></span>Abuse / tone</div>
          <div className={`gr-toggle ${gr.escalation ? 'on' : ''}`} onClick={() => setGr('escalation')}><span className="gd"></span>Escalation rules</div>
        </div>
        <div className="cfg-link" onClick={() => goto('guardrails')}>Edit guardrails<I k="arrowR" s={12} /></div>

        <hr className="hr" />
        <div className="cfg-row" style={{ padding: 0 }}>
          <div><div className="cfg-name"><I k="terminal" s={14} style={{ color: 'var(--amber)' }} />Debug Mode</div><div className="cfg-sub">Log raw request / response</div></div>
          <Switch on={cfg.debug} onClick={() => setCfg({ ...cfg, debug: !cfg.debug })} />
        </div>
        <div className="field-hint" style={{ marginTop: 10 }}>Changes here reshape the agent live. Send a message to see the trace update.</div>
      </div>
    </div>
  );
}

/* ── Test chat (center) ── */
const SUGGESTIONS = ['Where is my order?', 'I want a refund', 'How much is the Pro plan?', 'This is useless, I\u2019m furious'];
function TestChat({ chat, persona }) {
  const { messages, thinking, verb, send, selected, setSelected } = chat;
  const [val, setVal] = useScS('');
  const ref = useScR(null);
  useScE(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [messages, thinking]);
  const submit = () => { const t = val.trim(); if (!t) return; send(t); setVal(''); };
  return (
    <div className="pg-col pg-chat">
      <div className="pg-chat-head">
        <div className="pg-persona"><span className="av"><I k="user" s={14} /></span>
          <div><div style={{ fontSize: 12.5, fontWeight: 600 }}>Test customer</div><div style={{ fontSize: 10.5, color: 'var(--fog)' }}>Simulated · web-chat channel</div></div>
        </div>
        <div className="tb-spacer"></div>
        <span className="chip ind"><I k="sparkles" s={12} />{persona === 'warm' ? 'Warm' : 'Concise'} persona</span>
      </div>
      <div className="pg-thread" ref={ref}>
        <div className="pg-thread-inner">
          {messages.length === 0 && !thinking && (
            <div className="pg-empty">
              <div className="w">Test your agent</div>
              <div className="s">Send a message as a customer. Watch the behavior trace on the right react to your config.</div>
              <div className="pg-suggest">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
            </div>
          )}
          {messages.map((m, i) => (
            <React.Fragment key={i}>
              {m.role === 'assistant' && (
                <div className={`turn-tag ${selected === m.turnId ? 'sel' : ''}`} onClick={() => setSelected(m.turnId)}>
                  <I k="activity" s={11} />{m.caseType} · view trace
                </div>
              )}
              <div className={`pgm ${m.role}`}><div className="b">{prose(m.text)}</div></div>
            </React.Fragment>
          ))}
          {thinking && (
            <div className="pgm assistant"><div className="pg-thinking">
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <span className="tdot animate-breathe"></span><span className="tdot animate-breathe" style={{ animationDelay: '.2s' }}></span><span className="tdot animate-breathe" style={{ animationDelay: '.4s' }}></span>
              </span>
              <span className="v">{verb}…</span>
            </div></div>
          )}
        </div>
      </div>
      <div className="pg-composer"><div className="pg-composer-inner">
        <textarea rows={1} value={val} placeholder="Message as the customer…"
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button className="pg-send" onClick={submit} disabled={!val.trim()}><I k="send" s={17} /></button>
      </div></div>
    </div>
  );
}

/* ── Trace inspector (right) ── */
const SRC_LABEL = { caseTypes: 'Case Types', guardrails: 'Guardrails', knowledge: 'Knowledge', tools: 'Tools & Skills', agent: 'Agent Config', humanTasks: 'Human Tasks' };
const NODE_ICON = { ok: 'check', info: 'sparkles', warn: 'alert', block: 'shield', neutral: 'x' };
function TraceInspector({ trace, meta, debug, goto }) {
  const [open, setOpen] = useScS({});
  if (!trace) {
    return (
      <div className="pg-col pg-trace">
        <div className="pg-colhead"><I k="activity" s={15} style={{ color: 'var(--indigo)' }} /><span className="eyebrow">Behavior trace</span></div>
        <div className="trace-empty"><div className="ic"><I k="activity" s={20} /></div>
          Send a test message — each turn's full pipeline (intent → guardrails → knowledge → tools → model) appears here, annotated with the config that drove it.</div>
      </div>
    );
  }
  return (
    <div className="pg-col pg-trace">
      <div className="pg-colhead"><I k="activity" s={15} style={{ color: 'var(--indigo)' }} /><span className="eyebrow">Behavior trace</span>
        <div className="tb-spacer"></div><span className="tl-ms">{trace.reduce((a, s) => a + s.ms, 0)}ms</span></div>
      <div className="trace-meta">
        <span>Turn</span><span className="mono">{meta.turnId}</span>
        <Spill tone={meta.blocked ? 'escalated' : 'progress'}>{meta.caseType}</Spill>
      </div>
      {debug && <div className="debug-banner"><I k="terminal" s={13} />Debug Mode — raw payloads attached</div>}
      <div className="pg-colbody">
        <div className="tl">
          {trace.map((s, i) => {
            const isOpen = open[i];
            return (
              <div key={i} className={`tl-step ${s.status}`}>
                <span className="tl-node"><I k={NODE_ICON[s.status] || 'sparkles'} s={10} w={2.4} /></span>
                <div className="tl-card" onClick={() => setOpen({ ...open, [i]: !isOpen })}>
                  <div className="tl-top"><span className="tl-stage">{s.stage}</span><span className="tl-ms">{s.ms}ms</span></div>
                  <div className="tl-summary">{s.summary}</div>
                  {isOpen && (
                    <div className="tl-detail" onClick={(e) => e.stopPropagation()}>
                      {s.detail.map((kv, j) => <div key={j} className="tl-kv"><span className="k">{kv[0]}</span><span className="v">{kv[1]}</span></div>)}
                      <div style={{ marginTop: 4 }}><span className="tl-src" onClick={() => goto(s.source)}><I k="arrowR" s={11} />Driven by {SRC_LABEL[s.source]}</span></div>
                      {debug && s.json && jsonPeek(s.json)}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Playground (compose) ── */
function Playground({ cfg, setCfg, chat, goto }) {
  const sel = chat.selected;
  const trace = sel ? chat.traces[sel] : null;
  const meta = sel ? chat.metas[sel] : null;
  return (
    <div className="pg">
      <ConfigPanel cfg={cfg} setCfg={setCfg} goto={goto} />
      <TestChat chat={chat} persona={cfg.persona} />
      <TraceInspector trace={trace} meta={meta} debug={cfg.debug} goto={goto} />
    </div>
  );
}

window.Playground = Playground;
window.TestChat = TestChat;
window.TraceInspector = TraceInspector;
window.prose = prose;
