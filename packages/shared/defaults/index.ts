// Shared default data for admin pre-fill — used by both seed.ts and API lazy init.

export const DEFAULT_MODEL = 'deepseek-v4-flash'

/** Lightweight prompt for Core (discovery) mode — no case active.
 *  Focused on conversation routing, direct tool calls, and case creation.
 *  Does NOT include legacy stage requirements or detached background workers. */
export const CORE_SYSTEM_PROMPT = `You are Intera, a customer service assistant. Respond in the customer's language. Be concise. Don't describe what you'll do — just do it. Call the tool, don't narrate.

**For date/time questions: you MUST call get_current_time.** Do not guess. Do not say you can't. Just call the tool — it will give you the answer. Your training cutoff date is wrong.

**Never fabricate data.** If a tool returns success:false or an error, report the error to the customer. Never invent results, numbers, dates, or records. If data is not returned by a tool, it does not exist.

**Always use ask_user_questions to collect information.** When you need member_id, date range, order ID, amount, or any other details: call ask_user_questions. Never ask in plain text — use the form tool. A text question like "Please provide your member ID" without calling ask_user_questions is a failed response.

**When information is missing, the tool call is the collection step.** For account-specific work with missing member_id or other required fields, your next turn should be the ask_user_questions call itself. Do not free-type the same question that the form already asks. At most, include a very short acknowledgment around the tool call.

## Parallel tool calls

When you need to look up or check multiple things, call all independent tools together in a single turn. If two tools don't depend on each other's output, issue them simultaneously — they execute concurrently. Sequence only when one result feeds the next.

**Knowledge base search**: Search all potentially relevant sources in parallel. If results are insufficient, iterate — rephrase, broaden, or try additional sources. Exhaust the search space before concluding information is unavailable.

## member_id

The Session ID under "Current User" is NOT a member_id. If a verified Member ID is listed there, use it for any tool that needs member_id. If member_id is unknown, call ask_user_questions to ask the customer for it before calling any tool that needs it — never guess or pass the Session ID. If a tool returns "member id is invalid", call ask_user_questions immediately — don't apologize, just ask. In channel flows, do not send a duplicate plain-text request for the same field after calling ask_user_questions.

## Knowledge base vs account tools

For general / catalog / how-to questions (what promotions, games, or payment methods exist; how to do something; policies, bonus terms, contact info) → ALWAYS use the knowledge base (kb_search_*). It holds the catalog and the rules. Account/status tools (get_active_promotions, get_latest_deposit, get_account_status, etc.) return ONLY this member's live data. If an account/status tool returns empty or negative, do NOT conclude "there is none" — check the knowledge base before answering.

## Memory Tools

You have access to three built-in memory tools:
- \`read_chat_memory\` — Retrieve the current case's working summary (context map, tools executed, key events)
- \`read_user_profile\` — Retrieve this user's cross-chat profile (identity, contact, preferences, activity, history)
- \`remember\` — Save long-term profile memory with \`scope: "user"\` only. Do not use it for chat-scoped facts or ProcedureRun runtime state.
Use these when you need context about the user/current chat or need to save business memory.

{{available_tools}}

{{case_types}}

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
2. Treat this as a human_task_result input event. Use the latest ProcedureRun inputEpoch before any terminal action.
3. Format it as a helpful update, e.g.: "Hi! Our team has reviewed your case and [result]. Here's what this means for you: [explanation]."
4. If the operator asked for more information instead of resolving, continue assisting without finalizing.
5. If the current ProcedureRun has current evidence and is ready to close, call finalize_procedure with a conclusion and evidence basis.`

/** Appended after \`[Form submitted]\` + answer lines when \`formResponseTemplate\` is empty. */
export const HARNESS_DEFAULT_FORM_RESPONSE_APPEND =
  'Please continue processing based on this information.'

export interface DefaultHookSeed {
  name: string
  description: string | null
  checkpoint: 'PreToolUse' | 'PostToolUse' | 'Stop'
  handlerKind: 'declarative' | 'code' | 'http'
  handler: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  enabled: boolean
}

export const HUMAN_HANDOFF_PROMISE_PATTERN = [
  String.raw`(?:\b(?:i|we)\s+(?:have|'ve)\s+(?:created|opened|submitted|arranged|escalated)\s+(?:a\s+)?(?:ticket|case|handoff|human support request)\b)`,
  String.raw`(?:\b(?:i|we)\s+will\s+(?:arrange|transfer|connect|escalate)\s+(?:you\s+)?(?:to|with)?\s*(?:a\s+)?(?:human|agent|specialist|representative)\b)`,
  String.raw`(?:已为您创建工单|已经为您创建工单|已安排人工|将安排人工|正在(?:为您|帮您)?人工处理|(?:为您|帮您)?人工处理(?:中|。|，|,|$)|已转人工|已经转人工|已为您转接|客服会(?:尽快)?(?:联系|回复)您|(?:人工|客服|专员)(?:会|将)(?:尽快)?(?:联系|回复)您|专员将尽快与您联系)`,
].join('|')

export const DEFAULT_HOOKS: DefaultHookSeed[] = [
  {
    name: 'no_high_risk_account_change',
    description: 'Block high-risk account mutations before a Tool runs',
    checkpoint: 'PreToolUse',
    handlerKind: 'declarative',
    handler: JSON.stringify({
      kind: 'declarative',
      check: {
        kind: 'rule',
        match: { tools: ['refund_money', 'change_ban_status', 'delete_account'] },
        denyTools: ['refund_money', 'change_ban_status', 'delete_account'],
      },
      effect: {
        decision: 'block',
        guidance: 'High-risk account changes are not allowed. Escalate to a human specialist if needed.',
      },
    }),
    severity: 'critical',
    enabled: true,
  },
  {
    name: 'investigate_before_resolve',
    description: 'Require evidence before the Agent gives a final resolution',
    checkpoint: 'Stop',
    handlerKind: 'declarative',
    handler: JSON.stringify({
      kind: 'declarative',
      check: {
        kind: 'ai',
        evaluationPrompt:
          'Check whether the customer-visible answer cites evidence gathered during the case.\n\nReply draft: {{reply_draft}}\nTools called: {{tools_called}}\n\nBlock if the answer makes factual claims without citing tool results or knowledge evidence. Pass if the reasoning is traceable.',
      },
      effect: {
        decision: 'block',
        guidance: 'Cite specific evidence from tools or knowledge before resolving.',
      },
    }),
    severity: 'high',
    enabled: true,
  },
  {
    name: 'human_handoff_promise_requires_task',
    description: 'Auto-create human handoff when a model-authored human-support promise appears without create_human_task',
    checkpoint: 'Stop',
    handlerKind: 'declarative',
    handler: JSON.stringify({
      kind: 'declarative',
      check: {
        kind: 'rule',
        match: { ifPattern: HUMAN_HANDOFF_PROMISE_PATTERN },
        requireTools: ['create_human_task'],
        reason: 'Reply promises human support without calling create_human_task.',
      },
      effect: {
        decision: 'escalate',
        tool: 'create_human_task',
        guidance: 'If you promise human handoff, call create_human_task in the same turn.',
      },
    }),
    severity: 'critical',
    enabled: true,
  },
  {
    name: 'human_review_before_finalize',
    description: 'Require human review for high-risk CaseTypes before finalization',
    checkpoint: 'Stop',
    handlerKind: 'declarative',
    handler: JSON.stringify({
      kind: 'declarative',
      check: {
        kind: 'rule',
        requireTools: ['create_human_task'],
      },
      effect: {
        decision: 'block',
        guidance: 'Call create_human_task before finalizing this case.',
      },
    }),
    severity: 'high',
    enabled: true,
  },
]

export interface DefaultCaseTypeSeed {
  type: string
  displayName: string
  description: string
  icon: string
  requiredFacts: string
  defaultGoal: string
  escalateOn: string
  enabled?: boolean
  procedure: string
  hookBindings?: string[]
  maxAutoTurns?: number
}

export const DEFAULT_CASE_TYPES: DefaultCaseTypeSeed[] = [
  {
    type: 'deposit_issue',
    displayName: 'Deposit not credited',
    description:
      'The customer says they topped up or transferred funds to the platform (bank card, e-wallet, USDT, etc.) but their balance did not increase or they see no confirmation of arrival. Includes "charged but balance unchanged", "transaction shows but no credits in game/wallet", and "still not credited after a long time".',
    icon: '💰',
    requiredFacts: '["txnId","amount","paymentMethod","date"]',
    defaultGoal: 'Verify the order and payment-channel status; determine whether it is delayed, failed, or needs a manual top-up. Escalate to a human when system data conflicts with the customer report.',
    escalateOn: '["conflict"]',
    procedure: JSON.stringify({
      version: 'v2',
      whenToUse: 'Use when the customer says a deposit or transfer was charged but no credit reached their balance.',
      overview: 'Collect deposit details, verify order evidence, then either explain the result or hand off when platform evidence conflicts with the customer report.',
      handoffGuidance: 'Escalate to payment_ops when platform evidence conflicts with the customer report or a manual review is required.',
      steps: [
        {
          id: 'collect_deposit_details',
          title: 'Collect deposit details',
          guidance: 'Collect txnId, amount, payment method, and date with ask_user_questions before any account lookup.',
          actions: [
            {
              id: 'ask_deposit_details',
              kind: 'ask',
              label: 'Ask for deposit details',
              fields: ['txnId', 'amount', 'paymentMethod', 'date'],
            },
          ],
        },
        {
          id: 'investigate_deposit',
          title: 'Investigate order and channel status',
          guidance: 'Verify the reported deposit against platform records and review any channel or turnover conditions that affect the answer.',
          actions: [
            {
              id: 'lookup_latest_deposit',
              kind: 'call_tool',
              label: 'Check latest deposit',
              toolName: 'get_latest_deposit',
            },
            {
              id: 'check_channel_or_conditions',
              kind: 'call_tool',
              label: 'Check withdrawal conditions',
              toolName: 'get_withdraw_conditions',
              required: false,
            },
          ],
          branches: [
            {
              id: 'conflict_or_manual_review',
              kind: 'if',
              condition: {
                kind: 'llm_eval',
                prompt: 'Based on the latest tool evidence and the customer report, is there a conflict or a manual-review need that requires payment_ops handoff?',
              },
              actions: [
                {
                  id: 'handoff_payment_ops',
                  kind: 'request_human_handoff',
                  label: 'Request payment ops review',
                  queue: 'payment_ops',
                },
              ],
            },
          ],
          completionGuidance: 'Do not finalize until the evidence is current and sufficient, or a human handoff is persisted.',
        },
        {
          id: 'finalize_deposit_answer',
          title: 'Explain the result and next step',
          guidance: 'Explain the evidence and next step without promising compensation.',
          actions: [
            {
              id: 'finish_deposit_case',
              kind: 'end',
              label: 'Finalize customer answer',
              status: 'completed',
            },
          ],
        },
      ],
    }),
    hookBindings: ['investigate_before_resolve', 'human_handoff_promise_requires_task', 'human_review_before_finalize'],
    maxAutoTurns: 10,
  },
  {
    type: 'account_issue',
    displayName: 'Account issue',
    description:
      'The customer reports being unable to log in, account banned/frozen, risk-control or KYC anomalies, suspected account theft, OTP/2FA issues, or device-binding disputes — i.e. issues about the account identity and security policy. Does NOT include a single deposit not arriving (that is "Deposit not credited").',
    icon: '🔒',
    requiredFacts: '["userId","issueType"]',
    defaultGoal:
      'Pull account-side records and knowledge-base references to determine whether the account is restricted/banned/falsely flagged. Escalate to account-ops human review on conflict or high-risk cases, and give actionable next steps.',
    escalateOn: '["high_risk","conflict"]',
    procedure: JSON.stringify({
      version: 'v2',
      whenToUse: 'Use when the customer cannot log in, reports an account restriction, or needs help with identity, security, or KYC status.',
      overview: 'Collect account details, inspect live account evidence, and hand off high-risk or conflicting cases to account_ops.',
      handoffGuidance: 'Escalate to account_ops when the evidence suggests high risk, suspected theft, or a conflict between system status and the customer report.',
      steps: [
        {
          id: 'collect_account_details',
          title: 'Collect account details',
          guidance: 'Collect userId, issue type, and symptom details before investigating the account.',
          actions: [
            {
              id: 'ask_account_details',
              kind: 'ask',
              label: 'Ask for account details',
              fields: ['userId', 'issueType', 'symptoms'],
            },
          ],
        },
        {
          id: 'investigate_account_status',
          title: 'Investigate account status',
          guidance: 'Check the account status first, then review KYC status when it is relevant to the issue.',
          actions: [
            {
              id: 'lookup_account_status',
              kind: 'call_tool',
              label: 'Check account status',
              toolName: 'get_account_status',
            },
            {
              id: 'lookup_kyc_status',
              kind: 'call_tool',
              label: 'Check KYC status',
              toolName: 'get_kyc_status',
              required: false,
            },
          ],
          branches: [
            {
              id: 'high_risk_or_conflict',
              kind: 'if',
              condition: {
                kind: 'llm_eval',
                prompt: 'Based on the current tool evidence and the customer report, is this a high-risk or conflicting account case that requires account_ops handoff?',
              },
              actions: [
                {
                  id: 'handoff_account_ops',
                  kind: 'request_human_handoff',
                  label: 'Request account ops review',
                  queue: 'account_ops',
                },
              ],
            },
          ],
          completionGuidance: 'Do not finalize until the account evidence is current and sufficient, or a human handoff is persisted.',
        },
        {
          id: 'finalize_account_answer',
          title: 'Explain the status and next safe step',
          guidance: 'Explain the current status and the safest next step for the customer.',
          actions: [
            {
              id: 'finish_account_case',
              kind: 'end',
              label: 'Finalize account answer',
              status: 'completed',
            },
          ],
        },
      ],
    }),
    hookBindings: ['investigate_before_resolve', 'human_handoff_promise_requires_task'],
    maxAutoTurns: 10,
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
