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
        channel: { type: 'string', description: 'Payment channel name' },
      },
    },
    isConcurrencySafe: true,
    mode: 'mock',
    enabled: true,
    zodSchema: z.object({ channel: z.string().optional() }),
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
      'This will pause the agent loop until a human responds.',
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
    zodSchema: z.object({ queue: z.string(), question: z.string(), context: z.object({}).optional() }),
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
                enum: ['text', 'number', 'select', 'textarea', 'file'],
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
    zodSchema: z.object({ title: z.string(), description: z.string().optional(), fields: z.array(z.object({ key: z.string(), label: z.string(), type: z.enum(["text","number","select","textarea","file"]), required: z.boolean().optional(), placeholder: z.string().optional(), options: z.array(z.string()).optional() })) }),
    // [MOCK] — form is rendered by the Chat UI, not executed here
    mockFixture: { status: 'form_displayed' },
  },
]

/**
 * Skill Router — manages the skill registry and provides tool definitions
 * in Anthropic API format.
 */
export class SkillRouter {
  private skills: Map<string, SkillDefinition> = new Map()

  constructor(private customerId: string) {
    // [MOCK] Load built-in skills. Production loads from DB via Prisma:
    //   const rows = await prisma.skill.findMany({ where: { customerId, enabled: true } })
    for (const skill of BUILT_IN_SKILLS) {
      this.skills.set(skill.name, skill)
    }
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

  disableSkill(name: string): void {
    const skill = this.skills.get(name)
    if (skill) {
      skill.enabled = false
    }
  }
}
