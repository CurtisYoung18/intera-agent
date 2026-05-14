// Shared default data for admin pre-fill — used by both seed.ts and API lazy init.
// Must match the built-in definitions in skills.ts and policy.ts exactly.

export const DEFAULT_SYSTEM_PROMPT = `You are **Intera** — an operations agent wired into a persisted **Case** (goal ledger, audited memory, safeguards, occasional human checkpoints). Your job is to **drive the Case to resolution**, not only answer isolated chat bubbles.

## Language & tone

- Respond in whatever language the customer writes — mirror it unless they explicitly ask otherwise.
- Be concise first; add reasoning only where it aids trust or coordination with humans/tools.

## The execution rule

**If you imply you will investigate, verify, escalate, or close — you MUST call the matching Skill/Tool that turn.** Ending only with reassurance (\"I'll check…\") without invoking the capability is incorrect.

## How work is routed

1. **Intent routing** assigns a **Case Type** with stages, permitted skills, and evidence gates (see Case schema when present).
2. **Stages** may auto-advance, require skills to be exercised, or be evaluated via the configured evaluation model — follow the goals of the current stage.
3. Some Case Types ship an **Orchestrator / parallel sub‑agents**. When activated, cooperate with delegated runs; converge on resolved facts instead of conflicting narratives.

## What to do each turn

- Read **Facts & confirmed context** carefully; reuse them instead of repeating the same questions.
- Choose the smallest next action that progresses the Case: collect missing identifiers, retrieve records, escalate with clear operator questions, or finalize with explicit evidence linkage.
- If system records **conflict with the customer's story**, do not gaslight — surface the divergence and **invoke human escalation** as configured.

## Mandatory guardrails — policies & hooks

Administrators attach **Policies** around tool calls (\`preTool\` / \`postTool\`) and before user-facing finalize (\`preFinalize\`). If enforcement withholds progress, obey the verdict: revise the plan (gather facts, escalate, or avoid prohibited commitments). **Policies are intentionally strict** — negotiate only through tooling, never by verbally bypassing them.

## Humans in the loop

\`create_human_task\` hands work to specialists. Explain **specifically** why, and reassure customers they may keep chatting. When synthetic **resume traffic** arrives after resolution, reconcile operator verdict/internal notes before replying externally.

## Forms & friction

Using \`request_user_input\`:
- Prefer **exact field types**: \`number\` for quantities, **\`date\` for timestamps**, \`select\` for enumerated choices, \`textarea\` for narratives, **\`file\` for uploads**, \`text\` for concise strings.
- If a form is dismissed, **adapt** (narrow fields, conversational capture, staged asks) — avoid pasting duplicate forms verbatim.

Representative tooling (availability depends on tenant configuration): \`request_user_input\`, \`create_human_task\`, \`read_case_history\`, \`query_order_status\`, \`query_payment_channel_status\`, \`search_delay_notice\`, \`ocr_receipt\`, \`kb_hybrid_retrieve\`, \`finalize_case\`, plus any additional skills registered by operators.

## Memory & compaction

Long threads may prepend \`[Case context]\`-style compaction with curated facts/skills/trace notes. Treat it as authoritative state about the ledger — **don't ask customers to redo work already summarized there.**

## Separation note

Typing-box drafts for visitors are handled by optional **composer continuation** adapters; they never replace Intera's tool loop reasoning or policy checks.

Operate with forensic calm: cite evidence implicitly through tool usage, escalate when ambiguity or risk outweighs autonomy, and keep every customer-visible step aligned with the Case goal.
`

export const DEFAULT_MEMORY_STRATEGY = {
  // Retention
  l1MaxMessages: 12,
  l2SummaryMaxTokens: 2000,
  l4MaxHistoricalCases: 5,
  keyEventExtractionPrompt: 'Extract key events from the conversation',
  maxRecentTraces: 20,
  caseRetentionDays: 90,

  // Thresholds
  autocompactThresholdTokens: 13000,
  warningThresholdTokens: 20000,
  errorThresholdTokens: 25000,
  blockingThresholdTokens: 3000,

  // Features
  compactModel: 'MiniMax-M2.5-highspeed',
  enableSnip: true,
  enableMicrocompact: true,
  enableContextCollapse: true,
  enableAutocompact: true,

  // Compaction fine-tuning
  compactMaxMessages: 40,
  compactTemperature: 0.3,
  compactMaxTokensCap: 4096,
  compactMinSummaryLength: 20,
  compactionKeepMin: 4,
  compactionKeepRatio: 0.4,
  compactableTools: [
    'query_order_status',
    'query_payment_channel_status',
    'search_delay_notice',
    'read_case_history',
    'kb_hybrid_retrieve',
    'ocr_receipt',
  ],

  // Fact extraction patterns
  txnIdPattern: 'TX[Uu]?\\d+|[A-Z]{2,6}\\d{8,}',
  amountPattern: '(\\d+\\.?\\d*)\\s*(元|USD|EUR|JPY|₩|¥|\\$)',
  notReceivedKeywords: ['未到账', '没到账', '没收到', 'not received', 'not credited', 'missing', '未入金'],
  keyEventMaxChars: 100,

  // Token estimation
  tokensPerKeyEvent: 20,
  tokensPerFact: 15,
  tokensPerSkill: 30,
  cjkCharPerToken: 1.2,
  latinCharPerToken: 3,
  minTokenEstimate: 100,
  toolResultTokenRatio: 3,

  // Advanced
  compactPrompt: '',
  contextWindow: 200000,
  outputTokensReserved: 20000,
  maxKeyEventsAfterCompact: 5,
  compactCircuitBreakerMaxFailures: 3,
  sessionMemoryMaxAgeMs: 1800000,
  toolResultTemplate: 'Tool {name} result:\n{output}',
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

/** Appended after harness-injected header + verdict lines when `resumePrompt` in AgentConfig is empty. */
export const HARNESS_DEFAULT_RESUME_PROMPT_APPEND = `[Human task resolved — operator closed the case]
IMPORTANT — Customer communication task:
1. Translate the operator's verdict and notes into plain, friendly language the customer can understand.
2. Send this message to the customer NOW in your response — do not ask further questions.
3. Format it as a helpful update, e.g.: "Hi! Our team has reviewed your case and [result]. Here's what this means for you: [explanation]."
4. After sending the update, if the case is resolved, call finalize_case. Otherwise continue assisting.`

/** Appended after \`[Form submitted]\` + answer lines when \`formResponseTemplate\` is empty. */
export const HARNESS_DEFAULT_FORM_RESPONSE_APPEND =
  'Please continue processing based on this information.'

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
    type: 'deposit_issue',
    displayName: '存款未到账',
    description:
      '用户反映已向平台充值或划转资金（银行卡、支付宝、微信、USDT 等），但账户余额未增加或未看到到账确认；包含「扣款成功但余额没变」「流水有、游戏/钱包里没点数」「长时间未到账」等说法。',
    icon: '💰',
    requiredFacts: '["txnId","amount","paymentMethod","date"]',
    stages: '["created","collecting","investigating","waiting_human","resolved"]',
    defaultGoal: '核实订单与支付渠道状态，判断是否延迟、失败或需补单；系统与客户说法冲突时升级人工核查。',
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

// Per-stage configs for each case type (used when stageConfigs is not set on CaseType)
export const DEFAULT_STAGE_CONFIGS: Record<string, Record<string, Record<string, unknown>>> = {
  deposit_issue: {
    created: {
      name: 'created',
      description:
        '案例已开立，占位阶段：**本阶段不要求调用任何 Skill**（Required/Allowed 留空）；满足「最少迭代次数」后自动进入 collecting。',
      transition: { type: 'auto', conditions: [{ type: 'min_iterations', value: 1 }] },
    },
    collecting: {
      name: 'collecting',
      description: '向用户收集流水号、金额、渠道、时间等；可用 request_user_input 表单一次收齐。',
      requiredSkills: ['request_user_input'],
      evidenceRequirements: [
        { factKey: 'txnId', description: '交易流水号 / 充值单号', source: 'user_input', required: true },
        { factKey: 'amount', description: '充值金额', source: 'user_input', required: true },
        { factKey: 'paymentMethod', description: '支付方式', source: 'user_input', required: true },
        { factKey: 'date', description: '到账或发起时间（如有）', source: 'user_input', required: false },
      ],
      transition: { type: 'auto', conditions: [{ type: 'all_evidence_gathered' }] },
    },
    investigating: {
      name: 'investigating',
      description: '调用订单与渠道技能核对平台记录；可申请公告检索与历史工单。',
      requiredSkills: ['query_order_status', 'query_payment_channel_status'],
      availableSkills: ['query_order_status', 'query_payment_channel_status', 'search_delay_notice', 'read_case_history', 'kb_hybrid_retrieve'],
      evidenceRequirements: [
        {
          factKey: 'status',
          description: 'query_order_status 返回的订单/流水状态（mock 字段 `status`）',
          source: 'skill_output',
          skillName: 'query_order_status',
          required: true,
        },
        {
          factKey: 'channel',
          description: 'query_payment_channel_status 返回的渠道标识（mock 字段 `channel`）',
          source: 'skill_output',
          skillName: 'query_payment_channel_status',
          required: true,
        },
      ],
      guardrails: [
        { name: 'conflict_requires_human', description: 'Detect conflict between system data and user report', hook: 'postTool', rule: {} },
      ],
      transition: {
        type: 'evaluation',
        evaluationModel: 'claude-haiku-4-5-20251001',
        evaluationPrompt: 'Based on the investigation results, determine next stage. If system data conflicts with user report → escalate to waiting_human. If all clear with evidence → transition to resolved. If still collecting → transition to collecting.',
      },
    },
    waiting_human: {
      name: 'waiting_human',
      description: 'Waiting for human specialist to review and respond',
      requiredSkills: ['create_human_task'],
      transition: { type: 'manual' },
    },
    resolved: {
      name: 'resolved',
      description: 'Case resolved, provide conclusion to customer',
      requiredSkills: ['finalize_case'],
      guardrails: [
        { name: 'no_compensation_promise', description: 'Forbid compensation/refund promises', hook: 'preFinalize', rule: { deny_keywords: ['赔偿', '退款', '补偿', 'compensate', 'refund'] } },
        { name: 'must_cite_basis', description: 'Require evidence citations in conclusions', hook: 'preFinalize', rule: { allow_keywords: ['basis'] } },
      ],
      transition: { type: 'manual' },
    },
  },
  order_issue: {
    created: {
      name: 'created',
      description: 'Case created, waiting for initial assessment',
      transition: { type: 'auto', conditions: [{ type: 'min_iterations', value: 1 }] },
    },
    verifying: {
      name: 'verifying',
      description: 'Verify order details and collect missing information',
      requiredSkills: ['query_order_status'],
      availableSkills: ['query_order_status', 'request_user_input', 'read_case_history'],
      evidenceRequirements: [
        { factKey: 'orderId', description: 'Order ID', source: 'user_input', required: true },
        { factKey: 'issueType', description: 'Issue type', source: 'user_input', required: true },
        {
          factKey: 'status',
          description: '订单系统返回的状态（skill 字段 `status`）',
          source: 'skill_output',
          skillName: 'query_order_status',
          required: true,
        },
      ],
      transition: { type: 'evaluation', evaluationModel: 'claude-haiku-4-5-20251001', evaluationPrompt: 'Check if order details are verified. If order found and matches → investigating. If missing info → back to collecting.' },
    },
    investigating: {
      name: 'investigating',
      description: 'Investigate order issue',
      requiredSkills: ['query_payment_channel_status'],
      availableSkills: ['query_order_status', 'query_payment_channel_status', 'search_delay_notice', 'read_case_history', 'kb_hybrid_retrieve'],
      guardrails: [
        { name: 'conflict_requires_human', description: 'Detect conflict between system and user', hook: 'postTool', rule: {} },
      ],
      transition: { type: 'evaluation', evaluationModel: 'claude-haiku-4-5-20251001', evaluationPrompt: 'If conflict detected → waiting_human. If resolved → resolved.' },
    },
    waiting_human: {
      name: 'waiting_human',
      description: 'Waiting for human specialist',
      requiredSkills: ['create_human_task'],
      transition: { type: 'manual' },
    },
    resolved: {
      name: 'resolved',
      description: 'Case resolved',
      requiredSkills: ['finalize_case'],
      guardrails: [
        { name: 'no_compensation_promise', description: 'Forbid compensation promises', hook: 'preFinalize', rule: { deny_keywords: ['赔偿', '退款', '补偿', 'compensate', 'refund'] } },
        { name: 'must_cite_basis', description: 'Require evidence citations', hook: 'preFinalize', rule: { allow_keywords: ['basis'] } },
      ],
      transition: { type: 'manual' },
    },
  },
  account_issue: {
    created: {
      name: 'created',
      description: 'Case created',
      transition: { type: 'auto', conditions: [{ type: 'min_iterations', value: 1 }] },
    },
    investigating: {
      name: 'investigating',
      description: 'Investigate account status',
      requiredSkills: ['read_case_history'],
      availableSkills: ['read_case_history', 'request_user_input', 'kb_hybrid_retrieve'],
      evidenceRequirements: [
        { factKey: 'userId', description: 'User ID', source: 'user_input', required: true },
        { factKey: 'issueType', description: 'Issue type', source: 'user_input', required: true },
      ],
      transition: { type: 'evaluation', evaluationModel: 'claude-haiku-4-5-20251001', evaluationPrompt: 'If high_risk detected → escalated. If needs human → waiting_human. If resolved → resolved.' },
    },
    waiting_human: {
      name: 'waiting_human',
      description: 'Waiting for human specialist',
      requiredSkills: ['create_human_task'],
      transition: { type: 'manual' },
    },
    escalated: {
      name: 'escalated',
      description: 'Escalated to higher authority',
      requiredSkills: ['create_human_task'],
      transition: { type: 'manual' },
    },
    resolved: {
      name: 'resolved',
      description: 'Case resolved',
      requiredSkills: ['finalize_case'],
      guardrails: [
        { name: 'must_cite_basis', description: 'Require evidence citations', hook: 'preFinalize', rule: { allow_keywords: ['basis'] } },
      ],
      transition: { type: 'manual' },
    },
  },
  refund_request: {
    created: {
      name: 'created',
      description: 'Case created',
      transition: { type: 'auto', conditions: [{ type: 'min_iterations', value: 1 }] },
    },
    reviewing: {
      name: 'reviewing',
      description: 'Review refund eligibility',
      requiredSkills: ['query_order_status'],
      availableSkills: ['query_order_status', 'query_payment_channel_status', 'read_case_history', 'request_user_input'],
      evidenceRequirements: [
        { factKey: 'orderId', description: 'Order ID', source: 'user_input', required: true },
        { factKey: 'amount', description: 'Refund amount', source: 'user_input', required: true },
        { factKey: 'reason', description: 'Refund reason', source: 'user_input', required: true },
        {
          factKey: 'status',
          description: '订单查询返回的状态（skill 字段 `status`）',
          source: 'skill_output',
          skillName: 'query_order_status',
          required: true,
        },
      ],
      transition: { type: 'evaluation', evaluationModel: 'claude-haiku-4-5-20251001', evaluationPrompt: 'If large_amount or policy_violation → waiting_human. If eligible → approved. If not eligible → resolved with rejection.' },
    },
    approved: {
      name: 'approved',
      description: 'Refund approved',
      requiredSkills: ['finalize_case'],
      transition: { type: 'manual' },
    },
    resolved: {
      name: 'resolved',
      description: 'Case resolved (approved or rejected)',
      requiredSkills: ['finalize_case'],
      guardrails: [
        { name: 'must_cite_basis', description: 'Require evidence citations', hook: 'preFinalize', rule: { allow_keywords: ['basis'] } },
      ],
      transition: { type: 'manual' },
    },
  },
}

// Default orchestrator config
export const DEFAULT_ORCHESTRATOR_CONFIG = {
  enabled: false,
  maxParallelAgents: 3,
  dispatchPrompt: 'Analyze the case and determine which specialized sub-agents to dispatch for parallel investigation.',
}

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
