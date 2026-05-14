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

      const uid = this.platformUserId.trim() || 'anonymous'
      taskPrompt += `\n\n[Harness] platformUserId for tools (e.g. read_case_history): "${uid}". Use this as userId unless the customer explicitly gives another authoritative ID.`

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
              this.mergeSingleResult(result, caseMemory)
              this.emitSubAgentComplete(sendEvent, result)
            }
          }
        }

        // Then serial
        for (const task of serialTasks) {
          const result = await this.runSubAgent(task)
          this.newResults.push(result)
          this.pendingNames.delete(result.agentName)
          this.mergeSingleResult(result, caseMemory)
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

  /** Merge a single sub-agent result into case memory (incremental). */
  mergeSingleResult(
    result: SubAgentResult,
    caseMemory: CaseMemoryData,
  ): void {
    Object.assign(caseMemory.confirmedFacts, result.findings)

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
      Object.assign(confirmedFacts, result.findings)

      skillResults[`subagent:${result.agentName}`] = {
        findings: result.findings,
        evidence: result.evidence,
        recommendation: result.recommendation,
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs,
      }

      keyEvents.push({
        at: new Date().toISOString(),
        text: `Sub-agent ${result.agentName} completed: ${result.recommendation || 'no recommendation'}`,
        source: 'llm',
      })
    }
  }

  /** Emit a sub_agent_complete SSE event. */
  private emitSubAgentComplete(
    sendEvent: (event: SSEEvent) => void,
    result: SubAgentResult,
  ): void {
    sendEvent({
      type: 'sub_agent_complete',
      data: {
        agentId: result.taskId,
        agentName: result.agentName,
        caseId: result.caseId,
        findings: result.findings,
        recommendation: result.recommendation,
        evidence: result.evidence,
        durationMs: result.durationMs,
        tokensUsed: result.tokensUsed,
      },
      timestamp: new Date().toISOString(),
    })
  }

  /** Run a single sub-agent (with caching for repeat invocations). */
  private async runSubAgent(task: SubAgentTask): Promise<SubAgentResult> {
    let agent = this.subAgents.get(task.agentConfig.name)
    if (!agent) {
      agent = new SubAgent(task.agentConfig, this.skillDefinitions)
      this.subAgents.set(task.agentConfig.name, agent)
    }

    return agent.investigate(task)
  }
}
