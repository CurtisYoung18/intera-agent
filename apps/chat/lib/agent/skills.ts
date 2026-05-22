// Intera Harness - Skill Router
// Based on architecture doc: Skills System
//
// [MOCK] Hardcoded built-in skills with mock execution.
// Production path:
//   - Load skills from Skill table (Prisma) for the active Customer
//   - Support dynamic skill registration via Admin console
//   - Route mock/http based on Skill.mode field

import type { SkillDefinition, ToolUse } from '@intera/shared/types'
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod'

/**
 * Built-in Skills — core capabilities available to the Agent.
 * Each skill has a mock implementation in streaming-tool-executor.ts.
 * Skills marked isConcurrencySafe=false run sequentially (write operations).
 */
export const BUILT_IN_SKILLS: SkillDefinition[] = [
  {
    name: 'create_case',
    description:
      'Create a tracked Case for a single clear customer issue. ' +
      'Use when the customer reports one distinct problem. ' +
      'For multiple issues or ambiguous intent, use propose_cases instead.',
    inputSchema: {
      type: 'object',
      properties: {
        caseType: { type: 'string', description: 'Case type slug, e.g. deposit_issue, account_issue' },
      },
      required: ['caseType'],
    },
    isConcurrencySafe: false,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Creating your case', icon: 'dots' },
    zodSchema: z.object({ caseType: z.string() }),
    mockFixture: { caseId: 'case_mock_001', status: 'created' },
  },
  {
    name: 'propose_cases',
    description:
      'Propose case types when the customer has multiple distinct issues or the intent is ambiguous. ' +
      'The customer will see a multi-select card to choose which cases to open. ' +
      'Use this INSTEAD of create_case when there are 2+ issues or you are unsure which type fits.',
    inputSchema: {
      type: 'object',
      properties: {
        cases: {
          type: 'array',
          description: 'Proposed case types with a brief summary of the detected issue',
          items: {
            type: 'object',
            properties: {
              caseType: { type: 'string', description: 'Case type slug, e.g. deposit_issue' },
              summary: { type: 'string', description: 'One-line description of what the customer reported for this issue' },
            },
            required: ['caseType', 'summary'],
          },
        },
      },
      required: ['cases'],
    },
    isConcurrencySafe: false,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Analyzing your issue', icon: 'dots' },
    zodSchema: z.object({
      cases: z.array(z.object({ caseType: z.string(), summary: z.string() })),
    }),
    mockFixture: { status: 'proposed' },
  },
  {
    name: 'read_case_history',
    description: "Read the customer's historical cases for context",
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Customer user ID' },
        limit: {
          type: 'number',
          description: 'Max number of cases to return',
          default: 5,
        },
      },
      required: ['userId'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Looking up past cases', icon: 'scan' },
    zodSchema: z.object({ userId: z.string(), limit: z.number().optional() }),
    mockFixture: {
      cases: [
        {
          id: 'C2026-0482',
          type: 'deposit_issue',
          status: 'resolved',
          summary: 'User deposited 2000 CNY via WeChat Pay, funds credited after 1.5 hour batch settlement delay',
          resolvedAt: '2026-05-15T14:30:00Z',
        },
        {
          id: 'C2026-0501',
          type: 'deposit_issue',
          status: 'resolved',
          summary: 'User deposited 500 CNY via Alipay, transaction confirmed but balance not updated; traced to cached balance display issue, resolved by manual refresh',
          resolvedAt: '2026-05-10T09:15:00Z',
        },
        {
          id: 'C2026-0550',
          type: 'withdrawal_issue',
          status: 'resolved',
          summary: 'User withdrawal of 3000 CNY delayed due to bank maintenance window, credited within 4 hours',
          resolvedAt: '2026-05-20T16:45:00Z',
        },
      ],
      total: 3,
    },
  },
  {
    name: 'query_order_status',
    description: 'Query the platform order system for transaction status',
    inputSchema: {
      type: 'object',
      properties: {
        txnId: { type: 'string', description: 'Transaction ID' },
      },
      required: ['txnId'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Checking order status', icon: 'scan' },
    zodSchema: z.object({ txnId: z.string() }),
    // [MOCK] realistic deposit scenario — Alipay 1000 CNY pending batch settlement
    mockFixture: {
      txnId: 'TX2026051912345678',
      status: 'pending',
      amount: 1000.0,
      currency: 'CNY',
      time: '2026-05-19T15:30:00.000Z',
      channel: 'alipay',
      paymentMethod: 'Alipay',
      merchantRef: 'MCH20260519001',
    },
  },
  {
    name: 'query_payment_channel_status',
    description: 'Query the payment channel for current status and delays',
    inputSchema: {
      type: 'object',
      properties: {
        txnId: { type: 'string', description: 'Transaction ID to look up' },
        channel: { type: 'string', description: 'Payment channel name (optional, inferred from query_order_status if omitted)' },
      },
      required: ['txnId'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Verifying payment channel', icon: 'scan' },
    zodSchema: z.object({ txnId: z.string(), channel: z.string().optional() }),
    // [MOCK] realistic Alipay channel — normal operation, no delays
    mockFixture: {
      delayed_batch: false,
      channel: 'alipay',
      channelStatus: 'normal',
      lastSettlementAt: '2026-05-19T15:25:00.000Z',
      currentLoad: 'low',
      reason: null,
    },
  },
  {
    name: 'search_delay_notice',
    description: 'Search for any delay notices or announcements',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Checking platform announcements', icon: 'dots' },
    zodSchema: z.object({ query: z.string().optional() }),
    // [MOCK] realistic delay notices — Alipay batch settlement schedule
    mockFixture: {
      notices: [
        {
          id: 'NOT20260510-001',
          title: 'Alipay Batch Settlement Schedule',
          channel: 'alipay',
          severity: 'info',
          content: 'Alipay deposits are processed in batches every 15-30 minutes during normal hours (00:00-02:00 UTC). During the 02:00-04:00 UTC maintenance window, settlement may be delayed up to 2 hours.',
          publishedAt: '2026-05-10T00:00:00Z',
          affectsDeposit: true,
        },
      ],
    },
  },
  // ── Account / KYC skills (used by account_issue SOP) ────────────────────────
  {
    name: 'get_account_status',
    description: 'Retrieve the current account status, restrictions, and ban reason for a member',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string', description: 'Platform user ID (UID)' },
      },
      required: ['member_id'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Checking account status', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string() }),
    mockFixture: {
      member_id: 'U10023',
      status: 'active',           // active | suspended | banned | locked
      restrictions: [],
      banReason: null,
      lastLoginAt: '2026-05-21T08:00:00Z',
      registeredAt: '2025-01-15T00:00:00Z',
      riskLevel: 'low',
    },
  },
  {
    name: 'get_kyc_status',
    description: 'Retrieve KYC (identity verification) status for a member',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string', description: 'Platform user ID (UID)' },
      },
      required: ['member_id'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Verifying identity status', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string() }),
    mockFixture: {
      member_id: 'U10023',
      kycStatus: 'approved',      // not_started | pending | approved | rejected
      kycLevel: 'basic',          // basic | enhanced
      submittedAt: '2025-01-16T09:00:00Z',
      approvedAt: '2025-01-17T10:30:00Z',
      rejectionReason: null,
    },
  },

  // ── Withdrawal skills (used by withdrawal_issue SOP) ──────────────────────
  {
    name: 'get_latest_withdrawal',
    description: 'Retrieve the most recent withdrawal request and its status for a member',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string', description: 'Platform user ID' },
      },
      required: ['member_id'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Checking withdrawal status', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string() }),
    mockFixture: {
      withdrawalId: 'WD2026052100987',
      member_id: 'U10023',
      amount: 3000.0,
      currency: 'CNY',
      status: 'pending',          // pending | processing | completed | rejected | cancelled
      bankName: '招商银行',
      bankAccount: '****1234',
      requestedAt: '2026-05-21T10:00:00Z',
      estimatedArrival: '2026-05-22T18:00:00Z',
      rejectionReason: null,
    },
  },
  {
    name: 'get_withdraw_conditions',
    description: 'Check withdrawal eligibility conditions for a member, including wagering requirements',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string', description: 'Platform user ID' },
      },
      required: ['member_id'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Checking withdrawal eligibility', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string() }),
    mockFixture: {
      eligible: true,
      wageringRequired: 5000.0,
      wageringCompleted: 5200.0,
      wageringShortfall: 0,
      bonusLockAmount: 0,
      minWithdrawalAmount: 100.0,
      maxWithdrawalAmount: 50000.0,
      dailyLimitRemaining: 10000.0,
      pendingWithdrawals: 1,
    },
  },
  {
    name: 'get_transaction_history',
    description: 'Retrieve recent deposit/withdrawal transaction history for a member',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string', description: 'Platform user ID' },
        limit: { type: 'number', description: 'Max records to return (default 10)' },
        type: { type: 'string', description: 'Filter by type: deposit | withdrawal | all', enum: ['deposit', 'withdrawal', 'all'] },
      },
      required: ['member_id'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Loading transaction history', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string(), limit: z.number().optional(), type: z.enum(['deposit', 'withdrawal', 'all']).optional() }),
    mockFixture: {
      transactions: [
        { id: 'TX001', type: 'withdrawal', amount: 3000.0, status: 'pending',   at: '2026-05-21T10:00:00Z' },
        { id: 'TX002', type: 'deposit',    amount: 5000.0, status: 'completed', at: '2026-05-20T14:00:00Z' },
        { id: 'TX003', type: 'deposit',    amount: 1000.0, status: 'completed', at: '2026-05-19T15:30:00Z' },
      ],
      total: 3,
    },
  },

  // ── Promotion skills (used by promotion_inquiry SOP) ─────────────────────
  {
    name: 'get_active_promotions',
    description: 'Retrieve promotions the member is currently participating in',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string', description: 'Platform user ID' },
      },
      required: ['member_id'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Loading active promotions', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string() }),
    mockFixture: {
      activePromotions: [
        {
          id: 'PROMO-2026-05-WELCOME',
          name: '首存优惠 100%',
          type: 'deposit_bonus',
          bonusAmount: 1000.0,
          wageringRequired: 5000.0,
          wageringCompleted: 5200.0,
          expiresAt: '2026-06-01T00:00:00Z',
          status: 'wagering_complete',
        },
      ],
    },
  },
  {
    name: 'get_eligible_promotions',
    description: 'Retrieve promotions the member is eligible for but has not yet claimed',
    inputSchema: {
      type: 'object',
      properties: {
        member_id: { type: 'string', description: 'Platform user ID' },
      },
      required: ['member_id'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Finding available promotions', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string() }),
    mockFixture: {
      eligiblePromotions: [
        {
          id: 'PROMO-2026-05-RELOAD',
          name: '每周续存优惠 50%',
          type: 'reload_bonus',
          maxBonus: 500.0,
          minDeposit: 200.0,
          wageringMultiplier: 3,
          validUntil: '2026-05-25T23:59:59Z',
          claimUrl: '/promotions/reload',
        },
      ],
    },
  },

  {
    name: 'ocr_receipt',
    description: 'Extract information from uploaded receipt screenshots',
    inputSchema: {
      type: 'object',
      properties: {
        attachmentId: {
          type: 'string',
          description: 'Attachment ID to process',
        },
      },
      required: ['attachmentId'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Reading your receipt', icon: 'spin' },
    zodSchema: z.object({ attachmentId: z.string() }),
    // [MOCK] realistic receipt extraction — Alipay payment of 1000 CNY
    mockFixture: {
      success: true,
      extracted: {
        amount: 1000.0,
        currency: 'CNY',
        time: '2026-05-19T15:30:00.000Z',
        channel: 'alipay',
        merchantRef: 'MCH20260519001',
        txnId: 'TX2026051912345678',
      },
    },
  },
  {
    name: 'create_human_task',
    description:
      'Create a human task for manual confirmation or processing. ' +
      'This will pause the agent loop until a human responds. ' +
      'Optionally provide structured fields to collect specific data from the operator — ' +
      'their answers will be automatically ingested as confirmedFacts when they resolve the task.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: {
          type: 'string',
          description: 'Human queue to route to',
        },
        question: {
          type: 'string',
          description: 'Structured question for human',
        },
        fields: {
          type: 'array',
          description: 'Optional structured form fields for the operator to fill. Their answers flow back as confirmedFacts.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Fact key, e.g. "actualAmount", "verifyResult"' },
              label: { type: 'string', description: 'Display label, e.g. "实际到账金额"' },
              type: { type: 'string', enum: ['text', 'number', 'select', 'textarea'], description: 'Field type' },
              required: { type: 'boolean', description: 'Whether this field must be filled' },
              placeholder: { type: 'string', description: 'Placeholder text' },
              options: { type: 'array', items: { type: 'string' }, description: 'Options for select type' },
            },
            required: ['key', 'label', 'type'],
          },
        },
        context: {
          type: 'object',
          description: 'Additional context for the human reviewer',
        },
      },
      required: ['queue', 'question'],
    },
    isConcurrencySafe: false,
    mode: 'mock',
    enabled: true,
    zodSchema: z.object({
      queue: z.string(),
      question: z.string(),
      fields: z.array(z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(['text', 'number', 'select', 'textarea']),
        required: z.boolean().optional(),
        placeholder: z.string().optional(),
        options: z.array(z.string()).optional(),
      })).optional(),
      context: z.object({}).optional(),
    }),
    displayVerb: { text: 'Escalating to a specialist', icon: 'pulse' },
    // [MOCK]
    mockFixture: { taskId: 'htask_mock_001', status: 'pending' },
  },
  {
    name: 'finalize_case',
    description: 'Mark the case as resolved with a conclusion',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['resolved', 'escalated'],
          description: 'Final status',
        },
        conclusion: { type: 'string', description: 'Conclusion summary' },
        basis: {
          type: 'array',
          items: { type: 'string' },
          description: 'Evidence basis for the conclusion',
        },
      },
      required: ['status', 'conclusion'],
    },
    isConcurrencySafe: false,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Wrapping up your case', icon: 'spin' },
    zodSchema: z.object({ status: z.enum(["resolved","escalated"]), conclusion: z.string(), basis: z.array(z.string()).optional() }),
    // [MOCK]
    mockFixture: {
      status: 'resolved',
      resolvedAt: new Date().toISOString(),
    },
  },
  {
    name: 'kb_hybrid_retrieve',
    description: 'Hybrid knowledge base search (BM25 + vector)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        topK: {
          type: 'number',
          description: 'Number of results',
          default: 5,
        },
      },
      required: ['query'],
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Searching knowledge base', icon: 'dots' },
    zodSchema: z.object({ query: z.string(), topK: z.number().optional() }),
    // [MOCK] realistic KB articles about deposit delays and troubleshooting
    mockFixture: {
      results: [
        {
          title: 'Why is my deposit not showing in my balance?',
          snippet: 'Deposits via third-party payment channels (Alipay, WeChat Pay) may take up to 2 hours to reflect due to batch settlement cycles. Check your payment provider app for the transaction receipt first. If your deposit still does not appear after 2 hours, please contact support with your transaction ID.',
          source: 'help_center',
          relevance: 0.92,
        },
        {
          title: 'Common causes of balance discrepancies',
          snippet: 'Balance discrepancies can occur due to: (1) pending batch settlements from payment providers — most common, resolves within 30 min to 2 hours; (2) cached balance display — try logging out and back in; (3) recent refunds or adjustments not yet reflected; (4) payment provider-side delays outside our control.',
          source: 'faq',
          relevance: 0.85,
        },
        {
          title: 'How to verify your deposit status',
          snippet: 'You can verify your deposit by: (1) checking the payment provider app (Alipay/WeChat) for the transaction receipt and exact transaction ID; (2) comparing the transaction ID with our system records via the transaction history page; (3) waiting up to 24 hours during peak periods or maintenance windows before escalating.',
          source: 'help_center',
          relevance: 0.78,
        },
      ],
      sources: ['help_center/deposit-faq', 'faq/balance-issues', 'help_center/verify-deposit'],
    },
  },
  {
    name: 'request_user_input',
    description:
      'Display a structured form to the customer to collect required information. ' +
      'Use this when you need the customer to provide specific details (amount, payment method, ' +
      'screenshots, etc.). The form will appear as a floating glass card in the chat UI. ' +
      'Once the customer submits, you will receive their answers and can continue.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Form title, e.g. "Order Details Needed"',
        },
        description: {
          type: 'string',
          description: 'Brief explanation of why this information is needed',
        },
        fields: {
          type: 'array',
          description: 'Form fields to collect from the customer',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Field identifier, e.g. "amount"' },
              label: { type: 'string', description: 'Display label, e.g. "充值金额"' },
              type: {
                type: 'string',
                enum: ['text', 'number', 'select', 'textarea', 'file', 'date'],
                description: 'Input type',
              },
              required: {
                type: 'boolean',
                description: 'Whether this field is required',
              },
              placeholder: { type: 'string', description: 'Placeholder text' },
              options: {
                type: 'array',
                items: { type: 'string' },
                description: 'Options for select type',
              },
            },
            required: ['key', 'label', 'type'],
          },
        },
      },
      required: ['title', 'fields'],
    },
    isConcurrencySafe: false,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Preparing your information form', icon: 'pulse' },
    zodSchema: z.object({ title: z.string(), description: z.string().optional(), fields: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(["text","number","select","textarea","file","date"]), required: z.boolean().optional(), placeholder: z.string().optional(), options: z.array(z.string()).optional() })) }),
    // [MOCK] — form is rendered by the Chat UI, not executed here
    mockFixture: { status: 'form_displayed' },
  },
  {
    name: 'finalize_consultation',
    description: 'End the human consultation. Provide a customer-facing summary and the resolution decision. This closes the consultation chat and notifies the customer.',
    inputSchema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'Message to show the customer explaining what was resolved' },
        resolution: { type: 'string', description: 'The specialist\'s decision: confirmed_delayed, refund_issued, needs_more_info, resolved, false_alarm' },
      },
      required: ['summary', 'resolution'],
    },
    isConcurrencySafe: false,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Closing consultation', icon: 'spin' },
    zodSchema: z.object({ summary: z.string(), resolution: z.string() }),
    mockFixture: { status: 'consultation_closed' },
  },
  {
    name: 'propose_interaction',
    description:
      'Present an interactive choice card to the customer. Use when you need to confirm a correction, clarify intent, ' +
      'ask a follow-up question with specific options, or get a quick yes/no/alternative decision. ' +
      'This is a terminal tool — the loop pauses until the customer responds. ' +
      'Example use cases: correcting a previously submitted fact ("was 100, now it\'s 1000"), ' +
      'confirming before a destructive action, or offering multiple resolution paths.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Card title, e.g. "确认金额修改"' },
        description: { type: 'string', description: 'What needs to be resolved, e.g. "您刚才填的金额是100，但现在您说的是1000。需要修改吗？"' },
        options: {
          type: 'array',
          description: 'Options presented to the customer. The first option is the recommended/default choice.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique option key, e.g. "accept", "keep", "other"' },
              label: { type: 'string', description: 'Button/option text, e.g. "是的，改为1000"' },
              description: { type: 'string', description: 'Subtitle explaining the consequence of this choice' },
              inputType: { type: 'string', enum: ['none', 'text', 'number'], description: 'Whether this option needs user input. "none" for simple tap-to-select.' },
              inputPlaceholder: { type: 'string', description: 'Placeholder text for the input field (only relevant if inputType is not "none")' },
            },
            required: ['id', 'label'],
          },
        },
        multiSelect: { type: 'boolean', description: 'Allow selecting multiple options at once. Default false.' },
      },
      required: ['title', 'options'],
    },
    isConcurrencySafe: false,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Asking you a question', icon: 'pulse' },
    zodSchema: z.object({
      title: z.string(),
      description: z.string().optional(),
      options: z.array(z.object({
        id: z.string(),
        label: z.string(),
        description: z.string().optional(),
        inputType: z.enum(['none', 'text', 'number']).optional(),
        inputPlaceholder: z.string().optional(),
      })),
      multiSelect: z.boolean().optional(),
    }),
    mockFixture: { status: 'presented' },
  },
]

/**
 * SOP Internal Skills — only injected into the tool list when a case type
 * uses `executionMode: 'sop'`. Intercepted in AgentLoop (never sent to the
 * streaming-tool-executor for real execution).
 */
export const SOP_INTERNAL_SKILLS: SkillDefinition[] = [
  {
    name: 'todo_write',
    description:
      'Create, update, complete, or cancel a todo item in the case investigation plan. ' +
      'Use "add" to create a new todo, "complete" to mark one done (with findings as notes), ' +
      '"cancel" to drop an item that is no longer relevant, and "update" to revise text or notes. ' +
      'Always complete or cancel items as you progress — do not leave stale pending todos.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['add', 'update', 'complete', 'cancel'],
          description: '"add" creates a new todo; "complete"/"cancel"/"update" require id.',
        },
        id: { type: 'string', description: 'Todo ID — required for update / complete / cancel.' },
        text: { type: 'string', description: 'Todo description (required for add; optional for update).' },
        notes: { type: 'string', description: 'Findings or reason for this state change (e.g., what was discovered on completion).' },
      },
      required: ['action'],
    },
    isConcurrencySafe: false,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Updating investigation plan', icon: 'dots' },
    zodSchema: z.object({
      action: z.enum(['add', 'update', 'complete', 'cancel']),
      id: z.string().optional(),
      text: z.string().optional(),
      notes: z.string().optional(),
    }),
    mockFixture: { ok: true, todos: [] },
  },
  {
    name: 'todo_read',
    description: 'Read the current investigation todo list. Call this at the start of each turn to see pending, in-progress, and completed items before deciding what to do next.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    displayVerb: { text: 'Reviewing investigation plan', icon: 'scan' },
    mockFixture: { todos: [] },
  },
]

/**
 * Skill Router — manages the skill registry and provides tool definitions
 * in Anthropic API format.
 */
export class SkillRouter {
  private skills: Map<string, SkillDefinition> = new Map()

  constructor(_customerId: string) {
    // Load built-in skills synchronously (fallback).
    // Call SkillRouter.create() for DB-loaded skills.
    for (const skill of BUILT_IN_SKILLS) {
      this.skills.set(skill.name, skill)
    }
    // SOP internal tools (todo_write, todo_read) must be in the registry so
    // getSkill() resolves their displayVerb and getToolDefinitions() includes
    // them for the StreamingToolExecutor.
    for (const skill of SOP_INTERNAL_SKILLS) {
      this.skills.set(skill.name, skill)
    }
  }

  /** Create and initialize a SkillRouter — loads built-ins (via constructor) + DB skills. */
  static async create(customerId: string): Promise<SkillRouter> {
    const router = new SkillRouter(customerId)

    // Load DB skills (overlay on top of built-ins already loaded in constructor)
    try {
      const { prisma } = await import('@intera/shared/prisma')
      // Load ALL DB skills (including disabled) so that enabled:false records
      // properly shadow their built-in counterparts. Filtering only enabled:true
      // would leave built-ins (always enabled:true) unaffected by console toggles.
      const dbSkills = await prisma.skill.findMany({
        where: { customerId },
      })

      for (const s of dbSkills) {
        router.skills.set(s.name, {
          name: s.name,
          description: s.description,
          inputSchema: JSON.parse(s.inputSchema || '{}'),
          outputSchema: s.outputSchema ? JSON.parse(s.outputSchema) : undefined,
          mode: (s.mode as 'mock' | 'http') || 'mock',
          endpoint: s.endpoint || undefined,
          httpMethod: (s.httpMethod as 'GET' | 'POST') || 'POST',
          headers: s.headers ? JSON.parse(s.headers) : undefined,
          timeoutMs: s.timeoutMs,
          mockFixture: s.mockFixture ? JSON.parse(s.mockFixture) : undefined,
          displayVerb: s.displayVerb ? JSON.parse(s.displayVerb) : undefined,
          isConcurrencySafe: s.isConcurrencySafe,
          enabled: s.enabled,
        })
      }
    } catch (err) {
      console.warn('[SkillRouter] Failed to load skills from DB, using built-ins only:', err)
    }

    return router
  }

  /** Returns Anthropic tool format for all enabled skills. */
  getTools(): Tool[] {
    const tools: Tool[] = []
    for (const skill of this.skills.values()) {
      if (!skill.enabled) continue
      tools.push({
        name: skill.name,
        description: skill.description,
        input_schema: skill.inputSchema as Tool['input_schema'],
      })
    }
    return tools
  }

  /** Returns full skill definitions (with runtime config). */
  getToolDefinitions(): SkillDefinition[] {
    return Array.from(this.skills.values()).filter((s) => s.enabled)
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name)
  }

  /** Register or update a skill (used by Admin console). */
  setSkill(skill: SkillDefinition): void {
    this.skills.set(skill.name, skill)
  }

}
