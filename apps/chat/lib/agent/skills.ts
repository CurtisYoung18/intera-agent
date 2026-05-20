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
    zodSchema: z.object({ userId: z.string(), limit: z.number().optional() }),
    mockFixture: { cases: [], total: 0 },
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
    zodSchema: z.object({ txnId: z.string() }),
    // [MOCK] mockFixture is used when mode=mock
    mockFixture: {
      status: 'pending',
      amount: 0,
      time: new Date().toISOString(),
      channel: 'unknown',
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
    zodSchema: z.object({ txnId: z.string(), channel: z.string().optional() }),
    // [MOCK]
    mockFixture: {
      delayed_batch: false,
      channel: 'unknown',
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
    zodSchema: z.object({ query: z.string().optional() }),
    // [MOCK]
    mockFixture: { notices: [] },
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
    zodSchema: z.object({ attachmentId: z.string() }),
    // [MOCK]
    mockFixture: {
      success: true,
      extracted: { amount: null, time: null, channel: null },
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
    zodSchema: z.object({ query: z.string(), topK: z.number().optional() }),
    // [MOCK]
    mockFixture: { results: [], sources: [] },
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
