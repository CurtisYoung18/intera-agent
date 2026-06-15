import { prisma } from '@intera/shared/prisma'
import type { AgentConfigData, Message } from '@intera/shared/types'
import { mergeProfile } from '@intera/shared/memory/mergeProfile'
import { recomputeProfileStats } from '@intera/shared/memory/recomputeStats'
import { ChatMemoryManager } from './memory'
import { microCompact } from './microCompact'
import { trySessionMemoryCompact } from './sessionMemoryCompact'
import { compactConversation } from './compact'
import { profileKey } from './identity'
import type { PersistencePort } from './persistence-port'
import { selectProviderMessageWindow } from './provider-transcript'
import type { Profiler } from './profiler'
import type { TraceWriter } from './trace'
import { getActiveProcedureRun } from './session-store'

export interface RuntimeMemoryLifecycleDeps {
  config: AgentConfigData
  caseId: string
  orgId: string
  userId: string
  chatId?: string | null
  dryRun: boolean
  persistRuntimeMemory?: boolean
  chatMemory: ChatMemoryManager
  persistence: PersistencePort
  traceWriter: TraceWriter
  profiler: Profiler
  getMessages: () => Message[]
  setMessages: (messages: Message[]) => void
  getUserMessagesSinceLastCompact: () => number
  setUserMessagesSinceLastCompact: (count: number) => void
}

export class RuntimeMemoryLifecycle {
  constructor(private deps: RuntimeMemoryLifecycleDeps) {}

  async checkAndCompact(): Promise<{
    shouldCompact: boolean
    reason?: string
  }> {
    if (!this.deps.config.memoryStrategy.enableAutocompact) {
      return { shouldCompact: false }
    }

    if (this.deps.config.memoryStrategy.enableMicrocompact !== false) {
      const ms = this.deps.config.memoryStrategy
      const minAge = ms.microcompactMinAgeMs ?? 60000
      const mcResult = microCompact(this.deps.getMessages(), ms.compactableTools, ms.toolResultTokenRatio, minAge)
      if (mcResult.clearedCount > 0) {
        this.deps.setMessages(mcResult.messages)
        await this.deps.traceWriter.write('microcompact', 'Cleared tool results', {
          clearedCount: mcResult.clearedCount,
          tokensSaved: mcResult.tokensSaved,
        })
      }
    }

    if (this.deps.chatMemory.hasSummary()) {
      const smResult = trySessionMemoryCompact(
        this.deps.chatMemory.getSummary().summary,
        this.deps.chatMemory.getLastCompactedAt(),
        this.deps.config.memoryStrategy.sessionMemoryMaxAgeMs ?? 1800000,
      )
      if (smResult.used) {
        return { shouldCompact: false, reason: 'session_memory_still_fresh' }
      }
    }

    const everyN = this.deps.config.memoryStrategy.compactEveryNMessages
    const cadenceTriggered = everyN != null && everyN > 0 &&
      this.deps.getUserMessagesSinceLastCompact() >= everyN

    const messages = this.deps.getMessages()
    const messageContents = messages.map((m) => typeof m.content === 'string' ? m.content : '')
    const estimatedTokens = this.deps.chatMemory.estimateTokens(messageContents)
    const assessment = this.deps.chatMemory.assessCompaction(estimatedTokens, messages.length)

    if (cadenceTriggered) {
      return this.tryCompact('cadence', { messagesSinceLast: everyN, percentLeft: assessment.percentLeft })
    }

    if (assessment.isBlocking) {
      return this.tryCompact('blocking', { percentLeft: assessment.percentLeft })
    }

    if (assessment.shouldCompact) {
      return this.tryCompact('auto', { percentLeft: assessment.percentLeft })
    }

    if (assessment.isWarning) {
      console.warn(`[AgentLoop] Context: ${assessment.percentLeft.toFixed(0)}% remaining`)
    }

    return { shouldCompact: false }
  }

  async persistChatSession(): Promise<void> {
    if (!this.deps.chatId) return
    if (!this.shouldPersistRuntimeMemory()) return
    const activeRun = getActiveProcedureRun(this.deps.caseId)
    const persistedContextMap = activeRun?.definition?.version === 'v2'
      ? {}
      : this.deps.chatMemory.getContextMap()
    try {
      await prisma.chatSession.upsert({
        where: { orgId_chatId: { orgId: this.deps.orgId, chatId: this.deps.chatId } },
        update: {
          contextMap: JSON.stringify(persistedContextMap),
          keyEvents: JSON.stringify(this.deps.chatMemory.getSummary().keyEvents),
          summary: this.deps.chatMemory.getSummary().summary || undefined,
        },
        create: {
          chatId: this.deps.chatId,
          orgId: this.deps.orgId,
          contextMap: JSON.stringify(persistedContextMap),
          keyEvents: JSON.stringify(this.deps.chatMemory.getSummary().keyEvents),
          summary: this.deps.chatMemory.getSummary().summary || undefined,
        },
      })
    } catch (err) {
      console.warn('[AgentLoop] persistChatSession failed:', err)
    }
  }

  async compactUserProfile(): Promise<void> {
    if (!this.deps.config.memoryStrategy.enableChatMemory) return
    if (!this.shouldPersistRuntimeMemory()) return
    const key = profileKey(this.deps.userId, this.deps.chatId)
    if (!key) return
    try {
      const recentMessages = this.deps.getMessages().slice(-50)
      const result = await compactConversation(recentMessages, this.deps.config.memoryStrategy, { purpose: 'profile' })
      const summary = result.summary
      if (!summary) return

      const existing = await prisma.userProfile.findUnique({
        where: { orgId_userId: { orgId: this.deps.orgId, userId: key } },
        select: { profile: true },
      }).catch(() => null)
      const maxTokens = this.deps.config.memoryStrategy.chatMemoryMaxTokens ?? 4000
      const { profile: merged, sections } = mergeProfile(existing?.profile ?? '', summary, maxTokens)
      const stats = await recomputeProfileStats(prisma, key, this.deps.orgId)

      await prisma.userProfile.upsert({
        where: { orgId_userId: { orgId: this.deps.orgId, userId: key } },
        create: { userId: key, orgId: this.deps.orgId, profile: merged, sections, ...stats },
        update: { profile: merged, sections, ...stats },
      })
    } catch (err) {
      console.warn('[AgentLoop] compactUserProfile failed:', err)
    }
  }

  async persistChatMemory(): Promise<void> {
    if (!this.shouldPersistRuntimeMemory()) return
    try {
      await this.deps.persistence.saveMemory(this.deps.caseId, {
        caseId: this.deps.caseId,
        ...this.deps.chatMemory.getDbFields(),
      })
    } catch (err) {
      console.warn('[AgentLoop] persistChatMemory failed:', err)
    }
  }

  shouldPersistRuntimeMemory(): boolean {
    return !this.deps.dryRun || this.deps.persistRuntimeMemory === true
  }

  private async tryCompact(
    reason: 'cadence' | 'blocking' | 'auto',
    metadata: Record<string, unknown>,
  ): Promise<{ shouldCompact: boolean; reason?: string }> {
    if (this.deps.chatMemory.isCompactCircuitBroken()) {
      return { shouldCompact: false, reason: 'circuit_breaker' }
    }
    try {
      await this.performCompaction()
      const messages = this.deps.getMessages()
      const keepCount = this.deps.chatMemory.compactionKeepCount(messages.length)
      if (this.deps.config.memoryStrategy.enableSnip !== false) {
        this.deps.setMessages(selectProviderMessageWindow(messages, keepCount))
      }
      this.deps.setUserMessagesSinceLastCompact(0)
      await this.deps.traceWriter.write('loop_decision', 'Compacted', {
        reason,
        kept: keepCount,
        ...metadata,
      })
      return { shouldCompact: true, reason }
    } catch {
      this.deps.chatMemory.recordCompactionFailure()
      return { shouldCompact: false, reason: 'failed' }
    }
  }

  private async performCompaction(): Promise<void> {
    this.deps.profiler.incrementCompaction()
    const strategy = this.deps.config.memoryStrategy

    try {
      const result = await compactConversation(this.deps.getMessages(), strategy, { purpose: 'case' })
      if (result.summary) {
        this.deps.chatMemory.setSummary(result.summary)
        await this.deps.traceWriter.write('loop_decision', 'LLM Compact', {
          model: result.model,
          provider: result.provider,
          tokensUsed: result.tokensUsed,
        })
        return
      }
      console.warn('[AgentLoop] LLM compact returned empty summary, falling back to programmatic')
    } catch (err) {
      console.warn('[AgentLoop] LLM compact failed, falling back to programmatic:', err)
    }

    this.deps.chatMemory.recordCompaction()
  }
}
