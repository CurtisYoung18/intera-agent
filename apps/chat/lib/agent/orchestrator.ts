// Intera Harness - Orchestrator Agent
// Main brain that identifies case types and dispatches sub-agents
// for parallel investigation. Configured via AgentConfig + CaseSchema.

import type {
  CaseSchemaConfig,
  SubAgentConfig,
  SubAgentTask,
  SubAgentResult,
  CaseMemoryData,
  SSEEvent,
  SkillDefinition,
} from '@intera/shared/types'
import { SubAgent } from './sub-agent'
import { DEFAULT_ORCHESTRATOR_CONFIG } from '@intera/shared/defaults'

export class OrchestratorAgent {
  private subAgents: Map<string, SubAgent> = new Map()
  private newResults: SubAgentResult[] = []
  private pendingNames: Set<string> = new Set()

  constructor(
    private caseSchema: CaseSchemaConfig,
    private skillDefinitions: SkillDefinition[] = [],
    private platformUserId: string = 'anonymous',
  ) {}

  /** Whether sub-agent dispatch is enabled for this case type. */
  isEnabled(): boolean {
    return this.caseSchema.orchestrator?.enabled ?? DEFAULT_ORCHESTRATOR_CONFIG.enabled
  }

  /** Get max number of parallel sub-agents. */
  getMaxParallelAgents(): number {
    return (
      this.caseSchema.orchestrator?.maxParallelAgents ??
      DEFAULT_ORCHESTRATOR_CONFIG.maxParallelAgents
    )
  }

  /** Plan investigation: determine which sub-agents to dispatch for a stage. */
  async planInvestigation(
    stage: string,
    subAgentConfigs: SubAgentConfig[],
    caseMemory: CaseMemoryData,
    stageGoal: string,
  ): Promise<SubAgentTask[]> {
    if (!subAgentConfigs.length) return []

    const tasks: SubAgentTask[] = []

    for (const config of subAgentConfigs) {
      let taskPrompt = config.taskTemplate
        .replace(/\{\{caseId\}\}/g, caseMemory.caseId)
        .replace(/\{\{stage\}\}/g, stage)
        .replace(/\{\{stageGoal\}\}/g, stageGoal)
        .replace(/\{\{confirmedFacts\}\}/g, JSON.stringify(caseMemory.confirmedFacts))
        .replace(/\{\{missingFacts\}\}/g, JSON.stringify(caseMemory.missingFacts))

      // Surface key facts explicitly so sub-agents don't miss them (e.g. txnId
      // is critical for query_order_status to return correct results).
      const facts = caseMemory.confirmedFacts as Record<string, unknown>
      const txnId = facts?.txnId
      const paymentMethod = facts?.paymentMethod
      if (txnId) {
        taskPrompt += `\n\n[Harness] Use txnId="${txnId}" when calling query_order_status.`
      }
      if (paymentMethod) {
        taskPrompt += `\n[Harness] Use paymentMethod="${paymentMethod}" when calling query_payment_channel_status.`
      }

      const uid = this.platformUserId.trim() || 'anonymous'
      taskPrompt += `\n[Harness] platformUserId for tools (e.g. read_case_history): "${uid}". Use this as userId unless the customer explicitly gives another authoritative ID.`

      tasks.push({
        id: `subagent_${config.name}_${Date.now()}`,
        agentConfig: config,
        taskPrompt,
        context: {
          caseId: caseMemory.caseId,
          caseMemory,
          stageGoal,
        },
      })
    }

    return tasks
  }

  /** Dispatch sub-agents, respecting parallel/serial configuration. */
  async dispatch(
    tasks: SubAgentTask[],
    sendEvent: (event: SSEEvent) => void,
  ): Promise<SubAgentResult[]> {
    const results: SubAgentResult[] = []
    const parallelTasks: SubAgentTask[] = []
    const serialTasks: SubAgentTask[] = []

    for (const task of tasks) {
      if (task.agentConfig.parallel) {
        parallelTasks.push(task)
      } else {
        serialTasks.push(task)
      }
    }

    // Run parallel tasks concurrently (with concurrency cap)
    if (parallelTasks.length > 0) {
      const maxParallel = this.getMaxParallelAgents()
      for (let i = 0; i < parallelTasks.length; i += maxParallel) {
        const batch = parallelTasks.slice(i, i + maxParallel)
        sendEvent({
          type: 'tool_executing',
          data: {
            name: 'orchestrator',
            status: 'executing',
            detail: `Dispatching ${batch.length} parallel sub-agents: ${batch.map((t) => t.agentConfig.name).join(', ')}`,
          },
          timestamp: new Date().toISOString(),
        })

        const batchResults = await Promise.all(
          batch.map((task) => this.runSubAgent(task)),
        )
        results.push(...batchResults)
      }
    }

    // Run serial tasks one at a time
    for (const task of serialTasks) {
      sendEvent({
        type: 'tool_executing',
        data: {
          name: 'orchestrator',
          status: 'executing',
          detail: `Running sub-agent: ${task.agentConfig.name}`,
        },
        timestamp: new Date().toISOString(),
      })

      const result = await this.runSubAgent(task)
      results.push(result)
    }

    // Emit completion events for each result
    for (const result of results) {
      this.emitSubAgentComplete(sendEvent, result)
    }

    return results
  }

  /** Non-blocking dispatch: runs in background via Promise.all, results merge incrementally. */
  dispatchInBackground(
    tasks: SubAgentTask[],
    sendEvent: (event: SSEEvent) => void,
    caseMemory: CaseMemoryData,
  ): void {
    const parallelTasks: SubAgentTask[] = []
    const serialTasks: SubAgentTask[] = []

    for (const task of tasks) {
      if (task.agentConfig.parallel) {
        parallelTasks.push(task)
      } else {
        serialTasks.push(task)
      }
    }

    // Mark all as pending
    for (const task of tasks) {
      this.pendingNames.add(task.agentConfig.name)
    }

    // Fire background execution
    const runAll = async () => {
      try {
        // Parallel first
        if (parallelTasks.length > 0) {
          const maxParallel = this.getMaxParallelAgents()
          const parallelResults: SubAgentResult[] = []
          for (let i = 0; i < parallelTasks.length; i += maxParallel) {
            const batch = parallelTasks.slice(i, i + maxParallel)
            const batchResults = await Promise.all(
              batch.map((task) => this.runSubAgent(task)),
            )
            for (const result of batchResults) {
              parallelResults.push(result)
              this.newResults.push(result)
              this.pendingNames.delete(result.agentName)
              this.emitSubAgentComplete(sendEvent, result)
            }
          }
        }

        // Then serial
        for (const task of serialTasks) {
          const result = await this.runSubAgent(task)
          this.newResults.push(result)
          this.pendingNames.delete(result.agentName)
          this.emitSubAgentComplete(sendEvent, result)
        }
      } catch (err) {
        console.error('[Orchestrator] Background dispatch error:', err)
      }
    }

    // Fire and forget — results are collected via hasNewResults()
    runAll().catch((err) => console.error('[Orchestrator] Background dispatch failed:', err))
  }

  /** Check if any new sub-agent results have arrived since last check. */
  hasNewResults(): boolean {
    return this.newResults.length > 0
  }

  /** Get and clear new results for merging into CaseMemory. */
  drainNewResults(): SubAgentResult[] {
    const results = [...this.newResults]
    this.newResults = []
    return results
  }

  /** Get names of sub-agents still running. */
  getPendingAgentNames(): string[] {
    return Array.from(this.pendingNames)
  }

  /**
   * Keys that sub-agents commonly return but should NOT pollute confirmedFacts.
   * These are sub-agent internal metadata or findings that shadow user-provided facts.
   */
  private static readonly SUB_AGENT_INTERNAL_KEYS = new Set([
    'results', 'cases', 'total', 'sources', 'evidence',
  ])

  /** Merge a single sub-agent result into case memory (incremental). */
  mergeSingleResult(
    result: SubAgentResult,
    caseMemory: CaseMemoryData,
  ): void {
    // Filter findings: only merge keys that don't pollute confirmedFacts.
    // - Skip sub-agent-internal metadata keys (results, cases, total, etc.)
    // - Don't overwrite existing user-provided facts with sub-agent data
    const safeFindings: Record<string, unknown> = {}
    const dropped: string[] = []
    for (const [key, value] of Object.entries(result.findings)) {
      if (OrchestratorAgent.SUB_AGENT_INTERNAL_KEYS.has(key)) {
        dropped.push(key)
        continue
      }
      const existing = caseMemory.confirmedFacts[key]
      if (existing !== undefined && existing !== null && existing !== '') {
        // Existing fact looks intentional — don't let sub-agent overwrite it
        if (JSON.stringify(existing) !== JSON.stringify(value)) {
          console.warn(`[Orchestrator] Sub-agent "${result.agentName}" finding "${key}"=${JSON.stringify(value)} conflicts with existing confirmedFacts.${key}=${JSON.stringify(existing)} — keeping user value`)
        }
        continue
      }
      safeFindings[key] = value
    }
    if (dropped.length > 0) {
      console.warn(`[Orchestrator] Filtered sub-agent internal keys from confirmedFacts: ${dropped.join(', ')}`)
    }

    if (Object.keys(safeFindings).length > 0) {
      Object.assign(caseMemory.confirmedFacts, safeFindings)
    }

    caseMemory.skillResults[`subagent:${result.agentName}`] = {
      findings: result.findings,
      evidence: result.evidence,
      recommendation: result.recommendation,
      tokensUsed: result.tokensUsed,
      durationMs: result.durationMs,
    }

    caseMemory.keyEvents.push({
      at: new Date().toISOString(),
      text: `Sub-agent ${result.agentName} completed: ${result.recommendation || 'no recommendation'}`,
      source: 'llm',
    })
  }

  /** Merge sub-agent findings into case memory. */
  mergeResults(
    results: SubAgentResult[],
    confirmedFacts: Record<string, unknown>,
    skillResults: Record<string, unknown>,
    keyEvents: Array<{ at: string; text: string; source: string }>,
  ): void {
    for (const result of results) {
      this.mergeSingleResult(result, { confirmedFacts, skillResults, keyEvents } as CaseMemoryData)
    }
  }

  /** Build a SubAgentNotification from a result (CC <task-notification> pattern). */
  static toNotification(result: SubAgentResult): import('@intera/shared/types').SubAgentNotification & { agentId: string } {
    return {
      taskId: result.taskId,
      agentId: result.taskId,
      agentName: result.agentName,
      caseId: result.caseId,
      status: 'completed',
      findings: result.findings,
      recommendation: result.recommendation,
      tokensUsed: result.tokensUsed,
      durationMs: result.durationMs,
      timestamp: new Date().toISOString(),
    }
  }

  /** Build a human-readable summary message for injection into the main agent's context. */
  static toContextMessage(result: SubAgentResult): string {
    const lines = [
      `[Sub-agent: ${result.agentName} — completed]`,
      '',
    ]
    const findingKeys = Object.keys(result.findings)
    if (findingKeys.length > 0) {
      lines.push('Findings:')
      for (const [k, v] of Object.entries(result.findings)) {
        lines.push(`  - ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      }
    }
    if (result.recommendation) {
      lines.push(`Recommendation: ${result.recommendation}`)
    }
    if (result.evidence.length > 0) {
      lines.push(`Evidence items: ${result.evidence.length}`)
    }
    lines.push(`Tokens: ${result.tokensUsed} | Duration: ${(result.durationMs / 1000).toFixed(1)}s`)
    return lines.join('\n')
  }

  /** Emit a sub_agent_complete SSE event (unified SubAgentNotification format). */
  private emitSubAgentComplete(
    sendEvent: (event: SSEEvent) => void,
    result: SubAgentResult,
  ): void {
    sendEvent({
      type: 'sub_agent_complete',
      data: OrchestratorAgent.toNotification(result),
      timestamp: new Date().toISOString(),
    })
  }

  private static readonly MAX_CACHED_AGENTS = 20

  /** Run a single sub-agent (with caching for repeat invocations, LRU-evicted). */
  private async runSubAgent(task: SubAgentTask): Promise<SubAgentResult> {
    let agent = this.subAgents.get(task.agentConfig.name)
    if (!agent) {
      agent = new SubAgent(task.agentConfig, this.skillDefinitions)
      // Evict oldest entry when cache exceeds limit
      if (this.subAgents.size >= OrchestratorAgent.MAX_CACHED_AGENTS) {
        const firstKey = this.subAgents.keys().next().value
        if (firstKey) this.subAgents.delete(firstKey)
      }
      this.subAgents.set(task.agentConfig.name, agent)
    }

    return agent.investigate(task)
  }
}
