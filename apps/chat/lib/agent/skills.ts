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
    // [MOCK]
    mockFixture: { results: [], sources: [] },
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
