import { z } from 'zod'
import type {
  ProcedureCondition as SharedProcedureCondition,
  ProcedureV2Action as SharedProcedureV2Action,
} from '../types'

export const PROCEDURE_V2_ACTION_KINDS = [
  'ask',
  'search_knowledge',
  'call_tool',
  'request_human_handoff',
  'end',
] as const
export const procedureV2ActionKindSchema = z.enum(PROCEDURE_V2_ACTION_KINDS)
export type ProcedureV2ActionKindContract = z.infer<typeof procedureV2ActionKindSchema>

export const PROCEDURE_CONDITION_KINDS = [
  'llm_eval',
  'tool_event',
  'form_field',
  'runtime_signal',
] as const
export const procedureConditionKindSchema = z.enum(PROCEDURE_CONDITION_KINDS)

export const PROCEDURE_RUNTIME_SIGNALS = [
  'no_progress_loop',
  'knowledge_gap',
] as const
export const procedureRuntimeSignalSchema = z.enum(PROCEDURE_RUNTIME_SIGNALS)
export type ProcedureRuntimeSignalContract = z.infer<typeof procedureRuntimeSignalSchema>

export const procedureRuntimeSignalDetectorSchema = z.object({
  signal: procedureRuntimeSignalSchema,
  patterns: z.array(z.string().min(1)).default([]),
  reason: z.string().optional(),
})
export type ProcedureRuntimeSignalDetectorContract = z.infer<typeof procedureRuntimeSignalDetectorSchema>

export const procedureConditionSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.string().min(1).optional(),
    kind: z.literal('llm_eval'),
    label: z.string().optional(),
    prompt: z.string().min(1, 'llm_eval prompt is required'),
  }),
  z.object({
    id: z.string().min(1).optional(),
    kind: z.literal('tool_event'),
    label: z.string().optional(),
    toolName: z.string().min(1, 'tool name is required'),
    event: z.enum(['called', 'succeeded', 'failed', 'stale', 'empty_result']).default('succeeded'),
  }),
  z.object({
    id: z.string().min(1).optional(),
    kind: z.literal('form_field'),
    label: z.string().optional(),
    field: z.string().min(1, 'form field is required'),
    operator: z.enum(['present', 'equals']).default('present'),
    value: z.string().optional(),
  }),
  z.object({
    id: z.string().min(1).optional(),
    kind: z.literal('runtime_signal'),
    label: z.string().optional(),
    signal: procedureRuntimeSignalSchema,
  }),
])
export type ProcedureConditionContract = z.infer<typeof procedureConditionSchema>

const actionBaseSchema = z.object({
  id: z.string().min(1, 'action id is required'),
  label: z.string().min(1, 'action label is required'),
  guidance: z.string().optional(),
  required: z.boolean().optional(),
})

export const procedureV2ActionSchema = z.discriminatedUnion('kind', [
  actionBaseSchema.extend({
    kind: z.literal('ask'),
    fields: z.array(z.string()).default([]),
  }),
  actionBaseSchema.extend({
    kind: z.literal('search_knowledge'),
    suggestedSources: z.array(z.string()).default([]),
  }),
  actionBaseSchema.extend({
    kind: z.literal('call_tool'),
    toolName: z.string().min(1, 'tool name is required'),
  }),
  actionBaseSchema.extend({
    kind: z.literal('request_human_handoff'),
    queue: z.string().optional(),
  }),
  actionBaseSchema.extend({
    kind: z.literal('end'),
    status: z.enum(['completed', 'cancelled']).default('completed'),
  }),
])
export type ProcedureV2ActionContract = z.infer<typeof procedureV2ActionSchema>

export const procedureV2BranchSchema = z.object({
  id: z.string().min(1, 'branch id is required'),
  kind: z.enum(['if', 'else_if', 'else']),
  label: z.string().optional(),
  condition: procedureConditionSchema.optional(),
  guidance: z.string().optional(),
  actions: z.array(procedureV2ActionSchema).min(1, 'branch requires at least one action'),
})
export type ProcedureV2BranchContract = z.infer<typeof procedureV2BranchSchema>

export const procedureV2StepSchema = z.object({
  id: z.string().min(1, 'step id is required'),
  title: z.string().min(1, 'step title is required'),
  guidance: z.string().min(1, 'step guidance is required'),
  actions: z.array(procedureV2ActionSchema).default([]),
  branches: z.array(procedureV2BranchSchema).default([]),
  skipGuidance: z.string().optional(),
  completionGuidance: z.string().optional(),
})
export type ProcedureV2StepContract = z.infer<typeof procedureV2StepSchema>

export const procedureV2Schema = z.object({
  version: z.literal('v2'),
  whenToUse: z.string().min(1, 'whenToUse is required'),
  overview: z.string().optional(),
  knowledgeGuidance: z.string().optional(),
  handoffGuidance: z.string().optional(),
  runtimeSignalDetectors: z.array(procedureRuntimeSignalDetectorSchema).default([]),
  steps: z.array(procedureV2StepSchema).min(1, 'at least one step is required'),
})
export type ProcedureV2Contract = z.infer<typeof procedureV2Schema>

export const procedureSimulationInputSchema = z.object({
  signals: z.array(procedureRuntimeSignalSchema).default([]),
  toolNames: z.array(z.string()).default([]),
  knowledgeToolNames: z.array(z.string()).default([]),
  formFields: z.array(z.string()).default([]),
  knowledgeSearches: z.number().int().nonnegative().default(0),
  handoffRequested: z.boolean().default(false),
  ended: z.boolean().default(false),
  matchedLlmConditionIds: z.array(z.string()).default([]),
})
export type ProcedureSimulationInputContract = z.infer<typeof procedureSimulationInputSchema>

export const procedureSimulationStepSchema = z.object({
  stepId: z.string(),
  title: z.string(),
  status: z.enum(['pending', 'active', 'completed', 'skipped']),
  matchedBranchId: z.string().optional(),
  reason: z.string().optional(),
})
export type ProcedureSimulationStepContract = z.infer<typeof procedureSimulationStepSchema>

export const procedureSimulationReceiptSchema = z.object({
  status: z.enum(['ready', 'completed', 'handoff']),
  activeStepId: z.string().optional(),
  steps: z.array(procedureSimulationStepSchema),
  notes: z.array(z.string()).default([]),
  matchedSignals: z.array(procedureRuntimeSignalSchema).default([]),
})
export type ProcedureSimulationReceiptContract = z.infer<typeof procedureSimulationReceiptSchema>

export function parseProcedure(json: string | null | undefined): ProcedureV2Contract | null {
  if (!json) return null
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  const parsed = procedureV2Schema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

export function buildProcedureConditionLabel(
  condition?: ProcedureConditionContract | SharedProcedureCondition | null,
): string {
  if (!condition) return 'No condition'
  switch (condition.kind) {
    case 'llm_eval':
      return condition.label?.trim() || condition.prompt.trim()
    case 'tool_event':
      return condition.label?.trim() || `${condition.toolName} ${condition.event}`
    case 'form_field':
      return condition.label?.trim() || (
        condition.operator === 'equals' && condition.value
          ? `${condition.field} equals ${condition.value}`
          : `${condition.field} is present`
      )
    case 'runtime_signal':
      return condition.label?.trim() || condition.signal.replace(/_/g, ' ')
  }
}

export function buildProcedureActionSummary(
  action: ProcedureV2ActionContract | SharedProcedureV2Action,
): string {
  switch (action.kind) {
    case 'ask':
      return `${action.label} (ask${action.fields?.length ? `: ${action.fields.join(', ')}` : ''})`
    case 'search_knowledge':
      return `${action.label} (knowledge${action.suggestedSources?.length ? `: ${action.suggestedSources.join(', ')}` : ''})`
    case 'call_tool':
      return `${action.label} (${action.toolName})`
    case 'request_human_handoff':
      return `${action.label}${action.queue ? ` (${action.queue})` : ''}`
    case 'end':
      return `${action.label} (${action.status})`
  }
}

export function simulateProcedure(
  definition: ProcedureV2Contract,
  rawInput?: Partial<ProcedureSimulationInputContract>,
): ProcedureSimulationReceiptContract {
  const input = procedureSimulationInputSchema.parse(rawInput ?? {})
  const steps: ProcedureSimulationStepContract[] = []
  const notes: string[] = []
  let status: ProcedureSimulationReceiptContract['status'] = 'ready'
  let activeStepId: string | undefined

  for (let index = 0; index < definition.steps.length; index += 1) {
    const step = definition.steps[index]
    const branch = findMatchingBranch(step, input)
    const actions = branch?.actions.length ? branch.actions : step.actions
    const matchedAction = actions.find((action) => actionMatchesSimulation(action, input))
    const matchedStatus = matchedAction
      ? matchedAction.kind === 'request_human_handoff'
        ? 'handoff'
        : matchedAction.kind === 'end'
          ? 'completed'
          : 'ready'
      : 'ready'

    if (matchedAction) {
      steps.push({
        stepId: step.id,
        title: step.title,
        status: 'completed',
        matchedBranchId: branch?.id,
        reason: buildProcedureActionSummary(matchedAction),
      })
      if (matchedAction.kind === 'request_human_handoff') {
        status = 'handoff'
      } else if (matchedAction.kind === 'end' && status !== 'handoff') {
        status = 'completed'
      }
      continue
    }

    const stepStatus = activeStepId ? 'pending' : 'active'
    if (!activeStepId) activeStepId = step.id
    if (branch?.condition?.kind === 'llm_eval' && !input.matchedLlmConditionIds.includes(branch.condition.id ?? '')) {
      notes.push(`Preview only: llm_eval for "${step.title}" needs a runtime evaluator receipt before production validation.`)
    }
    if (branch?.condition?.kind === 'runtime_signal') {
      notes.push(`Preview only: runtime_signal branches for "${step.title}" are safety hints, not production truth gates.`)
    }
    steps.push({
      stepId: step.id,
      title: step.title,
      status: stepStatus,
      matchedBranchId: branch?.id,
      reason: branch ? buildProcedureConditionLabel(branch.condition) : undefined,
    })
  }

  return procedureSimulationReceiptSchema.parse({
    status,
    activeStepId,
    steps,
    notes,
    matchedSignals: input.signals,
  })
}

function findMatchingBranch(
  step: ProcedureV2StepContract,
  input: ProcedureSimulationInputContract,
): ProcedureV2BranchContract | undefined {
  for (const branch of step.branches ?? []) {
    if (!branch.condition) {
      if (branch.kind === 'else') return branch
      continue
    }
    if (conditionMatchesSimulation(branch.condition, input)) return branch
  }
  return step.branches?.find((branch) => branch.kind === 'else')
}

function conditionMatchesSimulation(
  condition: ProcedureConditionContract | SharedProcedureCondition,
  input: ProcedureSimulationInputContract,
): boolean {
  switch (condition.kind) {
    case 'tool_event':
      return input.toolNames.includes(condition.toolName) ||
        input.knowledgeToolNames.includes(condition.toolName)
    case 'form_field':
      return input.formFields.includes(condition.field)
    case 'runtime_signal':
      return input.signals.includes(condition.signal)
    case 'llm_eval':
      return condition.id ? input.matchedLlmConditionIds.includes(condition.id) : false
  }
}

function actionMatchesSimulation(
  action: ProcedureV2ActionContract | SharedProcedureV2Action,
  input: ProcedureSimulationInputContract,
): boolean {
  switch (action.kind) {
    case 'ask':
      return !action.fields?.length || action.fields.some((field) => input.formFields.includes(field))
    case 'search_knowledge':
      return input.knowledgeSearches > 0
    case 'call_tool':
      return input.toolNames.includes(action.toolName)
    case 'request_human_handoff':
      return input.handoffRequested
    case 'end':
      return input.ended
  }
}
