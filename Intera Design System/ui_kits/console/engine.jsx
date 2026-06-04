/* ============================================================
   Intera — Console · agent "engine" (mock)
   runAgent(message, cfg) → { reply, trace[] }
   The trace is the whole point: it shows WHICH config knob
   shaped each step, so you can see config → behavior.
   NOTE: pure UI mock. Real pipeline is implemented server-side.
   ============================================================ */

const MODELS = {
  'claude-sonnet': { label: 'Claude Sonnet', ms: 920 },
  'minimax': { label: 'MiniMax', ms: 540 },
  'deepseek': { label: 'DeepSeek', ms: 680 },
};

function classifyIntent(msg) {
  const t = msg.toLowerCase();
  if (/refund|money back|charge|charged|cancel my|return/.test(t)) return 'refund';
  if (/order|package|deliver|track|ship|where is/.test(t)) return 'order_status';
  if (/price|cost|plan|upgrade|how much|billing/.test(t)) return 'billing';
  if (/stupid|useless|terrible|angry|hate|sucks|idiot/.test(t)) return 'abuse';
  return 'general';
}

const CASE_TYPES = {
  refund:       { label: 'Refund Request', stages: ['Verify', 'Apply policy', 'Resolve'] },
  order_status: { label: 'Order Inquiry', stages: ['Identify', 'Look up', 'Resolve'] },
  billing:      { label: 'Billing & Plans', stages: ['Clarify', 'Retrieve', 'Answer'] },
  abuse:        { label: 'Escalation', stages: ['De-escalate', 'Hand off'] },
  general:      { label: 'General Inquiry', stages: ['Classify', 'Gather', 'Resolve'] },
};

const REPLIES = {
  refund: {
    concise: "Your order qualifies for a refund. I've started a **$48.00** refund to your original card — it lands in 3–5 business days.",
    warm: "I'm sorry for the hassle! Good news — your order is eligible, so I've gone ahead and started your **$48.00** refund to the original card. It usually arrives within 3–5 business days. Anything else I can do?",
  },
  order_status: {
    concise: "Order **#4821** shipped Tuesday and is out for delivery — arriving today by 6 pm. Tracking link sent to your email.",
    warm: "Great question! Your order **#4821** is already on its way — it shipped Tuesday and should reach you today by 6 pm. I've popped the live tracking link into your email. 📦",
  },
  billing: {
    concise: "The Pro plan is **$49/mo** and includes unlimited cases, 5 seats, and priority routing. Want me to start an upgrade?",
    warm: "Happy to help! Our Pro plan runs **$49/mo** and unlocks unlimited cases, 5 seats and priority routing. I can kick off the upgrade whenever you're ready.",
  },
  abuse: {
    concise: "I understand you're frustrated. I'm connecting you with a human specialist now.",
    warm: "I'm really sorry this has been frustrating — you deserve better. Let me bring in a human specialist right away to make this right.",
  },
  general: {
    concise: "Thanks — I've opened a case. Could you share your order number so I can pull up the details?",
    warm: "Thanks for reaching out! I've opened a case for you. To dig in, could you share the order number tied to your account?",
  },
};

let TURN = 0;

function runAgent(message, cfg) {
  const intent = classifyIntent(message);
  const ct = CASE_TYPES[intent];
  const model = MODELS[cfg.model] || MODELS['claude-sonnet'];
  const trace = [];
  const T0 = 0;

  // 1 — Intent / case-type classification
  trace.push({
    stage: 'Intent classification', status: 'info', ms: 60, source: 'caseTypes',
    summary: `Matched case type → ${ct.label}`,
    detail: [['Intent', intent], ['Confidence', '0.9' + (2 + Math.floor(Math.random() * 7))], ['Case type', ct.label]],
    json: { classifier: 'intent.v2', intent, case_type: intent, confidence: 0.93 },
  });

  // 2 — Guardrails (each active rule is a checkpoint)
  const grNotes = [];
  if (cfg.guardrails.pii) {
    const hasPII = /\b\d{4,}\b|@/.test(message);
    grNotes.push({ name: 'PII redaction', status: hasPII ? 'warn' : 'ok', note: hasPII ? 'Masked 1 token before logging' : 'No PII detected' });
  }
  if (intent === 'abuse' && cfg.guardrails.profanity) {
    grNotes.push({ name: 'Abuse / tone', status: 'block', note: 'Triggered de-escalation + human handoff' });
  }
  if (intent === 'refund' && cfg.guardrails.refundPolicy) {
    grNotes.push({ name: 'Refund policy', status: 'ok', note: 'Within 30-day window · auto-refund ≤ $50 allowed' });
  }
  trace.push({
    stage: 'Guardrails', status: grNotes.some(g => g.status === 'block') ? 'block' : grNotes.some(g => g.status === 'warn') ? 'warn' : 'ok',
    ms: 35, source: 'guardrails',
    summary: grNotes.length ? `${grNotes.length} rule${grNotes.length > 1 ? 's' : ''} evaluated · ${grNotes.filter(g => g.status !== 'ok').length} fired` : 'No active guardrails',
    detail: grNotes.length ? grNotes.map(g => [g.name, g.note]) : [['—', 'All guardrails disabled in config']],
    json: { evaluated: grNotes.map(g => ({ rule: g.name, result: g.status })) },
  });

  // short-circuit on abuse handoff
  if (intent === 'abuse' && cfg.guardrails.profanity) {
    trace.push({
      stage: 'Human handoff', status: 'warn', ms: 50, source: 'humanTasks',
      summary: 'Routed to Tier-2 human queue',
      detail: [['Queue', 'Escalations'], ['SLA', '< 5 min'], ['Reason', 'Guardrail: abuse/tone']],
      json: { action: 'escalate', queue: 'tier2_humans' },
    });
    TURN += 1;
    return { turnId: 't' + TURN, intent, caseType: ct.label, reply: REPLIES.abuse[cfg.persona], trace, blocked: true };
  }

  // 3 — Knowledge retrieval
  if (cfg.knowledge) {
    const hits = intent === 'billing' ? 4 : intent === 'general' ? 1 : 2;
    trace.push({
      stage: 'Knowledge retrieval', status: 'ok', ms: 180, source: 'knowledge',
      summary: `Hybrid search → ${hits} source${hits > 1 ? 's' : ''} above threshold`,
      detail: [['Provider', 'GPTBots'], ['Top score', '0.8' + (1 + Math.floor(Math.random() * 8))], ['Returned', hits + ' chunks']],
      json: { retriever: 'kb_hybrid_retrieve', k: 6, threshold: 0.72, hits },
    });
  } else {
    trace.push({
      stage: 'Knowledge retrieval', status: 'neutral', ms: 0, source: 'knowledge',
      summary: 'Skipped — knowledge base disabled in config',
      detail: [['Knowledge', 'Off'], ['Effect', 'Agent answers from prompt only']], json: { skipped: true },
    });
  }

  // 4 — Tools / skills
  const TOOLS = {
    refund: ['lookup_order', 'check_eligibility', 'issue_refund'],
    order_status: ['lookup_order', 'get_carrier_status'],
    billing: ['get_plan_catalog'],
    general: [],
  }[intent] || [];
  trace.push({
    stage: 'Skills & tools', status: TOOLS.length ? 'ok' : 'neutral', ms: TOOLS.length ? 240 : 0, source: 'tools',
    summary: TOOLS.length ? `Executed ${TOOLS.length} tool${TOOLS.length > 1 ? 's' : ''}` : 'No tools required',
    detail: TOOLS.length ? TOOLS.map(t => [t, '✓ ok']) : [['—', 'Direct answer']],
    json: { calls: TOOLS.map(name => ({ name, status: 'ok' })) },
  });

  // 5 — Stage progression (case-type SOP)
  trace.push({
    stage: 'Stage / SOP', status: 'info', ms: 20, source: 'caseTypes',
    summary: ct.stages.join('  →  '),
    detail: ct.stages.map((s, i) => [`Stage ${i + 1}`, s + (i === ct.stages.length - 1 ? '  (current)' : '  ✓')]),
    json: { sop: ct.stages, current: ct.stages.length - 1 },
  });

  // 6 — Model generation (agent config)
  trace.push({
    stage: 'Model generation', status: 'ok', ms: model.ms, source: 'agent',
    summary: `${model.label} · persona “${cfg.persona}”`,
    detail: [['Model', model.label], ['Persona', cfg.persona], ['Memory', cfg.memory ? 'on (profile injected)' : 'off'], ['Temp', '0.4']],
    json: { model: cfg.model, persona: cfg.persona, max_tokens: 1024, temperature: 0.4 },
  });

  TURN += 1;
  return { turnId: 't' + TURN, intent, caseType: ct.label, reply: REPLIES[intent][cfg.persona], trace, blocked: false };
}

window.runAgent = runAgent;
window.MODELS = MODELS;
