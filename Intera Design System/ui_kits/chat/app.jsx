/* ============================================================
   Intera — Chat UI Kit · interactive app
   Login → Welcome → live conversation with a faked agent that
   "thinks", opens a case, investigates, and resolves.
   ============================================================ */
const { useState: useS, useRef: useR, useEffect: useE } = React;

/* Verb cycle shown in the responding bubble */
const VERBS = ['Reading your message', 'Searching knowledge', 'Checking your account', 'Drafting a reply'];

/* Scripted agent replies keyed loosely by intent; falls back to generic */
function agentReply(text) {
  const t = text.toLowerCase();
  if (/order|package|deliver|track|ship/.test(t)) {
    return {
      reply: "I found your most recent order **#4821**. It shipped Tuesday and is out for delivery — expected today by 6 pm. I've sent the live tracking link to your email on file. Anything else I can check?",
      case: {
        title: 'Where is my order?',
        steps: [
          { icon: 'user', label: 'Identified customer', done: true },
          { icon: 'search', label: 'Looked up order #4821', done: true },
          { icon: 'package', label: 'Checked carrier status', done: true },
          { icon: 'sparkles', label: 'Resolved & notified', done: true },
        ],
        status: 'resolved',
      },
    };
  }
  if (/refund|return|cancel|money back/.test(t)) {
    return {
      reply: "I can help with that. Your order qualifies for a free return within 30 days. I've started the refund of **$48.00** to your original payment method — it usually lands in 3–5 business days. Would you like a prepaid return label emailed to you?",
      case: {
        title: 'Refund request',
        steps: [
          { icon: 'user', label: 'Verified eligibility', done: true },
          { icon: 'book', label: 'Applied refund policy', done: true },
          { icon: 'sparkles', label: 'Initiated $48.00 refund', done: true },
          { icon: 'package', label: 'Return label — awaiting your reply', active: true },
        ],
        status: 'waiting',
      },
    };
  }
  return {
    reply: "Thanks for reaching out — I've got the details. Let me look into this for you. Could you share the email address or order number associated with your account so I can pull up the right information?",
    case: {
      title: 'New inquiry',
      steps: [
        { icon: 'user', label: 'Opened case', done: true },
        { icon: 'search', label: 'Classifying intent', done: true },
        { icon: 'book', label: 'Awaiting account details', active: true },
        { icon: 'sparkles', label: 'Resolve', done: false },
      ],
      status: 'progress',
    },
  };
}

function ChatApp() {
  const [user, setUser] = useS(null);          // null = login gate
  const [messages, setMessages] = useS([]);
  const [status, setStatus] = useS('online');
  const [responding, setResponding] = useS(false);
  const [verb, setVerb] = useS(VERBS[0]);
  const [caseData, setCaseData] = useS(null);
  const scrollRef = useR(null);
  const verbTimer = useR(null);

  useE(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, responding]);

  const newChat = () => { setMessages([]); setCaseData(null); setStatus('online'); };

  const send = (text) => {
    setMessages((m) => [...m, { role: 'user', text }]);
    const { reply, case: cs } = agentReply(text);

    // Phase 1 — thinking, cycle verbs
    setResponding(true);
    setStatus('thinking');
    let i = 0;
    setVerb(VERBS[0]);
    verbTimer.current = setInterval(() => { i = (i + 1) % VERBS.length; setVerb(VERBS[i]); }, 850);

    // Phase 2 — working (case opens)
    setTimeout(() => {
      setStatus('working');
      setCaseData({ id: 'case_' + Math.random().toString(36).slice(2, 10), ...cs, steps: cs.steps.map((s, idx) => ({ ...s, active: idx === 1 ? true : s.active })) });
    }, 1100);

    // Phase 3 — reply
    setTimeout(() => {
      clearInterval(verbTimer.current);
      setResponding(false);
      setStatus('online');
      setCaseData({ id: 'case_' + Math.random().toString(36).slice(2, 10), ...cs });
      setMessages((m) => [...m, { role: 'assistant', text: reply }]);
    }, 2600);
  };

  /* lightweight **bold** + paragraph renderer for the serif prose */
  const renderProse = (text) => {
    const html = text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/\*\*(.+?)\*\*/g, '<strong style="font-weight:600">$1</strong>');
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  };

  if (!user) {
    return (
      <React.Fragment>
        <LiquidGlass />
        <UserLoginScreen onSelect={setUser} onAnonymous={() => setUser({ label: 'Anonymous' })} />
      </React.Fragment>
    );
  }

  const empty = messages.length === 0;

  return (
    <React.Fragment>
      <LiquidGlass />
      <div className="chat-shell">
        <ChatHeader
          user={user.label} status={status}
          onNewChat={newChat} onSwitchUser={() => { setUser(null); newChat(); }}
        />
        <div className={`chat-body ${caseData ? 'split' : ''}`}>
          <div className="chat-main">
            {empty ? (
              <div className="chat-empty">
                <WelcomeScreen />
                <div className="composer-host"><Composer onSend={send} responding={responding} /></div>
              </div>
            ) : (
              <React.Fragment>
                <div className="msg-list scroll-thin" ref={scrollRef}>
                  <div className="msg-list-inner">
                    {messages.map((m, i) => (
                      <div key={i} className="animate-message-in">
                        <MessageBubble role={m.role}>
                          {m.role === 'assistant'
                            ? <span className="prose-serif">{renderProse(m.text)}</span>
                            : <span className="prose-serif">{m.text}</span>}
                        </MessageBubble>
                      </div>
                    ))}
                    {responding && <RespondingBubble verb={verb} />}
                  </div>
                </div>
                <div className="composer-host">
                  <Composer onSend={send} responding={responding}
                    placeholder={responding ? 'Agent is responding — queue your next question…' : undefined} />
                </div>
              </React.Fragment>
            )}
          </div>
          <CasePanel open={!!caseData} caseData={caseData} />
        </div>
      </div>
    </React.Fragment>
  );
}

window.ChatApp = ChatApp;
window.App = ChatApp;
ReactDOM.createRoot(document.getElementById('root')).render(<ChatApp />);
