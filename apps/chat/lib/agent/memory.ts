// Intera Harness — Case Memory Manager
// Based on Claude Code's multi-tiered context compaction patterns:
//   - Token thresholds: warning (20K), compact (13K), blocking (3K)
//   - Session memory: running summary maintained across turns
//   - Structured compaction with <analysis>/<summary> format

import type { KeyEvent, CaseMemoryData } from '@intera/shared/types'

// ─── Token thresholds (CC-style) ────────────────────────────
const AUTOCOMPACT_BUFFER_TOKENS = 13000
const WARNING_THRESHOLD_TOKENS = 20000
const BLOCKING_BUFFER_TOKENS = 3000
const MAX_OUTPUT_TOKENS_RESERVED = 20000 // reserved for model output
const DEFAULT_CONTEXT_WINDOW = 200000

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
  private consecutiveCompactFailures = 0

  constructor(private caseId: string) {}

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
    if (/未到账|没到账|没收到|not received/i.test(message)) {
      this.confirmedFacts.userReportedNotReceived = true
    }
    this.keyEvents.push({
      at: new Date().toISOString(),
      text: `User: ${message.slice(0, 100)}`,
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
    const effectiveWindow = DEFAULT_CONTEXT_WINDOW - MAX_OUTPUT_TOKENS_RESERVED
    const tokensRemaining = effectiveWindow - estimatedMessageTokens
    const percentLeft = Math.max(0, (tokensRemaining / effectiveWindow) * 100)

    return {
      shouldCompact: tokensRemaining <= AUTOCOMPACT_BUFFER_TOKENS,
      isWarning: tokensRemaining <= WARNING_THRESHOLD_TOKENS,
      isBlocking: tokensRemaining <= BLOCKING_BUFFER_TOKENS,
      percentLeft,
      messagesToKeep: Math.max(4, Math.floor(messageCount * 0.4)), // keep 40%
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
      this.keyEvents.slice(-10).forEach((e) => parts.push(`- ${e.at}: ${e.text}`))
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
   * Returns estimated token count for the conversation so far.
   * Rough estimate: each key event ~20 tokens, each fact ~10 tokens, each skill ~30 tokens.
   */
  estimateTokens(): number {
    let tokens = 0
    tokens += this.keyEvents.length * 20
    tokens += Object.keys(this.confirmedFacts).length * 15
    tokens += this.skillsCalled.length * 30
    tokens += this.summary.length / 3 // rough: 3 chars ≈ 1 token
    return Math.max(100, tokens)
  }

  // ─── Record compaction in memory ─────────────────────────

  recordCompaction(): void {
    this.summary = this.buildCompactionSummary()
    // Keep only last 5 key events after compaction
    this.keyEvents = this.keyEvents.slice(-5)
  }

  recordCompactionFailure(): void {
    this.consecutiveCompactFailures++
  }

  resetCompactFailures(): void {
    this.consecutiveCompactFailures = 0
  }

  isCompactCircuitBroken(maxFailures = 3): boolean {
    return this.consecutiveCompactFailures >= maxFailures
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
