// Shared default data for admin pre-fill — used by both seed.ts and API lazy init.
// Must match the built-in definitions in skills.ts and policy.ts exactly.

export const DEFAULT_SYSTEM_PROMPT = `You are Intera, a customer service assistant.

## How you work

- Respond in the same language the customer uses. If they write in Chinese, respond in Chinese. Never mix languages.
- Be concise. Prefer action over explanation.
- If you say you will check or verify something, call the corresponding tool in that same turn. Text-only promises without tool calls will trigger a correction nudge (3 attempts, then the case escalates to a human).

## Cases

When a customer reports a single clear issue, call create_case to open a tracked Case.

**If the customer reports multiple distinct issues (e.g. "account login problem AND deposit not received"), or you are unsure which case type fits best — call propose_cases instead.** List each possible case type with a one-line summary of what the customer reported. The system will show a multi-select card so the customer can choose which cases to open.

{{case_types}}

When no Case is open, just chat naturally. No need to look up records or call tools.

## When a Case is active

The case schema, current stage, required evidence, and available tools are shown above. Follow the stage requirements — the evaluator will advance you when conditions are met, or route to a human when system data conflicts with the customer's story.

{{case_schema}}
{{case_state}}

## Sub-agents

Some investigation stages dispatch parallel sub-agents. Their findings appear as [Sub-agent: ...] messages. Read and use their findings — do not re-run tools they already called.

## Policies

{{active_policies}}

## Human handoff

When system data contradicts the customer's report, call create_human_task. After the human resolves, translate their verdict into plain, friendly language for the customer.

## Memory

Facts extracted from previous turns are in confirmedFacts — trust them. Summaries from earlier context appear as [Case context].

{{session_binding}}
`;

export const DEFAULT_MEMORY_STRATEGY = {
  // Retention
  l1MaxMessages: 12,
  l2SummaryMaxTokens: 2000,
  l4MaxHistoricalCases: 5,
  keyEventExtractionPrompt: 'Extract key events from the conversation',
  maxRecentTraces: 20,
  caseRetentionDays: 90,

  // Thresholds
  // Measured as remaining tokens below context window (contextWindow - outputReserved - currentTokens).
  // Lower values = compaction fires less often (more context preserved).
  autocompactThresholdTokens: 40000,
  warningThresholdTokens: 50000,
  errorThresholdTokens: 60000,
  blockingThresholdTokens: 15000,

  // Features
  compactModel: 'MiniMax-M2.5-highspeed',
  enableSnip: true,
  enableMicrocompact: true,
  microcompactMinAgeMs: 60000,
  enableContextCollapse: true,
  enableAutocompact: true,

  // Compaction fine-tuning
  compactMaxMessages: 40,
  compactTemperature: 0.3,
  compactMaxTokensCap: 4096,
  compactMinSummaryLength: 100,
  compactionKeepMin: 6,
  compactionKeepRatio: 0.65,
  compactableTools: [
    'query_order_status',
    'query_payment_channel_status',
    'search_delay_notice',
    'read_case_history',
    'kb_hybrid_retrieve',
    'ocr_receipt',
    'query_account_status',
  ],

  // Fact extraction (LLM-based, replaces regex/keyword patterns)
  factExtractionPrompt: '',
  keyEventMaxChars: 100,

  // Token estimation
  tokensPerKeyEvent: 20,
  tokensPerFact: 15,
  tokensPerSkill: 30,
  cjkCharPerToken: 1.5,
  latinCharPerToken: 4,
  minTokenEstimate: 100,
  toolResultTokenRatio: 4,

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
  preTool: ['no_high_risk_account_change', 'investigate_before_escalation'],
  postTool: ['conflict_requires_human'],
  preFinalize: [
    'evidence_required_before_resolution',
    'no_compensation_promise',
    'must_cite_basis',
  ],
}

/** Default consultation system prompt used when AgentConfig.consultationPrompt is empty. */
export const DEFAULT_CONSULTATION_PROMPT = `You are Intera, the AI agent owning this customer case. You are consulting a human operator. Respond in the SAME LANGUAGE as the customer's case context.

# Your Role

You are the CASE OWNER. Tell the operator:
1. What you've found and what needs confirmation
2. Ask specific, actionable questions
3. Execute tools if needed
4. When done, call finalize_consultation

# How to Consult

1. Start with a summary of findings + what you need
2. Ask 1-2 specific questions
3. Call finalize_consultation when you have confirmation

# Tools

- query_order_status(txnId) / query_payment_channel_status(txnId) / search_delay_notice(channel)
- finalize_consultation(summary, resolution) — END consultation
  - summary: customer-facing message about what was resolved
  - resolution: confirmed_delayed / refund_approved / needs_more_info / resolved / false_alarm
`

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
  /** JSON string — mock executor returns this payload when mode is mock */
  mockFixture?: string
}

export const DEFAULT_SKILLS: DefaultSkillSeed[] = [
  {
    name: 'propose_cases',
    description:
      'Propose case types when the customer has multiple distinct issues or the intent is ambiguous. The customer sees a multi-select card.',
    inputSchema:
      '{"type":"object","properties":{"cases":{"type":"array","items":{"type":"object","properties":{"caseType":{"type":"string","description":"Case type slug"},"summary":{"type":"string","description":"One-line issue summary"}},"required":["caseType","summary"]}}},"required":["cases"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"proposed"}',
  },
  {
    name: 'create_case',
    description: 'Create a new Case when the customer reports an issue that needs investigation. Call this before calling case-related tools like query_order_status or query_account_status.',
    inputSchema:
      '{"type":"object","properties":{"caseType":{"type":"string","description":"Case type slug, e.g. deposit_issue, account_issue, order_issue, refund_request"},"summary":{"type":"string","description":"Brief summary of what the customer reported"}},"required":["caseType","summary"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"caseId":"case_mock_001","status":"created"}',
  },
  {
    name: 'read_case_history', description: "Read the customer's historical cases for context",
    inputSchema: '{"type":"object","properties":{"userId":{"type":"string","description":"Customer user ID"},"limit":{"type":"number","description":"Max number of cases to return","default":5}},"required":["userId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"cases":[{"id":"C2024-0892","type":"deposit_issue","status":"resolved","summary":"User deposited 500 CNY via WeChat Pay, funds credited after 2-hour delay","resolvedAt":"2024-11-15T10:30:00Z"},{"id":"C2024-1034","type":"account_issue","status":"resolved","summary":"Account temporarily restricted due to suspicious login from new device; verified identity and lifted restriction","resolvedAt":"2024-12-03T16:45:00Z"},{"id":"C2025-0017","type":"deposit_issue","status":"resolved","summary":"User reported 200 CNY missing from balance after Alipay top-up; traced to pending batch settlement, resolved within 24h","resolvedAt":"2025-01-22T09:15:00Z"}],"total":3}',
  },
  {
    name: 'query_order_status', description: 'Query the platform order system for transaction status',
    inputSchema: '{"type":"object","properties":{"txnId":{"type":"string","description":"Transaction ID"}},"required":["txnId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"txnId":"TX2026051412345678","status":"completed","amount":1000.00,"currency":"CNY","time":"2026-05-14T08:05:00.000Z","channel":"wechat_pay","paymentMethod":"WeChat Pay","merchantRef":"MCH20260514001"}',
  },
  {
    name: 'query_payment_channel_status', description: 'Query the payment channel for current status and delays',
    inputSchema: '{"type":"object","properties":{"txnId":{"type":"string","description":"Transaction ID"}},"required":["txnId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"delayed_batch":false,"channel":"wechat_pay","channelStatus":"normal","lastSettlementAt":"2026-05-14T07:55:00.000Z","currentLoad":"low","reason":null}',
  },
  {
    name: 'query_account_status',
    description: 'Query platform account/security status (restrictions, bans, risk flags, last login)',
    inputSchema:
      '{"type":"object","properties":{"userId":{"type":"string","description":"Customer platform user ID"}},"required":["userId"]}',
    mode: 'mock',
    isConcurrencySafe: true,
    enabled: true,
    guardPhase: 'post',
    outputSchema: '{}',
    mockFixture:
      '{"accountStatus":"active","riskFlag":false,"banReason":null,"restrictionTier":"none","lastLoginAt":"2026-05-14T07:50:00.000Z","kycLevel":"L2_verified","registeredSince":"2023-06-15T00:00:00.000Z","totalDeposits":12500.00,"lastDepositAt":"2026-05-14T08:05:00.000Z","lastDepositAmount":1000.00}',
  },
  {
    name: 'search_delay_notice', description: 'Search for any delay notices or announcements',
    inputSchema: '{"type":"object","properties":{"channel":{"type":"string","description":"Payment channel to search"}},"required":["channel"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"notices":[{"id":"NOT20260514-001","title":"WeChat Pay Scheduled Maintenance","channel":"wechat_pay","severity":"info","content":"WeChat Pay will undergo scheduled maintenance on 2026-05-20 02:00-04:00 UTC. Deposits may be delayed during this window.","publishedAt":"2026-05-10T00:00:00Z","affectsDeposit":false}]}',
  },
  {
    name: 'ocr_receipt', description: 'Extract information from uploaded receipt screenshots',
    inputSchema: '{"type":"object","properties":{"attachmentId":{"type":"string","description":"Attachment ID from file upload"}},"required":["attachmentId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"success":true,"extracted":{"amount":1000.00,"currency":"CNY","time":"2026-05-14T08:05:00.000Z","channel":"wechat_pay","merchantRef":"MCH20260514001","txnId":"TX2026051412345678"}}',
  },
  {
    name: 'create_human_task', description: 'Create a human task for manual confirmation or processing',
    inputSchema: '{"type":"object","properties":{"queue":{"type":"string","description":"Queue to route to"},"question":{"type":"string","description":"Question for the human operator"}},"required":["queue","question"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"taskId":"htask_mock_001","status":"pending"}',
  },
  {
    name: 'finalize_case', description: 'Mark the case as resolved with a conclusion',
    inputSchema: '{"type":"object","properties":{"conclusion":{"type":"string","description":"Case conclusion"},"basis":{"type":"array","items":{"type":"string"},"description":"Evidence basis"}},"required":["conclusion","basis"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"resolved","resolvedAt":"2026-05-01T12:00:00.000Z"}',
  },
  {
    name: 'kb_hybrid_retrieve', description: 'Hybrid knowledge base search (BM25 + vector)',
    inputSchema: '{"type":"object","properties":{"query":{"type":"string","description":"Search query"}},"required":["query"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"results":[{"title":"Why is my deposit not showing in my balance?","snippet":"Deposits via third-party payment channels (WeChat Pay, Alipay) may take up to 2 hours to reflect due to batch settlement cycles. If your deposit still does not appear after 2 hours, please contact support with your transaction ID.","source":"help_center","relevance":0.92},{"title":"Common causes of balance discrepancies","snippet":"Balance discrepancies can occur due to: (1) pending batch settlements from payment providers, (2) cached balance display (try refreshing), (3) recent refunds or adjustments not yet reflected, (4) unauthorized transactions — check your transaction history.","source":"faq","relevance":0.85},{"title":"How to verify your deposit status","snippet":"You can verify your deposit by: (1) checking the payment provider app for the transaction receipt, (2) comparing the transaction ID with our system records, (3) waiting up to 24 hours for settlement delays during peak periods or maintenance windows.","source":"help_center","relevance":0.78}],"sources":["help_center/deposit-faq","faq/balance-issues","help_center/verify-deposit"]}',
  },
  {
    name: 'request_user_input', description: 'Display a structured form to collect required information from the customer',
    inputSchema: '{"type":"object","properties":{"title":{"type":"string","description":"Form title"},"fields":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"label":{"type":"string"},"type":{"type":"string","enum":["text","number","select","textarea","file"]},"required":{"type":"boolean"},"placeholder":{"type":"string"},"options":{"type":"array","items":{"type":"string"}}},"required":["key","label","type"]}}},"required":["title","fields"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"form_displayed"}',
  },
  {
    name: 'finalize_consultation', description: 'End the human consultation with a summary and resolution',
    inputSchema: '{"type":"object","properties":{"summary":{"type":"string","description":"Customer-facing message about what was resolved"},"resolution":{"type":"string","enum":["confirmed_delayed","refund_approved","needs_more_info","resolved","false_alarm"]}},"required":["summary","resolution"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"consultation_closed"}',
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
  { name: 'investigate_before_escalation', description: 'Require investigative skills before escalating to human (create_human_task)', hook: 'preTool', rule: '{"require_skills_any":["query_order_status","query_payment_channel_status","query_account_status"]}' },
  {
    name: 'conflict_requires_human',
    description: 'Detect conflict between system result and user report',
    hook: 'postTool',
    rule: JSON.stringify({
      evaluationPrompt: [
        'Check whether the skill outputs contradict what the customer reported.',
        '',
        'Skill output: {{skill_output}}',
        'Confirmed facts: {{confirmed_facts}}',
        '',
        'Escalate to human (result=escalated) when:',
        '(1) the system shows a completed/successful transaction but the customer says funds are missing or not received,',
        '(2) the system shows account status is normal but the customer reports access issues,',
        '(3) the payment channel shows normal operation but the customer says the payment failed.',
        '',
        'If outputs are consistent with the customer issue, pass.',
        'If data is ambiguous or incomplete, hint.',
      ].join('\n'),
    }),
  },
  {
    name: 'evidence_required_before_resolution',
    description: 'Require order or account verification skill before resolution',
    hook: 'preFinalize',
    rule: '{"require_skills_any":["query_order_status","query_account_status"]}',
  },
  {
    name: 'no_compensation_promise',
    description: 'Forbid compensation/refund promises in finalize output',
    hook: 'preFinalize',
    rule: JSON.stringify({
      evaluationPrompt: [
        'Check whether the finalize conclusion promises or commits to any monetary compensation.',
        '',
        'Finalize output: {{skill_output}}',
        'Confirmed facts: {{confirmed_facts}}',
        '',
        'Block (result=blocked) if the agent promises refund, cash reimbursement, voucher with cash value, or direct financial remedy — only human operators may authorize compensation.',
        'Pass if the conclusion explains findings, policy, or next steps without committing to pay the customer.',
        'Also pass if the agent only relays what a human operator already approved.',
      ].join('\n'),
    }),
  },
  {
    name: 'must_cite_basis',
    description: 'Require evidence citations in conclusions',
    hook: 'preFinalize',
    rule: JSON.stringify({
      evaluationPrompt: [
        'Check whether the finalize conclusion references specific evidence gathered during case investigation.',
        '',
        'Finalize output: {{skill_output}}',
        'Confirmed facts: {{confirmed_facts}}',
        'Skills called: {{skills_called}}',
        '',
        'The conclusion must cite at least one of:',
        '(1) a specific skill result (e.g. query_order_status showed status=completed),',
        '(2) confirmed facts collected from the user,',
        '(3) a knowledge base article or policy reference.',
        '',
        'Block (result=blocked) if the conclusion makes claims without any factual grounding.',
        'Pass if evidence is properly cited and the reasoning is traceable to collected facts.',
      ].join('\n'),
    }),
  },
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
    type: 'account_issue',
    displayName: '账号问题',
    description:
      '用户反馈无法正常登录、账号被封禁或冻结、风控/实名提示异常、疑似被盗号、验证码或二次验证异常、设备与环境绑定争议等——核心是「账户主体与安全策略下的状态」，不含单笔充值未到账（属存款未到账）。',
    icon: '🔒',
    requiredFacts: '["userId","issueType"]',
    stages: '["created","collecting","investigating","waiting_human","resolved"]',
    defaultGoal:
      '拉取账号侧记录与知识库依据，判断是否限制/封禁/误拦；与客户自述冲突或高风险场景升级账号运营人工复核，并给出可执行的下一步。',
    escalateOn: '["high_risk","conflict"]',
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
        '工单刚开立，先简短安抚客户。如客户已提供完整信息（流水号、金额、渠道），评估器可直接进入 investigating；否则进入 collecting 用 request_user_input 收集。',
      availableSkills: ['request_user_input'],
      transition: {
        type: 'evaluation',
        evaluationModel: 'MiniMax-M2.7-highspeed',
        evaluationPrompt: `You are the stage transition evaluator for stage "created" only.

Use the Case context block: Confirmed facts, Missing facts, Skills called, Skill results, Key events.

Deposit case rules:
- If confirmedFacts already has non-empty **txnId**, **amount**, and **paymentMethod** → nextStage MUST be **investigating** (ledger verification may proceed).
- Otherwise → nextStage MUST be **collecting** so structured intake runs before any investigative tools.

Respond with JSON ONLY:
{"shouldTransition": true, "nextStage": "collecting" | "investigating", "reason": "cite which keys are present or missing"}`,
      },
    },
    collecting: {
      name: 'collecting',
      description: '向用户收集流水号、金额、渠道、时间等；用 request_user_input 表单一次收齐。表单字段 key 必须使用: txnId, amount, paymentMethod, date（与证据系统对齐）。\n\nIMPORTANT: Do NOT list the required fields in text before calling request_user_input. Call request_user_input directly in your first response — the form itself will explain what is needed. Text-only lists waste a turn and annoy the user.',
      requiredSkills: ['request_user_input'],
      availableSkills: ['request_user_input'],
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
      subAgents: [
        {
          name: 'transaction_verifier',
          model: 'MiniMax-M2.7-highspeed',
          systemPrompt: 'You are a transaction verification specialist. Verify the transaction status and payment channel status for the given case. Report findings as structured facts only — no speculation.',
          skills: ['query_order_status', 'query_payment_channel_status'],
          taskTemplate: 'Verify the transaction for case {{caseId}}. The stage goal is: {{stageGoal}}. Known facts: {{confirmedFacts}}. Missing: {{missingFacts}}. Call query_order_status and query_payment_channel_status, then report findings.',
          maxIterations: 3,
          parallel: true,
        },
        {
          name: 'history_reviewer',
          model: 'MiniMax-M2.7-highspeed',
          systemPrompt: 'You are a case history reviewer. Check if the customer has had similar issues before. Look for patterns in historical cases and knowledge base.',
          skills: ['read_case_history', 'kb_hybrid_retrieve'],
          taskTemplate: 'Review historical cases and knowledge base for patterns related to case {{caseId}}. Stage goal: {{stageGoal}}. Known facts: {{confirmedFacts}}. Look for similar past deposit issues.',
          maxIterations: 2,
          parallel: true,
        },
      ],
      transition: {
        type: 'evaluation',
        evaluationModel: 'MiniMax-M2.7-highspeed',
        evaluationPrompt: `Evaluate transition from **investigating** using ONLY Confirmed facts, Missing facts, Skills called, Skill results, Key events.

- If query_order_status / query_payment_channel_status outputs conflict with the customer's deposit narrative → **waiting_human**.
- If **txnId**, **amount**, or **paymentMethod** are missing from confirmedFacts → **collecting** (do not finalize investigation).
- If evidence supports closure → **resolved**.

Respond JSON ONLY:
{"shouldTransition": true/false, "nextStage": "collecting"|"investigating"|"waiting_human"|"resolved", "reason": "..."}`,
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
      transition: { type: 'evaluation', evaluationModel: 'MiniMax-M2.7-highspeed', evaluationPrompt: 'Check if order details are verified. If order found and matches → investigating. If missing info → back to collecting.' },
    },
    investigating: {
      name: 'investigating',
      description: 'Investigate order issue',
      requiredSkills: ['query_payment_channel_status'],
      availableSkills: ['query_order_status', 'query_payment_channel_status', 'search_delay_notice', 'read_case_history', 'kb_hybrid_retrieve'],
      subAgents: [
        {
          name: 'order_verifier',
          model: 'MiniMax-M2.7-highspeed',
          systemPrompt: 'You are an order verification specialist. Verify the order status and check for any platform notices or delays.',
          skills: ['query_order_status', 'query_payment_channel_status', 'search_delay_notice'],
          taskTemplate: 'Verify order for case {{caseId}}. Stage goal: {{stageGoal}}. Known facts: {{confirmedFacts}}. Check order status, payment channel, and any delay notices.',
          maxIterations: 3,
          parallel: true,
        },
      ],
      transition: { type: 'evaluation', evaluationModel: 'MiniMax-M2.7-highspeed', evaluationPrompt: 'If conflict detected → waiting_human. If resolved → resolved.' },
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
      transition: { type: 'manual' },
    },
  },
  account_issue: {
    created: {
      name: 'created',
      description:
        '工单刚开立，先简短安抚客户。如客户已提供 userId 和问题类型，评估器可直接进入 investigating；否则进入 collecting 用 request_user_input 收集。',
      availableSkills: ['request_user_input'],
      transition: {
        type: 'evaluation',
        evaluationModel: 'MiniMax-M2.7-highspeed',
        evaluationPrompt: `Stage transition evaluator for **created** only.

Use Confirmed facts, Missing facts, Skills called, Skill results, Key events.

Rules:
- If **userId** and **issueType** are present (non-empty in confirmedFacts) → nextStage **investigating**.
- Else → nextStage **collecting**.

JSON ONLY:
{"shouldTransition": true, "nextStage": "collecting"|"investigating", "reason": "..."}`,
      },
    },
    collecting: {
      name: 'collecting',
      description:
        '收集用户标识、问题类型与现象描述；用 request_user_input 一次性收集。表单字段 key 必须使用: userId, issueType, symptoms（与证据系统对齐）。\n\nIMPORTANT: Do NOT list the required fields in text before calling request_user_input. Call request_user_input directly in your first response — the form itself will explain what is needed. Text-only lists waste a turn and annoy the user.',
      requiredSkills: ['request_user_input'],
      availableSkills: ['request_user_input'],
      evidenceRequirements: [
        { factKey: 'userId', description: '平台用户 ID / UID', source: 'user_input', required: true },
        {
          factKey: 'issueType',
          description: '问题类型（登录失败 / 封号 / 风控提示 / 疑似盗号 / 验证异常等）',
          source: 'user_input',
          required: true,
        },
        {
          factKey: 'symptoms',
          description: '现象简述（报错码、页面提示、大概起始时间）',
          source: 'user_input',
          required: false,
        },
      ],
      transition: { type: 'auto', conditions: [{ type: 'all_evidence_gathered' }] },
    },
    investigating: {
      name: 'investigating',
      description:
        '并行核对账号侧快照与历史工单/政策条目；若 records 与用户说法冲突，准备人工复核话术。',
      requiredSkills: ['query_account_status', 'read_case_history'],
      availableSkills: [
        'query_account_status',
        'read_case_history',
        'kb_hybrid_retrieve',
        'request_user_input',
      ],
      evidenceRequirements: [
        {
          factKey: 'accountStatus',
          description: 'query_account_status 返回的账户状态（mock 字段 `accountStatus`）',
          source: 'skill_output',
          skillName: 'query_account_status',
          required: true,
        },
        {
          factKey: 'total',
          description: 'read_case_history 已执行且返回历史工单计数（字段 `total`）',
          source: 'skill_output',
          skillName: 'read_case_history',
          required: true,
        },
      ],
      subAgents: [
        {
          name: 'account_platform_checker',
          model: 'MiniMax-M2.7-highspeed',
          systemPrompt:
            'You are an account security specialist. Query platform account status only — structured facts, no speculation.',
          skills: ['query_account_status'],
          taskTemplate:
            'Check account/security status for case {{caseId}}. Stage goal: {{stageGoal}}. Known facts: {{confirmedFacts}}. Missing: {{missingFacts}}. Call query_account_status with userId from facts.',
          maxIterations: 3,
          parallel: true,
        },
        {
          name: 'account_history_policy',
          model: 'MiniMax-M2.7-highspeed',
          systemPrompt:
            'You review historical tickets and KB articles for ban patterns, appeal flows, and known outages.',
          skills: ['read_case_history', 'kb_hybrid_retrieve'],
          taskTemplate:
            'For case {{caseId}}, review prior cases and KB for patterns matching the issue type. Stage goal: {{stageGoal}}. Facts: {{confirmedFacts}}. Use read_case_history and kb_hybrid_retrieve.',
          maxIterations: 3,
          parallel: true,
        },
      ],
      transition: {
        type: 'evaluation',
        evaluationModel: 'MiniMax-M2.7-highspeed',
        evaluationPrompt:
          'If account_status conflicts with customer narrative or risk_flag/ban → waiting_human (account_ops). If KB indicates mandatory human appeal → waiting_human. If status is clearly explained with evidence → resolved. If facts still missing → collecting.',
      },
    },
    waiting_human: {
      name: 'waiting_human',
      description: '等待账号运营或风控人工复核',
      requiredSkills: ['create_human_task'],
      transition: { type: 'manual' },
    },
    resolved: {
      name: 'resolved',
      description: '结案并向客户说明依据与下一步',
      requiredSkills: ['finalize_case'],
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
      transition: { type: 'evaluation', evaluationModel: 'MiniMax-M2.7-highspeed', evaluationPrompt: 'If large_amount or policy_violation → waiting_human. If eligible → approved. If not eligible → resolved with rejection.' },
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
      transition: { type: 'manual' },
    },
  },
}

// Default orchestrator config
export const DEFAULT_ORCHESTRATOR_CONFIG = {
  enabled: true,
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
    queue: 'account_ops',
    description: 'Account & security — login failures, bans, risk flags, appeals',
    skillsAllowed: '["query_account_status","read_case_history","kb_hybrid_retrieve"]',
    priority: 0,
  },
  {
    queue: 'general', description: 'General support queue for account and other issues',
    skillsAllowed: '["read_case_history","kb_hybrid_retrieve"]',
    priority: 1,
  },
]
