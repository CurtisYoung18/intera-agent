// Intera Harness — Case Memory Manager
// Based on Claude Code's multi-tiered context compaction patterns:
//   - Token thresholds: warning (20K), compact (13K), blocking (3K)
//   - Session memory: running summary maintained across turns
//   - Structured compaction with <analysis>/<summary> format

import type { KeyEvent, ChatMemoryData, MemoryStrategy, TodoItem, TodoWriteInput } from '@intera/shared/types'
import { DEFAULT_MEMORY_STRATEGY } from '@intera/shared/defaults'
import { DEFAULT_MEMORY_MODEL } from '@intera/shared/memory/contract'
import Anthropic from '@anthropic-ai/sdk'
import { createAgentClient } from './api/provider-config'
import { withRetry } from './api/with-retry'

export const INTERNAL_MEMORY_PREFIX = '__intera_'

export function isInternalMemoryKey(key: string): boolean {
  return key.startsWith(INTERNAL_MEMORY_PREFIX)
}

export function stripInternalMemoryKeys<T extends Record<string, unknown> | undefined | null>(value: T): Record<string, unknown> {
  if (!value) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !isInternalMemoryKey(key)),
  )
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
  private contextMap: Record<string, unknown> = {}
  private missingFacts: string[] = []
  private toolsCalled: string[] = []
  private toolResults: Record<string, unknown> = {}
  private keyEvents: KeyEvent[] = []
  private caseStatus: string | undefined = undefined
  private summary: string = ''
  private todos: TodoItem[] = []
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
    contextMap?: unknown; missingFacts?: unknown; toolsCalled?: unknown
    toolResults?: unknown; keyEvents?: unknown; summary?: string | null
    caseStatus?: string | null; todos?: unknown
  }): void {
    const safeParse = (raw: unknown, fallback: unknown): unknown => {
      if (typeof raw === 'string') {
        try { return JSON.parse(raw) } catch { /* fall through */ }
      }
      return raw ?? fallback
    }

    const contextMap = safeParse(data.contextMap, {})
    const missing = safeParse(data.missingFacts, [])
    const skills = safeParse(data.toolsCalled, [])
    const results = safeParse(data.toolResults, {})
    const events = safeParse(data.keyEvents, [])

    if (contextMap && typeof contextMap === 'object') this.contextMap = contextMap as Record<string, unknown>
    if (Array.isArray(missing)) this.missingFacts = missing
    if (Array.isArray(skills)) this.toolsCalled = skills
    if (results && typeof results === 'object') this.toolResults = results as Record<string, unknown>
    if (Array.isArray(events)) this.keyEvents = events
    if (data.summary) this.summary = data.summary
    if (data.caseStatus) this.caseStatus = data.caseStatus

    const todosRaw = safeParse(data.todos, [])
    if (Array.isArray(todosRaw)) this.todos = todosRaw as TodoItem[]
  }

  /** Align in-memory status with AgentLoop mid-request stage transitions (persisted on HTTP return). */
  setCaseStatus(status: string): void {
    this.caseStatus = status
  }

  // ─── Fact ingestion ───────────────────────────────────────

  /** Directly ingest structured form answers into the context map — no LLM needed.
   *  Follows CC's AskUserQuestion pattern: answers are already keyed by the model. */
  ingestFormAnswers(answers: Record<string, string>): void {
    for (const [key, value] of Object.entries(answers)) {
      if (value != null && String(value).trim() !== '') {
        this.setContextEntry(key, String(value).trim())
      }
    }
  }

  private getExtractionClient(): Anthropic {
    const model = process.env.FACT_EXTRACTION_MODEL || this.strategy.factExtractionModel || DEFAULT_MEMORY_MODEL
    return createAgentClient(model)
  }

  /**
   * Extract structured facts from a user message using LLM.
   * Replaces the old regex-based extraction (txnIdPattern, amountPattern, notReceivedKeywords).
   * Fact names are derived from the case type's requiredFacts when available.
   */
  async ingestUserMessageContext(message: string, requiredFacts?: string[]): Promise<void> {
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
      '- If the message is a form submission starting with "Tool ask_user_questions result:", parse the JSON object directly — each key is a fact name, each value is the fact value. Do NOT re-interpret or summarize the values.',
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
          model: process.env.FACT_EXTRACTION_MODEL || this.strategy.factExtractionModel || DEFAULT_MEMORY_MODEL,
          max_tokens: 256,
          temperature: 0,
          system: systemPrompt,
          tools: [extractTool as any],
          messages: [{ role: 'user', content: userPrompt }],
        }),
        { querySource: 'compact', model: process.env.FACT_EXTRACTION_MODEL || this.strategy.factExtractionModel || DEFAULT_MEMORY_MODEL },
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
              this.setContextEntry(key, value)
            }
          }
        }
        const flags: string[] = Array.isArray(parsed.flags) ? parsed.flags : []
        if (flags.includes('userReportedNotReceived')) {
          this.setContextEntry('userReportedNotReceived', true)
        }
        if (flags.includes('userReportedPartialMissing')) {
          this.setContextEntry('userReportedPartialMissing', true)
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

  // ─── Tool result tracking ────────────────────────────────

  async applyToolResult(toolName: string, output: unknown): Promise<void> {
    if (!this.toolsCalled.includes(toolName)) {
      this.toolsCalled.push(toolName)
    }
    this.toolResults[toolName] = output

    const result = (output && typeof output === 'object' && !Array.isArray(output))
      ? output as Record<string, unknown>
      : {}
    if (toolName === 'query_order_status' && result.status) {
      this.setContextEntry('orderStatus', result.status)
      if (result.amount) this.setContextEntry('orderAmount', result.amount)
      if (result.time) this.setContextEntry('orderTime', result.time)
    }
    if (toolName === 'query_payment_channel_status') {
      if (result.delayed_batch !== undefined) this.setContextEntry('channelDelayedBatch', result.delayed_batch)
      if (result.reason) this.setContextEntry('delayReason', result.reason)
    }

    this.keyEvents.push({
      at: new Date().toISOString(),
      text: `Tool ${toolName} executed`,
      source: 'heuristic',
    })
    this.updateMissingFacts()
  }

  private updateMissingFacts(): void {
    this.missingFacts = this.missingFacts.filter((fact) => !this.contextMap[fact])
  }

  // ─── Ratio-based compaction assessment ─────────────────────

  /**
   * Estimates the token count of the conversation and determines compaction need.
   * Uses ratio-based thresholds (fraction of context window used):
   *   - Blocking: used / window >= blockingRatio (default 0.92, i.e. 92% used) — MUST compact
   *   - AutoCompact: used / window >= autocompactRatio (default 0.70, i.e. 70% used) — should compact
   *   - Warning: used / window >= warningRatio (default 0.60, i.e. 60% used) — notify user
   */
  assessCompaction(estimatedMessageTokens: number, messageCount: number): CompactionResult {
    const ctxWindow = this.strategy.contextWindow ?? 200000
    const outReserved = this.strategy.outputTokensReserved ?? 20000
    const effectiveWindow = Math.max(1, ctxWindow - outReserved)
    const used = estimatedMessageTokens
    const usageRatio = used / effectiveWindow
    const tokensRemaining = effectiveWindow - used
    let percentLeft = Math.max(0, (tokensRemaining / effectiveWindow) * 100)
    if (!Number.isFinite(percentLeft)) percentLeft = 0

    // Ratio-based thresholds (P0-1 fix: absolute-token thresholds were unreachable)
    const acRatio = this.strategy.autocompactRatio ?? 0.70
    const wRatio = this.strategy.warningRatio ?? 0.60
    const bRatio = this.strategy.blockingRatio ?? 0.92

    const isBlocking = usageRatio >= bRatio
    const shouldCompact = usageRatio >= acRatio
    const isWarning = usageRatio >= wRatio

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
    const facts = Object.entries(stripInternalMemoryKeys(this.contextMap))
    if (facts.length > 0) {
      parts.push('\n## Context Map')
      facts.forEach(([k, v]) => parts.push(`- ${k}: ${JSON.stringify(v)}`))
    }

    // Tools executed
    if (this.toolsCalled.length > 0) {
      parts.push('\n## Tools Executed')
      this.toolsCalled.forEach((s) => {
        parts.push(`- ${s}: ${JSON.stringify(this.toolResults[s] || 'N/A')}`)
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

    if (this.todos.length > 0) {
      parts.push('\n## Investigation Todos')
      for (const todo of this.todos) {
        const icon = todo.status === 'completed' ? '✓' : todo.status === 'cancelled' ? '✗' : todo.status === 'in_progress' ? '→' : '○'
        const notes = todo.notes ? ` (${todo.notes})` : ''
        parts.push(`- [${icon}] ${todo.text}${notes}`)
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
    tokens += Object.keys(stripInternalMemoryKeys(this.contextMap)).length * s.tokensPerFact
    tokens += this.toolsCalled.length * s.tokensPerTool
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

  // ─── Hook hit tracking (per-session, not persisted) ─────

  private hookHitCount: Map<string, number> = new Map()

  recordHookHit(hookName: string): number {
    const next = (this.hookHitCount.get(hookName) || 0) + 1
    this.hookHitCount.set(hookName, next)
    return next
  }

  getHookHitCount(hookName: string): number {
    return this.hookHitCount.get(hookName) || 0
  }

  resetHookHits(): void {
    this.hookHitCount.clear()
  }

  // ─── Accessors ────────────────────────────────────────────

  getContextMap(): Record<string, unknown> { return stripInternalMemoryKeys(this.contextMap) }
  getMissingFacts(): string[] { return [...this.missingFacts] }
  getToolsCalled(): string[] { return [...this.toolsCalled] }
  getToolResult(toolName: string): unknown { return this.toolResults[toolName] }
  getKeyEvents(): KeyEvent[] { return [...this.keyEvents] }
  getInternalState<T = unknown>(key: string): T | undefined { return this.toolResults[key] as T | undefined }
  setInternalState(key: string, value: unknown): void {
    this.toolResults = { ...this.toolResults, [key]: value }
  }

  // ─── Centralized fact writes ──────────────────────────────

  setContextEntry(key: string, value: unknown): void {
    if (isInternalMemoryKey(key)) {
      this.setInternalState(key, value)
      return
    }
    const oldValue = this.contextMap[key]
    this.contextMap[key] = value
    this.missingFacts = this.missingFacts.filter((f) => f !== key)
    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      this.keyEvents.push({
        at: new Date().toISOString(),
        text: `Fact updated: ${key}=${JSON.stringify(value).slice(0, 80)}`,
        source: 'dashboard',
      })
    }
  }

  /**
   * Bulk-set context entries.
   */
  setContextEntriesBulk(facts: Record<string, unknown>): boolean {
    const changedKeys: string[] = []
    for (const [key, value] of Object.entries(facts)) {
      if (isInternalMemoryKey(key)) {
        this.setInternalState(key, value)
        continue
      }
      if (value !== null && value !== undefined && value !== '') {
        if (JSON.stringify(this.contextMap[key]) !== JSON.stringify(value)) {
          this.contextMap[key] = value
          this.missingFacts = this.missingFacts.filter((f) => f !== key)
          changedKeys.push(key)
        }
      }
    }
    if (changedKeys.length > 0) {
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

    return { todos: [...this.todos], changed }
  }

  getSummary(): ChatMemoryData {
      return {
        caseId: this.caseId,
        contextMap: stripInternalMemoryKeys(this.contextMap),
        missingFacts: this.missingFacts,
      toolsCalled: this.toolsCalled,
      toolResults: this.toolResults,
      keyEvents: this.keyEvents,
      summary: this.summary,
      caseStatus: this.caseStatus,
      todos: this.todos.length > 0 ? [...this.todos] : undefined,
    }
  }

  setMissingFacts(facts: string[]): void { this.missingFacts = [...facts] }

  /**
   * Return all fields needed for prisma.chatMemory.upsert().
   * Keeps DB write paths consistent across the codebase.
   */
  getDbFields(): {
    contextMap: string
    missingFacts: string
    toolsCalled: string
    toolResults: string
    keyEvents: string
    todos: string | null
  } {
    return {
      contextMap: JSON.stringify(stripInternalMemoryKeys(this.contextMap)),
      missingFacts: JSON.stringify(this.missingFacts),
      toolsCalled: JSON.stringify(this.toolsCalled),
      toolResults: JSON.stringify(this.toolResults),
      keyEvents: JSON.stringify(this.keyEvents),
      todos: this.todos.length > 0 ? JSON.stringify(this.todos) : null,
    }
  }
}

// ============================================
// ChatSessionManager — chat-level memory
// ============================================

export class ChatSessionManager {
  private contextMap: Record<string, unknown> = {}
  private keyEvents: KeyEvent[] = []
  private summary: string | null = null

  constructor(
    private chatId: string,
    private orgId: string,
  ) {}

  getContextMap(): Record<string, unknown> {
    return this.contextMap
  }

  setContextEntry(key: string, value: unknown): void {
    this.contextMap[key] = value
  }

  setContextEntriesBulk(facts: Record<string, unknown>): void {
    Object.assign(this.contextMap, facts)
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
      contextMap: this.contextMap,
      keyEvents: this.keyEvents,
      summary: this.summary,
    }
  }

  /** Load state from a persisted DB row. */
  loadFromDb(row: { contextMap?: string; keyEvents?: string; summary?: string | null }): void {
    if (row.contextMap) {
      try { this.contextMap = JSON.parse(row.contextMap) } catch { /* keep default */ }
    }
    if (row.keyEvents) {
      try { this.keyEvents = JSON.parse(row.keyEvents) } catch { /* keep default */ }
    }
    this.summary = row.summary ?? null
  }

  /** Return fields for prisma.chatSession.upsert. */
  getDbFields(): {
    contextMap: string
    keyEvents: string
    summary: string | undefined
  } {
    return {
      contextMap: JSON.stringify(this.contextMap),
      keyEvents: JSON.stringify(this.keyEvents),
      summary: this.summary ?? undefined,
    }
  }
}
