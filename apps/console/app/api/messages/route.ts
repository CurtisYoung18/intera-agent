// Intera Harness - Messages API Route
// POST /api/messages — Main entry point for user messages
// Supports resumeTrigger for human task resolution

import { NextRequest } from 'next/server'
import { AgentLoop } from '@/lib/agent/loop'
import { enqueueMessageOrCreate, getOrCreateSession, hasSession } from '@/lib/agent/session-store'
import { isInvestigableCaseType } from '@/lib/agent/case-type-slugs'
import { prisma } from '@intera/shared/prisma'
import { resolvePrompt, buildPromptContext } from '@/lib/agent/prompt-resolver'
import { resolveOrgFromApiKey, isTrustedInternalCall } from '@/lib/api-auth'
import { generateCaseId } from '@/lib/utils'
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
  CORE_SYSTEM_PROMPT,
  CASE_SYSTEM_PROMPT,
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
  showThinking: false,
  memoryStrategy: { ...DEFAULT_MEMORY_STRATEGY },
  policyHooks: { ...DEFAULT_POLICY_HOOKS },
  resumePrompt: '',
  formResponseTemplate: '',
  prefixContinuationEnabled: false,
  enableLlmSanitization: false,
}

// Per-customer TTL cache for AgentConfig (30s). Invalidated on admin save.
import { getCachedConfig, setCachedConfig } from '@/lib/agent/config-cache'

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
        coreSystemPrompt: (dbConfig as Record<string, unknown>).coreSystemPrompt
          ? String((dbConfig as Record<string, unknown>).coreSystemPrompt)
          : undefined,
        showThinking: dbConfig.showThinking,
        memoryStrategy: (parseNonEmptyJson(dbConfig.memoryStrategy) as unknown as AgentConfigData['memoryStrategy']) || DEFAULT_AGENT_CONFIG.memoryStrategy,
        policyHooks: (parseNonEmptyJson(dbConfig.policyHooks) as unknown as AgentConfigData['policyHooks']) || DEFAULT_AGENT_CONFIG.policyHooks,
        resumePrompt: (dbConfig as Record<string, unknown>).resumePrompt
          ? String((dbConfig as Record<string, unknown>).resumePrompt)
          : '',
        formResponseTemplate: (dbConfig as Record<string, unknown>).formResponseTemplate
          ? String((dbConfig as Record<string, unknown>).formResponseTemplate)
          : '',
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
        enableLlmSanitization: Boolean((dbConfig as Record<string, unknown>).enableLlmSanitization),
      }
      setCachedConfig(orgId, config)
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

/** Human verdicts that mean the case is definitively closed. */
const TERMINAL_VERDICTS = new Set(['resolved', 'false_alarm', 'confirmed_delayed', 'refund_approved'])

function isTerminalVerdict(verdict: string | null | undefined): boolean {
  if (!verdict) return false
  // Normalize: "false alarm" → "false_alarm" etc.
  const normalized = verdict.replace(/ /g, '_')
  return TERMINAL_VERDICTS.has(verdict) || TERMINAL_VERDICTS.has(normalized)
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

function parseMemoryJson(raw: string | null | undefined): unknown {
  if (!raw) return {}
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return {} }
}

/** Lightweight LLM-based intent routing: classify a user message to the best
 *  matching active case. Falls back to the most recent case on error. */
async function resolveCaseByIntent(
  userMessage: string,
  activeCases: Array<{ id: string; type: string }>,
  fallbackCaseId: string,
): Promise<string> {
  const model = process.env.HUB_ROUTING_MODEL || 'MiniMax-M2.7-highspeed'

  const caseList = activeCases
    .map((c) => `- id: "${c.id}", type: ${c.type}`)
    .join('\n')

  const prompt = [
    'You are a message router. Given a customer message and a list of active cases,',
    'return the case ID that best matches what the customer is talking about.',
    'If the message is about a NEW topic not covered by any case, return "new".',
    '',
    'Active cases:',
    caseList,
    '',
    'Reply with ONLY the case ID or "new". No other text.',
  ].join('\n')

  try {
    const { createAgentClient } = await import('@/lib/agent/api/provider-config')
    const client = createAgentClient(model)
    const resp = await client.messages.create({
      model,
      max_tokens: 32,
      temperature: 0,
      system: prompt,
      messages: [{ role: 'user', content: userMessage }],
    })
    const text = (resp.content[0] as any)?.text?.trim() || ''
    // Extract caseId from response (handle quotes, whitespace)
    const clean = text.replace(/^["']|["']$/g, '').trim()
    if (clean === 'new' || !clean) return fallbackCaseId
    // Verify the returned ID is in the active cases list
    if (activeCases.some((c) => c.id === clean)) return clean
    return fallbackCaseId
  } catch {
    return fallbackCaseId
  }
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
          contentBlocks,
          resumeTrigger,
          formResult,
          interactionResult,
          caseId,
          orgId,
          userId,
          userLabel,
          chatId,
          caseType: bodyCaseType,
          bootstrapNewCase: rawBootstrapNewCase,
        } = body

        const bootstrapNewCase = Boolean(rawBootstrapNewCase)

        // ── Auth gate: orgId from credential, NOT from body ──
        const authOrgId = await resolveOrgFromApiKey(request)
        const isInternal = !authOrgId && isTrustedInternalCall(request)
        if (!authOrgId && !isInternal) {
          sendEvent({ type: 'error', data: 'Unauthorized — valid API key or internal secret required', timestamp: new Date().toISOString() })
          controller.close()
          return
        }
        // If body sends a different orgId than the credential, reject (don't silently override)
        if (authOrgId && orgId && orgId !== authOrgId) {
          sendEvent({ type: 'error', data: 'orgId mismatch — body orgId must match API key org', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        // Validate orgId format
        if (orgId && (typeof orgId !== 'string' || orgId.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(orgId))) {
          sendEvent({ type: 'error', data: 'Invalid orgId format', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        // Validate userId format
        if (userId && (typeof userId !== 'string' || userId.length > 64 || !/^[a-zA-Z0-9_@.-]+$/.test(userId))) {
          sendEvent({ type: 'error', data: 'Invalid userId format', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        // Validate caseId format
        if (caseId && (typeof caseId !== 'string' || caseId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(caseId))) {
          sendEvent({ type: 'error', data: 'Invalid caseId format', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        // Validate resumeTrigger format
        if (resumeTrigger && (typeof resumeTrigger !== 'string' || resumeTrigger.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(resumeTrigger))) {
          sendEvent({ type: 'error', data: 'Invalid resumeTrigger format', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        // Validate message length
        if (message && typeof message === 'string' && message.length > 50000) {
          sendEvent({ type: 'error', data: 'Message too long (max 50000 characters)', timestamp: new Date().toISOString() })
          controller.close()
          return
        }

        // Validate contentBlocks format
        const resolvedContentBlocks = contentBlocks && Array.isArray(contentBlocks) ? contentBlocks : undefined

        let userMessage = message
        let resolvedCaseId = caseId || generateCaseId()
        let resolvedOrgId = authOrgId || orgId || 'default'
        let resolvedUserId = userId || 'anonymous'
        let createdCaseForIntent = false
        const emittedCaseCreated = new Set<string>()

        // If the client sent an explicit caseId that doesn't exist yet in DB,
        // it's a fresh conversation — skip hub routing so it doesn't hijack
        // old active cases for the same userId.
        const clientProvidedCaseId = !!caseId
        let clientCaseIsNew = false
        if (clientProvidedCaseId) {
          try {
            const existing = await prisma.case.findUnique({ where: { id: resolvedCaseId } })
            clientCaseIsNew = !existing
          } catch { /* noop */ }
        }

        // ── Form response: customer submitted form answers ──
        let formAnswers: Record<string, string> | undefined
        if (formResult && !message) {
          resolvedCaseId = formResult.caseId || resolvedCaseId
          const answers = (formResult.answers || {}) as Record<string, string>
          // Validate form payload size
          const answersJson = JSON.stringify(answers)
          if (answersJson.length > 50_000) {
            sendEvent({ type: 'error', data: 'Form answers too large (max 50KB)', timestamp: new Date().toISOString() })
            controller.close()
            return
          }
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
          // Validate optionId and input size
          if (!optionId || typeof optionId !== 'string' || optionId.length > 256) {
            sendEvent({ type: 'error', data: 'Invalid interaction option', timestamp: new Date().toISOString() })
            controller.close()
            return
          }
          if (input && typeof input === 'string' && input.length > 10_000) {
            sendEvent({ type: 'error', data: 'Interaction input too large (max 10KB)', timestamp: new Date().toISOString() })
            controller.close()
            return
          }
          const payload: Record<string, unknown> = { optionId }
          if (input) payload.input = input
          userMessage = `Tool request_user_input result: ${JSON.stringify(payload)}`
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
            resolvedOrgId = task.case.orgId
            resolvedUserId = task.case.userId

            const resumeTmpl =
              (await loadAgentConfig(resolvedOrgId)).resumePrompt || HARNESS_DEFAULT_RESUME_PROMPT_APPEND
            const parts = ['[Human task resolved — operator closed the case]']
            if (task.verdict) parts.push(`Operator verdict: ${task.verdict.replace(/_/g, ' ')}`)
            if (task.expectedEta) parts.push(`Expected resolution time: ${task.expectedEta}`)
            if (task.notes) parts.push(`Internal notes (do NOT share verbatim with customer): ${task.notes}`)
            parts.push(resumeTmpl)
            userMessage = parts.join('\n')

            console.log(`[Intera] Resuming case ${resolvedCaseId} after human resolution`)

            // Auto-resolve the case when the human operator closes it.
            // This prevents the agent from staying in investigating stage and
            // ensures subsequent user messages start a fresh conversation.
            // (caseStatus is injected from Case.status at line 718 — no
            // separate CaseMemory column needed.)
            if (isTerminalVerdict(task.verdict)) {
              await prisma.case.update({
                where: { id: resolvedCaseId },
                data: { status: 'resolved' },
              }).catch((err) => { console.error('[Intera] Failed to auto-resolve case:', err) })
            }
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

        // ── System prompts (Core + Case) ──
        // Core prompt — used when no case is active (discovery mode).
        // Case prompt — used when a case exists (stage-driven execution).
        let coreSystemPrompt: string = CORE_SYSTEM_PROMPT
        let systemPrompt: string = CASE_SYSTEM_PROMPT

        // Stream progress immediately so the user sees movement (CC pattern)
        sendEvent({ type: 'stream_request_start', data: null, timestamp: new Date().toISOString() })

        // ── Hub: route message to the correct active case ──
        // When multiple cases are active in a single chat window (no tabs),
        // the Hub decides which case receives this message.
        if (
          userMessage &&
          !resumeTrigger &&
          !formResult &&
          !bootstrapNewCase &&
          !interactionResult &&
          !clientCaseIsNew
        ) {
          try {
            const activeCases = await prisma.case.findMany({
              where: {
                orgId: resolvedOrgId,
                userId: resolvedUserId,
                status: { notIn: ['resolved'] },
              },
              orderBy: { updatedAt: 'desc' },
            })

            if (activeCases.length === 1) {
              resolvedCaseId = activeCases[0].id
            } else if (activeCases.length > 1) {
              // Check for pending interactions first
              const pendingTask = await prisma.humanTask.findFirst({
                where: {
                  caseId: { in: activeCases.map((c) => c.id) },
                  status: 'pending',
                },
                orderBy: { createdAt: 'desc' },
              })
              if (pendingTask) {
                resolvedCaseId = pendingTask.caseId
              } else {
                // LLM-based intent routing: classify the message to the right case
                resolvedCaseId = await resolveCaseByIntent(
                  userMessage,
                  activeCases,
                  resolvedCaseId,
                )
              }
            }
          } catch (err) { console.error('[Intera] Hub routing failed:', err) }
        }

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
              where: { orgId_type: { orgId: resolvedOrgId, type: bodyCaseType } },
            })
            const newCase = await prisma.case.create({
              data: {
                orgId: resolvedOrgId,
                userId: resolvedUserId,
                type: bodyCaseType,
                status: 'created',
                chatId,
              },
            })
            resolvedCaseId = newCase.id
            createdCaseForIntent = true

            // Rewrite userMessage to scope the agent to the single selected case type.
            // The agent sees the selected case type and the original details.
            userMessage =
              `[Intent selected: ${bodyCaseType}] ` +
              `The customer already chose "${bodyCaseType}" from the intent card. ` +
              `Handle ONLY this case type. ` +
              `Original message: "${userMessage}"`

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
          systemPrompt += `\n\n[Manual Case Type]: The user has already selected case type "${bodyCaseType}" from the intent clarification card. The user already made their choice. Proceed directly with this case type. If the original message mentions other issues, ignore them unless the customer brings them up again.`
        }

        // Chat UI binds SSE events to lane.caseId via case_created.
        if (!resumeTrigger && !formResult && !createdCaseForIntent && resolvedCaseId && !emittedCaseCreated.has(resolvedCaseId)) {
          const inferredType =
            (bodyCaseType && isInvestigableCaseType(bodyCaseType) ? bodyCaseType : undefined)
          if (inferredType) {
            try {
              const ctRow = await prisma.caseType.findUnique({
                where: {
                  orgId_type: {
                    orgId: resolvedOrgId,
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
            } catch (err) {
              console.error('[Intera] Failed to lookup case type for emit:', err)
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
                where: { orgId_type: { orgId: resolvedOrgId, type: existingCase.type } },
              })
              if (caseType) {
                caseSchema = schemaFromCaseTypeRow(caseType)
              }
            } catch (err) { console.error('[Intera] Failed to load caseType schema:', err) }

            // Auto-resume: if case is waiting for human and task was resolved, inject verdict
            if (existingCase.status === 'waiting_human' && !resumeTrigger && !formResult && message) {
              try {
                const resolvedTask = await prisma.humanTask.findFirst({
                  where: { caseId: resolvedCaseId, status: 'resolved', notifiedAt: null },
                  orderBy: { resolvedAt: 'desc' },
                })
                if (resolvedTask) {
                  const resumeTmpl = (await loadAgentConfig(resolvedOrgId)).resumePrompt || HARNESS_DEFAULT_RESUME_PROMPT_APPEND
                  const parts = ['[Human task resolved — operator reviewed your case]']
                  if (resolvedTask.verdict) parts.push(`Operator verdict: ${resolvedTask.verdict.replace(/_/g, ' ')}`)
                  if (resolvedTask.notes) parts.push(`Internal notes: ${resolvedTask.notes}`)
                  parts.push(resumeTmpl)
                  userMessage = parts.join('\n') + '\n\nCustomer also said: ' + message

                  // Mark task as notified so it doesn't replay on every message
                  await prisma.humanTask.update({
                    where: { id: resolvedTask.id },
                    data: { notifiedAt: new Date() },
                  }).catch((err) => { console.error('[Intera] Failed to mark humanTask notifiedAt:', err) })

                  // When the human resolves the case, auto-transition to resolved stage
                  // so the agent can relay the verdict and call finalize_case without
                  // getting stuck in the investigating stage.
                  if (isTerminalVerdict(resolvedTask.verdict)) {
                    await prisma.case.update({
                      where: { id: resolvedCaseId },
                      data: { status: 'resolved' },
                    }).catch((err) => { console.error('[Intera] Failed to auto-resolve case:', err) })
                  }
                }
              } catch (err) { console.error('[Intera] Auto-resume humanTask lookup failed:', err) }
            }

            if (existingCase.memory) {
              existingMemory = existingCase.memory

              if (existingCase.memory.summary) {
                systemPrompt += `\n\n## Case Session Memory\n${existingCase.memory.summary}`
              }
            }
          }
        } catch (err) {
          console.error('[Intera] Failed to load case/memory from DB:', err)
        }

        // FK: traces/messages reference Case.caseId — rows must exist before AgentLoop writes ActionTrace/Message.
        const inferredCaseTypeForRecord =
          caseSchema?.type ??
          bodyCaseType ??
          'general'

        try {
          await prisma.case.upsert({
            where: { id: resolvedCaseId },
            update: {},
            create: {
              id: resolvedCaseId,
              orgId: resolvedOrgId,
              userId: resolvedUserId,
              type: inferredCaseTypeForRecord,
              status: 'created',
              chatId,
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
                orgId_type: {
                  orgId: resolvedOrgId,
                  type: inferredCaseTypeForRecord,
                },
              },
            })
            if (ctRow) {
              caseSchema = schemaFromCaseTypeRow(ctRow)
            }
          } catch (err) {
            console.error('[Intera] Failed to load caseType for first-touch lane:', err)
          }
        }

        // ── Resolve prompt placeholders with live Console config ──
        const existingMemoryData = existingMemory as Record<string, unknown> | null
        const resolvedCaseState = existingMemoryData ? {
          confirmedFacts: (parseMemoryJson(existingMemoryData.confirmedFacts as string) as Record<string, unknown>) || {},
          skillsCalled: (parseMemoryJson(existingMemoryData.skillsCalled as string) as string[]) || [],
          missingFacts: (parseMemoryJson(existingMemoryData.missingFacts as string) as string[]) || [],
        } : undefined

        // Merge form answers into confirmed facts so the system prompt reflects
        // structured form data — prevents stale DB-only facts from misleading the agent.
        if (resolvedCaseState && formAnswers) {
          for (const [key, value] of Object.entries(formAnswers)) {
            if (value && value.trim()) {
              resolvedCaseState.confirmedFacts[key] = value.trim()
              resolvedCaseState.missingFacts = resolvedCaseState.missingFacts.filter((f) => f !== key)
            }
          }
        }

        const agentConfig = await loadAgentConfig(resolvedOrgId)

        // Use DB-custom systemPrompt as Case prompt base if configured
        if (agentConfig.systemPrompt && agentConfig.systemPrompt !== DEFAULT_SYSTEM_PROMPT) {
          systemPrompt = agentConfig.systemPrompt
        }

        // Use DB-custom coreSystemPrompt as Core/discovery prompt if configured
        // (editable in Console; falls back to the CORE_SYSTEM_PROMPT default when empty).
        if (agentConfig.coreSystemPrompt && agentConfig.coreSystemPrompt.trim()) {
          coreSystemPrompt = agentConfig.coreSystemPrompt
        }

        // Load tool summaries for {{available_tools}} template var
        const toolSummaries: Array<{ name: string; description: string; needsMemberId: boolean }> = []
        try {
          const dbSkills = await prisma.skill.findMany({
            where: { orgId: resolvedOrgId, enabled: true },
            select: { name: true, description: true, inputSchema: true, mode: true },
          })
          for (const s of dbSkills) {
            const schema = s.inputSchema ? JSON.parse(s.inputSchema) : {}
            const needsMemberId = !!schema.properties?.member_id
            toolSummaries.push({ name: s.name, description: s.description, needsMemberId })
          }
          const kbSources = await prisma.knowledgeSource.findMany({
            where: { orgId: resolvedOrgId, enabled: true },
            select: { name: true, description: true },
          })
          for (const ks of kbSources) {
            toolSummaries.push({
              name: `kb_search_${ks.name.replace(/[^a-zA-Z0-9_-]/g, '_')}`,
              description: ks.description || `Search the ${ks.name} knowledge base`,
              needsMemberId: false,
            })
          }
          // Include built-in skills not in DB
          const { BUILT_IN_SKILLS } = await import('@/lib/agent/skills')
          for (const s of BUILT_IN_SKILLS) {
            if (!toolSummaries.find(t => t.name === s.name)) {
              toolSummaries.push({ name: s.name, description: s.description, needsMemberId: false })
            }
          }
        } catch { /* DB unavailable, prompt just won't list tools */ }

        // Build shared prompt context
        const promptCtx = await buildPromptContext({
          orgId: resolvedOrgId,
          caseSchema: caseSchema ? {
            displayName: caseSchema.displayName,
            goal: caseSchema.defaultGoal,
            stages: caseSchema.stages,
            requiredFacts: caseSchema.requiredFacts,
            escalateOn: caseSchema.escalateOn,
          } : undefined,
          caseState: resolvedCaseState,
          sessionBinding: { userId: resolvedUserId, userLabel: userLabel || undefined },
          available_tools: toolSummaries,
        })

        // Resolve both prompts — Core (discovery) and Case (execution)
        coreSystemPrompt = resolvePrompt(coreSystemPrompt, promptCtx)
        systemPrompt = resolvePrompt(systemPrompt, promptCtx)

        // ── Concurrency guard: if an AgentLoop is already running for this caseId,
        //     enqueue the message and return 202 — don't create a second loop.
        if (hasSession(resolvedCaseId)) {
          enqueueMessageOrCreate(resolvedCaseId, { content: userMessage, contentBlocks, formAnswers })
          sendEvent({
            type: 'withheld',
            data: 'Message queued — agent is currently processing',
            timestamp: new Date().toISOString(),
          })
          sendEvent({
            type: 'message_stop',
            data: { reason: 'queued' },
            timestamp: new Date().toISOString(),
          })
          controller.close()
          return
        }

        // Register the session so subsequent requests for this caseId are queued.
        const activeSession = getOrCreateSession(resolvedCaseId)
        activeSession.resolved = false
        activeSession.aborted = false
        activeSession.lastActiveAt = Date.now()

        const agentLoop = await AgentLoop.create({
          config: agentConfig,
          caseId: resolvedCaseId,
          orgId: resolvedOrgId,
          userId: resolvedUserId,
          systemPrompt,
          coreSystemPrompt,
          caseSchema,
          chatId,
          bootstrapNewCase,
        })

        // Restore memory from DB into the in-memory manager
        if (existingMemory) {
          const memData = { ...(existingMemory as Record<string, unknown>) }
          // Inject caseStatus from the Case table so StageExecutor.getCurrentStage() works
          try {
            const c = await prisma.case.findUnique({ where: { id: resolvedCaseId } })
            if (c?.status) memData.caseStatus = c.status
          } catch (err) { console.error('[Intera] Failed to read case status:', err) }
          agentLoop.loadMemory(memData)
        }

        // Restore prior-turn messages so the agent has conversation context
        try {
          const priorMessages = await prisma.message.findMany({
            where: { caseId: resolvedCaseId },
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
        } catch (err) { console.error('[Intera] Failed to load prior messages:', err) }

        let result = await agentLoop.run(userMessage, sendEvent, formAnswers, contentBlocks)

        // P0-2: Drain queued messages that arrived during the run but after the last iteration's drain.
        // BUG-C: followup results must be persisted — capture the last run's result for DB writes.
        while (activeSession.queue.pendingCount > 0) {
          const next = activeSession.queue.dequeueNonBlocking()
          if (!next || next.content === '__SESSION_CLOSED__') break
          const followup = await AgentLoop.create({
            config: agentConfig,
            caseId: resolvedCaseId,
            orgId: resolvedOrgId,
            userId: resolvedUserId,
            systemPrompt,
            coreSystemPrompt,
            caseSchema,
            chatId,
            bootstrapNewCase: false,
          })
          // Re-load prior-turn messages for the follow-up loop
          try {
            const priorMsgs = await prisma.message.findMany({
              where: { caseId: resolvedCaseId },
              orderBy: { createdAt: 'asc' },
              take: 50,
            })
            if (priorMsgs.length > 0) {
              followup.loadMessages(priorMsgs.map((m) => ({
                id: m.id, role: m.role as 'user' | 'assistant',
                content: m.content,
                contentBlocks: (m as any).contentBlocks ?? undefined,
                createdAt: m.createdAt,
              })))
            }
          } catch (_) { /* non-critical */ }
          // Re-load memory from the master loop
          followup.loadMemory(agentLoop.getMemorySummary())
          result = await followup.run(next.content, sendEvent, next.formAnswers, next.contentBlocks)
          // Persist followup messages immediately so the next drain iteration sees them
          const followupMem = followup.getMemorySummary()
          if (result.messages.length > 0) {
            try {
              const caseTypeForUpsert = followup.getCaseType()
              await prisma.case.upsert({
                where: { id: resolvedCaseId },
                update: { status: result.caseStatus },
                create: {
                  id: resolvedCaseId, orgId: resolvedOrgId, userId: resolvedUserId,
                  type: caseTypeForUpsert, status: result.caseStatus, chatId,
                },
              })
              await prisma.chatMemory.upsert({
                where: { caseId: resolvedCaseId },
                update: {
                  confirmedFacts: JSON.stringify(followupMem.confirmedFacts),
                  missingFacts: JSON.stringify(followupMem.missingFacts),
                  skillsCalled: JSON.stringify(followupMem.skillsCalled),
                  skillResults: JSON.stringify(followupMem.skillResults),
                  keyEvents: JSON.stringify(followupMem.keyEvents),
                  summary: followupMem.summary || undefined,
                  todos: followupMem.todos ? JSON.stringify(followupMem.todos) : null,
                  agentTodos: followupMem.agentTodos ? JSON.stringify(followupMem.agentTodos) : null,
                  dashboardVersion: followupMem.dashboardVersion ?? 0,
                },
                create: {
                  caseId: resolvedCaseId,
                  confirmedFacts: JSON.stringify(followupMem.confirmedFacts),
                  missingFacts: JSON.stringify(followupMem.missingFacts),
                  skillsCalled: JSON.stringify(followupMem.skillsCalled),
                  skillResults: JSON.stringify(followupMem.skillResults),
                  keyEvents: JSON.stringify(followupMem.keyEvents),
                  summary: followupMem.summary || undefined,
                  todos: followupMem.todos ? JSON.stringify(followupMem.todos) : null,
                  agentTodos: followupMem.agentTodos ? JSON.stringify(followupMem.agentTodos) : null,
                  dashboardVersion: followupMem.dashboardVersion ?? 0,
                },
              })
              const msgsToPersist = result.messages
                .filter((m) => m.content?.trim() || m.role === 'user' || m.contentBlocks?.length)
                .map((m) => ({
                  id: m.id, caseId: resolvedCaseId, role: m.role,
                  content: m.content || '', contentBlocks: m.contentBlocks ?? undefined, isStreaming: false,
                }))
              if (msgsToPersist.length > 0) {
                await prisma.$transaction(
                  msgsToPersist.map((msg) =>
                    prisma.message.upsert({
                      where: { id: msg.id },
                      update: { content: msg.content, contentBlocks: msg.contentBlocks ?? undefined, isStreaming: false },
                      create: msg,
                    }),
                  ),
                )
              }
            } catch (e) {
              console.error('[Intera] Failed to persist followup result:', e)
            }
          }
          // Transfer memory back to master loop for subsequent drain iterations
          agentLoop.loadMemory(followupMem)
        }

        // Mark session as resolved so subsequent messages create a new loop.
        activeSession.resolved = true

        // ── Persist case memory — only if real work was done (not casual chat) ──
        const mem = agentLoop.getMemorySummary()
        const hasRealWork = mem.skillsCalled.length > 0 ||
          Object.keys(mem.confirmedFacts).length > 0 ||
          result.transition !== 'next_turn' ||
          (mem.summary && mem.summary.length > 0) ||
          (mem.caseStatus && mem.caseStatus !== 'created')
        if (hasRealWork) {
          try {
            // Read type from AgentLoop (may have been set by dispatch_case_agent tool mid-loop)
            const caseTypeForUpsert = agentLoop.getCaseType()
            await prisma.case.upsert({
              where: { id: resolvedCaseId },
              update: { status: result.caseStatus },
              create: {
                id: resolvedCaseId,
                orgId: resolvedOrgId,
                userId: resolvedUserId,
                type: caseTypeForUpsert,
                status: result.caseStatus,
                chatId,
              },
            })
            await prisma.chatMemory.upsert({
              where: { caseId: resolvedCaseId },
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
                caseId: resolvedCaseId,
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
            console.error('[Intera] Failed to persist case memory:', err)
          }
        }

        // ── Persist messages to DB (always, even for casual chat) ──
        try {
          const messagesToPersist = result.messages
            .filter((m) => m.content?.trim() || m.role === 'user' || m.contentBlocks?.length)
            .map((m) => ({
              id: m.id,
              caseId: resolvedCaseId,
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
          console.error('[Intera] Failed to persist messages:', err)
        }

        sendEvent({
          type: 'message_stop',
          data: { transition: result.transition, reason: result.reason },
          timestamp: new Date().toISOString(),
        })
      } catch (error) {
        console.error('Agent loop error:', error)
        try {
          sendEvent({
            type: 'error',
            data: error instanceof Error ? error.message : 'Unknown error',
            timestamp: new Date().toISOString(),
          })
        } catch { /* stream already closed */ }
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
