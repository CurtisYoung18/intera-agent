// Procedure Executor — structured single-agent Procedure runtime.
//
// A Procedure is an ordered list of steps (closed action vocab) executed by the
// single main customer-facing Agent. The prompt is rendered from typed steps and
// completion is gated on the required steps + finalize.

import type { Procedure, TodoItem } from '@intera/shared/types'
import type {
  ProcedureDefinition,
  ProcedureStep,
  ProcedureV2,
  ProcedureV2Action,
  ProcedureV2Branch,
  ProcedureV2Step,
} from '@intera/shared/types'
import {
  buildProcedureActionSummary,
  buildProcedureConditionLabel,
  isProcedureV2Definition,
  normalizeProcedureDefinition,
} from '@intera/shared/contracts/case-types'

const ACTION_LABEL: Record<string, string> = {
  use: 'Use tool',
  read: 'Read',
  ask: 'Ask customer',
  decide: 'Decide',
  tag: 'Tag',
  escalate: 'Escalate',
  finalize: 'Finalize',
}

/** Render the ordered Procedure steps as a Fin-style numbered checklist for the system prompt. */
export function renderProcedureSteps(procedure: Procedure): string {
  if (!procedure.steps.length) {
    return '  (no steps defined — use your best judgment to investigate and resolve.)'
  }
  return procedure.steps
    .map((s, i) => {
      const label = ACTION_LABEL[s.action] ?? s.action
      const head = [`  ${i + 1}. ${label}`]
      if (s.target) head.push(s.target)
      if (s.required) head.push('(required)')
      let line = head.join(' ')
      if (s.when) line += `\n       — only when: ${s.when}`
      if (s.guidance) line += `\n       — ${s.guidance}`
      return line
    })
    .join('\n')
}

/** Seed the agent's todo list from the Procedure steps (one pending todo per step, in order). */
export function seedProcedureTodos(procedure: Procedure): TodoItem[] {
  const now = new Date().toISOString()
  return procedure.steps.map((s) => ({
    id: s.id,
    text: `[${s.action}]${s.target ? ` ${s.target}` : ''}${s.guidance ? ` — ${s.guidance}` : ''}`,
    status: 'pending' as const,
    addedBy: 'procedure_init' as const,
    addedAt: now,
  }))
}

/**
 * Tool targets that the Procedure hard-requires before completion: required `use`/`read`
 * steps with a concrete target and NO `when` condition. A `when`-gated step is conditional —
 * the agent skips it when the condition is false, so it is not part of the hard completion gate.
 */
export function requiredToolTargets(procedure: Procedure): string[] {
  return procedure.steps
    .filter((s) => s.required && !s.when && (s.action === 'use' || s.action === 'read') && !!s.target)
    .map((s) => s.target as string)
}

/**
 * Completion check: every hard-required tool target has been called and a finalize
 * step has been reached.
 */
export function isProcedureComplete(
  procedure: Procedure,
  state: { calledTools: string[]; finalized: boolean },
): boolean {
  if (!state.finalized) return false
  const called = new Set(state.calledTools)
  return requiredToolTargets(procedure).every((t) => called.has(t))
}

/**
 * Renders a Procedure into the case-mode system prompt and exposes the completion gate.
 * Held by CaseAgentLoop when the case type carries a `procedure`.
 */
export class ProcedureExecutor {
  private readonly normalizedProcedure: Procedure
  private readonly definition: ProcedureDefinition

  constructor(
    procedure: Procedure | ProcedureDefinition,
    private readonly caseType: string,
  ) {
    this.definition = procedure
    this.normalizedProcedure = normalizeProcedureDefinition(procedure)
  }

  /** Build the Procedure-mode system prompt (mirrors buildSopPrompt but from typed steps). */
  buildPrompt(
    basePrompt: string,
    stage: string,
    todos: TodoItem[],
    facts: Record<string, unknown>,
  ): string {
    const todoLines =
      todos.length === 0
        ? '  (none tracked yet — follow the procedure steps below in order.)'
        : todos
            .map((t) => {
              const icon =
                t.status === 'completed' ? '✓' : t.status === 'cancelled' ? '✗' : t.status === 'in_progress' ? '→' : '○'
              const notes = t.notes ? ` — ${t.notes}` : ''
              return `  [${icon}] ${t.id} ${t.text}${notes}`
            })
            .join('\n')

    const factLines =
      Object.entries(facts).length === 0
        ? '  (none yet)'
        : Object.entries(facts)
            .filter(([k]) => !k.startsWith('__'))
            .map(([k, v]) => `  ${k}: ${JSON.stringify(v)}`)
            .join('\n')
    const runtimeTruthBlock = isProcedureV2Definition(this.definition)
      ? [
          '## Runtime Truth',
          'Use the dynamic ProcedureRun tail for inputs, evidence, evaluator receipts, blockers, and reconcile state.',
          'Do not treat chat-memory confirmed facts as Procedure v2 authority.',
          '',
        ].join('\n')
      : [
          '## Confirmed Facts',
          factLines,
          '',
        ].join('\n')

    const tail = [
      `## Procedure Execution Context`,
      `- procedureType: ${this.caseType}`,
      `- stage: ${stage}`,
      '',
      'Follow the ordered Procedure below using tools — one agent,',
      'no hand-offs. Text-only assertions are not sufficient.',
      '',
      '## Procedure (follow in order; adapt only as the rules allow)',
      this.renderOrderedDefinition(),
      '',
      '## Current Todos',
      todoLines,
      '',
      runtimeTruthBlock,
      '## EXECUTION RULES',
      'Rule 1 — Work the steps in order. Call the prescribed tool for each step.',
      'Rule 2 — A step marked "only when …" is conditional: skip it (no action) when its',
      '         condition is false; do NOT announce the skip.',
      'Rule 3 — Do not finalize until every required step has been completed with its tool.',
      'Rule 4 — If you are blocked or the customer needs something only a human can do,',
      '         call create_human_task to escalate rather than guessing.',
    ].join('\n')

    return basePrompt + '\n\n' + tail
  }

  /** Tool targets the procedure hard-requires before completion. */
  requiredTools(): string[] {
    return requiredToolTargets(this.normalizedProcedure)
  }

  /** Stable-ish Procedure definition block; runtime state is appended separately by AgentLoop. */
  buildDefinitionPrompt(): string {
    if (isProcedureV2Definition(this.definition)) {
      return this.buildV2DefinitionPrompt(this.definition)
    }
    return [
      `Procedure type: ${this.caseType}`,
      '',
      '## Ordered Procedure Steps',
      renderProcedureSteps(this.normalizedProcedure),
      '',
      '## Procedure Rules',
      'Rule 1 — Work the steps in order unless the runtime tail says reconciliation is required.',
      'Rule 2 — A step marked "only when …" is conditional: skip it when false without announcing the skip.',
      'Rule 3 — Do not finalize until required evidence is current for the latest inputEpoch.',
      'Rule 4 — If blocked or the customer needs something only a human can do, call create_human_task.',
    ].join('\n')
  }

  /** Step ids that are relevant for a Tool checkpoint in the current turn. */
  stepIdsForTool(toolName: string | undefined, todos: TodoItem[]): string[] {
    if (!toolName) return this.activeTodoStepIds(todos)
    const matchingTargets = isProcedureV2Definition(this.definition)
      ? this.definition.steps
          .filter((step) => this.v2StepMatchesTool(step, toolName))
          .map((step) => step.id)
      : this.normalizedProcedure.steps
          .filter((s) => (s.action === 'use' || s.action === 'read') && s.target === toolName)
          .map((s) => s.id)
    return [...new Set([...matchingTargets, ...this.activeTodoStepIds(todos)])]
  }

  /** Step ids that should be in scope for Stop checks in the current turn. */
  stepIdsForStop(todos: TodoItem[]): string[] {
    const active = this.activeTodoStepIds(todos)
    const completed = todos
      .filter((todo) => todo.status === 'completed')
      .map((todo) => todo.id)
    return [...new Set([...active, ...completed])]
  }

  /** Completion gate — see {@link isProcedureComplete}. */
  isComplete(state: { calledTools: string[]; finalized: boolean }): boolean {
    return isProcedureComplete(this.normalizedProcedure, state)
  }

  private activeTodoStepIds(todos: TodoItem[]): string[] {
    const ids = new Set(this.normalizedProcedure.steps.map((step) => step.id))
    const active = todos
      .filter((todo) => ids.has(todo.id) && (todo.status === 'pending' || todo.status === 'in_progress'))
      .map((todo) => todo.id)
    if (active.length > 0) return active

    const firstUnfinished = this.normalizedProcedure.steps.find((step) => {
      const todo = todos.find((t) => t.id === step.id)
      return !todo || (todo.status !== 'completed' && todo.status !== 'cancelled')
    })
    return firstUnfinished ? [firstUnfinished.id] : []
  }

  private renderOrderedDefinition(): string {
    if (!isProcedureV2Definition(this.definition)) {
      return renderProcedureSteps(this.normalizedProcedure)
    }
    return this.definition.steps
      .map((step, index) => this.renderV2Step(step, index))
      .join('\n')
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
        return toolName.startsWith('kb_search_')
      case 'ask':
        return toolName === 'ask_user_questions'
      case 'request_human_handoff':
        return toolName === 'create_human_task'
      case 'end':
        return toolName === 'finalize_procedure'
    }
  }
}
