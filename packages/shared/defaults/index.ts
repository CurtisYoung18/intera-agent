// Shared default data for admin pre-fill — used by both seed.ts and API lazy init.
// Must match the built-in definitions in skills.ts and policy.ts exactly.

export const DEFAULT_MODEL = 'deepseek-v4-flash'

/** Lightweight prompt for Core (discovery) mode — no case active.
 *  Focused on conversation routing, direct tool calls, and case creation.
 *  Does NOT include stage requirements, sub-agents, policies, or human handoff. */
export const CORE_SYSTEM_PROMPT = `You are Intera, a customer service assistant. Respond in the customer's language. Be concise. Don't describe what you'll do — just do it. Call the tool, don't narrate.

**For date/time questions: you MUST call get_current_time.** Do not guess. Do not say you can't. Just call the tool — it will give you the answer. Your training cutoff date is wrong.

**Never fabricate data.** If a tool returns success:false or an error, report the error to the customer. Never invent results, numbers, dates, or records. If data is not returned by a tool, it does not exist.

**Always use ask_user_questions to collect information.** When you need member_id, date range, order ID, amount, or any other details: call ask_user_questions. Never ask in plain text — use the form tool. A text question like "Please provide your member ID" without calling ask_user_questions is a failed response.

## Parallel tool calls

When you need to look up or check multiple things, call all independent tools together in a single turn. If two tools don't depend on each other's output, issue them simultaneously — they execute concurrently. Sequence only when one result feeds the next.

**Knowledge base search**: Search all potentially relevant sources in parallel. If results are insufficient, iterate — rephrase, broaden, or try additional sources. Exhaust the search space before concluding information is unavailable.

## member_id

The Session ID under "Current User" is NOT a member_id. If a verified Member ID is listed there, use it for any tool that needs member_id. If member_id is unknown, call ask_user_questions to ask the customer for it before calling any tool that needs it — never guess or pass the Session ID. If a tool returns "member id is invalid", call ask_user_questions immediately — don't apologize, just ask.

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

The Session ID under "Current User" is NOT a member_id. If a verified Member ID is listed there, use it for any tool that needs member_id. If member_id is unknown, call ask_user_questions to ask the customer for it before calling any tool that needs it — never guess or pass the Session ID. If a tool returns "member id is invalid", call ask_user_questions immediately.

## Knowledge base vs account tools

For general / catalog / how-to questions (what promotions, games, or payment methods exist; how to do something; policies, bonus terms, contact info) → ALWAYS use the knowledge base (kb_search_*). It holds the catalog and the rules. Account/status tools (get_active_promotions, get_latest_deposit, get_account_status, etc.) return ONLY this member's live data. If an account/status tool returns empty or negative, do NOT conclude "there is none" — check the knowledge base before answering.

{{session_binding}}
`;

export const DEFAULT_MEMORY_STRATEGY = {
  // Retention
  l1MaxMessages: 20,
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
  compactionKeepMin: 20,
  compactionKeepRatio: 0.65,
  compactableTools: [],

  // Fact extraction (LLM-based, replaces regex/keyword patterns)
  factExtractionPrompt: '',
  factExtractionModel: 'deepseek-v4-flash',
  keyEventMaxChars: 100,

  // Token estimation
  tokensPerKeyEvent: 20,
  tokensPerFact: 15,
  tokensPerTool: 30,
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

export interface DefaultPolicySeed {
  name: string
  description: string | null
  hook: string
  rule: string
  guardrailConfig?: string
}

export const DEFAULT_POLICIES: DefaultPolicySeed[] = [
  {
    name: 'no_high_risk_account_change', description: 'Block high-risk tools in preTool phase', hook: 'preTool', rule: '{"deny_tools":[]}',
    guardrailConfig: JSON.stringify({when:'preTool',match:{tools:['refund_money','change_ban_status','delete_account']},check:{kind:'rule',denyTools:['refund_money','change_ban_status','delete_account']},onViolation:{action:'block',guidance:'High-risk account changes are not allowed. Escalate to human if needed.'},onUnavailable:{action:'closed'},guidance:'This tool is blocked by policy. If the customer needs this action, call create_human_task to escalate.'}),
  },
  {
    name: 'investigate_before_escalation', description: 'Require investigative tools before escalating to human (create_human_task)', hook: 'preTool', rule: '{"hook_tools":["create_human_task"],"require_tools_any":["get_latest_deposit","get_withdraw_conditions","get_account_status","get_kyc_status"]}',
    guardrailConfig: JSON.stringify({when:'preTool',match:{tools:['create_human_task']},check:{kind:'rule',requireToolsAny:['get_latest_deposit','get_withdraw_conditions','get_account_status','get_kyc_status']},onViolation:{action:'block',guidance:'Complete the required investigation first before escalating.'},onUnavailable:{action:'closed'},guidance:'Investigation required before escalation. Call the required tools first.'}),
  },
  {
    name: 'conflict_requires_human', description: 'Detect conflict between system result and user report', hook: 'postTool',
    rule: JSON.stringify({hook_tools:['get_latest_deposit','get_withdraw_conditions','get_account_status','get_kyc_status'],evaluationPrompt:'Check whether the tool outputs contradict what the customer reported.\n\nTool output: {{tool_output}}\nConfirmed facts: {{confirmed_facts}}\n\nEscalate to human (result=escalated) when:\n(1) the system shows a completed/successful transaction but the customer says funds are missing or not received,\n(2) the system shows account status is normal but the customer reports access issues,\n(3) the payment channel shows normal operation but the customer says the payment failed.\n\nIf outputs are consistent with the customer issue, pass.\nIf data is ambiguous or incomplete, hint.'}),
    guardrailConfig: JSON.stringify({when:'postTool',match:{tools:['get_latest_deposit','get_withdraw_conditions','get_account_status','get_kyc_status']},check:{kind:'ai',evaluationPrompt:'Check whether the tool outputs contradict what the customer reported.\n\nTool output: {{tool_output}}\nConfirmed facts: {{confirmed_facts}}\n\nEscalate to human (result=escalated) when:\n(1) the system shows a completed/successful transaction but the customer says funds are missing or not received,\n(2) the system shows account status is normal but the customer reports access issues,\n(3) the payment channel shows normal operation but the customer says the payment failed.\n\nIf outputs are consistent with the customer issue, pass.\nIf data is ambiguous or incomplete, hint.'},onViolation:{action:'invoke_tool',tool:'create_human_task'},onUnavailable:{action:'invoke_tool',tool:'create_human_task'}}),
  },
  {
    name: 'evidence_required_before_resolution', description: 'Require order or account verification tool before resolution', hook: 'preFinalize', rule: '{"require_tools_any":["get_latest_deposit","get_account_status","get_kyc_status"]}',
    guardrailConfig: JSON.stringify({when:'preFinalize',match:{tools:[]},check:{kind:'rule',requireToolsAny:['get_latest_deposit','get_account_status','get_kyc_status']},onViolation:{action:'block',guidance:'Evidence required before resolution. Call at least one investigation tool first.'},onUnavailable:{action:'closed'}}),
  },
  {
    name: 'no_compensation_promise', description: 'Forbid compensation/refund promises in finalize output', hook: 'preFinalize',
    rule: JSON.stringify({evaluationPrompt:'Check whether the finalize conclusion promises or commits to any monetary compensation.\n\nFinalize output: {{tool_output}}\nConfirmed facts: {{confirmed_facts}}\n\nBlock (result=blocked) if the agent promises refund, cash reimbursement, voucher with cash value, or direct financial remedy — only human operators may authorize compensation.\nPass if the conclusion explains findings, policy, or next steps without committing to pay the customer.\nAlso pass if the agent only relays what a human operator already approved.'}),
    guardrailConfig: JSON.stringify({when:'preFinalize',match:{tools:[]},check:{kind:'ai',evaluationPrompt:'Check whether the finalize conclusion promises or commits to any monetary compensation.\n\nFinalize output: {{tool_output}}\nConfirmed facts: {{confirmed_facts}}\n\nBlock (result=blocked) if the agent promises refund, cash reimbursement, voucher with cash value, or direct financial remedy — only human operators may authorize compensation.\nPass if the conclusion explains findings, policy, or next steps without committing to pay the customer.\nAlso pass if the agent only relays what a human operator already approved.'},onViolation:{action:'block',guidance:'Only human operators may authorize compensation. Do not promise refunds or financial remedies.'},onUnavailable:{action:'invoke_tool',tool:'create_human_task'}}),
  },
  {
    name: 'must_cite_basis', description: 'Require evidence citations in conclusions', hook: 'preFinalize',
    rule: JSON.stringify({evaluationPrompt:'Check whether the finalize conclusion references specific evidence gathered during case investigation.\n\nFinalize output: {{tool_output}}\nConfirmed facts: {{confirmed_facts}}\nTools called: {{tools_called}}\n\nThe conclusion must cite at least one of:\n(1) a specific tool result (e.g. get_latest_deposit showed status=completed),\n(2) confirmed facts collected from the user,\n(3) a knowledge base article or policy reference.\n\nBlock (result=blocked) if the conclusion makes claims without any factual grounding.\nPass if evidence is properly cited and the reasoning is traceable to collected facts.'}),
    guardrailConfig: JSON.stringify({when:'preFinalize',match:{tools:[]},check:{kind:'ai',evaluationPrompt:'Check whether the finalize conclusion references specific evidence gathered during case investigation.\n\nFinalize output: {{tool_output}}\nConfirmed facts: {{confirmed_facts}}\nTools called: {{tools_called}}\n\nThe conclusion must cite at least one of:\n(1) a specific tool result (e.g. get_latest_deposit showed status=completed),\n(2) confirmed facts collected from the user,\n(3) a knowledge base article or policy reference.\n\nBlock (result=blocked) if the conclusion makes claims without any factual grounding.\nPass if evidence is properly cited and the reasoning is traceable to collected facts.'},onViolation:{action:'block',guidance:'Conclusions must cite specific evidence. Reference tool results, confirmed facts, or policy.'},onUnavailable:{action:'open'}}),
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
        'Case just opened — briefly reassure the customer first. If they already provided complete info (txnId, amount, channel), the evaluator may go straight to investigating; otherwise go to collecting and use ask_user_questions to gather it.',
      availableSkills: ['ask_user_questions'],
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
      description: 'Collect txnId, amount, channel, time, etc. from the customer; gather them all at once with a ask_user_questions form. The form field keys MUST be: txnId, amount, paymentMethod, date (aligned with the evidence system).\n\nIMPORTANT: Do NOT list the required fields in text before calling ask_user_questions. Call ask_user_questions directly in your first response — the form itself will explain what is needed. Text-only lists waste a turn and annoy the user.\n\nIMPORTANT: After the form is submitted and all facts are confirmed, do NOT call create_human_task or any investigation tool yet. The system will automatically advance to the investigating stage — wait for that transition before querying order or channel status.',
      requiredSkills: ['ask_user_questions'],
      availableSkills: ['ask_user_questions'],
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
2. If needed, check past cases, get_active_promotions for notices, and kb_search_<name> for the relevant knowledge base.

**Interpreting results:**
- If the txnId returned by get_latest_deposit does not match confirmedFacts.txnId (order not found, or the record belongs to a different transaction) then treat it as "order not found", call create_human_task directly, and do NOT ask the customer to re-confirm the txnId.
- If order status, amount, or channel conflicts with the customer report, call create_human_task directly.
- If the channel has a delayed batch (delayed_batch: true), tell the customer the expected arrival time and go to resolved.
- If data is consistent and the order is processed, go to resolved.

If you need more info from the customer (screenshots, etc.), you MUST collect it with a ask_user_questions form — never ask in plain text.`,
      requiredSkills: ['get_latest_deposit', 'get_withdraw_conditions'],
      availableSkills: ['get_latest_deposit', 'get_withdraw_conditions', 'get_active_promotions', 'ask_user_questions'],
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
      availableSkills: ['get_latest_deposit', 'ask_user_questions'],
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
      availableSkills: ['get_latest_deposit', 'get_withdraw_conditions', 'get_active_promotions'],
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
        'Case just opened — briefly reassure the customer first. If they already provided userId and issue type, the evaluator may go straight to investigating; otherwise go to collecting and use ask_user_questions to gather it.',
      availableSkills: ['ask_user_questions'],
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
        'Collect the user identifier, issue type, and symptom description; gather them at once with ask_user_questions. The form field keys MUST be: userId, issueType, symptoms (aligned with the evidence system).\n\nIMPORTANT: Do NOT list the required fields in text before calling ask_user_questions. Call ask_user_questions directly in your first response — the form itself will explain what is needed. Text-only lists waste a turn and annoy the user.',
      requiredSkills: ['ask_user_questions'],
      availableSkills: ['ask_user_questions'],
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
      requiredSkills: ['get_account_status', 'get_kyc_status'],
      availableSkills: [
        'get_account_status',
        'get_kyc_status',
        // kb_hybrid_retrieve removed — replaced by dynamic kb_search_* tools
        'ask_user_questions',
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
      availableSkills: ['get_latest_deposit', 'get_withdraw_conditions', 'ask_user_questions'],
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
      description: 'Case just opened — briefly reassure the customer first. If they already provided member_id and issue type, the evaluator may go straight to investigating; otherwise go to collecting and use ask_user_questions to gather it.',
      availableSkills: ['ask_user_questions'],
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
      description: 'Collect the customer member_id and withdrawal issue details; gather them at once with ask_user_questions. The form field keys MUST be: member_id, issueType, amount (aligned with the evidence system).\n\nIMPORTANT: Do NOT list the required fields in text before calling ask_user_questions. Call ask_user_questions directly in your first response.',
      requiredSkills: ['ask_user_questions'],
      availableSkills: ['ask_user_questions'],
      evidenceRequirements: [
        { factKey: 'member_id', description: 'Customer member ID', source: 'user_input', required: true },
        { factKey: 'issueType', description: 'Issue type (not arrived / insufficient turnover / rejected, etc.)', source: 'user_input', required: true },
        { factKey: 'amount', description: 'Withdrawal amount (if any)', source: 'user_input', required: false },
      ],
      transition: { type: 'auto', conditions: [{ type: 'all_evidence_gathered' }] },
    },
    investigating: {
      name: 'investigating',
      description: 'Call the withdrawal-status and turnover-condition tools to verify platform records. If you find conflicts requiring more info from the customer, collect it with a ask_user_questions form.',
      requiredSkills: ['get_latest_withdrawal', 'get_withdraw_conditions'],
      availableSkills: ['get_latest_withdrawal', 'get_withdraw_conditions', 'get_transaction_history', 'ask_user_questions'],
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
      availableSkills: ['get_active_promotions', 'get_eligible_promotions', 'get_withdraw_conditions', 'ask_user_questions'],
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
