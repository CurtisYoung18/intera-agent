// Intera Harness - Case Memory Manager
// Based on Claude Code's context compaction patterns
//
// [MOCK] In-memory only. Production path:
//   - Load from CaseMemory table (Prisma) on init
//   - Persist every mutation immediately via Prisma
//   - LLM-based key event extraction (currently heuristic-only)

import type { KeyEvent, CaseMemoryData } from '@/types'

export class CaseMemoryManager {
  private confirmedFacts: Record<string, unknown> = {}
  private missingFacts: string[] = []
  private skillsCalled: string[] = []
  private skillResults: Record<string, unknown> = {}
  private keyEvents: KeyEvent[] = []
  private summary?: string

  constructor(private caseId: string) {}

  /**
   * Extract facts from user messages.
   * [MOCK] Heuristic regex extraction. Production uses LLM extraction
   * via keyEventExtractionPrompt from AgentConfig.memoryStrategy.
   */
  async ingestUserMessageFacts(message: string): Promise<void> {
    const txnIdMatch = message.match(/TX[Uu]?\d+/i)
    if (txnIdMatch) {
      this.confirmedFacts.txnId = txnIdMatch[0]
      this.missingFacts = this.missingFacts.filter((f) => f !== 'txnId')
    }

    const amountMatch = message.match(/(\d+)\s*元/)
    if (amountMatch) {
      this.confirmedFacts.amount = parseInt(amountMatch[1])
      this.missingFacts = this.missingFacts.filter((f) => f !== 'amount')
    }

    if (/未到账|没到账|没收到/.test(message)) {
      this.confirmedFacts.userReportedNotReceived = true
    }

    this.keyEvents.push({
      at: new Date().toISOString(),
      text: `User: ${message.slice(0, 100)}...`,
      source: 'heuristic',
    })
  }

  /**
   * Update memory when a skill returns a result.
   */
  async applySkillResult(skillName: string, output: unknown): Promise<void> {
    if (!this.skillsCalled.includes(skillName)) {
      this.skillsCalled.push(skillName)
    }

    this.skillResults[skillName] = output

    const result = output as Record<string, unknown>

    if (skillName === 'query_order_status' && result.status) {
      this.confirmedFacts.orderStatus = result.status
      if (result.amount) this.confirmedFacts.orderAmount = result.amount
      if (result.time) this.confirmedFacts.orderTime = result.time
    }

    if (skillName === 'query_payment_channel_status') {
      this.confirmedFacts.channelDelayedBatch = result.delayed_batch
      if (result.delayed_batch) {
        this.confirmedFacts.delayReason = result.reason
      }
    }

    this.keyEvents.push({
      at: new Date().toISOString(),
      text: `Skill ${skillName} executed`,
      source: 'heuristic',
    })

    this.updateMissingFacts()
  }

  private updateMissingFacts(): void {
    this.missingFacts = this.missingFacts.filter((fact) => {
      return !this.confirmedFacts[fact]
    })
  }

  getConfirmedFacts(): Record<string, unknown> {
    return { ...this.confirmedFacts }
  }

  getMissingFacts(): string[] {
    return [...this.missingFacts]
  }

  getSkillsCalled(): string[] {
    return [...this.skillsCalled]
  }

  getSkillResult(skillName: string): unknown {
    return this.skillResults[skillName]
  }

  getKeyEvents(): KeyEvent[] {
    return [...this.keyEvents]
  }

  getSummary(): CaseMemoryData {
    return {
      caseId: this.caseId,
      confirmedFacts: this.confirmedFacts,
      missingFacts: this.missingFacts,
      skillsCalled: this.skillsCalled,
      skillResults: this.skillResults,
      keyEvents: this.keyEvents,
      summary: this.summary,
    }
  }

  setMissingFacts(facts: string[]): void {
    this.missingFacts = [...facts]
  }

  setSummary(summary: string): void {
    this.summary = summary
  }
}
