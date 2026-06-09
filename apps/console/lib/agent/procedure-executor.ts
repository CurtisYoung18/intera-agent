// Procedure Executor — structured single-agent Procedure runtime.
//
// A Procedure is an ordered list of steps (closed action vocab) executed by the
// single main agent (Case Owner). The prompt is rendered from typed steps and
// completion is gated on the required steps + finalize.

import type { Procedure, TodoItem } from '@intera/shared/types'

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
  constructor(
    private readonly procedure: Procedure,
    private readonly caseType: string,
  ) {}

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

    const header = [
      `[INTERA MODE: PROCEDURE EXECUTION | type: ${this.caseType} | stage: ${stage}]`,
      '',
      'You are the Case Owner. Follow the ordered Procedure below using tools — one agent,',
      'no hand-offs. Text-only assertions are not sufficient.',
      '',
      '## Procedure (follow in order; adapt only as the rules allow)',
      renderProcedureSteps(this.procedure),
      '',
      '## Current Todos',
      todoLines,
      '',
      '## Confirmed Facts',
      factLines,
      '',
      '## EXECUTION RULES',
      'Rule 1 — Work the steps in order. Call the prescribed tool for each step.',
      'Rule 2 — A step marked "only when …" is conditional: skip it (no action) when its',
      '         condition is false; do NOT announce the skip.',
      'Rule 3 — Do not finalize until every required step has been completed with its tool.',
      'Rule 4 — If you are blocked or the customer needs something only a human can do,',
      '         call create_human_task to escalate rather than guessing.',
    ].join('\n')

    return header + '\n\n' + basePrompt
  }

  /** Tool targets the procedure hard-requires before completion. */
  requiredTools(): string[] {
    return requiredToolTargets(this.procedure)
  }

  /** Step ids that are relevant for a Tool checkpoint in the current turn. */
  stepIdsForTool(toolName: string | undefined, todos: TodoItem[]): string[] {
    if (!toolName) return this.activeTodoStepIds(todos)
    const matchingTargets = this.procedure.steps
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
    return isProcedureComplete(this.procedure, state)
  }

  private activeTodoStepIds(todos: TodoItem[]): string[] {
    const ids = new Set(this.procedure.steps.map((step) => step.id))
    const active = todos
      .filter((todo) => ids.has(todo.id) && (todo.status === 'pending' || todo.status === 'in_progress'))
      .map((todo) => todo.id)
    if (active.length > 0) return active

    const firstUnfinished = this.procedure.steps.find((step) => {
      const todo = todos.find((t) => t.id === step.id)
      return !todo || (todo.status !== 'completed' && todo.status !== 'cancelled')
    })
    return firstUnfinished ? [firstUnfinished.id] : []
  }
}
