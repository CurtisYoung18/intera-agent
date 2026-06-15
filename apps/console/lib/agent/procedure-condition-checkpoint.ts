import type { AgentConfigData } from '@intera/shared/types'
import type { TraceWriter } from './trace'
import {
  getPendingProcedureLlmEvaluations,
  recordProcedureConditionEvaluation,
} from './session-store'
import { evaluateProcedureLlmCondition } from './procedure-llm-evaluator'

export interface ProcedureConditionCheckpointDeps {
  caseId: string
  config: AgentConfigData
  traceWriter: TraceWriter
}

export class ProcedureConditionCheckpoint {
  constructor(private readonly deps: ProcedureConditionCheckpointDeps) {}

  async run(): Promise<void> {
    const pending = getPendingProcedureLlmEvaluations(this.deps.caseId)
    for (const evaluation of pending) {
      const result = await evaluateProcedureLlmCondition(evaluation, this.deps.config)
      recordProcedureConditionEvaluation(this.deps.caseId, {
        runId: evaluation.runId,
        branchId: evaluation.branchId,
        conditionId: evaluation.conditionId,
        label: evaluation.branchLabel || evaluation.branchId,
        decision: result.decision,
        reason: result.reason,
        basedOnInputEpoch: evaluation.basedOnInputEpoch,
        model: result.model,
        metadata: result.metadata,
      })
      await this.deps.traceWriter.write(
        'loop_decision',
        `Procedure llm_eval receipt: ${evaluation.branchId}`,
        {
          runId: evaluation.runId,
          branchId: evaluation.branchId,
          conditionId: evaluation.conditionId,
          basedOnInputEpoch: evaluation.basedOnInputEpoch,
          decision: result.decision,
          reason: result.reason,
          model: result.model,
        },
      )
    }
  }
}
