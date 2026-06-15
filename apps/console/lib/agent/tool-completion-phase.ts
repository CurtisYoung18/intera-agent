import type { AgentConfigData, CaseSchemaConfig, Message } from '@intera/shared/types'
import type { ChatMemoryManager } from './memory'
import type { PendingHumanTaskEscalation } from './human-task-handoff-handler'
import type { PersistencePort } from './persistence-port'
import type { Profiler } from './profiler'
import {
  RuntimeManagedToolResolver,
} from './runtime-managed-tools'
import type { StreamingToolExecutor, ToolExecutionResult } from './streaming-tool-executor'
import type { TraceWriter } from './trace'

export interface ToolCompletionPhaseDeps {
  caseId: string
  orgId: string
  userId: string
  chatId?: string | null
  config: AgentConfigData
  getCaseSchema: () => CaseSchemaConfig | null | undefined
  getMessages: () => Message[]
  chatMemory: ChatMemoryManager
  persistence: PersistencePort
  traceWriter: TraceWriter
  profiler: Profiler
  dryRun: boolean
  persistRuntimeMemory?: boolean
  canCreateHumanTaskInGeneralMode: () => boolean
}

export interface ToolCompletionPhaseInput {
  toolExecutor: StreamingToolExecutor
  toolBasedOnEpoch: Map<string, number>
  iterationBasedOnInputEpoch: number
}

export interface ToolCompletionPhaseResult {
  toolResults: ToolExecutionResult[]
  pendingHumanTaskEscalation: PendingHumanTaskEscalation | null
}

export class ToolCompletionPhase {
  constructor(private readonly deps: ToolCompletionPhaseDeps) {}

  async run(input: ToolCompletionPhaseInput): Promise<ToolCompletionPhaseResult> {
    const toolResults = await input.toolExecutor.waitForAll()
    const runtimeToolResolution = await new RuntimeManagedToolResolver({
      caseId: this.deps.caseId,
      orgId: this.deps.orgId,
      userId: this.deps.userId,
      chatId: this.deps.chatId,
      config: this.deps.config,
      caseSchema: this.deps.getCaseSchema(),
      messages: this.deps.getMessages(),
      chatMemory: this.deps.chatMemory,
      persistence: this.deps.persistence,
      traceWriter: this.deps.traceWriter,
      dryRun: this.deps.dryRun,
      persistRuntimeMemory: this.deps.persistRuntimeMemory,
      canCreateHumanTaskInGeneralMode: this.deps.canCreateHumanTaskInGeneralMode(),
    }).resolve(
      toolResults,
      input.toolBasedOnEpoch,
      input.iterationBasedOnInputEpoch,
    )

    for (const result of toolResults) {
      this.deps.profiler.addToolExecution(result.latencyMs || 0)
    }

    return {
      toolResults,
      pendingHumanTaskEscalation: runtimeToolResolution.pendingHumanTaskEscalation,
    }
  }
}
