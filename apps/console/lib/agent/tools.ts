// Intera Harness - Tool Router
// Based on architecture doc: Tools System
//
// Built-in tools with mock execution (fallback).
// Production path:
//   - Load tools from Tool table (Prisma) for the active AgentConfig
//   - Support dynamic tool registration via Admin console
//   - Route mock/http based on Tool.mode field

import type { ToolDefinition, ToolUse } from '@intera/shared/types'
import type { Tool } from '@anthropic-ai/sdk/resources/index.mjs'
import { z } from 'zod'

/**
 * System Tools — always-available core tools registered directly in the constructor.
 * These are NOT loaded from DB; they're built into the runtime.
 */
export const SYSTEM_TOOLS: ToolDefinition[] = [
  {
    name: 'read_chat_memory',
    description:
      'Read the per-case working memory for the current investigation. Returns confirmed facts, tools called so far, ' +
      'key events, and any compaction summary from earlier turns. Use this to recall what has already been done in this case.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    isConcurrencySafe: true,
    mode: 'static',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Loading user memory', icon: 'scan' },
    mockFixture: { summary: '', confirmedFacts: {}, stats: {} },
    zodSchema: z.object({}),
  },
  {
    name: 'read_user_profile',
    description:
      'Read the user profile for the current customer. This contains the user\'s attributes, preferences, tags, ' +
      'and cross-chat statistics accumulated over time. Use this when you need to understand the customer\'s ' +
      'identity, preferences, and long-term behavior patterns.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    isConcurrencySafe: true,
    mode: 'static',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Loading user profile', icon: 'scan' },
    mockFixture: { profile: '', stats: {} },
    zodSchema: z.object({}),
  },
  {
    name: 'todo_read',
    description:
      'Read the current todo list. Call this at the start of a turn to see pending, ' +
      'in-progress, and completed items before deciding what to do next.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isConcurrencySafe: true,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Reviewing task list', icon: 'scan' },
    zodSchema: z.object({}),
  },
  {
    name: 'todo_write',
    description:
      'Create or update a structured todo list. ' +
      'Use this to plan complex investigations, track progress through multi-step workflows, ' +
      'and communicate current state to the user. Each item should have a unique id, ' +
      'a content description, and a status (pending, in_progress, completed, or cancelled).',
    inputSchema: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The complete todo list to persist. Replaces the existing list.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for this todo item' },
              content: { type: 'string', description: 'Description of what needs to be done' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: 'Current status of this item',
              },
              notes: { type: 'string', description: 'Optional findings or notes for this item' },
            },
            required: ['id', 'content', 'status'],
          },
        },
      },
      required: ['todos'],
    },
    isConcurrencySafe: true,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Updating task list', icon: 'dots' },
    zodSchema: z.object({
      todos: z.array(
        z.object({
          id: z.string(),
          content: z.string(),
          status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
          notes: z.string().optional(),
        }),
      ),
    }),
  },
]

/**
 * Built-in Tools — core capabilities available to the Agent.
 * Each tool has a mock implementation in streaming-tool-executor.ts.
 * Tools marked isConcurrencySafe=false run sequentially (write operations).
 * These serve as fallback when the DB has no tools for the agentConfig.
 */
export const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: 'dispatch_case_agent',
    description:
      'Dispatch a background case investigation agent for a single clear customer issue. ' +
      'The case agent runs autonomously through all investigation stages while you continue the conversation. ' +
      'For multiple issues, call dispatch_case_agent once per issue.',
    inputSchema: {
      type: 'object',
      properties: {
        caseType: { type: 'string', description: 'Case type slug, e.g. deposit_issue, account_issue' },
      },
      required: ['caseType'],
    },
    isConcurrencySafe: false,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Dispatching case agent', icon: 'dots' },
    zodSchema: z.object({ caseType: z.string() }),
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
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Looking up past cases', icon: 'scan' },
    zodSchema: z.object({ userId: z.string(), limit: z.number().optional() }),
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Checking order status', icon: 'scan' },
    zodSchema: z.object({ txnId: z.string() }),
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Verifying payment channel', icon: 'scan' },
    zodSchema: z.object({ txnId: z.string(), channel: z.string().optional() }),
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
    mode: 'static',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Checking platform announcements', icon: 'dots' },
    zodSchema: z.object({ query: z.string().optional() }),
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Checking account status', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string() }),
    mockFixture: {
      member_id: 'U10023',
      status: 'active',
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Verifying identity status', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string() }),
    mockFixture: {
      member_id: 'U10023',
      kycStatus: 'approved',
      kycLevel: 'basic',
      submittedAt: '2025-01-16T09:00:00Z',
      approvedAt: '2025-01-17T10:30:00Z',
      rejectionReason: null,
    },
  },
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Checking withdrawal status', icon: 'scan' },
    zodSchema: z.object({ member_id: z.string() }),
    mockFixture: {
      withdrawalId: 'WD2026052100987',
      member_id: 'U10023',
      amount: 3000.0,
      currency: 'CNY',
      status: 'pending',
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
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
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Reading your receipt', icon: 'spin' },
    zodSchema: z.object({ attachmentId: z.string() }),
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
    mode: 'engine_managed',
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
    toolCategory: 'operational',
    displayVerb: { text: 'Escalating to a specialist', icon: 'pulse' },
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
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Wrapping up your case', icon: 'spin' },
    zodSchema: z.object({ status: z.enum(["resolved","escalated"]), conclusion: z.string(), basis: z.array(z.string()).optional() }),
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
    mode: 'channel',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Preparing your information form', icon: 'pulse' },
    zodSchema: z.object({ title: z.string(), description: z.string().optional(), fields: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(["text","number","select","textarea","file","date"]), required: z.boolean().optional(), placeholder: z.string().optional(), options: z.array(z.string()).optional() })) }),
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
    mode: 'channel',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Closing consultation', icon: 'spin' },
    zodSchema: z.object({ summary: z.string(), resolution: z.string() }),
  },
  {
    name: 'finalize_sub_agent',
    description:
      '子代理完成任务后调用，将调查结果返回给主 Agent。调用后子代理循环终止。',
    inputSchema: {
      type: 'object',
      properties: {
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, value: {} },
          },
          description: '调查发现的事实列表',
        },
        evidence: {
          type: 'array',
          items: { type: 'string' },
          description: '支持结论的证据引用',
        },
        recommendation: { type: 'string', description: '建议的后续行动' },
      },
      required: ['findings', 'recommendation'],
    },
    isConcurrencySafe: false,
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Finalizing sub-agent report', icon: 'spin' },
    zodSchema: z.object({
      findings: z.array(z.object({ key: z.string(), value: z.unknown() })),
      evidence: z.array(z.string()).optional(),
      recommendation: z.string(),
    }),
    mockFixture: { status: 'finalized' },
  },
  {
    name: 'dispatch_subagent',
    description:
      'Dispatch a specialist sub-agent to investigate a specific aspect of the case. ' +
      'Available sub-agents are defined in the case type stage configuration. ' +
      'Use this to delegate research tasks to specialized agents.',
    inputSchema: {
      type: 'object',
      properties: {
        agentName: { type: 'string', description: 'Name of the sub-agent to dispatch' },
        taskDescription: { type: 'string', description: 'Short human-readable task summary' },
        taskPrompt: { type: 'string', description: 'Detailed investigation instructions for the sub-agent' },
      },
      required: ['agentName', 'taskDescription', 'taskPrompt'],
    },
    isConcurrencySafe: false,
    mode: 'static',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Dispatching specialist agent', icon: 'pulse' },
    zodSchema: z.object({
      agentName: z.string(),
      taskDescription: z.string(),
      taskPrompt: z.string(),
    }),
    mockFixture: { status: 'dispatched', message: 'Sub-agent task dispatched' },
  },
  {
    name: 'get_current_time',
    description: 'Get current date/time. Returns today date in YYYY-MM-DD format with day of week and UTC/GMT+8 times.',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: { today: { type: 'string' }, day_of_week: { type: 'string' }, utc_time: { type: 'string' }, gmt8_time: { type: 'string' } } },
    mode: 'static',
    isConcurrencySafe: true,
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Getting current time', icon: 'dots' },
    mockFixture: {},
  },
]

/**
 * SOP Internal Tools — only injected into the tool list when a case type
 * uses `executionMode: 'sop'`. Intercepted in AgentLoop (never sent to the
 * streaming-tool-executor for real execution).
 */
export const SOP_INTERNAL_TOOLS: ToolDefinition[] = [
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
      required: [],
    },
    isConcurrencySafe: false,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Updating investigation plan', icon: 'dots' },
    zodSchema: z.object({
      action: z.enum(['add', 'update', 'complete', 'cancel']).optional(),
      id: z.string().optional(),
      text: z.string().optional(),
      notes: z.string().optional(),
    }),
  },
  {
    name: 'todo_read',
    description: 'Read the current investigation todo list. Call this at the start of each turn to see pending, in-progress, and completed items before deciding what to do next.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    isConcurrencySafe: true,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Reviewing investigation plan', icon: 'scan' },
  },
]

/** Set of built-in tool names for fast lookup. */
export const BUILT_IN_TOOL_NAMES: Set<string> = new Set(BUILT_IN_TOOLS.map((s) => s.name))

/**
 * Returns true if the given tool name is a built-in (system) tool.
 */
export function isBuiltInTool(name: string): boolean {
  return BUILT_IN_TOOL_NAMES.has(name)
}

/**
 * Tool Router — manages the tool registry and provides tool definitions
 * in Anthropic API format.
 */
export class ToolRouter {
  private tools: Map<string, ToolDefinition> = new Map()

  constructor() {
    // Register system tools — always available (read_chat_memory, read_user_profile, todo_read, todo_write)
    for (const tool of SYSTEM_TOOLS) {
      this.tools.set(tool.name, tool)
    }
    // Load built-in tools as fallback (overridden by DB when available)
    for (const tool of BUILT_IN_TOOLS) {
      this.tools.set(tool.name, tool)
    }
    // SOP internal tools (todo_write, todo_read) must be in the registry so
    // getTool() resolves their displayVerb and getToolDefinitions() includes
    // them for the StreamingToolExecutor.
    for (const tool of SOP_INTERNAL_TOOLS) {
      this.tools.set(tool.name, tool)
    }
  }

  /** Create and initialize a ToolRouter — loads system tools (via constructor) + DB tools + dynamic knowledge sources.
   *  @param agentConfigId — agent config ID for DB queries.
   *  @param dryRun  — when true, skips knowledge-source auto-heal writes. */
  static async create(agentConfigId: string, dryRun = false): Promise<ToolRouter> {
    const router = new ToolRouter()

    // Load DB tools (overlay on top of system/built-ins already loaded in constructor)
    try {
      const { prisma } = await import('@intera/shared/prisma')
      // Load ALL DB tools (including disabled) so that enabled:false records
      // properly shadow their built-in counterparts. Filtering only enabled:true
      // would leave built-ins (always enabled:true) unaffected by console toggles.
      const dbTools = await prisma.tool.findMany({
        where: { agentConfigId },
      })

      const VALID_MODES = new Set(['static', 'http', 'engine_managed', 'channel'])
      for (const t of dbTools) {
        const dbMode = t.mode || 'static'
        // Preserve the built-in mode when DB has an invalid mode value (e.g. 'mock'
        // from old console saves). The built-in definition is authoritative for mode.
        const builtinMode = router.tools.get(t.name)?.mode
        const mode = VALID_MODES.has(dbMode)
          ? (dbMode as 'static' | 'http' | 'engine_managed' | 'channel')
          : (builtinMode as 'static' | 'http' | 'engine_managed' | 'channel') || 'static'
        router.tools.set(t.name, {
          name: t.name,
          description: t.description,
          inputSchema: JSON.parse(t.inputSchema || '{}'),
          outputSchema: t.outputSchema ? JSON.parse(t.outputSchema) : undefined,
          mode,
          endpoint: t.endpoint || undefined,
          httpMethod: (t.httpMethod as 'GET' | 'POST') || 'POST',
          headers: t.headers ? JSON.parse(t.headers) : undefined,
          timeoutMs: t.timeoutMs,
          mockFixture: t.mockFixture ? JSON.parse(t.mockFixture) : undefined,
          displayVerb: t.displayVerb ? JSON.parse(t.displayVerb) : undefined,
          renderHints: t.renderHints ? JSON.parse(t.renderHints) : undefined,
          toolCategory: (t.toolCategory as 'system_info' | 'operational') || undefined,
          isConcurrencySafe: t.isConcurrencySafe,
          enabled: t.enabled,
        })
      }

      // ── Dynamic tool descriptions: inject agent config's case types into tool descriptions ──
      const hasDbOverride = (name: string) => dbTools.some((t) => t.name === name)

      if (!hasDbOverride('dispatch_case_agent')) {
        try {
          const caseTypes = await prisma.caseType.findMany({
            where: { agentConfigId, enabled: true },
            select: { type: true, displayName: true, description: true, icon: true },
          })

          if (caseTypes.length > 0) {
            const caseTypeList = caseTypes
              .map((ct) => `- **${ct.type}** (${ct.icon} ${ct.displayName}): ${ct.description || 'No description'}`)
              .join('\n')

            if (!hasDbOverride('dispatch_case_agent')) {
              const existingDispatchTool = router.tools.get('dispatch_case_agent')
              if (existingDispatchTool) {
                existingDispatchTool.description =
                  'Dispatch a background case investigation agent. The agent runs autonomously through all investigation stages while you continue the conversation.\n\n' +
                  '## Available Case Types\n' +
                  caseTypeList +
                  '\n\nUse when the customer reports a single distinct issue. For multiple issues, call dispatch_case_agent once per issue.'
              }
            }
          }
        } catch (err) {
          console.warn('[ToolRouter] Failed to load case types for tool descriptions:', err)
        }
      }

      // Load knowledge sources and inject each as a kb_search_<name> tool.
      const knowledgeSources = await prisma.knowledgeSource.findMany({
        where: { agentConfigId, enabled: true },
      })

      // Auto-heal: migrate pre-existing KB rows to BGE-Rerank + topK>=15 + docCorrelation=0.3
      // Skipped entirely in dry-run (playground) so a turn performs ZERO DB writes.
      if (!dryRun) {
        const healOps: Promise<unknown>[] = []
        for (const ks of knowledgeSources) {
          const patches: Record<string, unknown> = {}
          if (!ks.rerankVersion || ks.rerankVersion === 'Jina-reranker-v2-base-multilingual') {
            patches.rerankVersion = 'BGE-Rerank'
          }
          if (ks.topK < 15) patches.topK = 15
          if (ks.docCorrelation === 0.5) patches.docCorrelation = 0.3
          if (Object.keys(patches).length > 0) {
            healOps.push(prisma.knowledgeSource.update({ where: { id: ks.id }, data: patches }))
          }
        }
        if (healOps.length > 0) {
          Promise.allSettled(healOps).catch(() => {})
        }
      }

      // Resolve GPTBots API key: per-agentConfig DB key first, env var fallback.
      let gptbotsApiKey = process.env.GPTBOTS_API_KEY ?? ''
      try {
        const config = await prisma.agentConfig.findUnique({
          where: { id: agentConfigId },
          select: { gptbotsApiKey: true },
        })
        if (config?.gptbotsApiKey) gptbotsApiKey = config.gptbotsApiKey
      } catch { /* DB may not be ready, use env fallback */ }

      for (const ks of knowledgeSources) {
        const toolName = `kb_search_${ks.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
        const baseDesc = ks.description || `Search the "${ks.name}" knowledge base`
        router.tools.set(toolName, {
          name: toolName,
          description: ks.modelControlTopK
            ? `${baseDesc}. Number of results to return (1–30, higher values return more matches). Default: ${ks.topK}.`
            : baseDesc,
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query in the user\'s language' },
              ...(ks.modelControlTopK ? { topK: { type: 'number', description: `Number of results to return (1–30). Default: ${ks.topK}.`, default: ks.topK } } : {}),
            },
            required: ['query'],
          },
          mode: 'http',
          endpoint: 'https://api-sg.gptbots.ai/v1/vector/match',
          httpMethod: 'POST',
          headers: { Authorization: `Bearer ${gptbotsApiKey}` },
          timeoutMs: 10000,
          isConcurrencySafe: true,
          enabled: true,
          toolCategory: 'system_info',
          displayVerb: { text: `Searching ${ks.name}`, icon: 'dots' },
          renderHints: {
            livechat: {
              kind: 'carousel',
              itemsField: '$.list',
              idField: '$.id',
              itemTemplate: {
                titleField: '$.title',
                subtitleField: '$.snippet',
                buttons: [{ id: 'open', postback: 'open_doc', labelStatic: 'Open', type: 'url', url: '$.url' }],
              },
            },
            "web-chat": {
              kind: 'form',
              layout: 'single',
              submitLabel: 'Submit',
            },
          },
        })
      }
    } catch (err) {
      console.warn('[ToolRouter] Failed to load tools from DB, using built-ins only:', err)
    }

    return router
  }

  /** Returns Anthropic tool format for all enabled tools. */
  getTools(): Tool[] {
    const tools: Tool[] = []
    for (const tool of this.tools.values()) {
      if (!tool.enabled) continue
      tools.push({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema as Tool['input_schema'],
      })
    }
    return tools
  }

  /** Returns full tool definitions (with runtime config). */
  getToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.enabled)
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  /** Register or update a tool (used by Admin console). */
  setTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
  }
}
