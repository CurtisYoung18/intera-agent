import type { CaseSchemaConfig } from '@intera/shared/types'
import type { HookCheckpoint, HookContext } from '@intera/shared/contracts/hooks'
import type { ChatMemoryManager } from './memory'
import { getActiveProcedureRun } from './session-store'

export interface HookContextBuildOptions {
  toolName?: string
  toolInput?: unknown
  toolOutput?: unknown
  toolError?: string
  replyDraft?: string
  procedureStepIds?: string[]
  currentToolCalls?: Array<{ name: string; input?: unknown; output?: unknown }>
}

export interface HookContextBuilderDeps {
  agentConfigId: string
  caseId: string
  chatId?: string | null
  chatMemory: ChatMemoryManager
  getCaseSchema: () => CaseSchemaConfig | null | undefined
  getCurrentStage: () => string
  getIterationCount: () => number
}

export class HookContextBuilder {
  constructor(private readonly deps: HookContextBuilderDeps) {}

  build(
    checkpoint: HookCheckpoint,
    options: HookContextBuildOptions = {},
  ): HookContext {
    const activeProcedureRun = getActiveProcedureRun(this.deps.caseId)
    const procedureStepIds = options.procedureStepIds ??
      (activeProcedureRun?.currentStepId ? [activeProcedureRun.currentStepId] : [])
    const caseSchema = this.deps.getCaseSchema()

    return {
      checkpoint,
      agentConfigId: this.deps.agentConfigId,
      caseId: this.deps.caseId,
      chatId: this.deps.chatId ?? undefined,
      caseType: caseSchema
        ? {
            type: caseSchema.type,
            displayName: caseSchema.displayName,
          }
        : undefined,
      procedureStepIds,
      tool: options.toolName
        ? {
            name: options.toolName,
            input: options.toolInput,
            output: options.toolOutput,
            error: options.toolError,
          }
        : undefined,
      caseFacts: this.deps.chatMemory.getContextMap(),
      missingFacts: this.deps.chatMemory.getMissingFacts(),
      previousToolCalls: this.deps.chatMemory.getToolsCalled().map((name) => ({
        name,
        output: this.deps.chatMemory.getToolResult(name),
      })),
      currentToolCalls: options.currentToolCalls ?? [],
      traceSummary: this.deps.chatMemory.getKeyEvents().slice(-10).map((event) => ({
        at: event.at,
        text: event.text,
        source: event.source,
      })),
      replyDraft: options.replyDraft,
      metadata: {
        currentStage: this.deps.getCurrentStage(),
        iteration: this.deps.getIterationCount(),
        procedureRun: activeProcedureRun
          ? {
              runId: activeProcedureRun.runId,
              procedureId: activeProcedureRun.procedureId,
              status: activeProcedureRun.status,
              currentStepId: activeProcedureRun.currentStepId,
              inputEpoch: activeProcedureRun.inputEpoch,
            }
          : undefined,
      },
    }
  }
}
