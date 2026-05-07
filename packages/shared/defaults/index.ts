// Shared default data for admin pre-fill — used by both seed.ts and API lazy init.
// Must match the built-in definitions in skills.ts and policy.ts exactly.

export const DEFAULT_SYSTEM_PROMPT = `You are Intera, an expert customer service agent.

**Language: Always respond in the same language the user writes in. Match their language exactly — Chinese, English, or any other language.**

# Your Mission

RESOLVE customer issues completely. Drive each case forward proactively. After each turn ask:
"What do I still need to know?" Then take that action with a TOOL immediately.

# The Golden Rule

**Saying "I will X" without calling the tool for X = FAILURE.**
If you type "let me escalate", "I'll check", "let me look into" — you MUST call the corresponding tool in the SAME turn. Never end a turn with just a promise.

# Triage

- **Support issue** (deposit, order, payment, account, refund) → follow Case Stages
- **Casual chat** (greetings, chitchat) → respond naturally, no tools needed

# Case Stages

1. **Collect** — if missing facts (txnId, amount, paymentMethod, date) → call request_user_input NOW
2. **Verify** — call query_order_status + query_payment_channel_status
3. **Resolve** — evidence clear → finalize_case. Conflict found → create_human_task IMMEDIATELY

# Tools

- request_user_input — show form to collect info. Call IMMEDIATELY when data is missing.
- query_order_status(txnId) — check order
- query_payment_channel_status(txnId) — check payment channel
- search_delay_notice(channel) — search delay announcements
- create_human_task(queue, question) — escalate to human specialist. Call this when there's a conflict.
- finalize_case(conclusion, basis) — close resolved case

# When to Escalate

Call create_human_task when:
- System data conflicts with what the customer reports
- You need authorization you don't have
- The case requires manual investigation

When escalating, ALWAYS also send a text message telling the customer:
- Why it's being escalated (specific reason)
- That they can continue asking questions here

# Form Rules

If user dismissed a form: try a simpler way. NEVER repeat the same form.

# Case Context Compression

When the conversation exceeds context limits, older turns are summarized and prepended as a [Case context] block. This summary contains key facts, skills executed, and missing information — not the full transcript. Always treat [Case context] blocks as authoritative background; do not ask the user to re-explain what is already recorded there.
`

export const DEFAULT_MEMORY_STRATEGY = {
  l1MaxMessages: 12,
  l2SummaryMaxTokens: 2000,
  l4MaxHistoricalCases: 5,
  keyEventExtractionPrompt: 'Extract key events from the conversation',
  maxRecentTraces: 20,
  caseRetentionDays: 90,
  autocompactThresholdTokens: 13000,
  warningThresholdTokens: 20000,
  errorThresholdTokens: 20000,
  blockingThresholdTokens: 3000,
  compactModel: 'MiniMax-M2.5-highspeed',
  enableSnip: true,
  enableMicrocompact: true,
  enableContextCollapse: true,
  enableAutocompact: true,
}

export const DEFAULT_POLICY_HOOKS = {
  preTool: ['no_high_risk_account_change'],
  postTool: ['conflict_requires_human'],
  preFinalize: [
    'evidence_required_before_resolution',
    'no_compensation_promise',
    'must_cite_basis',
  ],
}

export interface DefaultSkillSeed {
  name: string
  description: string
  inputSchema: string
  outputSchema: string
  mode: string
  isConcurrencySafe: boolean
  enabled: boolean
  guardPhase: string
}

export const DEFAULT_SKILLS: DefaultSkillSeed[] = [
  {
    name: 'read_case_history', description: "Read the customer's historical cases for context",
    inputSchema: '{"type":"object","properties":{"userId":{"type":"string","description":"Customer user ID"},"limit":{"type":"number","description":"Max number of cases to return","default":5}},"required":["userId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
  {
    name: 'query_order_status', description: 'Query the platform order system for transaction status',
    inputSchema: '{"type":"object","properties":{"txnId":{"type":"string","description":"Transaction ID"}},"required":["txnId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
  {
    name: 'query_payment_channel_status', description: 'Query the payment channel for current status and delays',
    inputSchema: '{"type":"object","properties":{"txnId":{"type":"string","description":"Transaction ID"}},"required":["txnId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
  {
    name: 'search_delay_notice', description: 'Search for any delay notices or announcements',
    inputSchema: '{"type":"object","properties":{"channel":{"type":"string","description":"Payment channel to search"}},"required":["channel"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
  {
    name: 'ocr_receipt', description: 'Extract information from uploaded receipt screenshots',
    inputSchema: '{"type":"object","properties":{"attachmentId":{"type":"string","description":"Attachment ID from file upload"}},"required":["attachmentId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
  {
    name: 'create_human_task', description: 'Create a human task for manual confirmation or processing',
    inputSchema: '{"type":"object","properties":{"queue":{"type":"string","description":"Queue to route to"},"question":{"type":"string","description":"Question for the human operator"}},"required":["queue","question"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
  {
    name: 'finalize_case', description: 'Mark the case as resolved with a conclusion',
    inputSchema: '{"type":"object","properties":{"conclusion":{"type":"string","description":"Case conclusion"},"basis":{"type":"array","items":{"type":"string"},"description":"Evidence basis"}},"required":["conclusion","basis"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
  {
    name: 'kb_hybrid_retrieve', description: 'Hybrid knowledge base search (BM25 + vector)',
    inputSchema: '{"type":"object","properties":{"query":{"type":"string","description":"Search query"}},"required":["query"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
  {
    name: 'request_user_input', description: 'Display a structured form to collect required information from the customer',
    inputSchema: '{"type":"object","properties":{"title":{"type":"string","description":"Form title"},"fields":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"label":{"type":"string"},"type":{"type":"string","enum":["text","number","select","textarea","file"]},"required":{"type":"boolean"},"placeholder":{"type":"string"},"options":{"type":"array","items":{"type":"string"}}},"required":["key","label","type"]}}},"required":["title","fields"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
  {
    name: 'finalize_consultation', description: 'End the human consultation with a summary and resolution',
    inputSchema: '{"type":"object","properties":{"summary":{"type":"string","description":"Customer-facing message about what was resolved"},"resolution":{"type":"string","enum":["confirmed_delayed","refund_approved","needs_more_info","resolved","false_alarm"]}},"required":["summary","resolution"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
  },
]

export interface DefaultPolicySeed {
  name: string
  description: string | null
  hook: string
  rule: string
}

export const DEFAULT_POLICIES: DefaultPolicySeed[] = [
  { name: 'no_high_risk_account_change', description: 'Block high-risk skills in preTool phase', hook: 'preTool', rule: '{"deny_skills":["refund_money","change_ban_status","delete_account"]}' },
  { name: 'conflict_requires_human', description: 'Detect conflict between system result and user report', hook: 'postTool', rule: '{}' },
  { name: 'evidence_required_before_resolution', description: 'Require evidence gathering before resolution', hook: 'preFinalize', rule: '{"require_skills":["query_order_status"]}' },
  { name: 'no_compensation_promise', description: 'Forbid compensation/refund promises in finalize output', hook: 'preFinalize', rule: '{"deny_keywords":["赔偿","退款","补偿","compensate","refund"]}' },
  { name: 'must_cite_basis', description: 'Require evidence citations in conclusions', hook: 'preFinalize', rule: '{}' },
]

export interface DefaultCaseTypeSeed {
  type: string
  displayName: string
  description: string
  icon: string
  requiredFacts: string
  stages: string
  defaultGoal: string
  escalateOn: string
}

export const DEFAULT_CASE_TYPES: DefaultCaseTypeSeed[] = [
  {
    type: 'deposit_issue', displayName: '充值未到账', description: 'Customer reports a deposit not received',
    icon: '💰',
    requiredFacts: '["txnId","amount","paymentMethod","date"]',
    stages: '["created","collecting","investigating","waiting_human","resolved"]',
    defaultGoal: '确认充值是否到账，如未到账申请补单',
    escalateOn: '["conflict"]',
  },
  {
    type: 'order_issue', displayName: '订单问题', description: 'Customer reports an order status issue',
    icon: '📦',
    requiredFacts: '["orderId","issueType"]',
    stages: '["created","verifying","investigating","waiting_human","resolved"]',
    defaultGoal: '确认订单状态并解决客户问题',
    escalateOn: '["conflict","refund_request"]',
  },
  {
    type: 'account_issue', displayName: '账号问题', description: 'Customer reports an account access or ban issue',
    icon: '🔒',
    requiredFacts: '["userId","issueType"]',
    stages: '["created","investigating","waiting_human","escalated","resolved"]',
    defaultGoal: '确认账号状态并解决访问问题',
    escalateOn: '["high_risk"]',
  },
  {
    type: 'refund_request', displayName: '退款申请', description: 'Customer requests a refund',
    icon: '↩️',
    requiredFacts: '["orderId","amount","reason"]',
    stages: '["created","reviewing","approved","resolved"]',
    defaultGoal: '审核退款申请并给出结论',
    escalateOn: '["large_amount","policy_violation"]',
  },
]

export interface DefaultRoutingSeed {
  queue: string
  description: string
  skillsAllowed: string
  priority: number
}

export const DEFAULT_ROUTING: DefaultRoutingSeed[] = [
  {
    queue: 'payment_ops', description: 'Payment operations — handles deposit, order, and refund issues',
    skillsAllowed: '["query_order_status","query_payment_channel_status","search_delay_notice"]',
    priority: 0,
  },
  {
    queue: 'general', description: 'General support queue for account and other issues',
    skillsAllowed: '["read_case_history","kb_hybrid_retrieve"]',
    priority: 1,
  },
]
