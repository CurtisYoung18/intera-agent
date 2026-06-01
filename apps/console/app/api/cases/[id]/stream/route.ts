// [deprecated-runtime-route] Used by legacy web-chat frontend; keep until zero traffic confirmed.
/**
 * GET /api/cases/[caseId]/stream
 *
 * CC-aligned persistent SSE endpoint — one long-lived stream per case.
 * The stream stays open for the lifetime of a case; messages arrive via
 * POST /api/cases/[caseId]/message and are dequeued here for each turn.
 *
 * Lifecycle:
 *   1. Client opens this endpoint (before or after the first POST).
 *   2. We initialize AgentLoop from DB (or reuse existing in-memory session).
 *   3. Session loop: await message → agentLoop.run() → persist → repeat.
 *   4. On terminal transition (resolved/error) or client disconnect: close.
 *
 * No secondary LLM calls in SOP mode — we fully trust the model (CC pattern).
 */

import { NextRequest } from 'next/server'
import { AgentLoop } from '@/lib/agent/loop'
import { prisma } from '@intera/shared/prisma'
import { resolvePrompt, buildPromptContext } from '@/lib/agent/prompt-resolver'
import { getCachedConfig, setCachedConfig } from '@/lib/agent/config-cache'
import { getOrCreateSession, closeSession, type CaseSession } from '@/lib/agent/session-store'
import type { SSEEvent, AgentConfigData, CaseSchemaConfig } from '@intera/shared/types'
import {
  DEFAULT_SYSTEM_PROMPT,
  CORE_SYSTEM_PROMPT,
  CASE_SYSTEM_PROMPT,
  DEFAULT_MEMORY_STRATEGY,
  DEFAULT_POLICY_HOOKS,
  HARNESS_DEFAULT_RESUME_PROMPT_APPEND,
} from '@intera/shared/defaults'
import { isInvestigableCaseType } from '@/lib/agent/case-type-slugs'
import { resolveOrgFromApiKey, isTrustedInternalCall } from '@/lib/api-auth'

// ─── Config helpers (shared with /api/messages) ───────────────────────────────

const DEFAULT_AGENT_CONFIG: AgentConfigData = {
  model: 'MiniMax-M2.7-highspeed',
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

function parseMemoryJson(raw: string | null | undefined): unknown {
  if (!raw) return {}
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return {} }
}

async function loadAgentConfig(orgId: string): Promise<AgentConfigData> {
  const cached = getCachedConfig(orgId)
  if (cached) return cached

  try {
    const dbConfig = await prisma.agentConfig.findUnique({ where: { orgId } })
    if (dbConfig) {
      const config: AgentConfigData = {
        model: dbConfig.model,
        temperature: dbConfig.temperature,
        thinkingBudget: dbConfig.thinkingBudget,
        maxIterations: dbConfig.maxIterations,
        maxOutputTokens: (dbConfig as any).maxOutputTokens ?? 4096,
        systemPrompt: dbConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        showThinking: dbConfig.showThinking,
        memoryStrategy: (parseNonEmptyJson(dbConfig.memoryStrategy) as unknown as AgentConfigData['memoryStrategy']) || DEFAULT_AGENT_CONFIG.memoryStrategy,
        policyHooks: (parseNonEmptyJson(dbConfig.policyHooks) as unknown as AgentConfigData['policyHooks']) || DEFAULT_AGENT_CONFIG.policyHooks,
        resumePrompt: (dbConfig as Record<string, unknown>).resumePrompt ? String((dbConfig as Record<string, unknown>).resumePrompt) : '',
        formResponseTemplate: (dbConfig as Record<string, unknown>).formResponseTemplate ? String((dbConfig as Record<string, unknown>).formResponseTemplate) : '',
        prefixContinuationEnabled: Boolean((dbConfig as Record<string, unknown>).prefixContinuationEnabled),
        prefixContinuationChatModel: (dbConfig as Record<string, unknown>).prefixContinuationChatModel as string | undefined,
        prefixContinuationBaseUrl: (dbConfig as Record<string, unknown>).prefixContinuationBaseUrl as string | undefined,
        prefixContinuationAssistantPrefix: ((dbConfig as Record<string, unknown>).prefixContinuationAssistantPrefix as string | null | undefined) ?? '',
        prefixContinuationStop: (dbConfig as Record<string, unknown>).prefixContinuationStop as string | undefined,
        debugMode: Boolean((dbConfig as Record<string, unknown>).debugMode),
      }
      setCachedConfig(orgId, config)
      return config
    }
  } catch (err) {
    console.warn('[Stream] Failed to load agent config, using default:', err)
  }
  return { ...DEFAULT_AGENT_CONFIG }
}

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
  executionMode?: string | null
  sop?: string | null
  requireHumanReview?: boolean
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
    escalateOn: (parseMemoryJson(caseType.escalateOn) as string[]) || [],
    autoCloseConditions: parseMemoryJson(caseType.autoCloseConditions) as Record<string, unknown> | undefined,
    orchestrator: orchestrator as unknown as CaseSchemaConfig['orchestrator'],
    requireHumanReview: caseType.requireHumanReview === true,
    executionMode: (caseType.executionMode as 'stage' | 'cc' | undefined) || 'stage',
    sop: caseType.sop || undefined,
  }
}

const TERMINAL_VERDICTS = new Set(['resolved', 'false_alarm', 'confirmed_delayed', 'refund_approved'])
function isTerminalVerdict(v: string | null | undefined): boolean {
  if (!v) return false
  const n = v.replace(/ /g, '_')
  return TERMINAL_VERDICTS.has(v) || TERMINAL_VERDICTS.has(n)
}

// ─── AgentLoop initializer (reads DB, builds prompts, restores memory) ────────

async function initAgentLoop(
  caseId: string,
  orgId: string,
  userId: string,
  userLabel: string | undefined,
  chatId: string | null,
): Promise<AgentLoop> {
  const agentConfig = await loadAgentConfig(orgId)
  let systemPrompt = CASE_SYSTEM_PROMPT
  let coreSystemPrompt = CORE_SYSTEM_PROMPT
  let caseSchema: CaseSchemaConfig | null = null

  // Use custom systemPrompt from DB if set
  if (agentConfig.systemPrompt && agentConfig.systemPrompt !== DEFAULT_SYSTEM_PROMPT) {
    systemPrompt = agentConfig.systemPrompt
  }

  // Ensure customer + case rows exist
  await prisma.organization.upsert({
    where: { id: orgId },
    update: {},
    create: { id: orgId, name: orgId },
  })
  await prisma.case.upsert({
    where: { id: caseId },
    update: {},
    create: { id: caseId, orgId, userId, type: 'general', status: 'created', chatId: chatId ?? caseId },
  })

  // Load case + memory from DB
  let existingMemory: Record<string, unknown> | null = null
  try {
    const existingCase = await prisma.case.findUnique({
      where: { id: caseId },
      include: { memory: true },
    })
    if (existingCase) {
      // Load case type schema
      try {
        const ct = await prisma.caseType.findUnique({
          where: { orgId_type: { orgId, type: existingCase.type } },
        })
        if (ct) caseSchema = schemaFromCaseTypeRow(ct)
      } catch { /* noop */ }

      if (existingCase.memory) {
        existingMemory = existingCase.memory as unknown as Record<string, unknown>
        if (existingCase.memory.summary) {
          systemPrompt += `\n\n## Case Session Memory\n${existingCase.memory.summary}`
        }
      }
    }
  } catch (err) {
    console.error('[Stream] Failed to load case/memory from DB:', err)
  }

  // Resolve prompt context
  const existingCaseState = existingMemory ? {
    confirmedFacts: (parseMemoryJson(existingMemory.confirmedFacts as string) as Record<string, unknown>) || {},
    skillsCalled: (parseMemoryJson(existingMemory.skillsCalled as string) as string[]) || [],
    missingFacts: (parseMemoryJson(existingMemory.missingFacts as string) as string[]) || [],
  } : undefined

  const promptCtx = await buildPromptContext({
    orgId,
    caseSchema: caseSchema ? {
      displayName: caseSchema.displayName,
      goal: caseSchema.defaultGoal,
      stages: caseSchema.stages,
      requiredFacts: caseSchema.requiredFacts,
      escalateOn: caseSchema.escalateOn,
    } : undefined,
    caseState: existingCaseState,
    sessionBinding: { userId, userLabel },
  })

  coreSystemPrompt = resolvePrompt(coreSystemPrompt, promptCtx)
  systemPrompt = resolvePrompt(systemPrompt, promptCtx)

  const agentLoop = await AgentLoop.create({
    config: agentConfig,
    caseId,
    orgId,
    userId,
    systemPrompt,
    coreSystemPrompt,
    caseSchema,
    chatId,
    bootstrapNewCase: false,
  })

  // Restore memory from DB
  if (existingMemory) {
    const memData = { ...existingMemory }
    try {
      const c = await prisma.case.findUnique({ where: { id: caseId } })
      if (c?.status) memData.caseStatus = c.status
    } catch { /* noop */ }
    agentLoop.loadMemory(memData)
  }

  // Restore prior messages (conversation history)
  try {
    const priorMessages = await prisma.message.findMany({
      where: { caseId },
      orderBy: { createdAt: 'asc' },
      take: 40,
    })
    if (priorMessages.length > 0) {
      agentLoop.loadMessages(
        priorMessages.map((m) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          contentBlocks: (m as any).contentBlocks ?? undefined,
          createdAt: m.createdAt,
        })),
      )
    }
  } catch (err) {
    console.error('[Stream] Failed to load prior messages:', err)
  }

  return agentLoop
}

// ─── DB persistence after each turn ──────────────────────────────────────────

async function persistTurn(
  caseId: string,
  orgId: string,
  userId: string,
  chatId: string | null,
  loop: AgentLoop,
  result: Awaited<ReturnType<AgentLoop['run']>>,
): Promise<void> {
  const mem = loop.getMemorySummary()
  const hasRealWork =
    mem.skillsCalled.length > 0 ||
    Object.keys(mem.confirmedFacts).length > 0 ||
    result.transition !== 'next_turn' ||
    (mem.summary && mem.summary.length > 0) ||
    (mem.caseStatus && mem.caseStatus !== 'created')

  if (hasRealWork) {
    try {
      const caseTypeForUpsert = loop.getCaseType()
      await prisma.case.upsert({
        where: { id: caseId },
        update: { status: result.caseStatus },
        create: { id: caseId, orgId, userId, type: caseTypeForUpsert, status: result.caseStatus, chatId: chatId ?? caseId },
      })
      await prisma.chatMemory.upsert({
        where: { caseId },
        update: {
          confirmedFacts: JSON.stringify(mem.confirmedFacts),
          missingFacts: JSON.stringify(mem.missingFacts),
          skillsCalled: JSON.stringify(mem.skillsCalled),
          skillResults: JSON.stringify(mem.skillResults),
          keyEvents: JSON.stringify(mem.keyEvents),
          summary: mem.summary || undefined,
          todos: mem.todos ? JSON.stringify(mem.todos) : null,
          agentTodos: mem.agentTodos ? JSON.stringify(mem.agentTodos) : null,
          dashboardVersion: mem.dashboardVersion ?? 0,
        },
        create: {
          caseId,
          confirmedFacts: JSON.stringify(mem.confirmedFacts),
          missingFacts: JSON.stringify(mem.missingFacts),
          skillsCalled: JSON.stringify(mem.skillsCalled),
          skillResults: JSON.stringify(mem.skillResults),
          keyEvents: JSON.stringify(mem.keyEvents),
          humanTaskStatus: 'none',
          summary: mem.summary || undefined,
          todos: mem.todos ? JSON.stringify(mem.todos) : null,
          agentTodos: mem.agentTodos ? JSON.stringify(mem.agentTodos) : null,
          dashboardVersion: mem.dashboardVersion ?? 0,
        },
      })
    } catch (err) {
      console.error('[Stream] Failed to persist case memory:', err)
    }
  }

  // Persist new messages
  try {
    const messagesToPersist = result.messages
      .filter((m) => m.content?.trim() || m.role === 'user' || m.contentBlocks?.length)
      .map((m) => ({
        id: m.id,
        caseId,
        role: m.role,
        content: m.content || '',
        contentBlocks: m.contentBlocks ?? undefined,
        isStreaming: false,
      }))

    if (messagesToPersist.length > 0) {
      await prisma.$transaction(
        messagesToPersist.map((msg) =>
          prisma.message.upsert({
            where: { id: msg.id },
            update: { content: msg.content, contentBlocks: msg.contentBlocks ?? undefined, isStreaming: false },
            create: msg,
          }),
        ),
      )
    }
  } catch (err) {
    console.error('[Stream] Failed to persist messages:', err)
  }
}

// ─── SSE headers ─────────────────────────────────────────────────────────────

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params
  const q = request.nextUrl.searchParams
  const queryOrgId = q.get('orgId') || 'default'

  // ── Auth gate ──
  const authOrgId = await resolveOrgFromApiKey(request)
  const isInternal = !authOrgId && isTrustedInternalCall(request)
  if (!authOrgId && !isInternal) {
    return new Response('Unauthorized', { status: 401 })
  }
  if (authOrgId && queryOrgId !== 'default' && queryOrgId !== authOrgId) {
    return new Response('orgId mismatch', { status: 400 })
  }
  const orgId = authOrgId || queryOrgId

  const userId = q.get('userId') || 'anonymous'
  const userLabel = q.get('userLabel') || undefined
  const chatId = q.get('chatId') || null

  // Validate caseId format
  if (!caseId || !/^[a-zA-Z0-9_-]+$/.test(caseId) || caseId.length > 128) {
    return new Response('Invalid caseId', { status: 400 })
  }

  const encoder = new TextEncoder()
  let streamClosed = false

  const stream = new ReadableStream({
    async start(controller) {
      let sopAutoTurnCount = 0
      let sopMaxAutoTurns = 10 // default, loaded once from case type config at session init

      const sendEvent = (event: SSEEvent) => {
        if (streamClosed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          streamClosed = true
        }
      }

      const session = getOrCreateSession(caseId)

      // Initialise AgentLoop exactly once per session. If two SSE connections
      // race (e.g. reconnect during init), the second waits for initialization.
      if (!session.initialized) {
        session.initialized = true
        try {
          const loop = await initAgentLoop(caseId, orgId, userId, userLabel, chatId)
          session.loop = loop
          // Pre-load SOP max turns from case type config (avoids DB query per turn)
          try {
            const ct = await prisma.caseType.findUnique({
              where: { orgId_type: { orgId, type: loop.getCaseType() } },
              select: { executionMode: true, sopMaxAutoTurns: true },
            })
            if ((ct?.executionMode === 'cc') && ct.sopMaxAutoTurns) {
              sopMaxAutoTurns = ct.sopMaxAutoTurns
            }
          } catch { /* keep default */ }
          console.log(`[Stream] Session initialised: ${caseId} (SOP max turns: ${sopMaxAutoTurns})`)
        } catch (err) {
          console.error('[Stream] AgentLoop init failed:', err)
          sendEvent({ type: 'error', data: 'Failed to initialise session', timestamp: new Date().toISOString() })
          controller.close()
          closeSession(caseId)
          return
        }
      }

      // ── Session loop ─────────────────────────────────────────────────────
      // Await one message at a time, run a full agent turn, persist, repeat.
      // In SOP mode, auto-continues until terminal state or max turns reached.


      try {
        while (!session.aborted && !streamClosed) {
          // Block until a message arrives from POST /message (or auto-continue)
          const queued = await session.queue.dequeue()

          if (session.aborted || queued.content === '__SESSION_CLOSED__') break
          if (streamClosed) break

          session.lastActiveAt = Date.now()

          // Check for human task auto-resume (same logic as /api/messages)
          let messageContent = queued.content
          if (session.loop) {
            messageContent = await maybeInjectHumanTaskResume(caseId, orgId, messageContent, session.loop)
          }

          // Run one agent turn
          sendEvent({ type: 'stream_request_start', data: null, timestamp: new Date().toISOString() })

          try {
            const result = await session.loop!.run(messageContent, sendEvent, queued.formAnswers, queued.contentBlocks)

            // Persist turn to DB asynchronously (don't block the next message wait)
            persistTurn(caseId, orgId, userId, chatId, session.loop!, result).catch((err) =>
              console.error('[Stream] Persist error:', err),
            )

            sendEvent({
              type: 'message_stop',
              data: { transition: result.transition, reason: result.reason },
              timestamp: new Date().toISOString(),
            })

            // Terminal transitions — close the session
            if (
              result.transition === 'resolved' ||
              result.transition === 'error' ||
              result.transition === 'connection_lost'
            ) {
              break
            }

            // SOP auto-continuation: in SOP mode, the agent must run autonomously
            // through all todo steps without waiting for further user messages.
            // After each non-terminal, non-waiting turn, inject a continuation
            // trigger so the loop processes the next turn immediately.
            if (
              result.transition !== 'waiting_human' &&
              result.transition !== 'waiting_form' &&
              sopAutoTurnCount < sopMaxAutoTurns
            ) {
              sopAutoTurnCount++
              console.log(`[Stream] SOP auto-continue ${sopAutoTurnCount}/${sopMaxAutoTurns} for ${caseId}`)
              session.queue.enqueue({ content: '[SOP CONTINUE]' })
            }

            // Waiting for form/interaction — stay alive, next message is the response
          } catch (turnErr) {
            console.error('[Stream] Turn error:', turnErr)
            sendEvent({
              type: 'error',
              data: turnErr instanceof Error ? turnErr.message : 'Turn failed',
              timestamp: new Date().toISOString(),
            })
            break
          }
        }
      } finally {
        streamClosed = true
        closeSession(caseId)
        controller.close()
        console.log(`[Stream] Session closed: ${caseId}`)
      }
    },

    cancel() {
      streamClosed = true
      closeSession(caseId)
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}

// ─── Human-task auto-resume injection (mirrors /api/messages logic) ──────────

async function maybeInjectHumanTaskResume(
  caseId: string,
  orgId: string,
  message: string,
  _loop: AgentLoop,
): Promise<string> {
  try {
    const existingCase = await prisma.case.findUnique({ where: { id: caseId } })
    if (existingCase?.status !== 'waiting_human') return message

    const resolvedTask = await prisma.humanTask.findFirst({
      where: { caseId, status: 'resolved', notifiedAt: null },
      orderBy: { resolvedAt: 'desc' },
    })
    if (!resolvedTask) return message

    const config = await loadAgentConfig(orgId)
    const resumeTmpl = config.resumePrompt || HARNESS_DEFAULT_RESUME_PROMPT_APPEND
    const parts = ['[Human task resolved — operator reviewed your case]']
    if (resolvedTask.verdict) parts.push(`Operator verdict: ${resolvedTask.verdict.replace(/_/g, ' ')}`)
    if (resolvedTask.notes) parts.push(`Internal notes: ${resolvedTask.notes}`)
    parts.push(resumeTmpl)

    await prisma.humanTask.update({
      where: { id: resolvedTask.id },
      data: { notifiedAt: new Date() },
    }).catch(() => {})

    if (isTerminalVerdict(resolvedTask.verdict)) {
      await prisma.case.update({
        where: { id: caseId },
        data: { status: 'resolved' },
      }).catch(() => {})
    }

    const injected = parts.join('\n')
    return message ? `${injected}\n\nCustomer also said: ${message}` : injected
  } catch {
    return message
  }
}
