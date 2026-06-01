// Intera Harness — Case Memory Manager
// Based on Claude Code's multi-tiered context compaction patterns:
//   - Token thresholds: warning (20K), compact (13K), blocking (3K)
//   - Session memory: running summary maintained across turns
//   - Structured compaction with <analysis>/<summary> format

import type { KeyEvent, ChatMemoryData, MemoryStrategy, TodoItem, TodoWriteInput, DashboardChange } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import Anthropic from '@anthropic-ai/sdk'
import { createAgentClient } from './api/provider-config'
import { withRetry } from './api/with-retry'

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

export class ChatMemoryManager {
  private confirmedFacts: Record<string, unknown> = {}
  private missingFacts: string[] = []
  private skillsCalled: string[] = []
  private skillResults: Record<string, unknown> = {}
  private keyEvents: KeyEvent[] = []
  private caseStatus: string | undefined = undefined
  private summary: string = ''
  private todos: TodoItem[] = []
  private agentTodos: Record<string, TodoItem[]> = {}
  private dashboardVersion: number = 0
  /** Changelog of fact keys that changed at each dashboard version — used by getDashboardDiff. */
  private factChangelog: Array<{ atVersion: number; keys: string[] }> = []
  private static readonly MAX_CHANGELOG_SIZE = 200
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
    caseStatus?: string | null; todos?: unknown; agentTodos?: unknown; dashboardVersion?: unknown
  }): void {
    const safeParse = (raw: unknown, fallback: unknown): unknown => {
      if (typeof raw === 'string') {
        try { return JSON.parse(raw) } catch { /* fall through */ }
      }
      return raw ?? fallback
    }

    const facts = safeParse(data.confirmedFacts, {})
    const missing = safeParse(data.missingFacts, [])
    const skills = safeParse(data.skillsCalled, [])
    const results = safeParse(data.skillResults, {})
    const events = safeParse(data.keyEvents, [])

    if (facts && typeof facts === 'object') this.confirmedFacts = facts as Record<string, unknown>
    if (Array.isArray(missing)) this.missingFacts = missing
    if (Array.isArray(skills)) this.skillsCalled = skills
    if (results && typeof results === 'object') this.skillResults = results as Record<string, unknown>
    if (Array.isArray(events)) this.keyEvents = events
    if (data.summary) this.summary = data.summary
    if (data.caseStatus) this.caseStatus = data.caseStatus

    // SOP mode: todos and dashboard version
    const todosRaw = safeParse(data.todos, [])
    if (Array.isArray(todosRaw)) this.todos = todosRaw as TodoItem[]
    const agentTodosRaw = safeParse(data.agentTodos, {})
    if (agentTodosRaw && typeof agentTodosRaw === 'object' && !Array.isArray(agentTodosRaw)) {
      this.agentTodos = agentTodosRaw as Record<string, TodoItem[]>
    }
    if (typeof data.dashboardVersion === 'number') this.dashboardVersion = data.dashboardVersion
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
      if (value != null && String(value).trim() !== '') {
        this.setConfirmedFact(key, String(value).trim())
      }
    }
  }

  private getExtractionClient(): Anthropic {
    const model = process.env.FACT_EXTRACTION_MODEL || 'MiniMax-M2.7-highspeed'
    return createAgentClient(model)
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
      'Call the extract_facts tool with the facts and flags you identify.',
      '',
      'Rules:',
      '- extractedFacts: map of fact_name → value. Only include facts you can confidently identify in the message.',
      '- flags: array of detected sentiment/circumstance labels. Supported: "userReportedNotReceived", "userReportedPartialMissing", "urgent", "angry", "confused"',
      '- Values should be primitives (string, number, boolean), not nested objects.',
      '- Do NOT invent facts that are not stated in the message.',
      '- NEVER fabricate system-side data (e.g. "systemReceivedAmount", "systemShows", "platformStatus"). Only extract what the customer explicitly says THEY observed or did.',
      '- If the message contains transaction IDs, order numbers, or similar identifiers, extract them as txnId.',
      '- If amounts are mentioned (e.g. "500元", "$100", "1000块"), extract the numeric value as amount.',
      '- If the message is a form submission starting with "Tool request_user_input result:", parse the JSON object directly — each key is a fact name, each value is the fact value. Do NOT re-interpret or summarize the values.',
    ].join('\n')

    // Native tool_use: model MUST call extract_facts with structured input.
    // The API protocol guarantees valid JSON — no regex extraction needed.
    const extractTool = {
      name: 'extract_facts',
      description: 'Record extracted facts and flags from the customer message.',
      input_schema: {
        type: 'object' as const,
        properties: {
          extractedFacts: { type: 'object' as const, description: 'Map of fact_name → value (primitive values only)' },
          flags: { type: 'array' as const, items: { type: 'string' as const }, description: 'Detected labels: userReportedNotReceived, userReportedPartialMissing, urgent, angry, confused' },
        },
        required: ['extractedFacts'],
      },
    }

    const userPrompt = [
      `Customer message: "${message}"`,
      `Target facts to look for: ${targetFacts.join(', ')}`,
      extraHint ? `Additional instructions: ${extraHint}` : '',
    ].filter(Boolean).join('\n')

    try {
      const client = this.getExtractionClient()
      const msg = await withRetry(
        (retryClient) => retryClient.messages.create({
          model: process.env.FACT_EXTRACTION_MODEL || 'MiniMax-M2.7-highspeed',
          max_tokens: 256,
          temperature: 0,
          system: systemPrompt,
          tools: [extractTool as any],
          messages: [{ role: 'user', content: userPrompt }],
        }),
        { querySource: 'compact', model: process.env.FACT_EXTRACTION_MODEL || 'MiniMax-M2.7-highspeed' },
        () => this.getExtractionClient(),
      )

      // Read tool_use block first (native path, guaranteed valid JSON)
      let parsed: Record<string, unknown> | null = null
      for (const block of msg.content) {
        if (block.type === 'tool_use') {
          parsed = (block as any).input as Record<string, unknown> | null
          break
        }
      }

      // Fallback: text response (provider doesn't support tool_use)
      if (!parsed) {
        const text = (msg.content[0] as any)?.text || ''
        parsed = extractJsonFromLlmOutput(text)
      }

      if (parsed) {
        const facts = parsed.extractedFacts
        if (facts && typeof facts === 'object') {
          for (const [key, value] of Object.entries(facts)) {
            if (value !== null && value !== undefined && value !== '') {
              this.setConfirmedFact(key, value)
            }
          }
        }
        const flags: string[] = Array.isArray(parsed.flags) ? parsed.flags : []
        if (flags.includes('userReportedNotReceived')) {
          this.setConfirmedFact('userReportedNotReceived', true)
        }
        if (flags.includes('userReportedPartialMissing')) {
          this.setConfirmedFact('userReportedPartialMissing', true)
        }
      } else {
        console.warn('[CaseMemory] Could not extract facts from response')
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
      this.setConfirmedFact('orderStatus', result.status)
      if (result.amount) this.setConfirmedFact('orderAmount', result.amount)
      if (result.time) this.setConfirmedFact('orderTime', result.time)
    }
    if (skillName === 'query_payment_channel_status') {
      if (result.delayed_batch !== undefined) this.setConfirmedFact('channelDelayedBatch', result.delayed_batch)
      if (result.reason) this.setConfirmedFact('delayReason', result.reason)
    }
    if (skillName === 'read_case_history' && typeof result.total === 'number') {
      this.setConfirmedFact('priorCaseCount', result.total)
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
   *   - Blocking: < blockingThresholdTokens (default 15K) — MUST compact
   *   - AutoCompact: < autocompactThresholdTokens (default 40K) — should compact
   *   - Warning: < warningThresholdTokens (default 50K) — notify user
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

    // SOP todos
    if (this.todos.length > 0) {
      parts.push('\n## Investigation Todos')
      for (const todo of this.todos) {
        const icon = todo.status === 'completed' ? '✓' : todo.status === 'cancelled' ? '✗' : todo.status === 'in_progress' ? '→' : '○'
        const notes = todo.notes ? ` (${todo.notes})` : ''
        parts.push(`- [${icon}] ${todo.text}${notes}`)
      }
    }

    // Per-agent todos
    for (const [agentName, agentTodoList] of Object.entries(this.agentTodos)) {
      if (agentTodoList.length > 0) {
        parts.push(`\n## Agent "${agentName}" Todos`)
        for (const todo of agentTodoList) {
          const icon = todo.status === 'completed' ? '✓' : todo.status === 'cancelled' ? '✗' : todo.status === 'in_progress' ? '→' : '○'
          const notes = todo.notes ? ` (${todo.notes})` : ''
          parts.push(`- [${icon}] ${todo.text}${notes}`)
        }
      }
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

  // ─── Policy hit tracking (per-session, not persisted) ─────

  private policyHitCount: Map<string, number> = new Map()

  recordPolicyHit(policyName: string): number {
    const next = (this.policyHitCount.get(policyName) || 0) + 1
    this.policyHitCount.set(policyName, next)
    return next
  }

  getPolicyHitCount(policyName: string): number {
    return this.policyHitCount.get(policyName) || 0
  }

  resetPolicyHits(): void {
    this.policyHitCount.clear()
  }

  // ─── Accessors ────────────────────────────────────────────

  getConfirmedFacts(): Record<string, unknown> { return { ...this.confirmedFacts } }
  getMissingFacts(): string[] { return [...this.missingFacts] }
  getSkillsCalled(): string[] { return [...this.skillsCalled] }
  getSkillResult(skillName: string): unknown { return this.skillResults[skillName] }
  getKeyEvents(): KeyEvent[] { return [...this.keyEvents] }

  // ─── Centralized fact writes (bumps dashboardVersion) ─────

  /**
   * Set a confirmed fact and bump dashboard version.
   * All fact writes MUST go through this method so sub-agents detect changes.
   */
  setConfirmedFact(key: string, value: unknown): void {
    const oldValue = this.confirmedFacts[key]
    this.confirmedFacts[key] = value
    this.missingFacts = this.missingFacts.filter((f) => f !== key)
    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      this.bumpDashboardVersion()
      this.factChangelog.push({ atVersion: this.dashboardVersion, keys: [key] })
      if (this.factChangelog.length > ChatMemoryManager.MAX_CHANGELOG_SIZE) {
        this.factChangelog.splice(0, 50)
      }
      this.keyEvents.push({
        at: new Date().toISOString(),
        text: `Fact updated: ${key}=${JSON.stringify(value).slice(0, 80)}`,
        source: 'dashboard',
      })
    }
  }

  /**
   * Bulk-set confirmed facts, bumping version once.
   */
  setConfirmedFactsBulk(facts: Record<string, unknown>): boolean {
    const changedKeys: string[] = []
    for (const [key, value] of Object.entries(facts)) {
      if (value !== null && value !== undefined && value !== '') {
        if (JSON.stringify(this.confirmedFacts[key]) !== JSON.stringify(value)) {
          this.confirmedFacts[key] = value
          this.missingFacts = this.missingFacts.filter((f) => f !== key)
          changedKeys.push(key)
        }
      }
    }
    if (changedKeys.length > 0) {
      this.bumpDashboardVersion()
      this.factChangelog.push({ atVersion: this.dashboardVersion, keys: changedKeys })
      if (this.factChangelog.length > ChatMemoryManager.MAX_CHANGELOG_SIZE) {
        this.factChangelog.splice(0, 50)
      }
      this.keyEvents.push({
        at: new Date().toISOString(),
        // Log only actually-changed keys, not all input keys
        text: `Facts bulk-updated: ${changedKeys.join(', ')}`,
        source: 'dashboard',
      })
    }
    return changedKeys.length > 0
  }

  // ─── SOP Mode: todo management ────────────────────────────

  getTodos(): TodoItem[] { return [...this.todos] }

  // ─── Per-agent todo isolation ──────────────────────────────

  getAgentTodos(agentName: string): TodoItem[] {
    return [...(this.agentTodos[agentName] || [])]
  }

  /**
   * Apply a todo action scoped to a specific agent.
   * Bumps dashboardVersion so the agent detects the change on next poll.
   */
  applyAgentTodoAction(agentName: string, input: TodoWriteInput): { todos: TodoItem[]; changed: boolean } {
    let list = [...(this.agentTodos[agentName] || [])]
    let changed = false
    const { action, id, text, notes, status } = input

    switch (action) {
      case 'add': {
        // Sequential short IDs scoped to this agent's list
        const newId = `t${list.length + 1}`
        const newTodo: TodoItem = {
          id: newId,
          text: text || '',
          status: 'pending',
          addedBy: 'agent',
          addedAt: new Date().toISOString(),
          notes: notes || undefined,
        }
        list.push(newTodo)
        changed = true
        break
      }
      case 'update': {
        const todo = this.resolveTodoInList(list, id, text)
        if (todo) {
          if (text !== undefined && text !== todo.text) todo.text = text
          if (notes !== undefined) todo.notes = notes
          if (status !== undefined) todo.status = status
          changed = true
        }
        break
      }
      case 'complete': {
        const todo = this.resolveTodoInList(list, id, text)
        if (todo && todo.status !== 'completed') {
          todo.status = 'completed'
          todo.completedAt = new Date().toISOString()
          if (notes !== undefined) todo.notes = notes
          changed = true
        }
        break
      }
      case 'cancel': {
        const todo = this.resolveTodoInList(list, id, text)
        if (todo && todo.status !== 'cancelled') {
          todo.status = 'cancelled'
          if (notes !== undefined) todo.notes = notes
          changed = true
        }
        break
      }
    }

    if (changed) {
      this.agentTodos[agentName] = list
      this.bumpDashboardVersion()
      this.keyEvents.push({
        at: new Date().toISOString(),
        text: `Agent "${agentName}" todo ${action}: ${text?.slice(0, 80) || id || ''}`,
        source: 'dashboard',
      })
    }

    return { todos: [...list], changed }
  }

  getDashboardVersion(): number { return this.dashboardVersion }

  bumpDashboardVersion(): void { this.dashboardVersion++ }

  /**
   * Compute what changed on the dashboard since a given version.
   * Used by sub-agents to generate "[DASHBOARD UPDATE]" context injection.
   */
  getDashboardDiff(sinceVersion: number): DashboardChange {
    // Compute only the facts that changed since sinceVersion using the changelog.
    const changedKeys = new Set<string>()
    for (const entry of this.factChangelog) {
      if (entry.atVersion > sinceVersion) {
        entry.keys.forEach(k => changedKeys.add(k))
      }
    }

    const changedFacts: Record<string, unknown> = {}
    if (changedKeys.size > 0) {
      for (const key of changedKeys) {
        if (key in this.confirmedFacts) changedFacts[key] = this.confirmedFacts[key]
      }
    } else if (this.dashboardVersion > sinceVersion) {
      // Version bumped but no fact changelog entries (e.g. only todo changes) —
      // include all current facts so the sub-agent has full context.
      Object.assign(changedFacts, this.confirmedFacts)
    }

    const agentTodoChanges: Record<string, TodoItem[]> = {}
    for (const [name, todos] of Object.entries(this.agentTodos)) {
      agentTodoChanges[name] = [...todos]
    }

    // Return only the dashboard-source events that postdate sinceVersion.
    // applyTodoAction can bump dashboardVersion without adding a 'dashboard' event,
    // so we use (dashboardVersion - sinceVersion) as a ceiling, not an exact count.
    const dashboardEvents = this.keyEvents.filter(e => e.source === 'dashboard')
    const newEventCap = Math.max(0, this.dashboardVersion - sinceVersion)
    const newKeyEvents = newEventCap > 0 ? dashboardEvents.slice(-newEventCap) : []

    return {
      dashboardVersion: this.dashboardVersion,
      changedFacts,
      removedFactKeys: [],
      agentTodoChanges,
      newKeyEvents,
    }
  }

  /**
   * Resolve a todo item from a list by id (exact → prefix → text fallback).
   *
   * Rationale: the model sees short sequential IDs (t1, t2, …) in the prompt, but
   * older cases persisted with full UUIDs.  Also, models occasionally pass the
   * todo text instead of the id.  This helper handles all three patterns so a
   * mismatched id never silently drops the action.
   */
  private resolveTodoInList(list: TodoItem[], id?: string, text?: string): TodoItem | undefined {
    if (id) {
      // 1. Exact match (normal path for sequential short IDs)
      const exact = list.find((t) => t.id === id)
      if (exact) return exact
      // 2. Prefix match — backward compat with UUID-based IDs already in prod
      const prefix = list.find((t) => t.id.startsWith(id) || id.startsWith(t.id))
      if (prefix) return prefix
    }
    // 3. Text-based fallback — model passed description instead of id
    if (text) {
      const lower = text.toLowerCase().trim()
      const active = list.filter((t) => t.status !== 'completed' && t.status !== 'cancelled')
      return (
        active.find((t) => t.text.toLowerCase() === lower) ||
        active.find((t) => t.text.toLowerCase().includes(lower) || lower.includes(t.text.toLowerCase()))
      )
    }
    return undefined
  }

  /**
   * Apply a single todo action (add / update / complete / cancel).
   * Pure in-memory — no DB writes; callers persist via getSummary() on HTTP exit.
   * Bumps dashboardVersion so sub-agents can detect changes at each ReAct iteration.
   */
  applyTodoAction(input: TodoWriteInput): { todos: TodoItem[]; changed: boolean } {
    const { action, id, text, notes, status } = input
    let changed = false

    switch (action) {
      case 'add': {
        // Sequential short IDs (t1, t2, t3 …) — easy for the model to reference
        const newId = `t${this.todos.length + 1}`
        const newTodo: TodoItem = {
          id: newId,
          text: text || '',
          status: 'pending',
          addedBy: 'agent',
          addedAt: new Date().toISOString(),
          notes: notes || undefined,
        }
        this.todos.push(newTodo)
        changed = true
        this.keyEvents.push({ at: newTodo.addedAt, text: `Todo added: ${newTodo.text.slice(0, 80)}`, source: 'heuristic' })
        break
      }
      case 'update': {
        const todo = this.resolveTodoInList(this.todos, id, text)
        if (todo) {
          if (text !== undefined && text !== todo.text) todo.text = text
          if (notes !== undefined) todo.notes = notes
          if (status !== undefined) todo.status = status
          changed = true
        }
        break
      }
      case 'complete': {
        const todo = this.resolveTodoInList(this.todos, id, text)
        if (todo && todo.status !== 'completed') {
          todo.status = 'completed'
          todo.completedAt = new Date().toISOString()
          if (notes !== undefined) todo.notes = notes
          changed = true
          this.keyEvents.push({ at: todo.completedAt, text: `Todo completed: ${todo.text.slice(0, 80)}`, source: 'heuristic' })
        }
        break
      }
      case 'cancel': {
        const todo = this.resolveTodoInList(this.todos, id, text)
        if (todo && todo.status !== 'cancelled') {
          todo.status = 'cancelled'
          if (notes !== undefined) todo.notes = notes
          changed = true
        }
        break
      }
    }

    if (changed) this.bumpDashboardVersion()

    return { todos: [...this.todos], changed }
  }

  getSummary(): ChatMemoryData {
    return {
      caseId: this.caseId,
      confirmedFacts: this.confirmedFacts,
      missingFacts: this.missingFacts,
      skillsCalled: this.skillsCalled,
      skillResults: this.skillResults,
      keyEvents: this.keyEvents,
      summary: this.summary,
      caseStatus: this.caseStatus,
      todos: this.todos.length > 0 ? [...this.todos] : undefined,
      agentTodos: Object.keys(this.agentTodos).length > 0 ? { ...this.agentTodos } : undefined,
      dashboardVersion: this.dashboardVersion,
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

  /**
   * Return all fields needed for prisma.chatMemory.upsert().
   * Keeps DB write paths consistent across the codebase.
   */
  getDbFields(): {
    confirmedFacts: string
    missingFacts: string
    skillsCalled: string
    skillResults: string
    keyEvents: string
    todos: string | null
    agentTodos: string | null
    dashboardVersion: number
  } {
    return {
      confirmedFacts: JSON.stringify(this.confirmedFacts),
      missingFacts: JSON.stringify(this.missingFacts),
      skillsCalled: JSON.stringify(this.skillsCalled),
      skillResults: JSON.stringify(this.skillResults),
      keyEvents: JSON.stringify(this.keyEvents),
      todos: this.todos.length > 0 ? JSON.stringify(this.todos) : null,
      agentTodos: Object.keys(this.agentTodos).length > 0 ? JSON.stringify(this.agentTodos) : null,
      dashboardVersion: this.dashboardVersion,
    }
  }
}

// ============================================
// ChatSessionManager — chat-level memory
// ============================================

export class ChatSessionManager {
  private confirmedFacts: Record<string, unknown> = {}
  private keyEvents: KeyEvent[] = []
  private summary: string | null = null

  constructor(
    private chatId: string,
    private orgId: string,
  ) {}

  getConfirmedFacts(): Record<string, unknown> {
    return this.confirmedFacts
  }

  setConfirmedFact(key: string, value: unknown): void {
    this.confirmedFacts[key] = value
  }

  setConfirmedFactsBulk(facts: Record<string, unknown>): void {
    Object.assign(this.confirmedFacts, facts)
  }

  getKeyEvents(): KeyEvent[] {
    return this.keyEvents
  }

  addKeyEvent(text: string, source: 'llm' | 'heuristic' | 'dashboard' = 'llm'): void {
    this.keyEvents.push({ at: new Date().toISOString(), text, source })
  }

  getSummary(): string | null {
    return this.summary
  }

  setSummary(s: string): void {
    this.summary = s
  }

  hasSummary(): boolean {
    return !!this.summary
  }

  getSummaryData() {
    return {
      confirmedFacts: this.confirmedFacts,
      keyEvents: this.keyEvents,
      summary: this.summary,
    }
  }

  /** Load state from a persisted DB row. */
  loadFromDb(row: { confirmedFacts?: string; keyEvents?: string; summary?: string | null }): void {
    if (row.confirmedFacts) {
      try { this.confirmedFacts = JSON.parse(row.confirmedFacts) } catch { /* keep default */ }
    }
    if (row.keyEvents) {
      try { this.keyEvents = JSON.parse(row.keyEvents) } catch { /* keep default */ }
    }
    this.summary = row.summary ?? null
  }

  /** Return fields for prisma.chatSession.upsert. */
  getDbFields(): {
    confirmedFacts: string
    keyEvents: string
    summary: string | undefined
  } {
    return {
      confirmedFacts: JSON.stringify(this.confirmedFacts),
      keyEvents: JSON.stringify(this.keyEvents),
      summary: this.summary ?? undefined,
    }
  }
}
