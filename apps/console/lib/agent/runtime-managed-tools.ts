import { prisma } from '@intera/shared/prisma'
import type { AgentConfigData, CaseSchemaConfig, Message } from '@intera/shared/types'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'
import { recomputeProfileStats } from '@intera/shared/memory/recomputeStats'
import { ChatMemoryManager } from './memory'
import type { PersistencePort } from './persistence-port'
import type { TraceWriter } from './trace'
import type { ToolExecutionResult } from './streaming-tool-executor'
import { buildHumanHandoffQuestion } from './human-handoff'
import { latestUserText } from './customer-messages'
import { profileKey } from './identity'
import {
  appendRuntimeEvent,
  filterRuntimeAuthorityKeys,
  finalizeProcedureRun,
  latestInputEpoch,
  reconcileProcedureInput,
} from './session-store'

export interface PendingHumanTaskEscalation {
  taskId: string
  queue: string
  question: string
}

export interface RuntimeManagedToolResolverDeps {
  caseId: string
  orgId: string
  userId: string
  chatId?: string | null
  config: AgentConfigData
  caseSchema?: CaseSchemaConfig | null
  messages: Message[]
  chatMemory: ChatMemoryManager
  persistence: PersistencePort
  traceWriter: TraceWriter
  dryRun: boolean
  persistRuntimeMemory?: boolean
  canCreateHumanTaskInGeneralMode: boolean
}

export interface RuntimeManagedToolResolution {
  pendingHumanTaskEscalation: PendingHumanTaskEscalation | null
}

export class RuntimeManagedToolResolver {
  constructor(private deps: RuntimeManagedToolResolverDeps) {}

  async resolve(
    toolResults: ToolExecutionResult[],
    toolBasedOnEpoch: Map<string, number>,
    iterationBasedOnInputEpoch: number,
  ): Promise<RuntimeManagedToolResolution> {
    let pendingHumanTaskEscalation: PendingHumanTaskEscalation | null = null

    for (const result of toolResults) {
      const input = (result.toolUse?.input ?? {}) as Record<string, unknown>
      const basedOnInputEpoch = result.toolUse?.id
        ? toolBasedOnEpoch.get(result.toolUse.id) ?? iterationBasedOnInputEpoch
        : iterationBasedOnInputEpoch

      if (result.name === 'read_chat_memory') {
        this.replaceToolOutput(result, this.readChatMemoryToolOutput())
      }

      if (result.name === 'read_user_profile') {
        this.replaceToolOutput(result, await this.readUserProfileToolOutput())
      }

      if (result.name === 'remember') {
        this.replaceToolOutput(result, await this.rememberToolOutput(input))
      }

      if (result.name === 'get_current_time') {
        this.replaceToolOutput(result, this.currentTimeToolOutput())
      }

      if (result.name === 'reconcile_procedure_input') {
        const runId = String(input.runId || '')
        const upToInputEpoch = Number(input.upToInputEpoch)
        const decision = String(input.decision || '')
        const summary = String(input.summary || '')
        const reconcile = reconcileProcedureInput(this.deps.caseId, {
          runId,
          upToInputEpoch,
          decision,
          summary,
        })
        this.replaceToolOutput(result, reconcile.ok
          ? {
              ok: true,
              cleared: reconcile.cleared,
              runId,
              upToInputEpoch,
              latestInputEpoch: latestInputEpoch(this.deps.caseId),
              note: 'Reconcile is a runtime action only; no chat or user memory was written.',
            }
          : { ok: false, error: reconcile.error },
        )
      }

      if (result.name === 'finalize_procedure') {
        const final = finalizeProcedureRun(this.deps.caseId, {
          runId: typeof input.runId === 'string' ? input.runId : undefined,
          status: input.status === 'cancelled' ? 'cancelled' : 'completed',
          basedOnInputEpoch,
          summary: typeof input.conclusion === 'string' ? input.conclusion : undefined,
        })
        this.replaceToolOutput(result, final.ok
          ? {
              ok: true,
              status: final.run?.status ?? 'completed',
              runId: final.run?.runId,
              procedureId: final.run?.procedureId,
              conclusion: input.conclusion,
              basis: input.basis,
            }
          : {
              ok: false,
              error: final.error ?? 'Unable to finalize ProcedureRun.',
              stale: final.stale,
              latestInputEpoch: latestInputEpoch(this.deps.caseId),
            },
          !final.ok,
        )
      }

      if (result.name === 'create_human_task' && this.deps.canCreateHumanTaskInGeneralMode) {
        pendingHumanTaskEscalation = await this.resolveGeneralHumanTask(result, input)
      }
    }

    return { pendingHumanTaskEscalation }
  }

  private async resolveGeneralHumanTask(
    result: ToolExecutionResult,
    input: Record<string, unknown>,
  ): Promise<PendingHumanTaskEscalation | null> {
    const queue = String(input.queue || 'general')
    const question = buildHumanHandoffQuestion({
      baseQuestion: String(input.question || 'Human task requested'),
      caseType: this.deps.caseSchema?.type,
      latestCustomerMessage: latestUserText(this.deps.messages),
      contextMap: this.deps.chatMemory.getContextMap(),
    })
    const taskFields = Array.isArray(input.fields) ? input.fields : undefined
    const resolvedCaseType = this.deps.caseSchema?.type || 'general'

    try {
      await this.deps.persistence.ensureCase({
        id: this.deps.caseId,
        orgId: this.deps.orgId,
        userId: this.deps.userId,
        type: resolvedCaseType,
        status: 'waiting_human',
        blocker: `Waiting for ${queue}`,
        chatId: this.deps.chatId ?? this.deps.caseId,
      })
      this.deps.chatMemory.setCaseStatus('waiting_human')
      await this.deps.persistence.saveMemory(this.deps.caseId, {
        caseId: this.deps.caseId,
        ...this.deps.chatMemory.getDbFields(),
        humanTaskStatus: 'pending',
      })
      const task = await this.deps.persistence.createHumanTask({
        caseId: this.deps.caseId,
        queue,
        question,
        fields: taskFields && taskFields.length > 0 ? JSON.stringify(taskFields) : null,
        status: 'pending',
      })
      await this.deps.traceWriter.writeHumanTaskCreated(task.id, queue)
      this.replaceToolOutput(result, { taskId: task.id, queue, status: 'pending', persisted: true })
      return { taskId: task.id, queue, question }
    } catch (error) {
      console.error('[AgentLoop] Failed to persist create_human_task in general mode:', error)
      this.replaceToolOutput(result, {
        error: 'Unable to create the human task. Please retry or contact support.',
      }, true)
      return null
    }
  }

  private replaceToolOutput(result: ToolExecutionResult, payload: unknown, isError = false): void {
    const output = {
      ok: !isError,
      output: payload,
      error: isError && isRecord(payload) && typeof payload.error === 'string' ? payload.error : undefined,
      latencyMs: result.latencyMs,
    }
    result.output = output
    if (result.toolUse) {
      result.toolUse.result = output
      result.toolUse.status = isError ? 'error' : 'completed'
    }
  }

  private readChatMemoryToolOutput(): Record<string, unknown> {
    const summary = this.deps.chatMemory.getSummary()
    return {
      scope: 'chat',
      authority: 'context_only_not_procedure_run_state',
      toolsCalled: summary.toolsCalled,
      keyEvents: summary.keyEvents.slice(-20),
      compactSummary: summary.summary || '',
      openItems: (summary.todos ?? []).filter((todo) => todo.status !== 'completed' && todo.status !== 'cancelled'),
      stats: {
        missingFacts: summary.missingFacts,
        toolCount: summary.toolsCalled.length,
        keyEventCount: summary.keyEvents.length,
      },
    }
  }

  private async readUserProfileToolOutput(): Promise<Record<string, unknown>> {
    const key = profileKey(this.deps.userId, this.deps.chatId)
    if (!key || !this.shouldPersistRuntimeMemory()) {
      return {
        scope: 'user',
        authority: 'long_term_profile_not_procedure_run_state',
        profile: '',
        sections: {},
        stats: {},
      }
    }
    const row = await prisma.userProfile.findUnique({
      where: { orgId_userId: { orgId: this.deps.orgId, userId: key } },
      select: {
        profile: true,
        sections: true,
        totalChats: true,
        totalCases: true,
        resolvedCases: true,
        escalatedCases: true,
        lastCaseType: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
    }).catch(() => null)
    return {
      scope: 'user',
      authority: 'long_term_profile_not_procedure_run_state',
      profile: row?.profile ?? '',
      sections: safeJson(row?.sections, {}),
      stats: row
        ? {
            totalChats: row.totalChats,
            totalCases: row.totalCases,
            resolvedCases: row.resolvedCases,
            escalatedCases: row.escalatedCases,
            lastCaseType: row.lastCaseType,
            firstSeenAt: row.firstSeenAt,
            lastSeenAt: row.lastSeenAt,
          }
        : {},
    }
  }

  private async rememberToolOutput(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const scope = input.scope === 'user' ? 'user' : 'chat'
    const rawFacts = isRecord(input.facts) ? input.facts : {}
    const key = typeof input.key === 'string' ? input.key : undefined
    const value = input.value
    const candidateFacts = key ? { ...rawFacts, [key]: value } : rawFacts
    const filteredFacts = filterRuntimeAuthorityKeys(candidateFacts)
    const rejectedKeys = Object.keys(candidateFacts).filter((candidateKey) => !(candidateKey in filteredFacts))
    const reason = String(input.reason || 'No reason supplied.')

    if (scope === 'chat') {
      appendRuntimeEvent(this.deps.caseId, {
        origin: 'system',
        source: 'remember',
        summary: `remember(scope="chat") rejected: ${reason}`,
        metadata: {
          attemptedKeys: Object.keys(filteredFacts),
          rejectedKeys,
          memoryScope: 'chat',
          status: 'rejected',
        },
      })
      return {
        ok: false,
        scope: 'chat',
        writtenKeys: [],
        rejectedKeys: [...rejectedKeys, ...Object.keys(filteredFacts)],
        error: 'Chat-scoped fact writes are no longer supported. Use runtime evidence, form results, tool results, or UserProfile instead.',
        authority: 'read_only_context',
      }
    }

    const profileKeyValue = profileKey(this.deps.userId, this.deps.chatId)
    if (!profileKeyValue) {
      return { ok: false, scope: 'user', error: 'No stable user/chat identity is available for UserProfile writes.', rejectedKeys }
    }

    const bullets = Object.entries(filteredFacts).map(([factKey, factValue]) => `- ${factKey}: ${JSON.stringify(factValue)}`)
    if (bullets.length === 0 && typeof value === 'string' && !key) {
      bullets.push(`- ${value}`)
    }
    const incoming = ['# User Profile', '', '## Activity', ...bullets, `- Memory reason: ${reason}`].join('\n')
    if (this.shouldPersistRuntimeMemory()) {
      const existing = await prisma.userProfile.findUnique({
        where: { orgId_userId: { orgId: this.deps.orgId, userId: profileKeyValue } },
        select: { profile: true },
      }).catch(() => null)
      const maxTokens = this.deps.config.memoryStrategy.chatMemoryMaxTokens ?? 4000
      const merged = mergeProfile(existing?.profile ?? '', incoming, maxTokens)
      const stats = await recomputeProfileStats(prisma, profileKeyValue, this.deps.orgId)
      await prisma.userProfile.upsert({
        where: { orgId_userId: { orgId: this.deps.orgId, userId: profileKeyValue } },
        create: { userId: profileKeyValue, orgId: this.deps.orgId, profile: merged.profile, sections: merged.sections, ...stats },
        update: { profile: merged.profile, sections: merged.sections, ...stats },
      }).catch((err: unknown) => {
        console.warn('[AgentLoop] remember(scope="user") failed:', err)
      })
    }
    appendRuntimeEvent(this.deps.caseId, {
      origin: 'system',
      source: 'remember',
      summary: `remember(scope="user"): ${reason}`,
      metadata: { writtenKeys: Object.keys(filteredFacts), rejectedKeys, memoryScope: 'user' },
    })
    return {
      ok: true,
      scope: 'user',
      writtenKeys: Object.keys(filteredFacts),
      rejectedKeys,
      readsFrom: 'read_user_profile',
      authority: 'memory_context_only',
    }
  }

  private currentTimeToolOutput(): Record<string, unknown> {
    const now = new Date()
    const timeZone = 'Asia/Shanghai'
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      weekday: 'long',
    }).formatToParts(now)
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
    const localDate = `${get('year')}-${get('month')}-${get('day')}`
    const localTime = `${get('hour')}:${get('minute')}:${get('second')}`
    return {
      utcTime: now.toISOString(),
      timeZone,
      localDate,
      localTime,
      localDateTime: `${localDate} ${localTime}`,
      dayOfWeek: get('weekday'),
    }
  }

  private shouldPersistRuntimeMemory(): boolean {
    return !this.deps.dryRun || this.deps.persistRuntimeMemory === true
  }
}

export function shouldPersistToolResultToChatMemory(toolName: string): boolean {
  return ![
    'start_procedure',
    'reconcile_procedure_input',
    'finalize_procedure',
    'remember',
    'read_chat_memory',
    'read_user_profile',
    'get_current_time',
  ].includes(toolName)
}

export function shouldRecordProcedureEvidence(toolName: string): boolean {
  return ![
    'start_procedure',
    'reconcile_procedure_input',
    'remember',
    'read_chat_memory',
    'read_user_profile',
    'get_current_time',
  ].includes(toolName)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function safeJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return value ?? fallback
  try { return JSON.parse(value) } catch { return fallback }
}
