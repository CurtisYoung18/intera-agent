/* ============================================================
   Intera — Console UI Kit · app shell
   ============================================================ */
const { useState: useAS, useRef: useAR, useEffect: useAE, useCallback: useAC } = React;

const VERBS = ['Classifying intent', 'Checking guardrails', 'Searching knowledge', 'Calling tools', 'Generating reply'];

function useAgentChat(cfgRef) {
  const [messages, setMessages] = useAS([]);
  const [thinking, setThinking] = useAS(false);
  const [verb, setVerb] = useAS(VERBS[0]);
  const [selected, setSelected] = useAS(null);
  const [traces, setTraces] = useAS({});
  const [metas, setMetas] = useAS({});
  const timers = useAR([]);

  const send = useAC((text) => {
    setMessages((m) => [...m, { role: 'user', text }]);
    setThinking(true);
    let i = 0; setVerb(VERBS[0]);
    const vt = setInterval(() => { i = (i + 1) % VERBS.length; setVerb(VERBS[i]); }, 620);
    timers.current.push(vt);
    const done = setTimeout(() => {
      clearInterval(vt);
      const res = runAgent(text, cfgRef.current);
      setTraces((t) => ({ ...t, [res.turnId]: res.trace }));
      setMetas((mt) => ({ ...mt, [res.turnId]: { turnId: res.turnId, caseType: res.caseType, blocked: res.blocked } }));
      setMessages((m) => [...m, { role: 'assistant', text: res.reply, turnId: res.turnId, caseType: res.caseType }]);
      setSelected(res.turnId);
      setThinking(false);
    }, 1900);
    timers.current.push(done);
  }, [cfgRef]);

  useAE(() => () => timers.current.forEach((t) => { clearInterval(t); clearTimeout(t); }), []);
  return { messages, thinking, verb, send, selected, setSelected, traces, metas };
}

const TITLES = {
  playground: ['Preview & Debug', 'Test how your configuration shapes the agent'],
  agent: ['Agent Config', 'Persona, model & instructions for Acme Support'],
  guardrails: ['Guardrails', 'Safety & policy rules that gate the agent'],
  tools: ['Tools & Skills', 'Capabilities the agent can invoke'],
  caseTypes: ['Case Types', 'Stage & SOP definitions'],
  knowledge: ['Knowledge', 'Sources & retrieval'],
  channels: ['Channels', 'Where customers reach you'],
  dashboard: ['Dashboard', 'System overview & health'],
  chats: ['Live Chats', 'Conversations in flight'],
  humanTasks: ['Human Tasks', 'Escalations awaiting an operator'],
  users: ['Users', 'Customers who contacted support'],
};

function App() {
  const [route, setRoute] = useAS('playground');
  const [collapsed, setCollapsed] = useAS(false);
  const [cfg, setCfg] = useAS({
    model: 'claude-sonnet', persona: 'warm', memory: true, knowledge: true, debug: false,
    guardrails: { pii: true, refundPolicy: true, profanity: true, escalation: true },
  });
  const cfgRef = useAR(cfg);
  useAE(() => { cfgRef.current = cfg; }, [cfg]);
  const chat = useAgentChat(cfgRef);
  const [dock, setDock] = useAS(false);

  const [t1, t2] = TITLES[route] || ['', ''];
  const isPlayground = route === 'playground';

  return (
    <div className="console">
      <Sidebar route={route} setRoute={setRoute} collapsed={collapsed} setCollapsed={setCollapsed} />
      <div className="main">
        <Topbar title={t1} subtitle={t2} onTest={isPlayground ? null : () => setDock(true)}
          right={isPlayground ? (
            <div className="seg" style={{ marginRight: 4 }}>
              <button className={!cfg.debug ? 'on' : ''} onClick={() => setCfg({ ...cfg, debug: false })}>Preview</button>
              <button className={cfg.debug ? 'on' : ''} onClick={() => setCfg({ ...cfg, debug: true })}>Debug</button>
            </div>
          ) : null} />
        {isPlayground ? (
          <div style={{ flex: 1, minHeight: 0 }}><Playground cfg={cfg} setCfg={setCfg} chat={chat} goto={setRoute} /></div>
        ) : route === 'dashboard' ? <Dashboard />
          : route === 'agent' ? <AgentConfig cfg={cfg} setCfg={setCfg} openDock={() => setDock(true)} />
          : route === 'guardrails' ? <Guardrails cfg={cfg} setCfg={setCfg} />
          : <GenericScreen id={route} />}
      </div>
      {!isPlayground && <Dock open={dock} onClose={() => setDock(false)} chat={chat} cfg={cfg} />}
    </div>
  );
}

window.App = App;
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
