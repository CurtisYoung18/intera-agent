// Shared default data for admin pre-fill — used by both seed.ts and API lazy init.
// Must match the built-in definitions in skills.ts and policy.ts exactly.

export const DEFAULT_MODEL = 'deepseek-v4-flash'

export const DEFAULT_SYSTEM_PROMPT = `You are Intera, a customer service assistant.

## How you work

- Respond in the same language the customer uses. If they write in Chinese, respond in Chinese. Never mix languages.
- Be concise. Prefer action over explanation.
- If you say you will check or verify something, call the corresponding tool in that same turn. Text-only promises without tool calls will trigger a correction nudge (3 attempts, then the case escalates to a human).

## Parallel tool calls

When you need multiple pieces of information, call all independent tools together in a single turn. If two tools don't depend on each other's output, issue them simultaneously — they execute concurrently and save turns. Sequence only when one tool's result is required input for the next.

**Knowledge base search**: Search all potentially relevant sources in parallel on the first attempt. If results are not sufficient, iterate — rephrase the query, broaden the scope, or try sources you skipped. Exhaust the search space before concluding information is unavailable.

## Cases

When a customer reports a single clear issue, call dispatch_case_agent FIRST — before any lookup tools. The case system manages structured investigation. Do not call get_latest_deposit, get_transaction_history, or similar tools before creating the case.

**When the customer has multiple issues, call dispatch_case_agent once for each issue.** Do not call dispatch_case_agent because you are "unsure" — if the customer describes one situation, pick the best-matching case type and call dispatch_case_agent directly. When in doubt between two similar types, choose the one most relevant to the customer's primary complaint.

{{case_types}}

When no Case is open, just chat naturally. No need to look up records or call tools.

## When a Case is active

The case schema, current stage, required evidence, and available tools are shown above. Follow the stage requirements — the evaluator will advance you when conditions are met, or route to a human when system data conflicts with the customer's story.

{{case_schema}}
{{case_state}}

## Policies

{{active_policies}}

## Human handoff

Call create_human_task **only after** investigation tools (get_latest_deposit, get_withdraw_conditions, get_account_status, get_kyc_status, etc.) have returned data that conflicts with the customer's report. Do not escalate based on preliminary lookups (e.g. get_latest_deposit) or your own inference alone — always complete the required investigation for the current stage first.

After the human resolves the task, translate their verdict into plain, friendly language for the customer.

## Memory

Facts extracted from previous turns are in confirmedFacts — trust them. Summaries from earlier context appear as [Case context].

## member_id

The Session ID under "Current User" is NOT a member_id. If a verified Member ID is listed there, use it for any tool that needs member_id. If member_id is unknown, call request_user_input to ask the customer for it before calling any tool that needs it — never guess or pass the Session ID. If a tool returns "member id is invalid", call request_user_input immediately.

## Knowledge base vs account tools

For general / catalog / how-to questions (what promotions, games, or payment methods exist; how to do something; policies, bonus terms, contact info) → ALWAYS use the knowledge base (kb_search_*). It holds the catalog and the rules. Account/status tools (get_active_promotions, get_latest_deposit, get_account_status, etc.) return ONLY this member's live data. If an account/status tool returns empty or negative, do NOT conclude "there is none" — check the knowledge base before answering.

{{session_binding}}
`;

/** Lightweight prompt for Core (discovery) mode — no case active.
 *  Focused on conversation routing, direct tool calls, and case creation.
 *  Does NOT include stage requirements, sub-agents, policies, or human handoff. */
export const CORE_SYSTEM_PROMPT = `You are Intera, a customer service assistant. Respond in the customer's language. Be concise. Don't describe what you'll do — just do it. Call the tool, don't narrate.

**For date/time questions: you MUST call get_current_time.** Do not guess. Do not say you can't. Just call the tool — it will give you the answer. Your training cutoff date is wrong.

**Never fabricate data.** If a tool returns success:false or an error, report the error to the customer. Never invent results, numbers, dates, or records. If data is not returned by a tool, it does not exist.

**Always use request_user_input to collect information.** When you need member_id, date range, order ID, amount, or any other details: call request_user_input. Never ask in plain text — use the form tool. A text question like "Please provide your member ID" without calling request_user_input is a failed response.

## member_id

The Session ID under "Current User" is NOT a member_id. If a verified Member ID is listed there, use it for any tool that needs member_id. If member_id is unknown, call request_user_input to ask the customer for it before calling any tool that needs it — never guess or pass the Session ID. If a tool returns "member id is invalid", call request_user_input immediately — don't apologize, just ask.

## Knowledge base vs account tools

For general / catalog / how-to questions (what promotions, games, or payment methods exist; how to do something; policies, bonus terms, contact info) → ALWAYS use the knowledge base (kb_search_*). It holds the catalog and the rules. Account/status tools (get_active_promotions, get_latest_deposit, get_account_status, etc.) return ONLY this member's live data. If an account/status tool returns empty or negative, do NOT conclude "there is none" — check the knowledge base before answering.

## Memory Tools

You have access to two built-in memory tools:
- \`read_chat_memory\` — Retrieve the current case's working summary (confirmed facts, tools executed, key events)
- \`read_user_profile\` — Retrieve this user's cross-chat profile (identity, contact, preferences, activity, history)
Use these when you need context about the user or the current case state.

{{available_tools}}

{{case_types}}

{{session_binding}}

`;

/**
 * Case-execution prompt — used when a case is active and past the "created" stage.
 * Stage-driven, policy-enforced, with sub-agent and human-handoff awareness.
 *
 * @deprecated Since Phase 1 (2026-06-03) — use the base+append model instead:
 *   coreSystemPrompt + caseAddendum (see buildModePrompt.ts).
 *   The legacy swap path (systemPrompt / CASE_SYSTEM_PROMPT) is still supported
 *   when useLegacyCasePrompt=true, but will be removed in Phase 3.
 */
export const CASE_SYSTEM_PROMPT = `You are Intera, handling an active customer case. Follow the stage requirements.

## How you work

- Respond in the same language the customer uses.
- Be concise. Prefer action over explanation.
- If you say you will check or verify something, call the corresponding tool in that same turn. Text-only promises without tool calls will trigger a correction nudge (3 attempts, then the case escalates to a human).

## Parallel tool calls

When a stage requires multiple lookups, call all independent tools together in a single turn. If two tools don't depend on each other's output, issue them simultaneously — they execute concurrently. Sequence only when one result feeds the next.

**Knowledge base search**: Search all potentially relevant sources in parallel. If results are insufficient, iterate — rephrase, broaden, or try additional sources. Exhaust the search space before concluding information is unavailable.

## Case context

The case schema, current stage, required evidence, and available tools are shown below. Follow the stage requirements — the evaluator will advance you when conditions are met, or route to a human when system data conflicts with the customer's story.

{{case_schema}}
{{case_state}}

## Policies

{{active_policies}}

## Human handoff

Call create_human_task **only after** investigation tools (get_latest_deposit, get_withdraw_conditions, get_account_status, get_kyc_status, etc.) have returned data that conflicts with the customer's report. Do not escalate based on preliminary lookups (e.g. get_latest_deposit) or your own inference alone — always complete the required investigation for the current stage first.

After the human resolves the task, translate their verdict into plain, friendly language for the customer.

## Memory

Facts extracted from previous turns are in confirmedFacts — trust them. Summaries from earlier context appear as [Case context].

## Memory Tools

You have access to two built-in memory tools:
- \`read_chat_memory\` — Retrieve the current case's working summary (confirmed facts, tools executed, key events)
- \`read_user_profile\` — Retrieve this user's cross-chat profile (identity, contact, preferences, activity, history)
Use these when you need context about the user or the current case state.

## member_id

The Session ID under "Current User" is NOT a member_id. If a verified Member ID is listed there, use it for any tool that needs member_id. If member_id is unknown, call request_user_input to ask the customer for it before calling any tool that needs it — never guess or pass the Session ID. If a tool returns "member id is invalid", call request_user_input immediately.

## Knowledge base vs account tools

For general / catalog / how-to questions (what promotions, games, or payment methods exist; how to do something; policies, bonus terms, contact info) → ALWAYS use the knowledge base (kb_search_*). It holds the catalog and the rules. Account/status tools (get_active_promotions, get_latest_deposit, get_account_status, etc.) return ONLY this member's live data. If an account/status tool returns empty or negative, do NOT conclude "there is none" — check the knowledge base before answering.

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

  // Ratio-based thresholds (preferred over absolute token counts)
  autocompactRatio: 0.70,
  warningRatio: 0.60,
  blockingRatio: 0.92,
  // Cadence-driven compaction (disabled by default)
  compactEveryNMessages: undefined,

  // Features
  compactModel: 'deepseek-v4-flash',
  enableSnip: true,
  enableMicrocompact: false,
  microcompactMinAgeMs: 300000,
  enableContextCollapse: true,
  enableAutocompact: true,

  // Chat Memory
  enableChatMemory: true,
  chatMemoryMaxTokens: 4000,

  // Compaction fine-tuning
  compactMaxMessages: 40,
  compactTemperature: 0.3,
  compactMaxTokensCap: 4096,
  compactMinSummaryLength: 100,
  compactionKeepMin: 6,
  compactionKeepRatio: 0.65,
  compactableTools: [
    'get_latest_deposit',
    'get_withdraw_conditions',
    'get_active_promotions',
    'read_case_history',
    // kb_hybrid_retrieve removed — replaced by dynamic kb_search_* tools
  ],

  // Fact extraction (LLM-based, replaces regex/keyword patterns)
  factExtractionPrompt: '',
  factExtractionModel: 'deepseek-v4-flash',
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
  toolCategory?: 'system_info' | 'operational'
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
    name: 'dispatch_case_agent',
    displayVerb: { text: 'Dispatching case agent', icon: 'dots' },
    toolCategory: 'operational',
    description: 'Dispatch a case investigation agent when the customer reports an issue. IMPORTANT: Call dispatch_case_agent BEFORE any lookup tools (get_latest_deposit, get_transaction_history, get_account_status, etc.). Do not investigate first — the case system manages investigation stages. Only use lookup tools directly when the customer asks a simple informational question, NOT when they report a problem.',
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
    name: 'propose_interaction',
    displayVerb: { text: 'Asking you a question', icon: 'pulse' },
    description: '[DEPRECATED] Use request_user_input instead. Present a choice card with options.',
    inputSchema: '{"type":"object","properties":{"title":{"type":"string"},"description":{"type":"string"},"options":{"type":"array","items":{"type":"object","properties":{"id":{"type":"string"},"label":{"type":"string"},"description":{"type":"string"},"inputType":{"type":"string","enum":["none","text","number"]},"inputPlaceholder":{"type":"string"}},"required":["id","label"]}},"multiSelect":{"type":"boolean"}},"required":["title","options"]}',
    mode: 'mock', isConcurrencySafe: false, enabled: false, guardPhase: 'post', outputSchema: '{}',
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
    description: 'Check account status (login failure, account locked, etc.). Call when the customer cannot log in, is locked out, or reports a login failure.',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/account-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_kyc_status',
    displayVerb: { text: 'Verifying identity status', icon: 'scan' },
    description: 'Check KYC verification status and which step it is stuck at. Call when the customer asks about KYC progress or identity-verification status.',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/user-kyc-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_active_promotions',
    displayVerb: { text: 'Checking active promotions', icon: 'dots' },
    description: "Check THIS member's currently-active turnover promotions (member-specific, requires member_id). Do NOT use this to answer general \"what promotions do you have / what bonuses are available\" questions — use kb_search_* (the Promotion knowledge base) for the promotion catalog, terms, and eligibility. An empty result only means this member has no active turnover promo; still consult the knowledge base before telling the customer there are none.",
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/promotion-active-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_withdraw_conditions',
    displayVerb: { text: 'Checking withdrawal conditions', icon: 'scan' },
    description: 'Check turnover (wagering) requirements for withdrawal. Call when the customer asks whether their turnover is enough or how much wagering is needed to withdraw.',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"},"gmt":{"type":"string","description":"Timezone, default -4:00","default":"-4:00"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/withdraw-condition',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_eligible_promotions',
    displayVerb: { text: 'Checking eligible promotions', icon: 'dots' },
    description: 'Check the promotions THIS member is eligible to join. Call when the customer asks how to join a promotion or claim a bonus.',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"},"language":{"type":"string","description":"Language, default en-bd","default":"en-bd"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/promotion-eligible-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_latest_withdrawal',
    displayVerb: { text: 'Checking withdrawal status', icon: 'scan' },
    description: 'Check the latest withdrawal status and elapsed time. Call when the customer asks about withdrawal progress or whether it has arrived.',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"},"gmt":{"type":"string","description":"Timezone, default -04:00","default":"-04:00"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/get-latest-withdraw-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_latest_deposit',
    displayVerb: { text: 'Checking deposit status', icon: 'scan' },
    description: 'Check the latest deposit status. Call when the customer asks whether a deposit has arrived or about top-up progress.',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"},"gmt":{"type":"string","description":"Timezone, default -4:00","default":"-4:00"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/get-latest-deposit-status',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_transaction_history',
    displayVerb: { text: 'Loading transaction history', icon: 'scan' },
    description: 'Get the last 5 deposit/withdrawal transactions. Call when the customer asks about transaction records or deposit/withdrawal history.',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"},"method":{"type":"string","description":"deposit or withdraw","enum":["deposit","withdraw"]}},"required":["member_id","method"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/deposit-withdrawal-history',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_recommended_games',
    displayVerb: { text: 'Loading game recommendations', icon: 'dots' },
    description: 'Get the recommended / hot games list. Call when the customer asks for game recommendations or popular games.',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"}},"required":["member_id"]}',
    mode: 'http', isConcurrencySafe: true, enabled: true, guardPhase: 'post', outputSchema: '{}',
    endpoint: 'https://jayabaji.ai-chat.life/v2/chatbot/top-hot-game-list',
    httpMethod: 'POST',
    headers: '{"apiKey":"G71fGn7G8vb1T2824rr7"}',
    timeoutMs: 8000,
  },
  {
    name: 'get_bet_history',
    displayVerb: { text: 'Loading bet history', icon: 'scan' },
    description: 'Check game bet history. Call when the customer asks about betting records, bet history, or game records.',
    inputSchema: '{"type":"object","properties":{"member_id":{"type":"string","description":"The member ID (from the current session context)"},"from_date":{"type":"string","description":"Start date, format YYYY-MM-DD HH:mm:ss"},"to_date":{"type":"string","description":"End date, format YYYY-MM-DD HH:mm:ss"}},"required":["member_id","from_date","to_date"]}',
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
    description: 'Called by a sub-agent when it finishes, to return its findings to the main agent. The sub-agent loop ends after this call.',
    inputSchema: '{"type":"object","properties":{"findings":{"type":"array","items":{"type":"object","properties":{"key":{"type":"string"},"value":{}}},"description":"List of facts discovered during investigation"},"evidence":{"type":"array","items":{"type":"string"},"description":"Evidence references supporting the conclusion"},"recommendation":{"type":"string","description":"Recommended next action"}},"required":["findings","recommendation"]}',
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
  { name: 'no_high_risk_account_change', description: 'Block high-risk skills in preTool phase', hook: 'preTool', rule: '{"deny_skills":[]}' },
  { name: 'investigate_before_escalation', description: 'Require investigative skills before escalating to human (create_human_task)', hook: 'preTool', rule: '{"hook_skills":["create_human_task"],"require_skills_any":["get_latest_deposit","get_withdraw_conditions","get_account_status","get_kyc_status"]}' },
  {
    name: 'conflict_requires_human',
    description: 'Detect conflict between system result and user report',
    hook: 'postTool',
    rule: JSON.stringify({
      hook_skills: ['get_latest_deposit', 'get_withdraw_conditions', 'get_account_status', 'get_kyc_status'],
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
    rule: '{"require_skills_any":["get_latest_deposit","get_account_status","get_kyc_status"]}',
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
        '(1) a specific skill result (e.g. get_latest_deposit showed status=completed),',
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
    displayName: 'Deposit not credited',
    description:
      'The customer says they topped up or transferred funds to the platform (bank card, e-wallet, USDT, etc.) but their balance did not increase or they see no confirmation of arrival. Includes "charged but balance unchanged", "transaction shows but no credits in game/wallet", and "still not credited after a long time".',
    icon: '💰',
    requiredFacts: '["txnId","amount","paymentMethod","date"]',
    stages: '["created","collecting","investigating","resolved"]',
    defaultGoal: 'Verify the order and payment-channel status; determine whether it is delayed, failed, or needs a manual top-up. Escalate to a human when system data conflicts with the customer report.',
    escalateOn: '["conflict"]',
    requireHumanReview: true,
  },
  {
    type: 'order_issue', displayName: 'Order issue', description: 'Customer reports an order status issue',
    icon: '📦',
    requiredFacts: '["orderId","issueType"]',
    stages: '["created","verifying","investigating","resolved"]',
    defaultGoal: 'Confirm the order status and resolve the customer issue',
    escalateOn: '["conflict","refund_request"]',
  },
  {
    type: 'account_issue',
    displayName: 'Account issue',
    description:
      'The customer reports being unable to log in, account banned/frozen, risk-control or KYC anomalies, suspected account theft, OTP/2FA issues, or device-binding disputes — i.e. issues about the account identity and security policy. Does NOT include a single deposit not arriving (that is "Deposit not credited").',
    icon: '🔒',
    requiredFacts: '["userId","issueType"]',
    stages: '["created","collecting","investigating","resolved"]',
    defaultGoal:
      'Pull account-side records and knowledge-base references to determine whether the account is restricted/banned/falsely flagged. Escalate to account-ops human review on conflict or high-risk cases, and give actionable next steps.',
    escalateOn: '["high_risk","conflict"]',
  },
  {
    type: 'refund_request', displayName: 'Refund request', description: 'Customer requests a refund',
    icon: '↩️',
    requiredFacts: '["orderId","amount","reason"]',
    stages: '["created","reviewing","approved","resolved"]',
    defaultGoal: 'Review the refund request and give a conclusion',
    escalateOn: '["large_amount","policy_violation"]',
    requireHumanReview: true,
  },
  {
    type: 'withdrawal_issue',
    displayName: 'Withdrawal issue',
    description: 'The customer reports withdrawal not arriving, unclear withdrawal progress, or being unable to withdraw due to insufficient turnover.',
    icon: '💸',
    requiredFacts: '["member_id","issueType"]',
    stages: '["created","collecting","investigating","resolved"]',
    defaultGoal: 'Check withdrawal status and turnover requirements; determine whether it is delayed, insufficient, or rejected. Escalate to a human when it conflicts with the customer report.',
    escalateOn: '["conflict"]',
    requireHumanReview: true,
  },
  {
    type: 'promotion_inquiry',
    displayName: 'Promotion inquiry',
    description: 'The customer asks about promotions, eligibility, turnover requirements, or wagering progress.',
    icon: '🎁',
    requiredFacts: '["member_id"]',
    stages: '["created","investigating","resolved"]',
    defaultGoal: 'Check the promotion status and eligibility for this member; tell them which promotions they can join and the withdrawal turnover requirements.',
    escalateOn: '["conflict"]',
  },
]

// Per-stage configs for each case type (used when stageConfigs is not set on CaseType)
export const DEFAULT_STAGE_CONFIGS: Record<string, Record<string, Record<string, unknown>>> = {
  deposit_issue: {
    created: {
      name: 'created',
      description:
        'Case just opened — briefly reassure the customer first. If they already provided complete info (txnId, amount, channel), the evaluator may go straight to investigating; otherwise go to collecting and use request_user_input to gather it.',
      availableSkills: ['request_user_input'],
      transition: {
        type: 'evaluation',

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
      description: 'Collect txnId, amount, channel, time, etc. from the customer; gather them all at once with a request_user_input form. The form field keys MUST be: txnId, amount, paymentMethod, date (aligned with the evidence system).\n\nIMPORTANT: Do NOT list the required fields in text before calling request_user_input. Call request_user_input directly in your first response — the form itself will explain what is needed. Text-only lists waste a turn and annoy the user.\n\nIMPORTANT: After the form is submitted and all facts are confirmed, do NOT call create_human_task or any investigation tool yet. The system will automatically advance to the investigating stage — wait for that transition before querying order or channel status.',
      requiredSkills: ['request_user_input'],
      availableSkills: ['request_user_input'],
      evidenceRequirements: [
        { factKey: 'txnId', description: 'Transaction / top-up reference number', source: 'user_input', required: true },
        { factKey: 'amount', description: 'Top-up amount', source: 'user_input', required: true },
        { factKey: 'paymentMethod', description: 'Payment method', source: 'user_input', required: true },
        { factKey: 'date', description: 'Arrival or initiation time (if any)', source: 'user_input', required: false },
      ],
      transition: { type: 'auto', conditions: [{ type: 'all_evidence_gathered' }] },
    },
    investigating: {
      name: 'investigating',
      description: `Use the txnId from confirmedFacts to call the order and channel tools and verify the platform records.

**CRITICAL — which txnId to use:**
The txnId argument for get_latest_deposit and get_withdraw_conditions MUST be **confirmedFacts.txnId** (the customer-provided reference). A txnId in sub-agent findings is reverse-lookup reference data, NOT the customer's transaction number — never pass a sub-agent txnId into the query tools. If the customer reported TX101, query TX101; do not get pulled toward the sub-agent's TX2026... format.

**Investigation order:**
1. Call get_latest_deposit (passing confirmedFacts.txnId) and get_withdraw_conditions — both in the SAME turn, do not split across turns.
2. If needed, call read_case_history for past cases, get_active_promotions for notices, and kb_search_<name> for the relevant knowledge base.

**Interpreting results:**
- If the txnId returned by get_latest_deposit does not match confirmedFacts.txnId (order not found, or the record belongs to a different transaction) then treat it as "order not found", call create_human_task directly, and do NOT ask the customer to re-confirm the txnId.
- If order status, amount, or channel conflicts with the customer report, call create_human_task directly.
- If the channel has a delayed batch (delayed_batch: true), tell the customer the expected arrival time and go to resolved.
- If data is consistent and the order is processed, go to resolved.

If you need more info from the customer (screenshots, etc.), you MUST collect it with a request_user_input form — never ask in plain text.`,
      requiredSkills: ['get_latest_deposit', 'get_withdraw_conditions'],
      availableSkills: ['get_latest_deposit', 'get_withdraw_conditions', 'get_active_promotions', 'read_case_history', 'request_user_input'],
      evidenceRequirements: [
        {
          factKey: 'status',
          description: 'Order/transaction status returned by get_latest_deposit (field `status`)',
          source: 'skill_output',
          skillName: 'get_latest_deposit',
          required: true,
        },
        {
          factKey: 'channel',
          description: 'Channel identifier returned by get_withdraw_conditions (field `channel`)',
          source: 'skill_output',
          skillName: 'get_withdraw_conditions',
          required: true,
        },
      ],
      transition: {
        type: 'evaluation',

        evaluationPrompt: `Evaluate transition from **investigating** using ONLY Confirmed facts, Missing facts, Skills called, Skill results, Key events.

- If get_latest_deposit returned a record whose txnId differs from confirmedFacts.txnId, OR returned "not found" → treat as unresolvable conflict, nextStage stays investigating (agent should call create_human_task).
- If get_latest_deposit / get_withdraw_conditions outputs conflict with the customer's deposit narrative (amount, channel, status mismatch) → agent should call create_human_task; stay in investigating.
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
      requiredSkills: ['get_latest_deposit'],
      availableSkills: ['get_latest_deposit', 'request_user_input', 'read_case_history'],
      evidenceRequirements: [
        { factKey: 'orderId', description: 'Order ID', source: 'user_input', required: true },
        { factKey: 'issueType', description: 'Issue type', source: 'user_input', required: true },
        {
          factKey: 'status',
          description: 'Status returned by the order system (field `status`)',
          source: 'skill_output',
          skillName: 'get_latest_deposit',
          required: true,
        },
      ],
      transition: { type: 'evaluation', evaluationPrompt: 'Check if order details are verified. If order found and matches → investigating. If missing info → back to collecting.' },
    },
    investigating: {
      name: 'investigating',
      description: 'Investigate order issue',
      requiredSkills: ['get_withdraw_conditions'],
      availableSkills: ['get_latest_deposit', 'get_withdraw_conditions', 'get_active_promotions', 'read_case_history'],
      transition: { type: 'evaluation', evaluationPrompt: 'If conflict detected → call create_human_task. If resolved → resolved.' },
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
        'Case just opened — briefly reassure the customer first. If they already provided userId and issue type, the evaluator may go straight to investigating; otherwise go to collecting and use request_user_input to gather it.',
      availableSkills: ['request_user_input'],
      transition: {
        type: 'evaluation',

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
        'Collect the user identifier, issue type, and symptom description; gather them at once with request_user_input. The form field keys MUST be: userId, issueType, symptoms (aligned with the evidence system).\n\nIMPORTANT: Do NOT list the required fields in text before calling request_user_input. Call request_user_input directly in your first response — the form itself will explain what is needed. Text-only lists waste a turn and annoy the user.',
      requiredSkills: ['request_user_input'],
      availableSkills: ['request_user_input'],
      evidenceRequirements: [
        { factKey: 'userId', description: 'Platform user ID / UID', source: 'user_input', required: true },
        {
          factKey: 'issueType',
          description: 'Issue type (login failure / ban / risk-control flag / suspected theft / verification anomaly, etc.)',
          source: 'user_input',
          required: true,
        },
        {
          factKey: 'symptoms',
          description: 'Brief symptom description (error code, on-screen message, approximate start time)',
          source: 'user_input',
          required: false,
        },
      ],
      transition: { type: 'auto', conditions: [{ type: 'all_evidence_gathered' }] },
    },
    investigating: {
      name: 'investigating',
      description:
        'In parallel, verify the account-side snapshot against past cases / policy entries; if records conflict with the customer report, prepare human-review wording.',
      requiredSkills: ['get_account_status', 'get_kyc_status', 'read_case_history'],
      availableSkills: [
        'get_account_status',
        'get_kyc_status',
        'read_case_history',
        // kb_hybrid_retrieve removed — replaced by dynamic kb_search_* tools
        'request_user_input',
      ],
      evidenceRequirements: [
        {
          factKey: 'accountStatus',
          description: 'Account status returned by get_account_status (field `data.status`)',
          source: 'skill_output',
          skillName: 'get_account_status',
          required: true,
        },
        {
          factKey: 'kycStatus',
          description: 'KYC status returned by get_kyc_status (field `data.kyc_status`)',
          source: 'skill_output',
          skillName: 'get_kyc_status',
          required: true,
        },
        {
          factKey: 'total',
          description: 'read_case_history has run and returned a past-case count (field `total`)',
          source: 'skill_output',
          skillName: 'read_case_history',
          required: true,
        },
      ],
      transition: {
        type: 'evaluation',

        evaluationPrompt:
          'If account/KYC status conflicts with customer narrative → call create_human_task (account_ops). If KB indicates mandatory human appeal → call create_human_task. If status is clearly explained with evidence → resolved. If facts still missing → collecting.',
      },
    },
    resolved: {
      name: 'resolved',
      description: 'Close the case and explain the basis and next steps to the customer',
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
      requiredSkills: ['get_latest_deposit'],
      availableSkills: ['get_latest_deposit', 'get_withdraw_conditions', 'read_case_history', 'request_user_input'],
      evidenceRequirements: [
        { factKey: 'orderId', description: 'Order ID', source: 'user_input', required: true },
        { factKey: 'amount', description: 'Refund amount', source: 'user_input', required: true },
        { factKey: 'reason', description: 'Refund reason', source: 'user_input', required: true },
        {
          factKey: 'status',
          description: 'Status returned by the order lookup (field `status`)',
          source: 'skill_output',
          skillName: 'get_latest_deposit',
          required: true,
        },
      ],
      transition: { type: 'evaluation', evaluationPrompt: 'If large_amount or policy_violation → waiting_human. If eligible → approved. If not eligible → resolved with rejection.' },
    },
    approved: {
      name: 'approved',
      description: 'Refund approved — transition to resolved',
      requiredSkills: ['finalize_case'],
      transition: { type: 'auto', conditions: [{ type: 'all_skills_called' }] },
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
      description: 'Case just opened — briefly reassure the customer first. If they already provided member_id and issue type, the evaluator may go straight to investigating; otherwise go to collecting and use request_user_input to gather it.',
      availableSkills: ['request_user_input'],
      transition: {
        type: 'evaluation',

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
      description: 'Collect the customer member_id and withdrawal issue details; gather them at once with request_user_input. The form field keys MUST be: member_id, issueType, amount (aligned with the evidence system).\n\nIMPORTANT: Do NOT list the required fields in text before calling request_user_input. Call request_user_input directly in your first response.',
      requiredSkills: ['request_user_input'],
      availableSkills: ['request_user_input'],
      evidenceRequirements: [
        { factKey: 'member_id', description: 'Customer member ID', source: 'user_input', required: true },
        { factKey: 'issueType', description: 'Issue type (not arrived / insufficient turnover / rejected, etc.)', source: 'user_input', required: true },
        { factKey: 'amount', description: 'Withdrawal amount (if any)', source: 'user_input', required: false },
      ],
      transition: { type: 'auto', conditions: [{ type: 'all_evidence_gathered' }] },
    },
    investigating: {
      name: 'investigating',
      description: 'Call the withdrawal-status and turnover-condition tools to verify platform records. If you find conflicts requiring more info from the customer, collect it with a request_user_input form.',
      requiredSkills: ['get_latest_withdrawal', 'get_withdraw_conditions'],
      availableSkills: ['get_latest_withdrawal', 'get_withdraw_conditions', 'get_transaction_history', 'read_case_history', 'request_user_input'],
      evidenceRequirements: [
        {
          factKey: 'withdrawalStatus',
          description: 'Withdrawal status returned by get_latest_withdrawal (field `status`)',
          source: 'skill_output',
          skillName: 'get_latest_withdrawal',
          required: true,
        },
        {
          factKey: 'withdrawConditions',
          description: 'Turnover conditions returned by get_withdraw_conditions (field `data`)',
          source: 'skill_output',
          skillName: 'get_withdraw_conditions',
          required: true,
        },
      ],
      transition: {
        type: 'evaluation',

        evaluationPrompt: 'If withdrawal status conflicts with customer narrative → call create_human_task (withdrawal_ops). If conditions clearly explained with evidence → resolved. If facts still missing → collecting.',
      },
    },
    resolved: {
      name: 'resolved',
      description: 'Close the case and explain the withdrawal status and basis to the customer',
      requiredSkills: ['finalize_case'],
      transition: { type: 'manual' },
    },
  },
  promotion_inquiry: {
    created: {
      name: 'created',
      description: 'Promotion-inquiry case opened — go straight to the lookup stage.',
      transition: { type: 'auto', conditions: [{ type: 'min_iterations', value: 1 }] },
    },
    investigating: {
      name: 'investigating',
      description: 'Check the promotion status, eligible promotions, and turnover conditions for this member. Give the customer the complete information in one go.',
      availableSkills: ['get_active_promotions', 'get_eligible_promotions', 'get_withdraw_conditions', 'request_user_input'],
      evidenceRequirements: [
        {
          factKey: 'activePromotions',
          description: 'Current promotions returned by get_active_promotions (field `data`)',
          source: 'skill_output',
          skillName: 'get_active_promotions',
          required: false,
        },
        {
          factKey: 'eligiblePromotions',
          description: 'Eligible promotions returned by get_eligible_promotions (field `data`)',
          source: 'skill_output',
          skillName: 'get_eligible_promotions',
          required: false,
        },
      ],
      transition: {
        type: 'evaluation',

        evaluationPrompt: 'If promotion info is returned and customer question is answered → resolved. If customer needs more details → stay in investigating. If conflict → waiting_human.',
      },
    },
    resolved: {
      name: 'resolved',
      description: 'Close the case and explain the promotion information to the customer',
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
    topK: 15,
    rerankVersion: 'BGE-Rerank',
    docCorrelation: 0.3,
    caseTypeTag: 'deposit_issue',
    enabled: true,
  },
  {
    name: 'Withdrawal FAQ',
    description: 'Withdrawal methods, PIN, conditions, and status',
    groupIds: '["6777d7976526a22a241862c4"]',
    embeddingRate: 0.9,
    topK: 15,
    rerankVersion: 'BGE-Rerank',
    docCorrelation: 0.3,
    caseTypeTag: 'withdraw_issue',
    enabled: true,
  },
  {
    name: 'Account FAQ',
    description: 'Account login, security, verification, and settings',
    groupIds: '["6777d77b6526a22a24186282"]',
    embeddingRate: 0.9,
    topK: 15,
    rerankVersion: 'BGE-Rerank',
    docCorrelation: 0.3,
    caseTypeTag: 'account_issue',
    enabled: true,
  },
  {
    name: 'Game FAQ',
    description: 'Game rules, gameplay issues, and troubleshooting',
    groupIds: '["6777d76fdf784b1af21531e7"]',
    embeddingRate: 0.9,
    topK: 15,
    rerankVersion: 'BGE-Rerank',
    docCorrelation: 0.3,
    enabled: true,
  },
  {
    name: 'Promotion FAQ',
    description: 'Active promotions, bonus terms, eligibility, and claiming',
    groupIds: '["6777d7adaa45953ded935004"]',
    embeddingRate: 0.7,
    topK: 15,
    rerankVersion: 'BGE-Rerank',
    docCorrelation: 0.3,
    enabled: true,
  },
  {
    name: 'General FAQ',
    description: 'General platform questions and miscellaneous help',
    groupIds: '["6777d78adf784b1af2153213"]',
    embeddingRate: 0.9,
    topK: 15,
    rerankVersion: 'BGE-Rerank',
    docCorrelation: 0.3,
    enabled: true,
  },
  {
    name: 'Scenarios & SOP',
    description: 'Customer service scenarios and standard operating procedures',
    groupIds: '["696763795a9460010f69a8d7"]',
    embeddingRate: 0.9,
    topK: 15,
    rerankVersion: 'BGE-Rerank',
    docCorrelation: 0.3,
    enabled: true,
  },
]
