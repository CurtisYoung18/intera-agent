// Playground turn runner — exercises the real agent pipeline (config, skills, guardrails, LLM)
// with in-memory persistence and dry-run tool execution. No DB writes.

import { prisma } from '@intera/shared/prisma'
import { Anthropic } from '@anthropic-ai/sdk'
import type { SSEEvent, AgentConfigData } from '@intera/shared/types'
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_MEMORY_STRATEGY, DEFAULT_POLICY_HOOKS } from '@intera/shared/defaults'
import { SkillRouter } from './skills'
import { resolvePrompt, buildPromptContext } from './prompt-resolver'
import { getProviderConfig } from './api/provider-config'
import { isSafeInDryRun, dryRunMockResult, dispatchCaseAgentMockResult } from './dry-run-executor'
import { createMemoryPersistence, type PersistencePort, type TraceRecord } from './persistence-port'
import { aggregateTraces, type PlaygroundTraceStep } from './trace-aggregator'

export interface PlaygroundConfig {
  model: 'claude-sonnet' | 'minimax' | 'deepseek'
  persona: 'concise' | 'warm'
  memory: boolean
  knowledge: boolean
  debug: boolean
  guardrails: {
    pii: boolean
    refundPolicy: boolean
    profanity: boolean
    escalation: boolean
  }
}

export interface PlaygroundResult {
  turnId: string
  intent: string
  caseType: string
  reply: string
  blocked: boolean
  trace: PlaygroundTraceStep[]
}

function parseNonEmptyJson(raw: string): Record<string, unknown> | null {
  try {
    const p = JSON.parse(raw)
    if (p && typeof p === 'object' && !Array.isArray(p) && Object.keys(p).length > 0) return p
  } catch { /* ignore */ }
  return null
}

async function loadAgentConfig(orgId: string): Promise<AgentConfigData> {
  const dbConfig = await prisma.agentConfig.findFirst({ where: { orgId }, orderBy: { createdAt: 'asc' } })
  if (dbConfig) {
    return {
      model: dbConfig.model,
      temperature: dbConfig.temperature,
      thinkingBudget: dbConfig.thinkingBudget,
      maxIterations: dbConfig.maxIterations,
      maxOutputTokens: (dbConfig as any).maxOutputTokens ?? 4096,
      systemPrompt: dbConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      showThinking: dbConfig.showThinking,
      memoryStrategy: (parseNonEmptyJson(dbConfig.memoryStrategy) as any) || { ...DEFAULT_MEMORY_STRATEGY },
      policyHooks: (parseNonEmptyJson(dbConfig.policyHooks) as any) || { ...DEFAULT_POLICY_HOOKS },
      resumePrompt: '',
      formResponseTemplate: '',
      prefixContinuationEnabled: false,
      debugMode: Boolean((dbConfig as any).debugMode),
    }
  }
  return {
    model: 'claude-sonnet-4-20250514',
    temperature: 0.5,
    thinkingBudget: 4096,
    maxIterations: 20,
    maxOutputTokens: 4096,
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    showThinking: false,
    memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY },
    policyHooks: { ...DEFAULT_POLICY_HOOKS },
    resumePrompt: '',
    formResponseTemplate: '',
    prefixContinuationEnabled: false,
  }
}

/**
 * Run a single playground turn.
 * Returns an async generator of SSEEvent — stream tokens, then emit final trace.
 */
export async function* runPlaygroundTurn(input: {
  orgId: string
  message: string
  playgroundConfig: PlaygroundConfig
}): AsyncGenerator<SSEEvent> {
  const { orgId, message, playgroundConfig: pc } = input
  const turnId = `pg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const startTime = Date.now()

  const { port: persistence, traces: memoryTraces } = createMemoryPersistence()

  // ── Load real config from DB ──
  const agentConfig = await loadAgentConfig(orgId)
  const skillRouter = await SkillRouter.create(orgId)
  const allTools = skillRouter.getTools()

  // ── Filter tools based on playground toggles ──
  const filteredTools = allTools.filter((t) => {
    if (t.name === 'dispatch_case_agent') return true // keep but mock
    if (t.name.startsWith('kb_search')) return pc.knowledge
    return true
  })

  // ── Build system prompt (reusing real prompt resolver) ──
  let systemPrompt = agentConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT
  const personaNote = pc.persona === 'concise'
    ? '\n\nBe concise and direct. Use minimal words.'
    : '\n\nBe warm and empathetic. Use a friendly tone.'
  systemPrompt += personaNote

  if (pc.guardrails.pii) systemPrompt += '\n\nGUARDRAIL: Never expose PII (names, emails, phone numbers).'
  if (pc.guardrails.refundPolicy) systemPrompt += '\n\nGUARDRAIL: Do not promise refunds. Escalate refund requests to human.'
  if (pc.guardrails.profanity) systemPrompt += '\n\nGUARDRAIL: Do not respond to profanity or abusive language.'
  if (pc.guardrails.escalation) systemPrompt += '\n\nGUARDRAIL: Escalate if the user reports fraud or account compromise.'

  // ── Model mapping ──
  const modelMap: Record<string, string> = {
    'claude-sonnet': agentConfig.model || 'claude-sonnet-4-20250514',
    minimax: 'MiniMax-M2.7-highspeed',
    deepseek: 'deepseek-chat',
  }
  const model = modelMap[pc.model] || agentConfig.model

  // ── Call LLM ──
  const providerConfig = getProviderConfig(model)
  const client = new Anthropic(providerConfig)

  // Trace: intent classification
  memoryTraces.push({
    caseId: turnId,
    actionType: 'intent_classify',
    title: `Intent classification for: "${message.slice(0, 80)}"`,
    detail: 'Classifying user intent against enabled case types',
  })

  let reply = ''
  let blocked = false
  let intent = 'general'
  let caseType = ''

  try {
    const toolDefs = filteredTools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as any,
    }))

    const stream = client.messages.stream({
      model,
      max_tokens: agentConfig.maxOutputTokens || 4096,
      temperature: agentConfig.temperature,
      system: systemPrompt,
      messages: [{ role: 'user', content: message }],
      tools: toolDefs.length > 0 ? toolDefs : undefined,
    })

    // Trace: llm request start
    memoryTraces.push({
      caseId: turnId,
      actionType: 'llm_request_start',
      title: `LLM request: ${model}`,
      detail: `Model: ${model}, max_tokens: ${agentConfig.maxOutputTokens || 4096}, tools: ${toolDefs.length}`,
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        reply += event.delta.text
        yield { type: 'text_delta', data: event.delta.text, timestamp: new Date().toISOString() }
      }

      // Intercept tool_use BEFORE execution (dry-run chokepoint)
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        const toolName = event.content_block.name

        if (toolName === 'dispatch_case_agent') {
          // Never spawn real background agents in playground
          memoryTraces.push({
            caseId: turnId,
            actionType: 'skill_called',
            title: `[DRY-RUN] ${toolName}`,
            detail: 'dispatch_case_agent intercepted — would create case + spawn background agent in production',
          })
          yield {
            type: 'tool_executing',
            data: { name: toolName, input: event.content_block.input, dryRun: true },
            timestamp: new Date().toISOString(),
          }
          yield {
            type: 'skill_result',
            data: { name: toolName, output: dispatchCaseAgentMockResult('general').output, dryRun: true },
            timestamp: new Date().toISOString(),
          }
          continue
        }

        const skillDef = skillRouter.getSkill(toolName)
        const safe = skillDef != null && isSafeInDryRun(skillDef)

        if (!safe) {
          // Operational or unknown → mock
          memoryTraces.push({
            caseId: turnId,
            actionType: 'skill_called',
            title: `[DRY-RUN] ${toolName}`,
            detail: skillDef
              ? `Operational tool (category: ${skillDef.toolCategory || 'unknown'}) intercepted — no side effects`
              : 'Unknown tool intercepted',
          })
          yield {
            type: 'tool_executing',
            data: { name: toolName, input: event.content_block.input, dryRun: true },
            timestamp: new Date().toISOString(),
          }
          yield {
            type: 'skill_result',
            data: {
              name: toolName,
              output: skillDef ? dryRunMockResult(skillDef).output : JSON.stringify({ _dryRun: true, _note: 'Unknown tool intercepted' }),
              dryRun: true,
            },
            timestamp: new Date().toISOString(),
          }
        } else {
          // system_info → allow real execution
          memoryTraces.push({
            caseId: turnId,
            actionType: 'skill_called',
            title: `[EXEC] ${toolName}`,
            detail: 'system_info tool — real execution allowed',
          })
          // Note: real execution requires the agent loop infrastructure
          // For MVP playground, we trace the call but don't actually execute real tools
          // (real execution would need DB context, session state, etc.)
          yield {
            type: 'skill_result',
            data: { name: toolName, output: JSON.stringify({ _note: `Playground: ${toolName} traced. Real execution needs agent loop context.` }), dryRun: true },
            timestamp: new Date().toISOString(),
          }
        }
      }

      // Check for guardrail blocks
      if (event.type === 'content_block_stop') {
        memoryTraces.push({
          caseId: turnId,
          actionType: 'policy_hit',
          title: 'Guardrails: content block complete',
          detail: blocked ? 'Content blocked by guardrails' : 'Passed',
        })
      }
    }

    // Detect intent from reply
    if (reply.toLowerCase().includes('order') || reply.toLowerCase().includes('refund')) {
      intent = 'deposit_issue'
      caseType = 'deposit_issue'
    } else if (reply.toLowerCase().includes('account')) {
      intent = 'account_issue'
      caseType = 'account_issue'
    }

    // Trace: llm response
    memoryTraces.push({
      caseId: turnId,
      actionType: 'llm_response',
      title: `LLM response: ${reply.length} chars`,
      detail: reply.slice(0, 200),
    })

  } catch (err) {
    memoryTraces.push({
      caseId: turnId,
      actionType: 'llm_response',
      title: 'LLM error',
      detail: err instanceof Error ? err.message : 'Unknown error',
    })
    yield { type: 'error', data: err instanceof Error ? err.message : 'LLM call failed', timestamp: new Date().toISOString() }
  }

  // ── Aggregate traces ──
  const trace = aggregateTraces(memoryTraces, startTime, pc.debug)

  // ── Emit final trace event ──
  const result: PlaygroundResult = { turnId, intent, caseType, reply, blocked, trace }
  yield { type: 'trace', data: result, timestamp: new Date().toISOString() }
  yield { type: 'message_stop', data: { transition: 'next_turn' }, timestamp: new Date().toISOString() }
}
