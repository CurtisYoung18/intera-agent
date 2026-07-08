// Procedure Executor — structured single-agent Procedure runtime.
//
// Procedure v2 is the only supported execution shape here. The prompt is
// rendered from typed steps/branches/actions, and completion is gated on the
// required tool actions plus explicit finalize.

import type { ProcedureV2, ProcedureV2Action, ProcedureV2Step } from '@intera/shared/types'
import {
  buildProcedureActionSummary,
  buildProcedureConditionLabel,
} from '@intera/shared/contracts/case-types'

export interface ProcedureStepToolSelection {
  toolNames: string[]
  includesKnowledgeTools: boolean
}

/**
 * Renders a Procedure into the case-mode system prompt and exposes the completion gate.
 * Held by CaseAgentLoop when the case type carries a `procedure`.
 */
export class ProcedureExecutor {
  private readonly procedure: ProcedureV2

  constructor(
    procedure: ProcedureV2,
    private readonly caseType: string,
    private readonly knowledgeToolNames: Set<string> = new Set(),
  ) {
    this.procedure = procedure
  }

  /** Tool targets the procedure hard-requires before completion. */
  requiredTools(): string[] {
    return this.requiredToolTargets()
  }

  /** Stable-ish Procedure definition block; runtime state is appended separately by AgentLoop. */
  buildDefinitionPrompt(): string {
    return this.buildV2DefinitionPrompt(this.procedure)
  }

  /** Step ids that are relevant for a Tool checkpoint in the current turn. */
  stepIdsForTool(toolName: string | undefined): string[] {
    if (!toolName) return []
    const matchingTargets = this.procedure.steps
      .filter((step) => this.v2StepMatchesTool(step, toolName))
      .map((step) => step.id)
    return [...new Set(matchingTargets)]
  }

  /** Tools directly relevant to the active Procedure step. */
  toolSelectionForStep(stepId: string | null | undefined): ProcedureStepToolSelection | null {
    if (!stepId) return null
    const step = this.procedure.steps.find((candidate) => candidate.id === stepId)
    if (!step) return null

    const toolNames = new Set<string>()
    let includesKnowledgeTools = false

    for (const action of collectStepActions(step)) {
      switch (action.kind) {
        case 'ask':
          toolNames.add('ask_user_questions')
          break
        case 'search_knowledge':
          includesKnowledgeTools = true
          for (const name of this.knowledgeToolNames) toolNames.add(name)
          break
        case 'call_tool': {
          const name = action.toolName.trim()
          if (name) toolNames.add(name)
          break
        }
        case 'request_human_handoff':
          toolNames.add('create_human_task')
          break
        case 'end':
          toolNames.add('finalize_procedure')
          break
      }
    }

    return { toolNames: [...toolNames], includesKnowledgeTools }
  }

  /** Completion gate — see {@link isProcedureComplete}. */
  isComplete(state: { calledTools: string[]; finalized: boolean }): boolean {
    if (!state.finalized) return false
    const called = new Set(state.calledTools)
    return this.requiredToolTargets().every((toolName) => called.has(toolName))
  }

  private renderOrderedDefinition(): string {
    if (!this.procedure.steps.length) {
      return '  (no steps defined — use your best judgment to investigate and resolve.)'
    }
    return this.procedure.steps
      .map((step, index) => this.renderV2Step(step, index))
      .join('\n')
  }

  private requiredToolTargets(): string[] {
    return this.procedure.steps.flatMap((step) =>
      collectStepActions(step)
        .filter((action): action is Extract<ProcedureV2Action, { kind: 'call_tool' }> =>
          action.kind === 'call_tool' && action.required !== false && action.toolName.trim().length > 0,
        )
        .map((action) => action.toolName),
    )
  }

  private buildV2DefinitionPrompt(definition: ProcedureV2): string {
    const lines = [
      `Procedure type: ${this.caseType}`,
      '',
      '## When To Use This Procedure',
      definition.whenToUse,
    ]

    if (definition.overview) {
      lines.push('', '## Overview', definition.overview)
    }

    lines.push('', '## Ordered Procedure Steps', this.renderOrderedDefinition())

    if (definition.knowledgeGuidance) {
      lines.push('', '## Knowledge Guidance', definition.knowledgeGuidance)
    }

    if (definition.handoffGuidance) {
      lines.push('', '## Human Handoff Guidance', definition.handoffGuidance)
    }

    lines.push(
      '',
      '## Procedure Rules',
      'Rule 1 — Keep customer-facing output natural; do not expose internal procedure language.',
      'Rule 2 — Prefer the current step and its actions before jumping ahead, unless runtime evidence already justifies the later action.',
      'Rule 3 — If the customer asks where to find something or lacks context, knowledge search is always allowed and should stay native.',
      'Rule 4 — If the customer explicitly requests a person, or progress stalls, request human handoff instead of looping.',
      'Rule 5 — Do not finalize until the latest evidence fits the latest inputEpoch.',
    )

    return lines.join('\n')
  }

  private renderV2Step(step: ProcedureV2Step, index: number): string {
    const lines = [
      `  ${index + 1}. ${step.title}`,
      `       — ${step.guidance}`,
    ]
    if (step.actions.length) {
      lines.push('       Actions:')
      for (const action of step.actions) {
        lines.push(`       - ${buildProcedureActionSummary(action)}`)
        if (action.guidance) lines.push(`         ${action.guidance}`)
      }
    }
    if (step.branches?.length) {
      lines.push('       Branches:')
      for (const branch of step.branches) {
        const branchLabel = branch.kind === 'else_if' ? 'ELSE IF' : branch.kind.toUpperCase()
        const condition = branch.condition ? buildProcedureConditionLabel(branch.condition) : 'fallback'
        lines.push(`       - ${branchLabel}: ${condition}`)
        for (const action of branch.actions) {
          lines.push(`         * ${buildProcedureActionSummary(action)}`)
          if (action.guidance) lines.push(`           ${action.guidance}`)
        }
        if (branch.guidance) lines.push(`         ${branch.guidance}`)
      }
    }
    if (step.skipGuidance) lines.push(`       Skip guidance: ${step.skipGuidance}`)
    if (step.completionGuidance) lines.push(`       Completion: ${step.completionGuidance}`)
    return lines.join('\n')
  }

  private v2StepMatchesTool(step: ProcedureV2Step, toolName: string): boolean {
    return this.collectV2Actions(step).some((action) => this.v2ActionMatchesTool(action, toolName))
  }

  private collectV2Actions(step: ProcedureV2Step): ProcedureV2Action[] {
    return [
      ...step.actions,
      ...(step.branches?.flatMap((branch) => branch.actions) ?? []),
    ]
  }

  private v2ActionMatchesTool(action: ProcedureV2Action, toolName: string): boolean {
    switch (action.kind) {
      case 'call_tool':
        return action.toolName === toolName
      case 'search_knowledge':
        return this.knowledgeToolNames.has(toolName)
      case 'ask':
        return toolName === 'ask_user_questions'
      case 'request_human_handoff':
        return toolName === 'create_human_task'
      case 'end':
        return toolName === 'finalize_procedure'
    }
  }
}

function collectStepActions(step: ProcedureV2Step): ProcedureV2Action[] {
  return [
    ...step.actions,
    ...(step.branches?.flatMap((branch) => branch.actions) ?? []),
  ]
}
