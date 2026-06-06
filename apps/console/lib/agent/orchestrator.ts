// Intera Harness - Orchestrator Agent
// Main brain that identifies case types and dispatches sub-agents
// for parallel investigation. Configured via AgentConfig + CaseSchema.

import type {
  CaseSchemaConfig,
  SubAgentConfig,
  SubAgentTask,
  SubAgentResult,
  ChatMemoryData,
  SSEEvent,
  ToolDefinition,
  AgentContext,
  MessageBus,
} from '@intera/shared/types'
import type { ChatMemoryManager } from './memory'
import { SubAgent } from './sub-agent'
import { DEFAULT_ORCHESTRATOR_CONFIG } from '@intera/shared/defaults'
import { prisma } from '@intera/shared/prisma'

export class OrchestratorAgent {
  private newResults: SubAgentResult[] = []
  private pendingNames: Set<string> = new Set()

  constructor(
    private caseSchema: CaseSchemaConfig,
    private skillDefinitions: ToolDefinition[] = [],
    private platformUserId: string = 'anonymous',
    /** Live memory manager for shared dashboard polling by sub-agents. */
    private memoryManager?: ChatMemoryManager,
    /** Message bus for sub-agent communication (AgentContext). */
    private messageBus?: MessageBus,
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
    chatMemory: ChatMemoryData,
    stageGoal: string,
  ): Promise<SubAgentTask[]> {
    if (!subAgentConfigs.length) return []

    const tasks: SubAgentTask[] = []

    for (const config of subAgentConfigs) {
      let taskPrompt = config.taskTemplate
        .replace(/\{\{caseId\}\}/g, chatMemory.caseId)
        .replace(/\{\{stage\}\}/g, stage)
        .replace(/\{\{stageGoal\}\}/g, stageGoal)
        .replace(/\{\{confirmedFacts\}\}/g, JSON.stringify(chatMemory.confirmedFacts))
        .replace(/\{\{missingFacts\}\}/g, JSON.stringify(chatMemory.missingFacts))

      // ── Build task checklist for structured execution ──
      const skillNames = config.skills?.length
        ? config.skills.map((s) => `  □ 调用 ${s}`).join('\n')
        : '  □ 根据 task 描述自行判断需要调用哪些工具'
      const taskDirective = `[SUB-AGENT TASK: ${config.name}]
${taskPrompt}

Required tools (you may ONLY use these):
${skillNames}

Rules:
  - 严格按照 task 描述执行，不得自由发挥
  - 工具调用失败时报告具体错误，不得猜测结果
  - 完成后调用 finalize_sub_agent，禁止调用其他终端工具（finalize_case、dispatch_case_agent、create_human_task）
  - 如果收集到了足够信息，尽早完成，不要反复核查`

      // Surface key facts explicitly so sub-agents don't miss them (e.g. txnId
      // is critical for query_order_status to return correct results).
      const facts = chatMemory.confirmedFacts as Record<string, unknown>
      const txnId = facts?.txnId
      const paymentMethod = facts?.paymentMethod
      const extraHints: string[] = []
      if (txnId) extraHints.push(`Use txnId="${txnId}" when calling query_order_status.`)
      if (paymentMethod) extraHints.push(`Use paymentMethod="${paymentMethod}" when calling query_payment_channel_status.`)
      const uid = this.platformUserId.trim() || 'anonymous'
      extraHints.push(`platformUserId for tools (e.g. read_case_history): "${uid}"`)
      if (extraHints.length) {
        taskPrompt = taskDirective + '\n\n[Harness Hints]\n' + extraHints.map((h) => `- ${h}`).join('\n')
      } else {
        taskPrompt = taskDirective
      }

      tasks.push({
        id: `subagent_${config.name}_${Date.now()}`,
        agentConfig: config,
        taskPrompt,
        context: {
          caseId: chatMemory.caseId,
          chatMemory,
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
    stage?: string,
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

      // ── Fork cache: share prompt context across same-type parallel agents ──
      // Group by agent model (same model = same system prompt + tools = cacheable prefix)
      const forkGroups = new Map<string, SubAgentTask[]>()
      for (const t of parallelTasks) {
        const key = t.agentConfig.model || 'default'
        if (!forkGroups.has(key)) forkGroups.set(key, [])
        forkGroups.get(key)!.push(t)
      }

      for (const [model, group] of forkGroups) {
        // Build shared fork context once per group
        const forkChainId = `fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const sharedSystemPrompt = group[0]?.agentConfig.systemPrompt ?? ''
        const sharedSkills = group[0]?.agentConfig.skills ?? []

        for (let i = 0; i < group.length; i += maxParallel) {
          const batch = group.slice(i, i + maxParallel)
          const isFork = batch.length > 1

          sendEvent({
            type: 'tool_executing',
            data: {
              name: 'orchestrator',
              status: 'executing',
              detail: `${isFork ? 'Fork' : 'Dispatching'} ${batch.length} sub-agent${batch.length > 1 ? 's' : ''}: ${batch.map((t) => t.agentConfig.name).join(', ')}`,
            },
            timestamp: new Date().toISOString(),
          })

          // Inject fork context into each task
          for (const task of batch) {
            task.forkContext = {
              chainId: forkChainId,
              sharedSystemPrompt,
              sharedSkills,
              batchIndex: i,
              batchSize: batch.length,
            }
          }

          const batchResults = await Promise.all(
            batch.map((task) => this.runSubAgent(task)),
          )
          results.push(...batchResults)

          // Write sub_agent_dispatched trace for this batch
          const caseId = batch[0]?.context.caseId
          if (caseId) {
            prisma.actionTrace.create({
              data: {
                caseId,
                actionType: 'sub_agent_dispatched',
                title: `Dispatched ${batch.length} sub-agent${batch.length > 1 ? 's' : ''}`,
                detail: batch.map((t) => t.agentConfig.name).join(', '),
                payload: JSON.stringify({
                  agentNames: batch.map((t) => t.agentConfig.name),
                  stage: stage ?? null,
                  caseId,
                }),
              },
            }).catch((err) => console.error('[Orchestrator] Trace write failed (sub_agent_dispatched):', err))
          }
        }
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

      // Write sub_agent_dispatched trace for serial task
      const sCaseId = task.context.caseId
      if (sCaseId) {
        prisma.actionTrace.create({
          data: {
            caseId: sCaseId,
            actionType: 'sub_agent_dispatched',
            title: `Dispatched 1 sub-agent`,
            detail: task.agentConfig.name,
            payload: JSON.stringify({
              agentNames: [task.agentConfig.name],
              stage: stage ?? null,
              caseId: sCaseId,
            }),
          },
        }).catch((err) => console.error('[Orchestrator] Trace write failed (sub_agent_dispatched):', err))
      }
    }

    // Emit completion events for each result
    for (const result of results) {
      this.emitSubAgentComplete(sendEvent, result)
    }

    // Mark the orchestrator tool itself as done — without this the UI
    // spinner never resolves because no skill_result was ever sent.
    sendEvent({
      type: 'skill_result',
      data: {
        name: 'orchestrator',
        status: 'completed',
        result: {
          agentsRun: results.length,
          agents: results.map((r) => r.agentName),
        },
      },
      timestamp: new Date().toISOString(),
    })

    return results
  }

  /** Non-blocking dispatch: runs in background via Promise.all, results merge incrementally. */
  dispatchInBackground(
    tasks: SubAgentTask[],
    sendEvent: (event: SSEEvent) => void,
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

    // Track completed agent names for the final skill_result event
    const completedAgentNames: string[] = []

    // Fire background execution
    const runAll = async () => {
      // Parallel first
      if (parallelTasks.length > 0) {
        const maxParallel = this.getMaxParallelAgents()
        for (let i = 0; i < parallelTasks.length; i += maxParallel) {
          const batch = parallelTasks.slice(i, i + maxParallel)
          const batchResults = await Promise.allSettled(
            batch.map((task) => this.runSubAgent(task)),
          )
          for (const settled of batchResults) {
            if (settled.status === 'fulfilled') {
              const result = settled.value
              this.newResults.push(result)
              this.pendingNames.delete(result.agentName)
              completedAgentNames.push(result.agentName)
              persistResult(result)
              this.emitSubAgentComplete(sendEvent, result)
            } else {
              // Emit error for failed sub-agent so UI can reflect it
              const failedName = batch[batchResults.indexOf(settled)]?.agentConfig?.name || 'unknown'
              this.pendingNames.delete(failedName)
              sendEvent({
                type: 'sub_agent_error',
                data: {
                  taskId: `subagent_${failedName}_error`,
                  agentName: failedName,
                  error: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
                },
                timestamp: new Date().toISOString(),
              })
            }
          }
        }
      }

      // Then serial
      for (const task of serialTasks) {
        try {
          const result = await this.runSubAgent(task)
          this.newResults.push(result)
          this.pendingNames.delete(result.agentName)
          completedAgentNames.push(result.agentName)
          persistResult(result)
          this.emitSubAgentComplete(sendEvent, result)
        } catch (err) {
          const name = task.agentConfig.name
          this.pendingNames.delete(name)
          sendEvent({
            type: 'sub_agent_error',
            data: {
              taskId: task.id,
              agentName: name,
              error: err instanceof Error ? err.message : String(err),
            },
            timestamp: new Date().toISOString(),
          })
        }
      }
    }

    // Fire and forget — results are collected via hasNewResults()
    // Persist sub-agent results to DB so they survive across HTTP requests.
    const persistResult = async (result: SubAgentResult) => {
      try {
        const record = await prisma.chatMemory.findUnique({ where: { caseId: result.caseId } })
        const prevResults: Record<string, unknown> = record?.skillResults
          ? (() => { try { return JSON.parse(record.skillResults) } catch { return {} } })()
          : {}
        prevResults[`subagent:${result.agentName}`] = {
          findings: result.findings,
          evidence: result.evidence,
          recommendation: result.recommendation,
          tokensUsed: result.tokensUsed,
          durationMs: result.durationMs,
        }
        const prevEvents: unknown[] = record?.keyEvents
          ? (() => { try { return JSON.parse(record.keyEvents) } catch { return [] } })()
          : []
        prevEvents.push({
          at: new Date().toISOString(),
          text: `Sub-agent ${result.agentName} completed: ${result.recommendation || 'no recommendation'}`,
          source: 'llm',
        })
        const memSnap = this.memoryManager ? this.memoryManager.getSummary() : null
        const versionFields = memSnap
          ? {
              dashboardVersion: memSnap.dashboardVersion ?? 0,
              // Persist agentTodos so they survive across requests/restarts
              agentTodos: memSnap.agentTodos ? JSON.stringify(memSnap.agentTodos) : null,
            }
          : {}
        await prisma.chatMemory.upsert({
          where: { caseId: result.caseId },
          update: {
            skillResults: JSON.stringify(prevResults),
            keyEvents: JSON.stringify(prevEvents),
            ...versionFields,
          },
          create: {
            caseId: result.caseId,
            skillResults: JSON.stringify(prevResults),
            keyEvents: JSON.stringify(prevEvents),
            confirmedFacts: '{}',
            missingFacts: '[]',
            skillsCalled: '[]',
            humanTaskStatus: 'none',
            ...versionFields,
          },
        })
      } catch (err) {
        console.error('[Orchestrator] Failed to persist sub-agent result:', err)
      }
    }

    const caseId = tasks[0]?.context.caseId

    runAll()
      .then(async () => {
        // Mark orchestrator tool as complete so the UI spinner resolves.
        sendEvent({
          type: 'skill_result',
          data: {
            name: 'orchestrator',
            status: 'completed',
            result: {
              agentsRun: completedAgentNames.length,
              agents: completedAgentNames,
            },
          },
          timestamp: new Date().toISOString(),
        })

        // Phase 3: Flag case for continuation — the worker will pick it up.
        if (caseId) {
          try {
            await prisma.chatMemory.update({
              where: { caseId },
              data: { needsContinuation: true },
            })
            console.log(`[Orchestrator] Case ${caseId} flagged for continuation (${completedAgentNames.length} sub-agents completed)`)
          } catch (err) {
            console.error('[Orchestrator] Failed to flag case for continuation:', err)
          }
        }
      })
      .catch((err) => console.error('[Orchestrator] Background dispatch failed:', err))
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
    chatMemory: ChatMemoryData,
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
      const existing = chatMemory.confirmedFacts[key]
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
      if (this.memoryManager) {
        // Write through the live memory manager — this bumps dashboardVersion so
        // sub-agents detect the change on their next poll. The manager's internal
        // confirmedFacts IS the same object getSummary() returns, so no separate
        // snapshot write is needed.
        this.memoryManager.setConfirmedFactsBulk(safeFindings)
      } else {
        // No live manager (legacy / test path) — update the snapshot directly.
        Object.assign(chatMemory.confirmedFacts, safeFindings)
      }
    }

    chatMemory.skillResults[`subagent:${result.agentName}`] = {
      findings: result.findings,
      evidence: result.evidence,
      recommendation: result.recommendation,
      tokensUsed: result.tokensUsed,
      durationMs: result.durationMs,
    }

    chatMemory.keyEvents.push({
      at: new Date().toISOString(),
      text: `Sub-agent ${result.agentName} completed: ${result.recommendation || 'no recommendation'}`,
      source: 'llm',
    })

    // Write sub_agent_merged trace
    prisma.actionTrace.create({
      data: {
        caseId: result.caseId,
        actionType: 'sub_agent_merged',
        title: `Sub-agent ${result.agentName} merged`,
        detail: `Findings: ${Object.keys(result.findings).join(', ') || '(none)'}`,
        payload: JSON.stringify({
          agentName: result.agentName,
          findingsKeys: Object.keys(result.findings),
          durationMs: result.durationMs,
        }),
      },
    }).catch((err) => console.error('[Orchestrator] Trace write failed (sub_agent_merged):', err))
  }

  /** Merge sub-agent findings into case memory. */
  mergeResults(
    results: SubAgentResult[],
    confirmedFacts: Record<string, unknown>,
    skillResults: Record<string, unknown>,
    keyEvents: Array<{ at: string; text: string; source: string }>,
  ): void {
    for (const result of results) {
      this.mergeSingleResult(result, { confirmedFacts, skillResults, keyEvents } as ChatMemoryData)
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

  /** Run a single sub-agent. Creates a fresh instance each call so task-specific
   *  configuration (taskPrompt, context) is never stale from a previous dispatch. */
  private async runSubAgent(task: SubAgentTask): Promise<SubAgentResult> {
    const ctx: AgentContext = {
      agentId: task.id,
      chainId: task.forkContext?.chainId ?? '',
      depth: 1,
      parentAgentId: 'main',
      allowedTools: new Set(task.agentConfig.skills),
      isSubAgent: true,
      maxIterations: task.agentConfig.maxIterations || 5,
      messageBus: this.messageBus ?? { send: () => {}, poll: () => [] },
    }

    const agent = new SubAgent(task.agentConfig, this.skillDefinitions)
    return agent.run(ctx, task)
  }
}
