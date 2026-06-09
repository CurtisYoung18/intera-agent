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
      required: ['procedureId'],
    },
    isConcurrencySafe: true,
    mode: 'static',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Loading user profile', icon: 'scan' },
    mockFixture: { profile: '', stats: {} },
    zodSchema: z.object({}),
  },
]

/**
 * Built-in Tools — core capabilities available to the Agent.
 * Each tool has a mock implementation in streaming-tool-executor.ts.
 * Tools marked isConcurrencySafe=false run sequentially (write operations).
 * These serve as fallback when the DB has no tools for the agentConfig.
 */
export const BUILT_IN_TOOLS: ToolDefinition[] = [
  // ── System tools (engine-managed, auto-gifted) ──
  {
    name: 'read_chat_memory',
    description:
      'Read the per-case working memory for the current investigation. Returns confirmed facts, tools called so far, ' +
      'key events, and any compaction summary from earlier turns. Use this to recall what has already been done in this case.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    isConcurrencySafe: true,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Loading user memory', icon: 'scan' },
    zodSchema: z.object({}),
  },
  {
    name: 'read_user_profile',
    description:
      'Read the user profile for the current customer. Contains user attributes, preferences, tags, ' +
      'and cross-chat statistics accumulated over time. Use this to understand the customer\'s identity, ' +
      'preferences, and long-term behavior patterns.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    isConcurrencySafe: true,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Loading user profile', icon: 'scan' },
    zodSchema: z.object({}),
  },
  {
    name: 'dispatch_case_agent',
    description:
      'Start or select an inline Procedure for a single clear customer issue. ' +
      'This is a compatibility wrapper for start_procedure/select_procedure: the main Agent continues the Procedure inline. ' +
      'If another Procedure is active and the customer clearly switches topic, pause the current Procedure by default and start the new one.',
    inputSchema: {
      type: 'object',
      properties: {
        procedureId: { type: 'string', description: 'Procedure id / CaseType slug, e.g. deposit_issue, account_issue' },
        caseType: { type: 'string', description: 'Compatibility alias for procedureId.' },
        reason: { type: 'string', description: 'Why this Procedure matches the customer message.' },
        confidence: { type: 'number', description: 'Optional confidence from 0 to 1.' },
        collectedFacts: { type: 'object', description: 'Facts already collected from the customer message.' },
        currentProcedureAction: {
          type: 'string',
          enum: ['pause', 'complete', 'abandon'],
          description: 'What to do with the currently active Procedure when starting a different one. Defaults to pause.',
        },
      },
      required: ['procedureId'],
    },
    isConcurrencySafe: false,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Starting procedure', icon: 'dots' },
    zodSchema: z.object({
      procedureId: z.string().optional(),
      caseType: z.string().optional(),
      reason: z.string().optional(),
      confidence: z.number().optional(),
      collectedFacts: z.record(z.string(), z.unknown()).optional(),
      currentProcedureAction: z.enum(['pause', 'complete', 'abandon']).optional(),
    }).refine((input) => Boolean(input.procedureId || input.caseType), {
      message: 'procedureId is required (caseType is accepted as a compatibility alias).',
    }),
  },
  {
    name: 'finalize_case',
    description: 'Mark the case as resolved with a conclusion.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['resolved', 'escalated'], description: 'Final status' },
        conclusion: { type: 'string', description: 'Conclusion summary' },
        basis: { type: 'array', items: { type: 'string' }, description: 'Evidence basis for the conclusion' },
      },
      required: ['status', 'conclusion'],
    },
    isConcurrencySafe: false,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Wrapping up your case', icon: 'spin' },
    zodSchema: z.object({ status: z.enum(['resolved', 'escalated']), conclusion: z.string(), basis: z.array(z.string()).optional() }),
  },
  {
    name: 'finalize_case_agent',
    description:
      'Called when a sub-agent completes its task. Returns investigation findings to the main agent. ' +
      'After calling this, the sub-agent loop terminates.',
    inputSchema: {
      type: 'object',
      properties: {
        findings: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: {} } }, description: 'List of discovered facts' },
        evidence: { type: 'array', items: { type: 'string' }, description: 'Evidence references supporting the conclusion' },
        recommendation: { type: 'string', description: 'Suggested next action' },
      },
      required: ['findings', 'recommendation'],
    },
    isConcurrencySafe: false,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Finalizing sub-agent report', icon: 'spin' },
    zodSchema: z.object({
      findings: z.array(z.object({ key: z.string(), value: z.unknown() })),
      evidence: z.array(z.string()).optional(),
      recommendation: z.string(),
    }),
  },
  // ── Channel tools ──
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
        queue: { type: 'string', description: 'Human queue to route to' },
        question: { type: 'string', description: 'Structured question for human' },
        fields: {
          type: 'array',
          description: 'Optional structured form fields for the operator to fill. Their answers flow back as confirmedFacts.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Fact key, e.g. "actualAmount", "verifyResult"' },
              label: { type: 'string', description: 'Display label, e.g. "Actual deposit amount"' },
              type: { type: 'string', enum: ['text', 'number', 'select', 'textarea'], description: 'Field type' },
              required: { type: 'boolean', description: 'Whether this field must be filled' },
              placeholder: { type: 'string', description: 'Placeholder text' },
              options: { type: 'array', items: { type: 'string' }, description: 'Options for select type' },
            },
            required: ['key', 'label', 'type'],
          },
        },
        context: { type: 'object', description: 'Additional context for the human reviewer' },
      },
      required: ['queue', 'question'],
    },
    isConcurrencySafe: false,
    mode: 'engine_managed',
    enabled: true,
    toolCategory: 'operational',
    displayVerb: { text: 'Escalating to a specialist', icon: 'pulse' },
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
  },
  {
    name: 'ask_user_questions',
    description:
      'Display a structured form to the customer to collect required information. ' +
      'Use this when you need the customer to provide specific details (amount, payment method, ' +
      'screenshots, etc.). The form will appear as a floating card in the chat UI. ' +
      'Once the customer submits, you will receive their answers and can continue.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Form title, e.g. "Order Details Needed"' },
        description: { type: 'string', description: 'Brief explanation of why this information is needed' },
        fields: {
          type: 'array',
          description: 'Form fields to collect from the customer',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Field identifier, e.g. "amount"' },
              label: { type: 'string', description: 'Display label, e.g. "Deposit amount"' },
              type: { type: 'string', enum: ['text', 'number', 'select', 'textarea', 'file', 'date'], description: 'Input type' },
              required: { type: 'boolean', description: 'Whether this field is required' },
              placeholder: { type: 'string', description: 'Placeholder text' },
              options: { type: 'array', items: { type: 'string' }, description: 'Options for select type' },
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
    zodSchema: z.object({
      title: z.string(),
      description: z.string().optional(),
      fields: z.array(z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(['text', 'number', 'select', 'textarea', 'file', 'date']),
        required: z.boolean().optional(),
        placeholder: z.string().optional(),
        options: z.array(z.string()).optional(),
      })),
    }),
  },
]

/** Set of built-in tool names for fast lookup. */
export const BUILT_IN_TOOL_NAMES: Set<string> = new Set(BUILT_IN_TOOLS.map((tool) => tool.name))

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

  constructor(agentConfigId?: string) {
    // Register system tools — always available (read_chat_memory, read_user_profile)
    for (const tool of SYSTEM_TOOLS) {
      this.tools.set(tool.name, tool)
    }
    // Load built-in tools as fallback (overridden by DB when available)
    for (const tool of BUILT_IN_TOOLS) {
      this.tools.set(tool.name, tool)
    }
  }

  /** Create and initialize a ToolRouter — loads system tools (via constructor) + DB tools + dynamic knowledge sources.
   *  @param agentConfigId — agent config ID for DB queries.
   *  @param dryRun  — when true, skips knowledge-source auto-heal writes. */
  static async create(
    agentConfigId: string,
    dryRun = false,
    options: { enableLegacySubagentAdapter?: boolean } = {},
  ): Promise<ToolRouter> {
    const router = new ToolRouter(agentConfigId)

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

      if (!options.enableLegacySubagentAdapter) {
        router.tools.delete('dispatch_subagent')
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
                  'Start or select an inline Procedure for one clear customer issue. The main Agent continues through ProcedureExecutor and HookEngine; no background agent is spawned.\n\n' +
                  '## Procedure Catalog\n' +
                  caseTypeList +
                  '\n\nUse procedureId for new calls. caseType remains accepted for compatibility. If another Procedure is active and the customer clearly switches topic, pause the current Procedure by default.'
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
