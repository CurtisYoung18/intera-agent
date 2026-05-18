// Intera Harness — Case Memory Manager
// Based on Claude Code's multi-tiered context compaction patterns:
//   - Token thresholds: warning (20K), compact (13K), blocking (3K)
//   - Session memory: running summary maintained across turns
//   - Structured compaction with <analysis>/<summary> format

import type { KeyEvent, CaseMemoryData, MemoryStrategy } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import Anthropic from '@anthropic-ai/sdk'

/** Persisted in skillResults — avoids duplicate background sub-agent dispatch across HTTP turns. */
export const SUB_AGENT_DISPATCH_MARKER_KEY = '__intera_sub_agent_dispatch'

/** Maps workflow stage → sorted agent roster signature for which dispatch already ran. */
export interface SubAgentDispatchMarker {
  stages: Record<string, string>
}

function signatureForAgentNames(names: string[]): string {
  return [...names].filter(Boolean).sort().join('|')
}

function normalizeDispatchMarker(raw: unknown): SubAgentDispatchMarker {
  if (!raw || typeof raw !== 'object') return { stages: {} }
  const o = raw as Record<string, unknown>
  if (o.stages && typeof o.stages === 'object' && !Array.isArray(o.stages)) {
    return { stages: { ...(o.stages as Record<string, string>) } }
  }
  // Legacy single-stage shape from earlier drafts
  if (typeof o.stage === 'string' && typeof o.agentsSignature === 'string') {
    return { stages: { [o.stage]: o.agentsSignature } }
  }
  return { stages: {} }
}

/** Extract a JSON object from LLM output that may be wrapped in markdown code fences. */
function extractJsonFromLlmOutput(text: string): Record<string, unknown> | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const jsonStr = fenceMatch ? fenceMatch[1].trim() : text
  const match = jsonStr.match(/\{[\s\S]*\}/)
  if (!match) return null
  try { return JSON.parse(match[0]) } catch { return null }
}

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
  private caseStatus: string | undefined = undefined
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
    caseStatus?: string | null
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
      if (data.caseStatus) this.caseStatus = data.caseStatus
    } catch { /* ignore parse errors */ }
  }

  /** Align in-memory status with AgentLoop mid-request stage transitions (persisted on HTTP return). */
  setCaseStatus(status: string): void {
    this.caseStatus = status
  }

  // ─── Fact ingestion ───────────────────────────────────────

  /** Directly ingest structured form answers as confirmed facts — no LLM needed.
   *  Follows CC's AskUserQuestion pattern: answers are already keyed by the model. */
  ingestFormAnswers(answers: Record<string, string>): void {
    for (const [key, value] of Object.entries(answers)) {
      if (value && value.trim()) {
        this.confirmedFacts[key] = value.trim()
        this.missingFacts = this.missingFacts.filter((f) => f !== key)
      }
    }
  }

  private getExtractionClient(): Anthropic {
    return new Anthropic({
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    })
  }

  /**
   * Extract structured facts from a user message using LLM.
   * Replaces the old regex-based extraction (txnIdPattern, amountPattern, notReceivedKeywords).
   * Fact names are derived from the case type's requiredFacts when available.
   */
  async ingestUserMessageFacts(message: string, requiredFacts?: string[]): Promise<void> {
    const targetFacts = requiredFacts?.length ? requiredFacts : ['txnId', 'amount', 'paymentMethod', 'date']
    const extraHint = this.strategy.factExtractionPrompt || ''

    const systemPrompt = [
      'You are a fact extraction engine. Extract structured facts from customer support messages.',
      'Respond with a JSON object: {"extractedFacts": {}, "flags": []}',
      '',
      'Rules:',
      '- extractedFacts: map of fact_name → value. Only include facts you can confidently identify in the message.',
      '- flags: array of detected sentiment/circumstance labels. Supported: "userReportedNotReceived", "userReportedPartialMissing", "urgent", "angry", "confused"',
      '- Values should be primitives (string, number, boolean), not nested objects.',
      '- Do NOT invent facts that are not stated in the message.',
      '- If the message contains transaction IDs, order numbers, or similar identifiers, extract them as txnId.',
      '- If amounts are mentioned (e.g. "500元", "$100", "1000块"), extract the numeric value as amount.',
      '- If the message starts with "[Form submitted]", parse each "key: value" line as a fact directly. Map aliases: channel/deposit_method/payment_method → paymentMethod, deposit_time/time → date.',
      '- If amounts are mentioned (e.g. "500元", "$100", "1000块"), extract the numeric value as amount.',
    ].join('\n')

    const userPrompt = [
      `Customer message: "${message}"`,
      `Target facts to look for: ${targetFacts.join(', ')}`,
      extraHint ? `Additional instructions: ${extraHint}` : '',
    ].filter(Boolean).join('\n')

    try {
      const client = this.getExtractionClient()
      const msg = await client.messages.create({
        model: process.env.FACT_EXTRACTION_MODEL || 'MiniMax-M2.7-highspeed',
        max_tokens: 256,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      })

      const text = (msg.content[0] as any)?.text || ''
      const parsed = extractJsonFromLlmOutput(text)
      if (parsed) {
        const facts = parsed.extractedFacts
        if (facts && typeof facts === 'object') {
          for (const [key, value] of Object.entries(facts)) {
            if (value !== null && value !== undefined && value !== '') {
              this.confirmedFacts[key] = value
              this.missingFacts = this.missingFacts.filter((f) => f !== key)
            }
          }
        }
        const flags: string[] = Array.isArray(parsed.flags) ? parsed.flags : []
        if (flags.includes('userReportedNotReceived')) {
          this.confirmedFacts.userReportedNotReceived = true
        }
        if (flags.includes('userReportedPartialMissing')) {
          this.confirmedFacts.userReportedPartialMissing = true
        }
      } else {
        console.warn('[CaseMemory] Could not parse JSON from extraction response:', text.slice(0, 200))
      }
    } catch (err) {
      console.warn('[CaseMemory] LLM fact extraction failed:', err)
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

    const result = (output && typeof output === 'object' && !Array.isArray(output))
      ? output as Record<string, unknown>
      : {}
    if (skillName === 'query_order_status' && result.status) {
      this.confirmedFacts.orderStatus = result.status
      if (result.amount) this.confirmedFacts.orderAmount = result.amount
      if (result.time) this.confirmedFacts.orderTime = result.time
    }
    if (skillName === 'query_payment_channel_status') {
      this.confirmedFacts.channelDelayedBatch = result.delayed_batch
      if (result.delayed_batch) this.confirmedFacts.delayReason = result.reason
    }
    if (skillName === 'query_account_status') {
      if (result.accountStatus !== undefined) this.confirmedFacts.accountStatus = result.accountStatus
      if (result.riskFlag !== undefined) this.confirmedFacts.accountRiskFlag = result.riskFlag
      if (result.banReason !== undefined) this.confirmedFacts.banReason = result.banReason
      if (result.restrictionTier !== undefined) this.confirmedFacts.restrictionTier = result.restrictionTier
    }
    if (skillName === 'read_case_history' && typeof result.total === 'number') {
      this.confirmedFacts.priorCaseCount = result.total
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
      caseStatus: this.caseStatus,
    }
  }

  setMissingFacts(facts: string[]): void { this.missingFacts = [...facts] }

  /** Whether sub-agents for this stage + agent roster were already dispatched for this case. */
  hasDispatchedSubAgentsFor(stage: string, agentNames: string[]): boolean {
    const raw = this.skillResults[SUB_AGENT_DISPATCH_MARKER_KEY]
    const marker = normalizeDispatchMarker(raw)
    const sig = signatureForAgentNames(agentNames)
    return marker.stages[stage] === sig
  }

  /** Record after a successful background dispatch (persisted via skillResults JSON). */
  recordSubAgentsDispatched(stage: string, agentNames: string[]): void {
    const prev = normalizeDispatchMarker(this.skillResults[SUB_AGENT_DISPATCH_MARKER_KEY])
    const marker: SubAgentDispatchMarker = {
      stages: { ...prev.stages, [stage]: signatureForAgentNames(agentNames) },
    }
    this.skillResults = { ...this.skillResults, [SUB_AGENT_DISPATCH_MARKER_KEY]: marker }
  }
}
