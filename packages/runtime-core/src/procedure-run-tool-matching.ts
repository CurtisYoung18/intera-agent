import type {
  ProcedureRunActionState,
  ProcedureRunEvidenceState,
  ProcedureRunState,
  ProcedureRunStepState,
} from './procedure-run-state'

export function buildToolEvidenceLabel(toolName: string, kind: ProcedureRunEvidenceState['kind']): string {
  switch (kind) {
    case 'knowledge':
      return `Knowledge search completed with ${toolName}`
    case 'handoff':
      return 'Human handoff requested'
    default:
      return `Tool result captured for ${toolName}`
  }
}

export function findMatchingToolStep(
  run: ProcedureRunState,
  toolName: string,
  isKnowledgeTool: boolean,
): { step: ProcedureRunStepState; action?: ProcedureRunActionState } | null {
  const stepsInPriority = [
    ...(run.currentStepId ? run.steps.filter((step) => step.id === run.currentStepId) : []),
    ...run.steps.filter((step) => step.id !== run.currentStepId),
  ]

  for (const step of stepsInPriority) {
    const action = (step.actions ?? []).find((candidate) => actionMatchesTool(candidate, toolName, isKnowledgeTool))
    if (action) return { step, action }
  }

  return null
}

function actionMatchesTool(action: ProcedureRunActionState, toolName: string, isKnowledgeTool: boolean): boolean {
  switch (action.kind) {
    case 'call_tool':
      return action.target === toolName
    case 'search_knowledge':
      return isKnowledgeTool
    case 'ask':
      return toolName === 'ask_user_questions'
    case 'request_human_handoff':
      return toolName === 'create_human_task'
    case 'end':
      return toolName === 'finalize_procedure'
    default:
      return false
  }
}
