// Intera Harness — Case Memory Manager
// Based on Claude Code's multi-tiered context compaction patterns:
//   - Token thresholds: warning (20K), compact (13K), blocking (3K)
//   - Session memory: running summary maintained across turns
//   - Structured compaction with <analysis>/<summary> format

import type { KeyEvent, CaseMemoryData, MemoryStrategy } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'

export interface CompactionResult {
  shouldCompact: boolean
  isWarning: boolean
  isBlocking: boolean
  percentLeft: number
  messagesToKeep: number
}

export class CaseMemoryManager {
  private confirmedFacts: Record<string, unknown> = {}
  private missingFacts: string[] = []
  private skillsCalled: string[] = []
  private skillResults: Record<string, unknown> = {}
  private keyEvents: KeyEvent[] = []
  private summary: string = ''
  private lastCompactedAt: Date | null = null
  private consecutiveCompactFailures = 0
  private strategy: MemoryStrategy

  constructor(
    private caseId: string,
    strategy: MemoryStrategy,
  ) {
    this.strategy = { ...DEFAULT_MEMORY_STRATEGY, ...strategy }
  }

  // ─── DB load/restore ──────────────────────────────────────

  loadFromDb(data: {
    confirmedFacts?: unknown; missingFacts?: unknown; skillsCalled?: unknown
    skillResults?: unknown; keyEvents?: unknown; summary?: string | null
  }): void {
    try {
      const facts = typeof data.confirmedFacts === 'string' ? JSON.parse(data.confirmedFacts) : (data.confirmedFacts || {})
      const missing = typeof data.missingFacts === 'string' ? JSON.parse(data.missingFacts) : (data.missingFacts || [])
      const skills = typeof data.skillsCalled === 'string' ? JSON.parse(data.skillsCalled) : (data.skillsCalled || [])
      const results = typeof data.skillResults === 'string' ? JSON.parse(data.skillResults) : (data.skillResults || {})
      const events = typeof data.keyEvents === 'string' ? JSON.parse(data.keyEvents) : (data.keyEvents || [])

      if (facts && typeof facts === 'object') this.confirmedFacts = facts as Record<string, unknown>
      if (Array.isArray(missing)) this.missingFacts = missing
      if (Array.isArray(skills)) this.skillsCalled = skills
      if (results && typeof results === 'object') this.skillResults = results as Record<string, unknown>
      if (Array.isArray(events)) this.keyEvents = events
      if (data.summary) this.summary = data.summary
    } catch { /* ignore parse errors */ }
  }

  // ─── Fact ingestion ───────────────────────────────────────

  async ingestUserMessageFacts(message: string): Promise<void> {
    // Transaction ID pattern — configurable per customer
    try {
      const txnMatch = message.match(new RegExp(this.strategy.txnIdPattern, 'i'))
      if (txnMatch) {
        this.confirmedFacts.txnId = txnMatch[0]
        this.missingFacts = this.missingFacts.filter((f) => f !== 'txnId')
      }
    } catch { /* invalid regex, skip */ }

    // Amount pattern — configurable per currency
    try {
      const amountMatch = message.match(new RegExp(this.strategy.amountPattern, 'i'))
      if (amountMatch) {
        this.confirmedFacts.amount = parseFloat(amountMatch[1])
        if (amountMatch[2]) this.confirmedFacts.currency = amountMatch[2]
        this.missingFacts = this.missingFacts.filter((f) => f !== 'amount')
      }
    } catch { /* invalid regex, skip */ }

    // "Not received" keyword detection — configurable per language
    const keywords = this.strategy.notReceivedKeywords
    if (keywords.length > 0) {
      const pattern = new RegExp(keywords.join('|'), 'i')
      if (pattern.test(message)) {
        this.confirmedFacts.userReportedNotReceived = true
      }
    }

    this.keyEvents.push({
      at: new Date().toISOString(),
      text: `User: ${message.slice(0, this.strategy.keyEventMaxChars)}`,
      source: 'heuristic',
    })
  }

  // ─── Skill result tracking ────────────────────────────────

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
      if (result.delayed_batch) this.confirmedFacts.delayReason = result.reason
    }

    this.keyEvents.push({
      at: new Date().toISOString(),
      text: `Skill ${skillName} executed`,
      source: 'heuristic',
    })
    this.updateMissingFacts()
  }

  private updateMissingFacts(): void {
    this.missingFacts = this.missingFacts.filter((fact) => !this.confirmedFacts[fact])
  }

  // ─── CC-style token-based compaction assessment ────────────

  /**
   * Estimates the token count of the conversation and determines compaction need.
   * Uses CC's multi-tiered threshold approach:
   *   - Blocking: < BLOCKING_BUFFER (3K) — MUST compact
   *   - AutoCompact: < AUTOCOMPACT_BUFFER (13K) — should compact
   *   - Warning: < WARNING_THRESHOLD (20K) — notify user
   */
  assessCompaction(estimatedMessageTokens: number, messageCount: number): CompactionResult {
    const ctxWindow = this.strategy.contextWindow ?? 200000
    const outReserved = this.strategy.outputTokensReserved ?? 20000
    const effectiveWindow = Math.max(1, ctxWindow - outReserved)
    const tokensRemaining = effectiveWindow - estimatedMessageTokens
    let percentLeft = Math.max(0, (tokensRemaining / effectiveWindow) * 100)
    if (!Number.isFinite(percentLeft)) percentLeft = 0

    const isBlocking = tokensRemaining <= this.strategy.blockingThresholdTokens
    const shouldCompact = tokensRemaining <= this.strategy.autocompactThresholdTokens
    const isWarning = tokensRemaining <= this.strategy.warningThresholdTokens

    // enableContextCollapse=false → never signal compaction (messages are kept)
    const collapseEnabled = this.strategy.enableContextCollapse !== false

    return {
      shouldCompact: collapseEnabled ? shouldCompact : false,
      isWarning,
      isBlocking: collapseEnabled ? isBlocking : false,
      percentLeft,
      messagesToKeep: Math.max(4, Math.floor(messageCount * 0.4)),
    }
  }

  // ─── Session memory summary (CC-style) ───────────────────

  /**
   * Generates a structured summary of the conversation for compaction.
   * Follows CC's <analysis>/<summary> pattern.
   */
  buildCompactionSummary(): string {
    const parts: string[] = []

    parts.push('<summary>')
    parts.push(`Case ID: ${this.caseId}`)

    // Primary facts
    const facts = Object.entries(this.confirmedFacts)
    if (facts.length > 0) {
      parts.push('\n## Confirmed Facts')
      facts.forEach(([k, v]) => parts.push(`- ${k}: ${JSON.stringify(v)}`))
    }

    // Skills executed
    if (this.skillsCalled.length > 0) {
      parts.push('\n## Skills Executed')
      this.skillsCalled.forEach((s) => {
        parts.push(`- ${s}: ${JSON.stringify(this.skillResults[s] || 'N/A')}`)
      })
    }

    // Missing facts
    if (this.missingFacts.length > 0) {
      parts.push('\n## Still Missing')
      this.missingFacts.forEach((f) => parts.push(`- ${f}`))
    }

    // Key events
    if (this.keyEvents.length > 0) {
      parts.push('\n## Key Events')
      const maxEvents = Math.min(this.strategy.maxRecentTraces, 20)
      this.keyEvents.slice(-maxEvents).forEach((e) => parts.push(`- ${e.at}: ${e.text}`))
    }

    // Previous summary (if compacted before)
    if (this.summary) {
      parts.push('\n## Previous Summary')
      parts.push(this.summary)
    }

    parts.push('</summary>')
    return parts.join('\n')
  }

  /**
   * Returns estimated token count for memory metadata only.
   * The caller (loop.ts) adds message content tokens separately.
   * Rough estimate: 3 chars ≈ 1 token for Latin, 1.5 chars ≈ 1 token for CJK.
   */
  estimateTokens(messageContents: string[] = []): number {
    const s = this.strategy
    let tokens = 0
    tokens += this.keyEvents.length * s.tokensPerKeyEvent
    tokens += Object.keys(this.confirmedFacts).length * s.tokensPerFact
    tokens += this.skillsCalled.length * s.tokensPerSkill
    tokens += this.summary.length / s.latinCharPerToken
    for (const content of messageContents) {
      const cjkChars = (content.match(/[一-鿿]/g) || []).length
      const otherChars = content.length - cjkChars
      tokens += Math.ceil(cjkChars / s.cjkCharPerToken) + Math.ceil(otherChars / s.latinCharPerToken)
    }
    return Math.max(s.minTokenEstimate, tokens)
  }

  // ─── Record compaction in memory ─────────────────────────

  /** Returns the number of messages that should be KEPT after compaction. */
  compactionKeepCount(messagesTotal: number): number {
    return Math.max(
      this.strategy.compactionKeepMin,
      Math.floor(messagesTotal * this.strategy.compactionKeepRatio),
    )
  }

  recordCompaction(): string {
    this.summary = this.buildCompactionSummary()
    this.lastCompactedAt = new Date()
    this.keyEvents = this.keyEvents.slice(-(this.strategy.maxKeyEventsAfterCompact ?? 5))
    this.resetCompactFailures()
    return this.summary
  }

  getLastCompactedAt(): Date | null {
    return this.lastCompactedAt
  }

  recordCompactionFailure(): void {
    this.consecutiveCompactFailures++
  }

  resetCompactFailures(): void {
    this.consecutiveCompactFailures = 0
  }

  isCompactCircuitBroken(maxFailures?: number): boolean {
    const threshold = maxFailures ?? this.strategy.compactCircuitBreakerMaxFailures ?? 3
    return this.consecutiveCompactFailures >= threshold
  }

  hasSummary(): boolean {
    return this.summary.length > 0
  }

  setSummary(summary: string): void {
    this.summary = summary
    this.lastCompactedAt = new Date()
  }

  getStrategy(): MemoryStrategy {
    return { ...this.strategy }
  }

  // ─── Accessors ────────────────────────────────────────────

  getConfirmedFacts(): Record<string, unknown> { return { ...this.confirmedFacts } }
  getMissingFacts(): string[] { return [...this.missingFacts] }
  getSkillsCalled(): string[] { return [...this.skillsCalled] }
  getSkillResult(skillName: string): unknown { return this.skillResults[skillName] }
  getKeyEvents(): KeyEvent[] { return [...this.keyEvents] }
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

  setMissingFacts(facts: string[]): void { this.missingFacts = [...facts] }
}
