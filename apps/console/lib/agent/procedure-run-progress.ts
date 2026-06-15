import type { ProcedureRuntimeSignal, ProcedureV2Branch } from '@intera/shared/types'
import type {
  ProcedureRunBranchState,
  ProcedureRunConditionEvaluationState,
  ProcedureRunState,
  ProcedureRunStepState,
} from './procedure-run-state'

export function currentStep(run: ProcedureRunState): ProcedureRunStepState | undefined {
  return run.steps.find((step) => step.id === run.currentStepId)
}

export function refreshStepBranchStates(run: ProcedureRunState, step: ProcedureRunStepState): void {
  if (!step.branches?.length) return

  const lockedMatch = step.branches.find((branch) => branch.status === 'matched')
  if (lockedMatch) {
    for (const branch of step.branches) {
      if (branch.id !== lockedMatch.id) {
        branch.status = 'skipped'
        branch.reason = branch.reason ?? 'Another branch already matched.'
      }
    }
    for (const action of step.actions ?? []) {
      if (action.branchId && action.branchId !== lockedMatch.id && action.status === 'pending') {
        action.status = 'skipped'
      }
    }
    return
  }

  let matchedBranchId: string | undefined
  let hasPendingCondition = false

  for (const branch of step.branches) {
    if (branch.kind === 'else') {
      if (matchedBranchId) {
        branch.status = 'skipped'
        branch.reason = 'Another branch already matched.'
      } else if (hasPendingCondition) {
        branch.status = 'pending'
        branch.reason = 'Waiting for earlier branch evidence.'
      } else {
        branch.status = 'matched'
        branch.reason = branch.reason ?? 'Fallback branch matched.'
        matchedBranchId = branch.id
      }
      continue
    }

    const evaluation = evaluateBranchCondition(run, branch)
    if (evaluation.status === 'matched' && !matchedBranchId) {
      branch.status = 'matched'
      branch.reason = evaluation.reason
      matchedBranchId = branch.id
      continue
    }

    if (evaluation.status === 'skipped') {
      branch.status = 'skipped'
      branch.reason = evaluation.reason
      continue
    }

    branch.status = 'pending'
    branch.reason = evaluation.reason
    hasPendingCondition = true
  }

  if (matchedBranchId) {
    for (const branch of step.branches) {
      if (branch.id !== matchedBranchId) {
        branch.status = 'skipped'
        branch.reason = 'Another branch already matched.'
      }
    }
    for (const action of step.actions ?? []) {
      if (action.branchId && action.branchId !== matchedBranchId && action.status === 'pending') {
        action.status = 'skipped'
      }
    }
  }
}

interface BranchConditionResolution {
  status: 'matched' | 'skipped' | 'pending'
  reason: string
}

function evaluateBranchCondition(
  run: ProcedureRunState,
  branch: ProcedureRunBranchState,
): BranchConditionResolution {
  const definition = findBranchDefinition(run, branch.id)
  const condition = definition?.condition
  if (!condition) {
    return {
      status: branch.kind === 'else' ? 'matched' : 'pending',
      reason: branch.kind === 'else'
        ? 'Fallback branch matched.'
        : 'Waiting for runtime condition data.',
    }
  }

  switch (condition.kind) {
    case 'llm_eval': {
      const latest = latestConditionEvaluation(run, branch.id, condition.id ?? branch.id)
      if (!latest || latest.basedOnInputEpoch < run.inputEpoch) {
        return {
          status: 'pending',
          reason: 'Waiting for a current llm_eval evaluator receipt.',
        }
      }
      if (latest.decision === 'matched') {
        return { status: 'matched', reason: latest.reason || 'llm_eval matched.' }
      }
      if (latest.decision === 'skipped') {
        return { status: 'skipped', reason: latest.reason || 'llm_eval did not match.' }
      }
      return {
        status: 'pending',
        reason: latest.reason || 'llm_eval is pending or unavailable.',
      }
    }
    case 'runtime_signal': {
      const signal = run.signals.find((entry) => entry.signal === condition.signal && entry.active)
      if (signal) {
        return {
          status: 'matched',
          reason: `Runtime signal "${condition.signal}" is active: ${signal.reason}`,
        }
      }
      return {
        status: 'skipped',
        reason: `Runtime signal "${condition.signal}" was not active when this branch was evaluated.`,
      }
    }
    case 'form_field': {
      const formEvidence = run.evidence.filter((entry) => entry.kind === 'form')
      if (formEvidence.length === 0) {
        return { status: 'pending', reason: 'Waiting for form evidence.' }
      }
      const matchingField = formEvidence.find((entry) => entry.metadata?.field === condition.field)
      if (!matchingField) {
        return { status: 'skipped', reason: `No form evidence captured for ${condition.field}.` }
      }
      const value = typeof matchingField.metadata?.value === 'string' ? matchingField.metadata.value : undefined
      if (condition.operator === 'equals') {
        return value === condition.value
          ? { status: 'matched', reason: `Form field ${condition.field} equals ${condition.value}.` }
          : { status: 'skipped', reason: `Form field ${condition.field} did not equal ${condition.value}.` }
      }
      return value
        ? { status: 'matched', reason: `Form field ${condition.field} is present.` }
        : { status: 'skipped', reason: `Form field ${condition.field} is missing.` }
    }
    case 'tool_event': {
      const sawCall = run.timeline.some((event) =>
        event.source === 'tool_call' && event.metadata?.toolName === condition.toolName,
      )
      const toolEvidence = run.evidence.filter((entry) => entry.toolName === condition.toolName)
      if (!sawCall && toolEvidence.length === 0) {
        return { status: 'pending', reason: `Waiting for ${condition.toolName} to run.` }
      }
      if (condition.event === 'called') {
        return sawCall
          ? { status: 'matched', reason: `${condition.toolName} was called.` }
          : { status: 'pending', reason: `Waiting for ${condition.toolName} to be called.` }
      }
      if (condition.event === 'stale') {
        return toolEvidence.some((entry) => entry.state === 'stale')
          ? { status: 'matched', reason: `${condition.toolName} produced stale evidence.` }
          : { status: 'skipped', reason: `${condition.toolName} has no stale evidence.` }
      }
      if (condition.event === 'failed') {
        return toolEvidence.some((entry) => entry.metadata?.outcome === 'failed' || entry.metadata?.outcome === 'schema_invalid')
          ? { status: 'matched', reason: `${condition.toolName} failed.` }
          : { status: 'skipped', reason: `${condition.toolName} has not failed.` }
      }
      if (condition.event === 'empty_result') {
        return toolEvidence.some((entry) => entry.metadata?.outcome === 'empty_result')
          ? { status: 'matched', reason: `${condition.toolName} returned an empty result.` }
          : { status: 'skipped', reason: `${condition.toolName} has not returned an empty result.` }
      }
      return toolEvidence.some((entry) => entry.state === 'canonical' && entry.metadata?.outcome === 'succeeded')
        ? { status: 'matched', reason: `${condition.toolName} succeeded.` }
        : { status: 'skipped', reason: `${condition.toolName} has not succeeded.` }
    }
  }
}

export function latestConditionEvaluation(
  run: ProcedureRunState,
  branchId: string,
  conditionId: string,
): ProcedureRunConditionEvaluationState | undefined {
  return [...run.evaluations]
    .filter((entry) => entry.branchId === branchId && entry.conditionId === conditionId)
    .sort((left, right) =>
      left.basedOnInputEpoch === right.basedOnInputEpoch
        ? right.createdAt.localeCompare(left.createdAt)
        : right.basedOnInputEpoch - left.basedOnInputEpoch,
    )[0]
}

export function findBranchDefinition(
  run: ProcedureRunState,
  branchId: string,
): ProcedureV2Branch | undefined {
  if (!run.definition) return undefined
  for (const step of run.definition.steps) {
    const branch = (step.branches ?? []).find((candidate) => candidate.id === branchId)
    if (branch) return branch
  }
  return undefined
}

export function syncCurrentStepAfterProgress(run: ProcedureRunState, now = new Date().toISOString()): void {
  const current = currentStep(run)
  if (current) {
    refreshStepBranchStates(run, current)
    maybeCompleteStep(run, current, now)
  }

  const active = currentStep(run)
  if (active && (active.status === 'active' || active.status === 'blocked')) {
    run.currentStepId = active.id
    return
  }

  const next = run.steps.find((step) => step.status === 'pending')
  if (next) {
    next.status = 'active'
    next.startedAt = next.startedAt ?? now
    run.currentStepId = next.id
    return
  }

  const lastCompleted = lastMatchingStep(run.steps, (step) => step.status === 'completed' || step.status === 'skipped')
  run.currentStepId = lastCompleted?.id ?? run.currentStepId
}

function maybeCompleteStep(run: ProcedureRunState, step: ProcedureRunStepState, now: string): void {
  if (step.status === 'completed' || step.status === 'skipped') return

  if (!step.actions?.length) {
    step.status = 'completed'
    step.completedAt = step.completedAt ?? now
    step.completionReason = step.completionReason ?? 'No executable actions remained for this step.'
    return
  }

  const matchedBranchId = step.branches?.find((branch) => branch.status === 'matched')?.id
  const relevantActions = (step.actions ?? []).filter((action) => !action.branchId || action.branchId === matchedBranchId)
  if (relevantActions.length === 0) {
    // Branch-only step where no branch matched: once every branch is resolved
    // (none pending), there is nothing left to execute - complete the step so
    // the run cannot deadlock on a never-matching branch.
    const branches = step.branches ?? []
    if (branches.length > 0 && branches.every((branch) => branch.status !== 'pending')) {
      step.status = 'completed'
      step.completedAt = step.completedAt ?? now
      step.completionReason = step.completionReason ?? 'All branches resolved with no applicable actions.'
    }
    return
  }

  const pendingRequired = relevantActions.filter((action) =>
    action.required !== false &&
    action.status !== 'completed' &&
    action.status !== 'skipped',
  )
  if (pendingRequired.length > 0) {
    if (step.status !== 'blocked') step.status = 'active'
    return
  }

  if (relevantActions.some((action) => action.status === 'completed' || action.status === 'skipped')) {
    step.status = 'completed'
    step.completedAt = step.completedAt ?? now
    step.completionReason = step.completionReason ?? 'Required runtime evidence collected.'
    clearProcedureSignal(run, 'no_progress_loop')
    clearProcedureSignal(run, 'knowledge_gap')
  }
}

function lastMatchingStep(
  steps: ProcedureRunStepState[],
  predicate: (step: ProcedureRunStepState) => boolean,
): ProcedureRunStepState | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (predicate(steps[index])) return steps[index]
  }
  return undefined
}

export function markBranchMatched(step: ProcedureRunStepState, branchId: string, reason: string): void {
  for (const branch of step.branches ?? []) {
    if (branch.id === branchId) {
      branch.status = 'matched'
      branch.reason = reason
      continue
    }
    branch.status = 'skipped'
    branch.reason = 'Another branch already matched.'
  }
  for (const action of step.actions ?? []) {
    if (action.branchId && action.branchId !== branchId && action.status === 'pending') {
      action.status = 'skipped'
    }
  }
}

function clearProcedureSignal(run: ProcedureRunState, signal: ProcedureRuntimeSignal): void {
  const existing = run.signals.find((entry) => entry.signal === signal)
  if (existing) existing.active = false
}
