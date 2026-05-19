// Intera Harness - Messages API Route
// POST /api/messages — Main entry point for user messages
// Supports resumeTrigger for human task resolution

import { NextRequest } from 'next/server'
import { AgentLoop } from '@/lib/agent/loop'
import { isInvestigableCaseType } from '@/lib/agent/case-type-slugs'
import { prisma } from '@intera/shared/prisma'
import { resolvePrompt, buildPromptContext } from '@/lib/agent/prompt-resolver'
import type { SSEEvent, AgentConfigData, CaseSchemaConfig } from '@intera/shared/types'

// Verify env vars at module load (logged once per cold start)
const AUTH_SET = !!process.env.ANTHROPIC_AUTH_TOKEN
const URL_SET = !!process.env.ANTHROPIC_BASE_URL
if (AUTH_SET && URL_SET) {
  console.log('[Intera] ✓ API credentials loaded from env')
} else {
  console.warn('[Intera] ⚠️  ANTHROPIC_AUTH_TOKEN or ANTHROPIC_BASE_URL missing in env')
}

import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_MEMORY_STRATEGY,
  DEFAULT_POLICY_HOOKS,
  HARNESS_DEFAULT_RESUME_PROMPT_APPEND,
} from '@intera/shared/defaults'

// Default fallback config. Production loads from AgentConfig table via Customer.
const DEFAULT_AGENT_CONFIG: AgentConfigData = {
  model: 'MiniMax-M2.7-highspeed',
  temperature: 0.5,
  thinkingBudget: 4096,
  maxIterations: 20,
  maxOutputTokens: 4096,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  toolParallelism: true,
  isConcurrencySafe: true,
  showThinking: false,
  memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY },
  policyHooks: { ...DEFAULT_POLICY_HOOKS },
  resumePrompt: '',
  formResponseTemplate: '',
  prefixContinuationEnabled: false,
}

// Per-customer TTL cache for AgentConfig (30s). Invalidated on admin save.
import { getCachedConfig, setCachedConfig } from '@/lib/agent/config-cache'

async function loadAgentConfig(customerId: string): Promise<AgentConfigData> {
  const cached = getCachedConfig(customerId)
  if (cached) return cached

  try {
    const dbConfig = await prisma.agentConfig.findUnique({ where: { customerId } })
    if (dbConfig) {
      const config: AgentConfigData = {
        model: dbConfig.model,
        temperature: dbConfig.temperature,
        thinkingBudget: dbConfig.thinkingBudget,
        maxIterations: dbConfig.maxIterations,
        maxOutputTokens: (dbConfig as any).maxOutputTokens ?? 4096,
        systemPrompt: dbConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        toolParallelism: dbConfig.toolParallelism,
        isConcurrencySafe: dbConfig.isConcurrencySafe,
        showThinking: dbConfig.showThinking,
        memoryStrategy: (parseNonEmptyJson(dbConfig.memoryStrategy) as unknown as AgentConfigData['memoryStrategy']) || DEFAULT_AGENT_CONFIG.memoryStrategy,
        policyHooks: (parseNonEmptyJson(dbConfig.policyHooks) as unknown as AgentConfigData['policyHooks']) || DEFAULT_AGENT_CONFIG.policyHooks,
        resumePrompt: (dbConfig as Record<string, unknown>).resumePrompt
          ? String((dbConfig as Record<string, unknown>).resumePrompt)
          : '',
        formResponseTemplate: (dbConfig as Record<string, unknown>).formResponseTemplate
          ? String((dbConfig as Record<string, unknown>).formResponseTemplate)
          : '',
        evaluationModel: (dbConfig as Record<string, unknown>).evaluationModel
          ? String((dbConfig as Record<string, unknown>).evaluationModel)
          : undefined,
        intentModel: (dbConfig as Record<string, unknown>).intentModel
          ? String((dbConfig as Record<string, unknown>).intentModel)
          : undefined,
        prefixContinuationEnabled: Boolean((dbConfig as Record<string, unknown>).prefixContinuationEnabled),
        prefixContinuationChatModel: (dbConfig as Record<string, unknown>).prefixContinuationChatModel as
          | string
          | undefined,
        prefixContinuationBaseUrl: (dbConfig as Record<string, unknown>).prefixContinuationBaseUrl as
          | string
          | undefined,
        prefixContinuationAssistantPrefix:
          ((dbConfig as Record<string, unknown>).prefixContinuationAssistantPrefix as string | null | undefined) ??
          '',
        prefixContinuationStop: ((dbConfig as Record<string, unknown>).prefixContinuationStop as string | undefined) ?? undefined,
        debugMode: Boolean((dbConfig as Record<string, unknown>).debugMode),
      }
      setCachedConfig(customerId, config)
      return config
    }
  } catch (err) {
    console.warn('[Intera] Failed to load agent config from DB, using default:', err)
  }

  return { ...DEFAULT_AGENT_CONFIG }
}

function parseJson(raw: string): unknown {
  try { return JSON.parse(raw) } catch { return null }
}

function parseNonEmptyJson(raw: string): Record<string, unknown> | null {
  const parsed = parseJson(raw)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
    return parsed as Record<string, unknown>
  }
  return null
}

/** Build harness CaseSchemaConfig from a CaseType DB row (shared load / hydrate paths). */
function schemaFromCaseTypeRow(caseType: {
  type: string
  displayName: string
  description: string | null
  icon: string
  requiredFacts: string
  stages: string
  stageConfigs: string | null
  orchestratorConfig: string | null
  defaultGoal: string
  escalateOn: string
  autoCloseConditions: string | null
}): CaseSchemaConfig {
  const stages = parseMemoryJson(caseType.stages) as string[]
  const requiredFacts = parseMemoryJson(caseType.requiredFacts) as string[]
  const stageConfigs = parseMemoryJson(caseType.stageConfigs) as Record<string, unknown> | null
  const orchestrator = parseMemoryJson(caseType.orchestratorConfig) as Record<string, unknown> | null

  return {
    type: caseType.type,
    displayName: caseType.displayName,
    description: caseType.description || undefined,
    icon: caseType.icon,
    requiredFacts: Array.isArray(requiredFacts) ? requiredFacts : [],
    stages: Array.isArray(stages) ? stages : [],
    stageConfigs: stageConfigs as unknown as CaseSchemaConfig['stageConfigs'],
    defaultGoal: caseType.defaultGoal,
    escalateOn: parseMemoryJson(caseType.escalateOn) as string[] || [],
    autoCloseConditions: parseMemoryJson(caseType.autoCloseConditions) as Record<string, unknown> | undefined,
    orchestrator: orchestrator as unknown as CaseSchemaConfig['orchestrator'],
  }
}

function parseMemoryJson(raw: string | null | undefined): unknown {
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { return {} }
}

export async function POST(request: NextRequest) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (event: SSEEvent) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        )
      }

      try {
        // Body size validation
        const contentLength = Number(request.headers.get('content-length') || 0)
        if (contentLength > 100_000) {
          sendEvent({ type: 'error', data: 'Request body too large (max 100KB)', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        const body = await request.json()
        const {
          message,
          resumeTrigger,
          formResult,
          interactionResult,
          caseId,
          customerId,
          userId,
          caseType: bodyCaseType,
          bootstrapNewCase: rawBootstrapNewCase,
        } = body

        const bootstrapNewCase = Boolean(rawBootstrapNewCase)

        // Validate customerId format
        if (customerId && (typeof customerId !== 'string' || customerId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(customerId))) {
          sendEvent({ type: 'error', data: 'Invalid customerId format', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        // Validate message length
        if (message && typeof message === 'string' && message.length > 50000) {
          sendEvent({ type: 'error', data: 'Message too long (max 50000 characters)', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        let userMessage = message
        let resolvedCaseId = caseId || `case_${Date.now()}`
        let resolvedCustomerId = customerId || 'default'
        let resolvedUserId = userId || 'anonymous'
        let createdCaseForIntent = false
        const emittedCaseCreated = new Set<string>()

        // ── Form response: customer submitted form answers ──
        let formAnswers: Record<string, string> | undefined
        if (formResult && !message) {
          resolvedCaseId = formResult.caseId || resolvedCaseId
          const answers = (formResult.answers || {}) as Record<string, string>
          formAnswers = answers
          // Format as tool_result so the model sees it exactly like any other
          // tool execution result — matching CC's AskUserQuestion pattern.
          userMessage = `Tool request_user_input result: ${JSON.stringify(answers)}`
          console.log(`[Intera] Form submitted for case ${resolvedCaseId}`)
        }

        // ── Interaction response: customer selected an option ──
        if (interactionResult && !message && !formResult) {
          resolvedCaseId = interactionResult.caseId || resolvedCaseId
          const { optionId, input } = interactionResult as { caseId?: string; optionId: string; input?: string }
          const payload: Record<string, unknown> = { optionId }
          if (input) payload.input = input
          userMessage = `Tool propose_interaction result: ${JSON.stringify(payload)}`
          console.log(`[Intera] Interaction resolved for case ${resolvedCaseId}: option=${optionId}`)
        }

        // ── Resume flow: human resolved a task, agent continues ──
        if (resumeTrigger && !message) {
          const task = await prisma.humanTask.findUnique({
            where: { id: resumeTrigger },
            include: { case: true },
          })

          if (task && task.status === 'resolved') {
            resolvedCaseId = task.caseId
            resolvedCustomerId = task.case.customerId
            resolvedUserId = task.case.userId

            const resumeTmpl =
              (await loadAgentConfig(resolvedCustomerId)).resumePrompt || HARNESS_DEFAULT_RESUME_PROMPT_APPEND
            const parts = ['[Human task resolved — operator closed the case]']
            if (task.verdict) parts.push(`Operator verdict: ${task.verdict.replace(/_/g, ' ')}`)
            if (task.expectedEta) parts.push(`Expected resolution time: ${task.expectedEta}`)
            if (task.notes) parts.push(`Internal notes (do NOT share verbatim with customer): ${task.notes}`)
            parts.push(resumeTmpl)
            userMessage = parts.join('\n')

            console.log(`[Intera] Resuming case ${resolvedCaseId} after human resolution`)
          } else {
            sendEvent({
              type: 'error',
              data: 'Task not found or not resolved',
              timestamp: new Date().toISOString(),
            })
            controller.close()
            return
          }
        }

        if (!userMessage) {
          sendEvent({
            type: 'error',
            data: 'Message is required',
            timestamp: new Date().toISOString(),
          })
          controller.close()
          return
        }

        // ── System prompt ──
        let systemPrompt = DEFAULT_SYSTEM_PROMPT

        // Stream progress immediately so the user sees movement (CC pattern)
        sendEvent({ type: 'stream_request_start', data: null, timestamp: new Date().toISOString() })

        // ── Bootstrap new case from Chat UI (multi-case parallel lanes) ──
        if (
          bootstrapNewCase &&
          bodyCaseType &&
          isInvestigableCaseType(bodyCaseType) &&
          userMessage &&
          !resumeTrigger &&
          !formResult
        ) {
          try {
            const ctRow = await prisma.caseType.findUnique({
              where: { customerId_type: { customerId: resolvedCustomerId, type: bodyCaseType } },
            })
            const newCase = await prisma.case.create({
              data: {
                customerId: resolvedCustomerId,
                userId: resolvedUserId,
                type: bodyCaseType,
                status: 'created',
              },
            })
            resolvedCaseId = newCase.id
            createdCaseForIntent = true

            sendEvent({
              type: 'case_created',
              data: {
                caseId: newCase.id,
                caseType: bodyCaseType,
                displayName: ctRow?.displayName ?? bodyCaseType,
                icon: ctRow?.icon ?? '📋',
              },
              timestamp: new Date().toISOString(),
            })
            emittedCaseCreated.add(newCase.id)
            console.log(`[Intera] bootstrapNewCase → ${newCase.id} (${bodyCaseType})`)
          } catch (err) {
            console.error('[Intera] bootstrapNewCase failed:', err)
            sendEvent({
              type: 'error',
              data: err instanceof Error ? err.message : 'Failed to create case',
              timestamp: new Date().toISOString(),
            })
            controller.close()
            return
          }
        }

        if (bodyCaseType) {
          systemPrompt += `\n\n[Manual Case Type]: The user has selected case type "${bodyCaseType}".`
        }

        // Chat UI binds SSE events to lane.caseId via case_created.
        if (!resumeTrigger && !formResult && !createdCaseForIntent && resolvedCaseId && !emittedCaseCreated.has(resolvedCaseId)) {
          const inferredType =
            (bodyCaseType && isInvestigableCaseType(bodyCaseType) ? bodyCaseType : undefined)
          if (inferredType) {
            try {
              const ctRow = await prisma.caseType.findUnique({
                where: {
                  customerId_type: {
                    customerId: resolvedCustomerId,
                    type: inferredType,
                  },
                },
              })
              sendEvent({
                type: 'case_created',
                data: {
                  caseId: resolvedCaseId,
                  caseType: inferredType,
                  displayName: ctRow?.displayName ?? inferredType,
                  icon: ctRow?.icon ?? '📋',
                  extractedFacts: {},
                },
                timestamp: new Date().toISOString(),
              })
              emittedCaseCreated.add(resolvedCaseId)
            } catch {
              /* ignore */
            }
          }
        }

        // ── Load case memory + schema from DB (CC-style session memory pattern) ──
        let existingMemory: unknown = null
        let caseSchema: CaseSchemaConfig | null = null
        try {
          const existingCase = await prisma.case.findUnique({
            where: { id: resolvedCaseId },
            include: { memory: true },
          })
          if (existingCase) {
            // Load case type schema if available
            try {
              const caseType = await prisma.caseType.findUnique({
                where: { customerId_type: { customerId: resolvedCustomerId, type: existingCase.type } },
              })
              if (caseType) {
                caseSchema = schemaFromCaseTypeRow(caseType)
              }
            } catch { /* schema not found */ }

            // Auto-resume: if case is waiting for human and task was resolved, inject verdict
            if (existingCase.status === 'waiting_human' && !resumeTrigger && !formResult && message) {
              try {
                const resolvedTask = await prisma.humanTask.findFirst({
                  where: { caseId: resolvedCaseId, status: 'resolved' },
                  orderBy: { resolvedAt: 'desc' },
                })
                if (resolvedTask) {
                  const resumeTmpl = (await loadAgentConfig(resolvedCustomerId)).resumePrompt || HARNESS_DEFAULT_RESUME_PROMPT_APPEND
                  const parts = ['[Human task resolved — operator reviewed your case]']
                  if (resolvedTask.verdict) parts.push(`Operator verdict: ${resolvedTask.verdict.replace(/_/g, ' ')}`)
                  if (resolvedTask.notes) parts.push(`Internal notes: ${resolvedTask.notes}`)
                  parts.push(resumeTmpl)
                  userMessage = parts.join('\n') + '\n\nCustomer also said: ' + message
                }
              } catch { /* best-effort */ }
            }

            if (existingCase.memory) {
              existingMemory = existingCase.memory

              if (existingCase.memory.summary) {
                systemPrompt += `\n\n## Case Session Memory\n${existingCase.memory.summary}`
              }
            }
          }
        } catch {
          // Case doesn't exist yet
        }

        // FK: traces/messages reference Case.caseId — rows must exist before AgentLoop writes ActionTrace/Message.
        const inferredCaseTypeForRecord =
          caseSchema?.type ??
          bodyCaseType ??
          'general'

        try {
          await prisma.customer.upsert({
            where: { id: resolvedCustomerId },
            update: {},
            create: { id: resolvedCustomerId, name: resolvedCustomerId },
          })
          await prisma.case.upsert({
            where: { id: resolvedCaseId },
            update: {},
            create: {
              id: resolvedCaseId,
              customerId: resolvedCustomerId,
              userId: resolvedUserId,
              type: inferredCaseTypeForRecord,
              status: 'created',
            },
          })
        } catch (err) {
          console.error('[Intera] Failed to ensure Customer/Case row before agent loop:', err)
        }

        // First-touch lanes: Case row now exists but schema was only attached when existingCase was found earlier.
        if (!caseSchema && inferredCaseTypeForRecord !== 'general') {
          try {
            const ctRow = await prisma.caseType.findUnique({
              where: {
                customerId_type: {
                  customerId: resolvedCustomerId,
                  type: inferredCaseTypeForRecord,
                },
              },
            })
            if (ctRow) {
              caseSchema = schemaFromCaseTypeRow(ctRow)
            }
          } catch {
            /* ignore */
          }
        }

        // ── Resolve prompt placeholders with live Console config ──
        const existingMemoryData = existingMemory as Record<string, unknown> | null
        const resolvedCaseState = existingMemoryData ? {
          confirmedFacts: (parseMemoryJson(existingMemoryData.confirmedFacts as string) as Record<string, unknown>) || {},
          skillsCalled: (parseMemoryJson(existingMemoryData.skillsCalled as string) as string[]) || [],
          missingFacts: (parseMemoryJson(existingMemoryData.missingFacts as string) as string[]) || [],
        } : undefined

        const promptCtx = await buildPromptContext({
          customerId: resolvedCustomerId,
          caseSchema: caseSchema ? {
            displayName: caseSchema.displayName,
            goal: caseSchema.defaultGoal,
            stages: caseSchema.stages,
            requiredFacts: caseSchema.requiredFacts,
            escalateOn: caseSchema.escalateOn,
          } : undefined,
          caseState: resolvedCaseState,
          sessionBinding: { userId: resolvedUserId },
        })
        systemPrompt = resolvePrompt(systemPrompt, promptCtx)

        const agentConfig = await loadAgentConfig(resolvedCustomerId)

        const agentLoop = await AgentLoop.create({
          config: agentConfig,
          caseId: resolvedCaseId,
          customerId: resolvedCustomerId,
          userId: resolvedUserId,
          systemPrompt,
          caseSchema,
        })

        // Restore memory from DB into the in-memory manager
        if (existingMemory) {
          const memData = { ...(existingMemory as Record<string, unknown>) }
          // Inject caseStatus from the Case table so StageExecutor.getCurrentStage() works
          try {
            const c = await prisma.case.findUnique({ where: { id: resolvedCaseId } })
            if (c?.status) memData.caseStatus = c.status
          } catch { /* ignore */ }
          agentLoop.loadMemory(memData)
        }

        const result = await agentLoop.run(userMessage, sendEvent, formAnswers)

        // ── Persist case memory — only if real work was done (not casual chat) ──
        const mem = agentLoop.getMemorySummary()
        const hasRealWork = mem.skillsCalled.length > 0 ||
          Object.keys(mem.confirmedFacts).length > 0 ||
          result.transition !== 'next_turn'
        if (hasRealWork) {
          try {
            // Read type from AgentLoop's deps (may have been set by create_case tool mid-loop)
            const caseTypeForUpsert = (agentLoop as any).deps?.caseSchema?.type || caseSchema?.type || 'general'
            await prisma.case.upsert({
              where: { id: resolvedCaseId },
              update: { status: result.caseStatus, type: caseTypeForUpsert },
              create: {
                id: resolvedCaseId,
                customerId: resolvedCustomerId,
                userId: resolvedUserId,
                type: caseTypeForUpsert,
                status: result.caseStatus,
              },
            })
            await prisma.caseMemory.upsert({
              where: { caseId: resolvedCaseId },
              update: {
                confirmedFacts: JSON.stringify(mem.confirmedFacts),
                missingFacts: JSON.stringify(mem.missingFacts),
                skillsCalled: JSON.stringify(mem.skillsCalled),
                skillResults: JSON.stringify(mem.skillResults),
                keyEvents: JSON.stringify(mem.keyEvents),
                summary: mem.summary || undefined,
              },
              create: {
                caseId: resolvedCaseId,
                confirmedFacts: JSON.stringify(mem.confirmedFacts),
                missingFacts: JSON.stringify(mem.missingFacts),
                skillsCalled: JSON.stringify(mem.skillsCalled),
                skillResults: JSON.stringify(mem.skillResults),
                keyEvents: JSON.stringify(mem.keyEvents),
                humanTaskStatus: 'none',
                summary: mem.summary || undefined,
              },
            })
          } catch (err) {
            console.error('[Intera] Failed to persist case memory:', err)
          }
        }

        // ── Persist messages to DB (always, even for casual chat) ──
        try {
          const messagesToPersist = result.messages
            .filter((m) => m.content?.trim() || m.role === 'user')
            .map((m) => ({
              id: m.id,
              caseId: resolvedCaseId,
              role: m.role,
              content: m.content || '',
              isStreaming: false,
            }))

          if (messagesToPersist.length > 0) {
            await prisma.$transaction(
              messagesToPersist.map((msg) =>
                prisma.message.upsert({
                  where: { id: msg.id },
                  update: { content: msg.content, isStreaming: false },
                  create: msg,
                }),
              ),
            )
          }
        } catch (err) {
          console.error('[Intera] Failed to persist messages:', err)
        }

        sendEvent({
          type: 'message_stop',
          data: { transition: result.transition, reason: result.reason },
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        console.error('Agent loop error:', error)
        sendEvent({
          type: 'error',
          data: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
