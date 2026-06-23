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
import { knowledgeSourceToolName, stableToolNameSegment } from './tool-names'
import { hasKnowledgeSourceGroupIds } from '@/lib/knowledge/source-groups'
import { RETIRED_TOOL_NAMES } from '@/lib/tool-classifications'

/**
 * System Tools — always-available core tools registered directly in the constructor.
 * These are NOT loaded from DB; they're built into the runtime.
 */
export const SYSTEM_TOOLS: ToolDefinition[] = [
  {
    name: 'read_chat_memory',
    description:
      'Read chat-scoped working memory for the current conversation. Returns tools run, key events, compact summary, open items, and missing-info stats. Memory is context only, not ProcedureRun authority.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    isConcurrencySafe: true,
    mode: 'system_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Loading user memory', icon: 'scan' },
    zodSchema: z.object({}),
  },
  {
    name: 'read_user_profile',
    description:
      'Read cross-chat long-term profile for the current customer. Returns identity, contact details, preferences, history, and behavior patterns. It never returns active ProcedureRun runtime state.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    isConcurrencySafe: true,
    mode: 'system_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Loading user profile', icon: 'scan' },
    zodSchema: z.object({}),
  },
  {
    name: 'remember',
    description:
      'Write a scoped memory item. Use scope="user" for long-term cross-chat profile. Chat-scoped fact writes are no longer accepted; rely on runtime evidence, form results, and tool results instead. Do not store ProcedureRun runtime state, currentStepId, inputEpoch, stale evidence, or completion authority.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['user'], description: 'Memory scope to write. Only user profile writes are accepted.' },
        key: { type: 'string', description: 'Stable memory key or short label.' },
        value: { description: 'Memory value, fact, or profile item to store.' },
        facts: { type: 'object', description: 'Optional map of facts/items to store.' },
        reason: { type: 'string', description: 'Why this memory should be saved.' },
      },
      required: ['scope', 'reason'],
    },
    isConcurrencySafe: false,
    mode: 'system_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Saving memory', icon: 'scan' },
    zodSchema: z.object({
      scope: z.enum(['user']),
      key: z.string().optional(),
      value: z.unknown().optional(),
      facts: z.record(z.string(), z.unknown()).optional(),
      reason: z.string(),
    }),
  },
  {
    name: 'get_current_time',
    description:
      'Return the current server time and calendar date. Use this whenever the customer asks about today, current time, dates, deadlines, or time-sensitive business rules.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    isConcurrencySafe: true,
    mode: 'system_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Checking current time', icon: 'scan' },
    zodSchema: z.object({}),
  },
  {
    name: 'start_procedure',
    description:
      'Start or select a runtime ProcedureRun for a clear customer issue. The stable Core Agent prompt remains active; ProcedureRun state is appended by runtime as a dynamic tail. If another ProcedureRun is active, pause it by default.',
    inputSchema: {
      type: 'object',
      properties: {
        procedureId: { type: 'string', description: 'Procedure id / Procedure type slug, e.g. deposit_issue, account_access.' },
        reason: { type: 'string', description: 'Why this Procedure matches the customer message.' },
        confidence: { type: 'number', description: 'Optional confidence from 0 to 1.' },
        currentProcedureAction: {
          type: 'string',
          enum: ['pause', 'complete', 'abandon'],
          description: 'What to do with the currently active ProcedureRun when starting a different one. Defaults to pause.',
        },
        requestId: { type: 'string', description: 'Optional idempotency key for retries.' },
      },
      required: ['procedureId'],
    },
    isConcurrencySafe: false,
    mode: 'system_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Starting procedure', icon: 'dots' },
    zodSchema: z.object({
      procedureId: z.string(),
      reason: z.string().optional(),
      confidence: z.number().optional(),
      currentProcedureAction: z.enum(['pause', 'complete', 'abandon']).optional(),
      requestId: z.string().optional(),
    }),
  },
  {
    name: 'finalize_procedure',
    description:
      'Finalize the active ProcedureRun with a customer-safe conclusion. Runtime blocks stale finalization attempts and incomplete ProcedureRuns.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: { type: 'string', description: 'Optional active ProcedureRun id.' },
        status: { type: 'string', enum: ['completed', 'cancelled'], description: 'Final ProcedureRun status.' },
        conclusion: { type: 'string', description: 'Conclusion summary.' },
        basis: { type: 'array', items: { type: 'string' }, description: 'Evidence basis for the conclusion.' },
      },
      required: ['conclusion'],
    },
    isConcurrencySafe: false,
    mode: 'system_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Finalizing procedure', icon: 'spin' },
    zodSchema: z.object({
      runId: z.string().optional(),
      status: z.enum(['completed', 'cancelled']).optional(),
      conclusion: z.string(),
      basis: z.array(z.string()).optional(),
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
  // ── System tools (system-managed, auto-gifted) ──
  {
    name: 'read_chat_memory',
    description:
      'Read the per-case working memory for the current investigation. Returns tool history, key events, ' +
      'compact summary, open items, and missing-info stats. Use this to recall what has already been done in this case.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    isConcurrencySafe: true,
    mode: 'system_managed',
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
    mode: 'system_managed',
    enabled: true,
    toolCategory: 'system_info',
    displayVerb: { text: 'Loading user profile', icon: 'scan' },
    zodSchema: z.object({}),
  },
  ...SYSTEM_TOOLS.filter((tool) => !['read_chat_memory', 'read_user_profile'].includes(tool.name)),
  // ── Channel tools ──
  {
    name: 'create_human_task',
    description:
      'Create a human task for manual confirmation or processing. ' +
      'Call this when a human must take over — do not only say you will transfer. ' +
      'A successful persisted handoff finalizes the active ProcedureRun on every channel, ' +
      'even if the outer case or chat remains waiting_human for operator work. ' +
      'It creates the durable handoff record and triggers channel-specific handoff UI/transfer behavior. ' +
      'For channel handoff notes, include only these compact operator-facing fields when useful: ' +
      'known_facts, chat_summary, and handoff_reason. Write those fields in the same support language required by the active system prompt, such as Romanized Nepali for Nepali agents. ' +
      'Optionally provide structured fields to collect specific data from the operator — ' +
      'their answers come back as structured runtime input for follow-up operator handling or later customer work, not to resume the finalized handoff Procedure.',
    inputSchema: {
      type: 'object',
      properties: {
        queue: { type: 'string', description: 'Human queue to route to' },
        question: { type: 'string', description: 'Structured question for human' },
        fields: {
          type: 'array',
          description: 'Optional structured form fields for the operator to fill. Their answers flow back as structured runtime input.',
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
        known_facts: {
          type: 'object',
          description: 'Compact facts already collected from the customer or tools. Keep values short and in the active support language.',
          additionalProperties: true,
        },
        chat_summary: {
          type: 'string',
          description: 'Short summary for the human operator in the active support language.',
        },
        handoff_reason: {
          type: 'string',
          description: 'Why a human is needed, written in the active support language.',
        },
      },
      required: ['queue', 'question'],
    },
    isConcurrencySafe: false,
    mode: 'system_managed',
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
      known_facts: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
      chat_summary: z.string().optional(),
      handoff_reason: z.string().optional(),
    }),
  },
  {
    name: 'ask_user_questions',
    description:
      'Display a structured form to the customer to collect required information. ' +
      'Use this when you need the customer to provide specific details (amount, payment method, ' +
      'screenshots, etc.). Do not ask for those details in plain text when this tool can collect them. ' +
      'If the customer already provided a value in text or an uploaded image/screenshot, prefill the matching field with defaultValue or initialValues so they can confirm or edit it. ' +
      'For receipt/screenshot workflows, if another required field is still missing, keep already-provided receipt facts such as payment method/channel, amount, transaction id, date/time, or status as additional fields with defaultValue; do not drop them just because they were already supplied. ' +
      'The form will appear as a floating card in the chat UI. ' +
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
              validation: {
                type: 'object',
                description: 'Optional field validation metadata. For date ranges, set dateRange.pairId to the same value on both fields and dateRange.role to start or end.',
                properties: {
                  dateRange: {
                    type: 'object',
                    properties: {
                      pairId: { type: 'string' },
                      role: { type: 'string', enum: ['start', 'end'] },
                    },
                    required: ['role'],
                  },
                },
              },
              defaultValue: { type: 'string', description: 'Optional prefilled value inferred from prior customer text or image. The customer can confirm or edit it.' },
            },
            required: ['key', 'label', 'type'],
          },
        },
        initialValues: {
          type: 'object',
          description: 'Optional map of field key to prefilled value inferred from prior text or image. These values are merged into fields that do not already have defaultValue.',
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
      title: z.string().trim().min(1),
      description: z.string().optional(),
      fields: z.array(z.object({
        key: z.string(),
        label: z.string(),
        type: z.enum(['text', 'number', 'select', 'textarea', 'file', 'date']),
        required: z.boolean().optional(),
        placeholder: z.string().optional(),
        options: z.array(z.string()).optional(),
        validation: z.object({
          dateRange: z.object({
            pairId: z.string().optional(),
            role: z.enum(['start', 'end']),
          }).optional(),
        }).optional(),
        defaultValue: z.string().optional(),
      })).min(1),
      initialValues: z.record(z.unknown()).optional(),
    }),
  },
]

/** Set of built-in tool names for fast lookup. */
export const BUILT_IN_TOOL_NAMES: Set<string> = new Set(BUILT_IN_TOOLS.map((tool) => tool.name))
export const LOCKED_SYSTEM_TOOL_NAMES: Set<string> = new Set(SYSTEM_TOOLS.map((tool) => tool.name))

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
      if (!this.tools.has(tool.name)) this.tools.set(tool.name, tool)
    }
  }

  /** Create and initialize a ToolRouter — loads system tools (via constructor) + DB tools + dynamic knowledge sources.
   *  @param agentConfigId — agent config ID for DB queries.
   *  @param dryRun  — when true, skips knowledge-source auto-heal writes. */
  static async create(
    agentConfigId: string,
    dryRun = false,
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

      const normalizeRuntimeMode = (mode: string | null | undefined): ToolDefinition['mode'] => {
        switch (mode) {
          case 'static':
          case 'static_fixture':
            return 'static_fixture'
          case 'engine_managed':
          case 'system_managed':
            return 'system_managed'
          case 'channel':
          case 'workflow':
          case 'code_transform':
          case 'http':
            return mode
          default:
            return 'static_fixture'
        }
      }
      for (const t of dbTools) {
        if (LOCKED_SYSTEM_TOOL_NAMES.has(t.name) || RETIRED_TOOL_NAMES.has(t.name)) {
          continue
        }
        const dbMode = t.mode || 'static_fixture'
        // Preserve the built-in mode when DB has an invalid mode value.
        // The built-in definition is authoritative for mode.
        const builtinMode = router.tools.get(t.name)?.mode
        const existing = router.tools.get(t.name)
        const mode = t.mode
          ? normalizeRuntimeMode(dbMode)
          : normalizeRuntimeMode(builtinMode)
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
          zodSchema: existing?.zodSchema,
        })
      }

      // Load knowledge sources and inject each as a kb_search_<name> tool.
      const knowledgeSources = (await prisma.knowledgeSource.findMany({
        where: { agentConfigId, enabled: true },
      })).filter((source) => hasKnowledgeSourceGroupIds(source.groupIds))

      // Auto-heal legacy KB rows that still point at retired reranker defaults.
      // Runtime must preserve the admin-configured topK instead of rewriting it.
      // Skipped entirely in dry-run (playground) so a turn performs ZERO DB writes.
      if (!dryRun) {
        const healOps: Promise<unknown>[] = []
        for (const ks of knowledgeSources) {
          const patches: Record<string, unknown> = {}
          if (!ks.rerankVersion || ks.rerankVersion === 'Jina-reranker-v2-base-multilingual') {
            patches.rerankVersion = 'BGE-Rerank'
          }
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

      const usedKnowledgeToolNames = new Set<string>()
      for (const ks of knowledgeSources) {
        const baseToolName = knowledgeSourceToolName(ks.name, ks.id)
        const fallbackSuffix = ks.id ? `_${stableToolNameSegment(ks.id).slice(-6)}` : ''
        const toolName = usedKnowledgeToolNames.has(baseToolName)
          ? `${baseToolName}${fallbackSuffix}`
          : baseToolName
        usedKnowledgeToolNames.add(toolName)
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
          knowledgeSourceId: ks.id,
          knowledgeSourceName: ks.name,
          renderHints: {
            livechat: {
              kind: 'carousel',
              itemsField: '$.list',
              idField: '$.data_id',
              itemTemplate: {
                titleField: '$.document_name',
                subtitleField: '$.content',
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
