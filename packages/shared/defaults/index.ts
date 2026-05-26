// Shared default data for admin pre-fill — used by both seed.ts and API lazy init.
// Must match the built-in definitions in skills.ts and policy.ts exactly.

export const DEFAULT_SYSTEM_PROMPT = `You are Intera, a customer service assistant.

## How you work

- Respond in the same language the customer uses. If they write in Chinese, respond in Chinese. Never mix languages.
- Be concise. Prefer action over explanation.
- If you say you will check or verify something, call the corresponding tool in that same turn. Text-only promises without tool calls will trigger a correction nudge (3 attempts, then the case escalates to a human).

## Cases

When a customer reports a single clear issue, call create_case FIRST — before any lookup tools. The case system manages structured investigation. Do not call get_latest_deposit, get_transaction_history, or similar tools before creating the case.

**Call propose_cases ONLY when the customer explicitly mentions two or more separate problems in a single message** (e.g. "I can't log in AND my deposit didn't arrive"). Do NOT call propose_cases because you are "unsure" — if the customer describes one situation, pick the best-matching case type and call create_case directly. When in doubt between two similar types, choose the one most relevant to the customer's primary complaint. propose_cases is for genuine multi-issue messages, not for hedging.

{{case_types}}

When no Case is open, just chat naturally. No need to look up records or call tools.

## When a Case is active

The case schema, current stage, required evidence, and available tools are shown above. Follow the stage requirements — the evaluator will advance you when conditions are met, or route to a human when system data conflicts with the customer's story.

{{case_schema}}
{{case_state}}

## Sub-agents

Some investigation stages dispatch parallel sub-agents. Their findings appear as [Sub-agent: ...] messages. Read and use their findings for context — do not re-run tools they already called.

**CRITICAL:** Sub-agent findings may contain reference transaction IDs, amounts, or channel names from similar cases or system lookups. These are context clues, NOT verified facts about the current case. When calling query tools (query_order_status, query_payment_channel_status, etc.), always use values from **confirmedFacts** — the customer's own reported data. Never substitute a sub-agent's txnId for the customer's confirmed txnId.

## Policies

{{active_policies}}

## Human handoff

Call create_human_task **only after** investigation tools (query_order_status, query_payment_channel_status, get_account_status, get_kyc_status, etc.) have returned data that conflicts with the customer's report. Do not escalate based on preliminary lookups (e.g. get_latest_deposit) or your own inference alone — always complete the required investigation for the current stage first.

After the human resolves the task, translate their verdict into plain, friendly language for the customer.

## Memory

Facts extracted from previous turns are in confirmedFacts — trust them. Summaries from earlier context appear as [Case context].

{{session_binding}}
`;

/** Lightweight prompt for Core (discovery) mode — no case active.
 *  Focused on conversation routing, direct tool calls, and case creation.
 *  Does NOT include stage requirements, sub-agents, policies, or human handoff. */
export const CORE_SYSTEM_PROMPT = `You are Intera, a customer service assistant.

## How you work

- Respond in the same language the customer uses. If they write in Chinese, respond in Chinese. Never mix languages.
- Be concise. Prefer action over explanation.
- If you say you will check or verify something, call the corresponding tool in that same turn.
- **Never tell the customer to contact customer service themselves.** If an issue requires human intervention, call create_case — that IS how you help them. Saying "请联系客服" or "contact customer service" without creating a case is a failed response.

## When to create a Case

If the customer is reporting a **problem** — something not working, stuck, missing, or wrong — call **create_case** before calling any investigation tools for that problem. The case system provides forms, human escalation, and structured workflows that are only available after case creation.

Problem signals (→ create_case first):
- "取不了款" / "提现失败" / "不到账" / "被冻结" / "登录不了" / "被封号"
- "can't withdraw" / "deposit didn't arrive" / "account locked" / "stuck"
- Any complaint where the customer expects something to happen but it isn't

Simple inquiry signals (→ just answer with lookup tools, no case needed):
- "我余额多少" / "有什么优惠" / "推荐什么游戏" / "提现规则是什么"
- "what's my balance" / "any promotions" / "game recommendations" / "withdrawal rules"

**When in doubt, create a case.** A case can be resolved quickly if the issue turns out to be simple, but skipping case creation when it IS needed cripples the investigation.

{{case_types}}

**Call propose_cases ONLY when the customer explicitly mentions two or more separate problems in a single message** (e.g. "I can't log in AND my deposit didn't arrive"). Do NOT call propose_cases because you are "unsure" — pick the best-matching case type and call create_case directly.

## Tools you can use for simple inquiries (no case needed)

- **kb_hybrid_retrieve** — search knowledge base articles for FAQ / policy answers
- **get_account_status** — check account state, balance, or verification status
- **get_kyc_status** — check identity verification progress
- **get_latest_deposit** / **get_latest_withdrawal** — check recent transaction status
- **get_transaction_history** — query past transaction records
- **get_bet_history** — query betting/game records
- **get_active_promotions** / **get_eligible_promotions** — check available promotions
- **get_recommended_games** — get game recommendations
- **get_withdraw_conditions** — check withdrawal rules and limits
- **read_case_history** — review the customer's past cases for context

Use these freely for simple questions. But if the customer is reporting a problem with any of these areas, call create_case first — do not use these tools as a substitute for creating a case.

## When NOT to create a Case

For greetings ("hi", "hello"), FAQ questions, general information requests, or simple lookups — just answer naturally. Use tools if they help, but don't open a case.

{{session_binding}}
`;

/** Case-execution prompt — used when a case is active and past the "created" stage.
 *  Stage-driven, policy-enforced, with sub-agent and human-handoff awareness. */
export const CASE_SYSTEM_PROMPT = `You are Intera, handling an active customer case. Follow the stage requirements.

## How you work

- Respond in the same language the customer uses.
- Be concise. Prefer action over explanation.
- If you say you will check or verify something, call the corresponding tool in that same turn. Text-only promises without tool calls will trigger a correction nudge (3 attempts, then the case escalates to a human).

## Case context

The case schema, current stage, required evidence, and available tools are shown below. Follow the stage requirements — the evaluator will advance you when conditions are met, or route to a human when system data conflicts with the customer's story.

{{case_schema}}
{{case_state}}

## Sub-agents

Some investigation stages dispatch parallel sub-agents. Their findings appear as [Sub-agent: ...] messages. Read and use their findings for context — do not re-run tools they already called.

**CRITICAL:** Sub-agent findings may contain reference transaction IDs, amounts, or channel names from similar cases or system lookups. These are context clues, NOT verified facts about the current case. When calling query tools (query_order_status, query_payment_channel_status, etc.), always use values from **confirmedFacts** — the customer's own reported data. Never substitute a sub-agent's txnId for the customer's confirmed txnId.

## Policies

{{active_policies}}

## Human handoff

Call create_human_task **only after** investigation tools (query_order_status, query_payment_channel_status, get_account_status, get_kyc_status, etc.) have returned data that conflicts with the customer's report. Do not escalate based on preliminary lookups (e.g. get_latest_deposit) or your own inference alone — always complete the required investigation for the current stage first.

After the human resolves the task, translate their verdict into plain, friendly language for the customer.

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
export const DEFAULT_CONSULTATION_PROMPT = `You are Intera, the AI agent owning this customer case. You are consulting a human operator (your colleague, NOT the customer).

# CRITICAL — Who You Are Talking To

The person messaging you is a HUMAN OPERATOR / SPECIALIST — not the customer. They are your colleague helping you resolve the case. NEVER greet them as a customer, NEVER ask them for account verification, NEVER welcome them to a support channel. Get straight to business.

# Your Role

You are the CASE OWNER. Tell the operator:
1. What you've found and what needs confirmation
2. Ask specific, actionable questions about the case
3. Execute tools if needed to investigate
4. When done, call finalize_consultation

# How to Consult

1. Start directly with a brief summary of findings and what you need from the operator
2. Ask 1-2 specific, focused questions
3. Be concise — the operator is busy
4. Call finalize_consultation when you have what you need
5. If the operator says "hi" or greets you, respond briefly and immediately state what you need for the case

# Tools

- get_account_status / get_kyc_status / get_transaction_history — lookup account info
- query_order_status(txnId) / query_payment_channel_status(txnId) / search_delay_notice(channel)
- read_case_history — check prior cases for this customer
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
4. After sending the update, you MUST call finalize_case with a conclusion summarizing the resolution and the operator's findings as the basis. Do NOT wait for the customer to respond — finalize immediately after relaying the verdict.
5. If the operator asked for more information instead of resolving, continue assisting without calling finalize_case.`

/** Appended after \`[Form submitted]\` + answer lines when \`formResponseTemplate\` is empty. */
export const HARNESS_DEFAULT_FORM_RESPONSE_APPEND =
  'Please continue processing based on this information.'

export interface DefaultSkillSeed {
  name: string
  displayVerb?: { text: string; icon: string }
  description: string
  inputSchema: string
  outputSchema: string
  mode: string
  isConcurrencySafe: boolean
  enabled: boolean
  guardPhase: string
  /** JSON string — mock executor returns this payload when mode is mock */
  mockFixture?: string
  /** HTTP endpoint path (appended to base URL for http-mode skills) */
  endpoint?: string
  httpMethod?: string
  /** JSON string — extra HTTP headers */
  headers?: string
  timeoutMs?: number
}

export const DEFAULT_SKILLS: DefaultSkillSeed[] = [
  {
    name: 'propose_cases',
    displayVerb: { text: 'Analyzing your issue', icon: 'dots' },
    description:
      'Propose case types when the customer has multiple distinct issues or the intent is ambiguous. The customer sees a multi-select card.',
    inputSchema:
      '{"type":"object","properties":{"cases":{"type":"array","items":{"type":"object","properties":{"caseType":{"type":"string","description":"Case type slug"},"summary":{"type":"string","description":"One-line issue summary"}},"required":["caseType","summary"]}}},"required":["cases"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"proposed"}',
  },
  {
    name: 'create_case',
    displayVerb: { text: 'Creating your case', icon: 'dots' },
    description: 'Create a new Case when the customer reports an issue that needs investigation. IMPORTANT: Call create_case BEFORE any lookup tools (get_latest_deposit, get_transaction_history, query_order_status, etc.). Do not investigate first — the case system manages investigation stages. Only use lookup tools directly when the customer asks a simple informational question, NOT when they report a problem.',
    inputSchema:
      '{"type":"object","properties":{"caseType":{"type":"string","description":"Case type slug, e.g. deposit_issue, account_issue, order_issue, refund_request"},"summary":{"type":"string","description":"Brief summary of what the customer reported"}},"required":["caseType","summary"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"caseId":"case_mock_001","status":"created"}',
  },
  {
    name: 'read_case_history',
    displayVerb: { text: 'Looking up past cases', icon: 'scan' },
    description: "Read the customer's historical cases for context",
    inputSchema: '{"type":"object","properties":{"userId":{"type":"string","description":"Customer user ID"},"limit":{"type":"number","description":"Max number of cases to return","default":5}},"required":["userId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"cases":[{"id":"C2024-0892","type":"deposit_issue","status":"resolved","summary":"User deposited 500 CNY via WeChat Pay, funds credited after 2-hour delay","resolvedAt":"2024-11-15T10:30:00Z"},{"id":"C2024-1034","type":"account_issue","status":"resolved","summary":"Account temporarily restricted due to suspicious login from new device; verified identity and lifted restriction","resolvedAt":"2024-12-03T16:45:00Z"},{"id":"C2025-0017","type":"deposit_issue","status":"resolved","summary":"User reported 200 CNY missing from balance after Alipay top-up; traced to pending batch settlement, resolved within 24h","resolvedAt":"2025-01-22T09:15:00Z"}],"total":3}',
  },
  {
    name: 'query_order_status',
    displayVerb: { text: 'Checking order status', icon: 'scan' },
    description: 'Query the platform order system for transaction status',
    inputSchema: '{"type":"object","properties":{"txnId":{"type":"string","description":"Transaction ID"}},"required":["txnId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"txnId":"TX2026051412345678","status":"completed","amount":1000.00,"currency":"CNY","time":"2026-05-14T08:05:00.000Z","channel":"wechat_pay","paymentMethod":"WeChat Pay","merchantRef":"MCH20260514001"}',
  },
  {
    name: 'query_payment_channel_status',
    displayVerb: { text: 'Verifying payment channel', icon: 'scan' },
    description: 'Query the payment channel for current status and delays',
    inputSchema: '{"type":"object","properties":{"txnId":{"type":"string","description":"Transaction ID"}},"required":["txnId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"delayed_batch":false,"channel":"wechat_pay","channelStatus":"normal","lastSettlementAt":"2026-05-14T07:55:00.000Z","currentLoad":"low","reason":null}',
  },
  {
    name: 'search_delay_notice',
    displayVerb: { text: 'Checking platform announcements', icon: 'dots' },
    description: 'Search for any delay notices or announcements',
    inputSchema: '{"type":"object","properties":{"channel":{"type":"string","description":"Payment channel to search"}},"required":["channel"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"notices":[{"id":"NOT20260514-001","title":"WeChat Pay Scheduled Maintenance","channel":"wechat_pay","severity":"info","content":"WeChat Pay will undergo scheduled maintenance on 2026-05-20 02:00-04:00 UTC. Deposits may be delayed during this window.","publishedAt":"2026-05-10T00:00:00Z","affectsDeposit":false}]}',
  },
  {
    name: 'ocr_receipt',
    displayVerb: { text: 'Reading your receipt', icon: 'spin' },
    description: 'Extract information from uploaded receipt screenshots',
    inputSchema: '{"type":"object","properties":{"attachmentId":{"type":"string","description":"Attachment ID from file upload"}},"required":["attachmentId"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture:
      '{"success":true,"extracted":{"amount":1000.00,"currency":"CNY","time":"2026-05-14T08:05:00.000Z","channel":"wechat_pay","merchantRef":"MCH20260514001","txnId":"TX2026051412345678"}}',
  },
  {
    name: 'create_human_task',
    displayVerb: { text: 'Escalating to a specialist', icon: 'pulse' },
    description: 'Create a human task for manual confirmation or processing',
    inputSchema: '{"type":"object","properties":{"queue":{"type":"string","description":"Queue to route to"},"question":{"type":"string","description":"Question for the human operator"}},"required":["queue","question"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"taskId":"htask_mock_001","status":"pending"}',
  },
  {
    name: 'finalize_case',
    displayVerb: { text: 'Wrapping up your case', icon: 'spin' },
    description: 'Mark the case as resolved with a conclusion',
    inputSchema: '{"type":"object","properties":{"conclusion":{"type":"string","description":"Case conclusion"},"basis":{"type":"array","items":{"type":"string"},"description":"Evidence basis"}},"required":["conclusion","basis"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"resolved","resolvedAt":"2026-05-01T12:00:00.000Z"}',
  },
  {
    name: 'kb_hybrid_retrieve',
    displayVerb: { text: 'Searching knowledge base', icon: 'dots' },
    description: 'Search the GPTBots knowledge base for FAQ, policy, and reference answers. Returns matched content chunks with relevance scores.',
    inputSchema: '{"type":"object","properties":{"query":{"type":"string","description":"Search query"},"topK":{"type":"number","description":"Number of results","default":5},"sourceName":{"type":"string","description":"Optional: specific knowledge source to search"}},"required":["query"]}',
    mode: 'http',
    endpoint: 'https://api-sg.gptbots.ai/v1/vector/match',
    httpMethod: 'POST',
    headers: '{"Authorization":"Bearer ${GPTBOTS_API_KEY}"}',
    timeoutMs: 10000,
    isConcurrencySafe: true,
    enabled: true,
    guardPhase: 'post',
    outputSchema: '{}',
  },
  {
    name: 'propose_interaction',
    displayVerb: { text: 'Asking you a question', icon: 'pulse' },
    description: 'Present a choice card with options the customer can select (non-blocking, replaced by agent continuation)',
    inputSchema: '{"type":"object","properties":{"title":{"type":"string"},"description":{"type":"string"},"options":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"label":{"type":"string"},"description":{"type":"string"},"inputType":{"type":"string","enum":["none","text","number"]},"inputPlaceholder":{"type":"string"}},"required":["id","label"]}},"multiSelect":{"type":"boolean"}},"required":["title","options"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"presented"}',
  },
  {
    name: 'request_user_input',
    displayVerb: { text: 'Preparing your information form', icon: 'pulse' },
    description: 'Display a structured form to collect required information from the customer',
    inputSchema: '{"type":"object","properties":{"title":{"type":"string","description":"Form title"},"fields":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"label":{"type":"string"},"type":{"type":"string","enum":["text","number","select","textarea","file"]},"required":{"type":"boolean"},"placeholder":{"type":"string"},"options":{"type":"array","items":{"type":"string"}}},"required":["key","label","type"]}}},"required":["title","fields"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"form_displayed"}',
  },
  {
    name: 'refund_money',
    displayVerb: { text: 'Processing refund', icon: 'spin' },
    description: 'Process a refund to the customer (high-risk — blocked by no_high_risk_account_change policy until admin review)',
    inputSchema: '{"type":"object","properties":{"txnId":{"type":"string"},"amount":{"type":"number"},"reason":{"type":"string"}},"required":["txnId","amount","reason"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: false, guardPhase: 'pre', outputSchema: '{}',
    mockFixture: '{"status":"refunded"}',
  },
  {
    name: 'change_ban_status',
    displayVerb: { text: 'Updating account status', icon: 'pulse' },
    description: 'Modify a user account restriction status (high-risk — blocked by no_high_risk_account_change policy until admin review)',
    inputSchema: '{"type":"object","properties":{"userId":{"type":"string"},"action":{"type":"string","enum":["ban","unban","restrict"]},"reason":{"type":"string"}},"required":["userId","action","reason"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: false, guardPhase: 'pre', outputSchema: '{}',
    mockFixture: '{"status":"updated"}',
  },
  {
    name: 'delete_account',
    displayVerb: { text: 'Processing account deletion', icon: 'spin' },
    description: 'Permanently delete a user account (high-risk — blocked by no_high_risk_account_change policy until admin review)',
    inputSchema: '{"type":"object","properties":{"userId":{"type":"string"},"reason":{"type":"string"}},"required":["userId","reason"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: false, guardPhase: 'pre', outputSchema: '{}',
    mockFixture: '{"status":"deleted"}',
  },
  {
    name: 'finalize_consultation',
    displayVerb: { text: 'Closing consultation', icon: 'spin' },
    description: 'End the human consultation with a summary and resolution',
    inputSchema: '{"type":"object","properties":{"summary":{"type":"string","description":"Customer-facing message about what was resolved"},"resolution":{"type":"string","enum":["confirmed_delayed","refund_approved","needs_more_info","resolved","false_alarm"]}},"required":["summary","resolution"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"consultation_closed"}',
  },
  {
    name: 'get_account_status',
    displayVerb: { text: 'Checking account status', icon: 'scan' },
    description: '查询账户状态（登录失败、账户锁定等）。当用户无法登录、账户被锁、登录失败时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/account-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_kyc_status',
    displayVerb: { text: 'Verifying identity status', icon: 'scan' },
    description: '查询KYC身份验证状态及当前卡住的阶段。当用户询问KYC进度、身份验证状态时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/user-kyc-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_active_promotions',
    displayVerb: { text: 'Checking active promotions', icon: 'dots' },
    description: '查询当前生效的流水优惠活动。当用户询问有哪些优惠活动、当前流水优惠时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/promotion-active-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_withdraw_conditions',
    displayVerb: { text: 'Checking withdrawal conditions', icon: 'scan' },
    description: '查询打码量提现条件。当用户询问打码量是否足够、提现需要多少流水时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"},"gmt":{"type":"string","description":"时区，默认 -4:00","default":"-4:00"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/withdraw-condition',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_eligible_promotions',
    displayVerb: { text: 'Checking eligible promotions', icon: 'dots' },
    description: '查询用户可参与的优惠活动。当用户询问如何参与活动、领取优惠时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"},"language":{"type":"string","description":"语言，默认 en-bd","default":"en-bd"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/promotion-eligible-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_latest_withdrawal',
    displayVerb: { text: 'Checking withdrawal status', icon: 'scan' },
    description: '查询最新取款状态及已过时间。当用户询问取款进度、是否到账时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"},"gmt":{"type":"string","description":"时区，默认 -04:00","default":"-04:00"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/get-latest-withdraw-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_latest_deposit',
    displayVerb: { text: 'Checking deposit status', icon: 'scan' },
    description: '查询最新存款到账状态。当用户询问存款是否到账、充值进度时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"},"gmt":{"type":"string","description":"时区，默认 -4:00","default":"-4:00"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/get-latest-deposit-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_transaction_history',
    displayVerb: { text: 'Loading transaction history', icon: 'scan' },
    description: '查询最近5条存取款交易记录。当用户询问交易记录、充值/提现记录时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"},"method":{"type":"string","description":"deposit 或 withdraw","enum":["deposit","withdraw"]}},"required":["member_id","method"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/deposit-withdrawal-history',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_recommended_games',
    displayVerb: { text: 'Loading game recommendations', icon: 'dots' },
    description: '获取推荐/热门游戏列表。当用户询问有什么推荐游戏、热门游戏时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/top-hot-game-list',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_bet_history',
    displayVerb: { text: 'Loading bet history', icon: 'scan' },
    description: '查询游戏下注历史。当用户询问投注记录、下注历史、游戏记录时调用。',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"用户的 member ID（从会话上下文中获取当前用户ID）"},"from_date":{"type":"string","description":"开始日期，格式 YYYY-MM-DD HH:mm:ss"},"to_date":{"type":"string","description":"结束日期，格式 YYYY-MM-DD HH:mm:ss"}},"required":["member_id","from_date","to_date"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/user-bet-history-summary',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'todo_write',
    displayVerb: { text: 'Updating task list', icon: 'dots' },
    description: 'Create or update a structured todo list. Use to plan complex investigations, track progress, and communicate current state.',
    inputSchema: '{"type":"object","properties":{"todos":{"type":"array","description":"The complete todo list to persist","items":{"type":"object","properties":{"id":{"type":"string","description":"Unique identifier"},"content":{"type":"string","description":"What needs to be done"},"status":{"type":"string","enum":["pending","in_progress","completed","cancelled"]},"notes":{"type":"string","description":"Optional findings"}},"required":["id","content","status"]}}},"required":["todos"]}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"ok":true,"todos":[]}',
  },
  {
    name: 'todo_read',
    displayVerb: { text: 'Reviewing task list', icon: 'scan' },
    description: 'Read the current todo list to see pending, in-progress, and completed items.',
    inputSchema: '{"type":"object","properties":{}}',
    mode: 'mock', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"todos":[]}',
  },
  {
    name: 'finalize_sub_agent',
    displayVerb: { text: 'Finalizing sub-agent report', icon: 'spin' },
    description: '子代理完成任务后调用，将调查结果返回给主 Agent。调用后子代理循环终止。',
    inputSchema: '{"type":"object","properties":{"findings":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"value":{}}},"description":"调查发现的事实列表"},"evidence":{"type":"array","items":{"type":"string"},"description":"支持结论的证据引用"},"recommendation":{"type":"string","description":"建议的后续行动"}},"required":["findings","recommendation"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: true, guardPhase: 'post', outputSchema: '{}',
    mockFixture: '{"status":"finalized"}',
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
  { name: 'investigate_before_escalation', description: 'Require investigative skills before escalating to human (create_human_task)', hook: 'preTool', rule: '{"hook_skills":["create_human_task"],"require_skills_any":["query_order_status","query_payment_channel_status","get_account_status","get_kyc_status"]}' },
  {
    name: 'conflict_requires_human',
    description: 'Detect conflict between system result and user report',
    hook: 'postTool',
    rule: JSON.stringify({
      hook_skills: ['query_order_status', 'query_payment_channel_status', 'get_account_status', 'get_kyc_status'],
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
    rule: '{"require_skills_any":["query_order_status","get_account_status","get_kyc_status"]}',
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
  enabled?: boolean
  requireHumanReview?: boolean
}

export const DEFAULT_CASE_TYPES: DefaultCaseTypeSeed[] = [
  {
    type: 'deposit_issue',
    displayName: '存款未到账',
    description:
      '用户反映已向平台充值或划转资金（银行卡、支付宝、微信、USDT 等），但账户余额未增加或未看到到账确认；包含「扣款成功但余额没变」「流水有、游戏/钱包里没点数」「长时间未到账」等说法。',
    icon: '💰',
    requiredFacts: '["txnId","amount","paymentMethod","date"]',
    stages: '["created","collecting","investigating","resolved"]',
    defaultGoal: '核实订单与支付渠道状态，判断是否延迟、失败或需补单；系统与客户说法冲突时升级人工核查。',
    escalateOn: '["conflict"]',
    requireHumanReview: true,
  },
  {
    type: 'order_issue', displayName: '订单问题', description: 'Customer reports an order status issue',
    icon: '📦',
    requiredFacts: '["orderId","issueType"]',
    stages: '["created","collecting","investigating","resolved"]',
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
    stages: '["created","collecting","investigating","resolved"]',
    defaultGoal:
      '拉取账号侧记录与知识库依据，判断是否限制/封禁/误拦；与客户自述冲突或高风险场景升级账号运营人工复核，并给出可执行的下一步。',
    escalateOn: '["high_risk","conflict"]',
  },
  {
    type: 'refund_request', displayName: '退款申请', description: 'Customer requests a refund',
    icon: '↩️',
    requiredFacts: '["orderId","amount","reason"]',
    stages: '["created","collecting","reviewing","resolved"]',
    defaultGoal: '审核退款申请并给出结论',
    escalateOn: '["large_amount","policy_violation"]',
    requireHumanReview: true,
  },
  {
    type: 'withdrawal_issue',
    displayName: '提现问题',
    description: '用户反映提现未到账、提现进度不明、打码量不足无法提现等问题',
    icon: '💸',
    requiredFacts: '["member_id","issueType"]',
    stages: '["created","collecting","investigating","resolved"]',
    defaultGoal: '查询取款状态与打码量条件，判断是否延迟、不足或被拒；与客户说法冲突时升级人工',
    escalateOn: '["conflict"]',
    requireHumanReview: true,
  },
  {
    type: 'promotion_inquiry',
    displayName: '优惠咨询',
    description: '用户询问优惠活动、参与条件、打码量要求、流水进度等',
    icon: '🎁',
    requiredFacts: '["member_id"]',
    stages: '["created","investigating","resolved"]',
    defaultGoal: '查询用户优惠状态与参与条件，告知可参与的活动与提现流水要求',
    escalateOn: '["conflict"]',
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
      description: '向用户收集流水号、金额、渠道、时间等；用 request_user_input 表单一次收齐。表单字段 key 必须使用: txnId, amount, paymentMethod, date（与证据系统对齐）。\n\nIMPORTANT: Do NOT list the required fields in text before calling request_user_input. Call request_user_input directly in your first response — the form itself will explain what is needed. Text-only lists waste a turn and annoy the user.\n\nIMPORTANT: After the form is submitted and all facts are confirmed, do NOT call create_human_task or any investigation tool yet. The system will automatically advance to the investigating stage — wait for that transition before querying order or channel status.',
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
      description: `使用 confirmedFacts 中的 txnId 调用订单与渠道技能核对平台记录。

**CRITICAL — which txnId to use:**
query_order_status 和 query_payment_channel_status 的 txnId 参数必须使用 **confirmedFacts.txnId**（客户提供的流水号）。子代理 findings 中出现的 txnId 是反查参考数据，不是客户的交易号——严禁将子代理返回的 txnId 传入查询工具。客户报 TX101 就查 TX101，不要被子代理的 TX2026... 格式带偏。

**调查顺序：**
1. 调用 query_order_status（传入 confirmedFacts.txnId）和 query_payment_channel_status — 必须同一轮完成，不要分两轮调用。
2. 如有必要可调用 read_case_history 查历史工单、search_delay_notice 查公告、kb_hybrid_retrieve 查知识库。

**结果判断：**
- query_order_status 返回的 txnId 与 confirmedFacts.txnId 不符（订单未找到或记录属于别的交易）→ 视为"订单查无此号"，直接调用 create_human_task，不要再问用户确认 txnId。
- 订单状态、金额或渠道与用户报告冲突 → 直接调用 create_human_task。
- 渠道有延迟批处理（delayed_batch: true）→ 告知预计到账时间，走 resolved。
- 数据一致且订单已处理 → 走 resolved。

若发现需要客户补充信息（截图等），必须用 request_user_input 表单收集，禁止纯文本提问。`,
      requiredSkills: ['query_order_status', 'query_payment_channel_status'],
      availableSkills: ['query_order_status', 'query_payment_channel_status', 'search_delay_notice', 'read_case_history', 'kb_hybrid_retrieve', 'request_user_input'],
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
      transition: {
        type: 'evaluation',
        evaluationModel: 'MiniMax-M2.7-highspeed',
        evaluationPrompt: `Evaluate transition from **investigating** using ONLY Confirmed facts, Missing facts, Skills called, Skill results, Key events.

- If query_order_status returned a record whose txnId differs from confirmedFacts.txnId, OR returned "not found" → treat as unresolvable conflict, nextStage stays investigating (agent should call create_human_task).
- If query_order_status / query_payment_channel_status outputs conflict with the customer's deposit narrative (amount, channel, status mismatch) → agent should call create_human_task; stay in investigating.
- If **txnId**, **amount**, or **paymentMethod** are missing from confirmedFacts → **collecting**.
- If evidence supports closure (order confirmed, no conflict) → **resolved**.

Respond JSON ONLY:
{"shouldTransition": true/false, "nextStage": "collecting"|"investigating"|"resolved", "reason": "..."}`,
      },
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
      transition: { type: 'evaluation', evaluationModel: 'MiniMax-M2.7-highspeed', evaluationPrompt: 'If conflict detected → call create_human_task. If resolved → resolved.' },
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
      requiredSkills: ['get_account_status', 'get_kyc_status', 'read_case_history'],
      availableSkills: [
        'get_account_status',
        'get_kyc_status',
        'read_case_history',
        'kb_hybrid_retrieve',
        'request_user_input',
      ],
      evidenceRequirements: [
        {
          factKey: 'accountStatus',
          description: 'get_account_status 返回的账户状态（字段 `data.status`）',
          source: 'skill_output',
          skillName: 'get_account_status',
          required: true,
        },
        {
          factKey: 'kycStatus',
          description: 'get_kyc_status 返回的KYC状态（字段 `data.kyc_status`）',
          source: 'skill_output',
          skillName: 'get_kyc_status',
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
            'You are an account security specialist. Query platform account status and KYC status — structured facts, no speculation.',
          skills: ['get_account_status', 'get_kyc_status'],
          taskTemplate:
            'Check account and KYC status for case {{caseId}}. Stage goal: {{stageGoal}}. Known facts: {{confirmedFacts}}. Missing: {{missingFacts}}. Call get_account_status and get_kyc_status with member_id from facts.',
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
          'If account/KYC status conflicts with customer narrative → call create_human_task (account_ops). If KB indicates mandatory human appeal → call create_human_task. If status is clearly explained with evidence → resolved. If facts still missing → collecting.',
      },
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
  withdrawal_issue: {
    created: {
      name: 'created',
      description: '工单刚开立，先简短安抚客户。如客户已提供 member_id 和问题类型，评估器可直接进入 investigating；否则进入 collecting 用 request_user_input 收集。',
      availableSkills: ['request_user_input'],
      transition: {
        type: 'evaluation',
        evaluationModel: 'MiniMax-M2.7-highspeed',
        evaluationPrompt: `Stage transition evaluator for **created** only.

Use Confirmed facts, Missing facts, Skills called, Skill results, Key events.

Rules:
- If **member_id** and **issueType** are present (non-empty in confirmedFacts) → nextStage **investigating**.
- Else → nextStage **collecting**.

JSON ONLY:
{"shouldTransition": true, "nextStage": "collecting"|"investigating", "reason": "..."}`,
      },
    },
    collecting: {
      name: 'collecting',
      description: '收集用户 member_id 与提现问题详情；用 request_user_input 一次性收集。表单字段 key 必须使用: member_id, issueType, amount（与证据系统对齐）。\n\nIMPORTANT: Do NOT list the required fields in text before calling request_user_input. Call request_user_input directly in your first response.',
      requiredSkills: ['request_user_input'],
      availableSkills: ['request_user_input'],
      evidenceRequirements: [
        { factKey: 'member_id', description: '用户 member ID', source: 'user_input', required: true },
        { factKey: 'issueType', description: '问题类型（未到账 / 打码量不足 / 被拒等）', source: 'user_input', required: true },
        { factKey: 'amount', description: '提现金额（如有）', source: 'user_input', required: false },
      ],
      transition: { type: 'auto', conditions: [{ type: 'all_evidence_gathered' }] },
    },
    investigating: {
      name: 'investigating',
      description: '调用取款状态与打码量条件接口核对平台记录。若发现数据矛盾需要客户补充信息，使用 request_user_input 表单收集。',
      requiredSkills: ['get_latest_withdrawal', 'get_withdraw_conditions'],
      availableSkills: ['get_latest_withdrawal', 'get_withdraw_conditions', 'get_transaction_history', 'read_case_history', 'kb_hybrid_retrieve', 'request_user_input'],
      evidenceRequirements: [
        {
          factKey: 'withdrawalStatus',
          description: 'get_latest_withdrawal 返回的取款状态（字段 `status`）',
          source: 'skill_output',
          skillName: 'get_latest_withdrawal',
          required: true,
        },
        {
          factKey: 'withdrawConditions',
          description: 'get_withdraw_conditions 返回的打码量条件（字段 `data`）',
          source: 'skill_output',
          skillName: 'get_withdraw_conditions',
          required: true,
        },
      ],
      subAgents: [
        {
          name: 'withdrawal_verifier',
          model: 'MiniMax-M2.7-highspeed',
          systemPrompt: 'You are a withdrawal verification specialist. Check the latest withdrawal status and turnover conditions. Report structured facts only.',
          skills: ['get_latest_withdrawal', 'get_withdraw_conditions'],
          taskTemplate: 'Verify withdrawal status for case {{caseId}}. Stage goal: {{stageGoal}}. Known facts: {{confirmedFacts}}. Call get_latest_withdrawal and get_withdraw_conditions with member_id from facts.',
          maxIterations: 3,
          parallel: true,
        },
        {
          name: 'history_reviewer',
          model: 'MiniMax-M2.7-highspeed',
          systemPrompt: 'You review historical cases and transaction history for patterns.',
          skills: ['get_transaction_history', 'read_case_history'],
          taskTemplate: 'Review transaction history and past cases for case {{caseId}}. Stage goal: {{stageGoal}}. Facts: {{confirmedFacts}}. Check withdrawal history and case patterns.',
          maxIterations: 2,
          parallel: true,
        },
      ],
      transition: {
        type: 'evaluation',
        evaluationModel: 'MiniMax-M2.7-highspeed',
        evaluationPrompt: 'If withdrawal status conflicts with customer narrative → call create_human_task (withdrawal_ops). If conditions clearly explained with evidence → resolved. If facts still missing → collecting.',
      },
    },
    resolved: {
      name: 'resolved',
      description: '结案并向客户说明提现状态与依据',
      requiredSkills: ['finalize_case'],
      transition: { type: 'manual' },
    },
  },
  promotion_inquiry: {
    created: {
      name: 'created',
      description: '优惠咨询工单开立，直接进入查询阶段。',
      transition: { type: 'auto', conditions: [{ type: 'min_iterations', value: 1 }] },
    },
    investigating: {
      name: 'investigating',
      description: '查询用户优惠活动状态、可参与活动和打码量条件。一次性提供完整信息给客户。',
      availableSkills: ['get_active_promotions', 'get_eligible_promotions', 'get_withdraw_conditions', 'request_user_input'],
      evidenceRequirements: [
        {
          factKey: 'activePromotions',
          description: 'get_active_promotions 返回的当前优惠（字段 `data`）',
          source: 'skill_output',
          skillName: 'get_active_promotions',
          required: false,
        },
        {
          factKey: 'eligiblePromotions',
          description: 'get_eligible_promotions 返回的可参与优惠（字段 `data`）',
          source: 'skill_output',
          skillName: 'get_eligible_promotions',
          required: false,
        },
      ],
      transition: {
        type: 'evaluation',
        evaluationModel: 'MiniMax-M2.7-highspeed',
        evaluationPrompt: 'If promotion info is returned and customer question is answered → resolved. If customer needs more details → stay in investigating. If conflict → waiting_human.',
      },
    },
    resolved: {
      name: 'resolved',
      description: '结案并向客户说明优惠信息',
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
    description: 'Account & security — login failures, bans, risk flags, appeals, KYC verification',
    skillsAllowed: '["get_account_status","get_kyc_status","read_case_history","kb_hybrid_retrieve"]',
    priority: 0,
  },
  {
    queue: 'withdrawal_ops',
    description: 'Withdrawal operations — withdrawal status, turnover conditions, transaction history',
    skillsAllowed: '["get_latest_withdrawal","get_latest_deposit","get_withdraw_conditions","get_transaction_history"]',
    priority: 0,
  },
  {
    queue: 'general', description: 'General support queue for account and other issues',
    skillsAllowed: '["read_case_history","kb_hybrid_retrieve"]',
    priority: 1,
  },
]

export interface DefaultKnowledgeSourceSeed {
  name: string
  description?: string
  groupIds: string
  embeddingRate: number
  topK: number
  rerankVersion?: string
  docCorrelation?: number
  caseTypeTag?: string
  enabled: boolean
}

export const DEFAULT_KNOWLEDGE_SOURCES: DefaultKnowledgeSourceSeed[] = [
  {
    name: 'Deposit FAQ',
    description: 'Deposit methods, limits, delays, and troubleshooting',
    groupIds: '["6777d7a2df784b1af215324d"]',
    embeddingRate: 0.9,
    topK: 5,
    rerankVersion: 'Jina-reranker-v2-base-multilingual',
    docCorrelation: 0.5,
    caseTypeTag: 'deposit_issue',
    enabled: true,
  },
  {
    name: 'Withdrawal FAQ',
    description: 'Withdrawal methods, PIN, conditions, and status',
    groupIds: '["6777d7976526a22a241862c4"]',
    embeddingRate: 0.9,
    topK: 5,
    rerankVersion: 'Jina-reranker-v2-base-multilingual',
    docCorrelation: 0.5,
    caseTypeTag: 'withdraw_issue',
    enabled: true,
  },
  {
    name: 'Account FAQ',
    description: 'Account login, security, verification, and settings',
    groupIds: '["6777d77b6526a22a24186282"]',
    embeddingRate: 0.9,
    topK: 5,
    rerankVersion: 'Jina-reranker-v2-base-multilingual',
    docCorrelation: 0.5,
    caseTypeTag: 'account_issue',
    enabled: true,
  },
  {
    name: 'Game FAQ',
    description: 'Game rules, gameplay issues, and troubleshooting',
    groupIds: '["6777d76fdf784b1af21531e7"]',
    embeddingRate: 0.9,
    topK: 5,
    rerankVersion: 'Jina-reranker-v2-base-multilingual',
    docCorrelation: 0.5,
    enabled: true,
  },
  {
    name: 'Promotion FAQ',
    description: 'Active promotions, bonus terms, eligibility, and claiming',
    groupIds: '["6777d7adaa45953ded935004"]',
    embeddingRate: 0.7,
    topK: 5,
    rerankVersion: 'Jina-reranker-v2-base-multilingual',
    docCorrelation: 0.5,
    enabled: true,
  },
  {
    name: 'General FAQ',
    description: 'General platform questions and miscellaneous help',
    groupIds: '["6777d78adf784b1af2153213"]',
    embeddingRate: 0.9,
    topK: 5,
    rerankVersion: 'Jina-reranker-v2-base-multilingual',
    docCorrelation: 0.5,
    enabled: true,
  },
  {
    name: 'Scenarios & SOP',
    description: 'Customer service scenarios and standard operating procedures',
    groupIds: '["696763795a9460010f69a8d7"]',
    embeddingRate: 0.9,
    topK: 5,
    rerankVersion: 'Jina-reranker-v2-base-multilingual',
    docCorrelation: 0.5,
    enabled: true,
  },
]
