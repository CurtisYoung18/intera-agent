'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowUpRight, CheckCircle2, GitBranch, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { BuildComponentsRouteShell } from '../../_components/components-route-shell'
import { useConsoleLocale } from '@/components/locale-provider'
import ChipInput from '@/components/ui/chip-input'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import { PageLoader } from '@/components/ui/page-loader'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import type { TranslateFn } from '@/lib/i18n/types'
import {
  isProcedureV2Definition,
  parseProcedure,
  parseProcedureDefinition,
  PROCEDURE_CONDITION_KINDS,
  PROCEDURE_RUNTIME_SIGNALS,
  PROCEDURE_V2_ACTION_KINDS,
  simulateProcedureDefinition,
  type CaseTypeItem,
  type ProcedureRuntimeSignalContract,
  type ProcedureSimulationInputContract,
  type ProcedureV2ActionContract,
  type ProcedureV2ActionKindContract,
  type ProcedureV2BranchContract,
  type ProcedureV2Contract,
  type ProcedureV2StepContract,
} from '@intera/shared/contracts/case-types'

type HookBinding = {
  id: string
  hookName?: string | null
  scopeType: 'agent' | 'caseType' | 'procedureStep' | 'tool'
  scopeKey: string
  caseTypeId?: string | null
  procedureStepId?: string | null
  enabled: boolean
}

type ProcedureHook = {
  id: string
  name: string
  displayName?: string | null
  enabled: boolean
  bindings: HookBinding[]
}

type ActionDraft = {
  id: string
  kind: ProcedureV2ActionKindContract
  label: string
  guidance: string
  required: boolean
  fields: string[]
  suggestedSources: string[]
  toolName: string
  queue: string
  endStatus: 'completed' | 'cancelled'
}

type BranchDraft = {
  id: string
  kind: 'if' | 'else_if' | 'else'
  label: string
  guidance: string
  conditionKind: 'llm_eval' | 'tool_event' | 'form_field' | 'runtime_signal'
  conditionLabel: string
  llmPrompt: string
  toolName: string
  toolEvent: 'called' | 'succeeded' | 'failed' | 'stale' | 'empty_result'
  field: string
  operator: 'present' | 'equals'
  value: string
  signal: ProcedureRuntimeSignalContract
  actions: ActionDraft[]
}

type StepDraft = {
  id: string
  title: string
  guidance: string
  skipGuidance: string
  completionGuidance: string
  actions: ActionDraft[]
  branches: BranchDraft[]
}

type ProcedureEditorDraft = {
  type: string
  displayName: string
  description: string
  icon: string
  defaultGoal: string
  enabled: boolean
  maxAutoTurns: number
  requiredFacts: string[]
  escalateOn: string[]
  autoCloseConditions: string[]
  whenToUse: string
  overview: string
  knowledgeGuidance: string
  handoffGuidance: string
  steps: StepDraft[]
}

const TOOL_EVENTS = ['called', 'succeeded', 'failed', 'stale', 'empty_result'] as const
const BRANCH_KINDS = ['if', 'else_if', 'else'] as const
const END_STATUSES = ['completed', 'cancelled'] as const

function parseList(json: string | null | undefined) {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`
}

function actionLabel(t: TranslateFn, kind: ProcedureV2ActionKindContract) {
  switch (kind) {
    case 'ask':
      return t('procedureEditor.actionKind.ask')
    case 'search_knowledge':
      return t('procedureEditor.actionKind.searchKnowledge')
    case 'call_tool':
      return t('procedureEditor.actionKind.callTool')
    case 'request_human_handoff':
      return t('procedureEditor.actionKind.requestHumanHandoff')
    case 'end':
      return t('procedureEditor.actionKind.end')
  }
}

function branchKindLabel(t: TranslateFn, kind: BranchDraft['kind']) {
  switch (kind) {
    case 'if':
      return t('procedureEditor.branchKind.if')
    case 'else_if':
      return t('procedureEditor.branchKind.elseIf')
    case 'else':
      return t('procedureEditor.branchKind.else')
  }
}

function conditionKindLabel(t: TranslateFn, kind: BranchDraft['conditionKind']) {
  switch (kind) {
    case 'llm_eval':
      return t('procedureEditor.conditionKind.llmEval')
    case 'tool_event':
      return t('procedureEditor.conditionKind.toolEvent')
    case 'form_field':
      return t('procedureEditor.conditionKind.formField')
    case 'runtime_signal':
      return t('procedureEditor.conditionKind.runtimeSignal')
  }
}

function toolEventLabel(t: TranslateFn, event: BranchDraft['toolEvent']) {
  switch (event) {
    case 'called':
      return t('procedureEditor.toolEvent.called')
    case 'succeeded':
      return t('procedureEditor.toolEvent.succeeded')
    case 'failed':
      return t('procedureEditor.toolEvent.failed')
    case 'stale':
      return t('procedureEditor.toolEvent.stale')
    case 'empty_result':
      return t('procedureEditor.toolEvent.emptyResult')
  }
}

function endStatusLabel(t: TranslateFn, status: ActionDraft['endStatus']) {
  switch (status) {
    case 'completed':
      return t('procedureEditor.endStatus.completed')
    case 'cancelled':
      return t('procedureEditor.endStatus.cancelled')
  }
}

function runtimeSignalLabel(t: TranslateFn, signal: ProcedureRuntimeSignalContract) {
  switch (signal) {
    case 'explicit_human_request':
      return t('procedureEditor.runtimeSignal.explicitHumanRequest')
    case 'no_progress_loop':
      return t('procedureEditor.runtimeSignal.noProgressLoop')
    case 'knowledge_gap':
      return t('procedureEditor.runtimeSignal.knowledgeGap')
  }
}

function formOperatorLabel(t: TranslateFn, operator: BranchDraft['operator']) {
  switch (operator) {
    case 'present':
      return t('procedureEditor.formOperator.present')
    case 'equals':
      return t('procedureEditor.formOperator.equals')
  }
}

function simulationStatusLabel(t: TranslateFn, status: 'ready' | 'completed' | 'handoff') {
  switch (status) {
    case 'ready':
      return t('procedureEditor.simulation.status.ready')
    case 'completed':
      return t('procedureEditor.simulation.status.completed')
    case 'handoff':
      return t('procedureEditor.simulation.status.handoff')
  }
}

function simulationStepStatusLabel(t: TranslateFn, status: 'active' | 'completed' | 'pending' | 'skipped') {
  switch (status) {
    case 'active':
      return t('procedureEditor.simulation.stepStatus.active')
    case 'completed':
      return t('procedureEditor.simulation.stepStatus.completed')
    case 'pending':
      return t('procedureEditor.simulation.stepStatus.pending')
    case 'skipped':
      return t('procedureEditor.simulation.stepStatus.skipped')
  }
}

function summarizeCondition(t: TranslateFn, branch: ProcedureV2BranchContract) {
  const condition = branch.condition
  if (!condition) return t('procedureEditor.preview.noCondition')
  switch (condition.kind) {
    case 'llm_eval':
      return condition.label?.trim() || condition.prompt.trim()
    case 'tool_event':
      return condition.label?.trim() || `${condition.toolName} · ${toolEventLabel(t, condition.event)}`
    case 'form_field':
      return condition.label?.trim() || (
        condition.operator === 'equals' && condition.value
          ? `${condition.field} · ${formOperatorLabel(t, condition.operator)} · ${condition.value}`
          : `${condition.field} · ${formOperatorLabel(t, condition.operator)}`
      )
    case 'runtime_signal':
      return condition.label?.trim() || runtimeSignalLabel(t, condition.signal)
  }
}

function summarizeAction(t: TranslateFn, action: ProcedureV2ActionContract) {
  switch (action.kind) {
    case 'ask':
      return action.fields?.length ? `${action.label} (${action.fields.join(', ')})` : action.label
    case 'search_knowledge':
      return action.suggestedSources?.length ? `${action.label} (${action.suggestedSources.join(', ')})` : action.label
    case 'call_tool':
      return `${action.label} (${action.toolName})`
    case 'request_human_handoff':
      return action.queue ? `${action.label} (${action.queue})` : action.label
    case 'end':
      return `${action.label} (${endStatusLabel(t, action.status)})`
  }
}

function buildActionDraft(t: TranslateFn, kind: ProcedureV2ActionKindContract = 'ask', id?: string): ActionDraft {
  return {
    id: id ?? makeId('action'),
    kind,
    label: actionLabel(t, kind),
    guidance: '',
    required: true,
    fields: [],
    suggestedSources: [],
    toolName: '',
    queue: 'general',
    endStatus: 'completed',
  }
}

function buildBranchDraft(t: TranslateFn, kind: BranchDraft['kind'] = 'if', id?: string): BranchDraft {
  const branchId = id ?? makeId('branch')
  return {
    id: branchId,
    kind,
    label: '',
    guidance: '',
    conditionKind: 'llm_eval',
    conditionLabel: '',
    llmPrompt: '',
    toolName: '',
    toolEvent: 'succeeded',
    field: '',
    operator: 'present',
    value: '',
    signal: PROCEDURE_RUNTIME_SIGNALS[0],
    actions: [buildActionDraft(t, 'call_tool', `${branchId}_action`)],
  }
}

function buildStepDraft(t: TranslateFn, index: number, id?: string): StepDraft {
  const stepId = id ?? `step_${index + 1}`
  return {
    id: stepId,
    title: t('procedureEditor.defaults.stepTitle', { n: index + 1 }),
    guidance: '',
    skipGuidance: '',
    completionGuidance: '',
    actions: [buildActionDraft(t, 'ask', `${stepId}_ask`)],
    branches: [],
  }
}

function emptyToUndefined(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function titleFromLegacyStep(step: NonNullable<ReturnType<typeof parseProcedure>>['steps'][number]) {
  if (step.guidance?.trim()) return step.guidance.trim()
  if (step.target?.trim()) return `${step.action} ${step.target.trim()}`
  return `Handle ${step.action}`
}

function actionDraftFromContract(action: ProcedureV2ActionContract): ActionDraft {
  switch (action.kind) {
    case 'ask':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label,
        guidance: action.guidance || '',
        required: action.required !== false,
        fields: action.fields,
        suggestedSources: [],
        toolName: '',
        queue: 'general',
        endStatus: 'completed',
      }
    case 'search_knowledge':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label,
        guidance: action.guidance || '',
        required: action.required !== false,
        fields: [],
        suggestedSources: action.suggestedSources,
        toolName: '',
        queue: 'general',
        endStatus: 'completed',
      }
    case 'call_tool':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label,
        guidance: action.guidance || '',
        required: action.required !== false,
        fields: [],
        suggestedSources: [],
        toolName: action.toolName,
        queue: 'general',
        endStatus: 'completed',
      }
    case 'request_human_handoff':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label,
        guidance: action.guidance || '',
        required: action.required !== false,
        fields: [],
        suggestedSources: [],
        toolName: '',
        queue: action.queue || 'general',
        endStatus: 'completed',
      }
    case 'end':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label,
        guidance: action.guidance || '',
        required: action.required !== false,
        fields: [],
        suggestedSources: [],
        toolName: '',
        queue: 'general',
        endStatus: action.status,
      }
  }
}

function branchDraftFromContract(branch: ProcedureV2BranchContract): BranchDraft {
  return {
    id: branch.id,
    kind: branch.kind,
    label: branch.label || '',
    guidance: branch.guidance || '',
    conditionKind: branch.condition?.kind || 'llm_eval',
    conditionLabel: branch.condition?.label || '',
    llmPrompt: branch.condition?.kind === 'llm_eval' ? branch.condition.prompt : '',
    toolName: branch.condition?.kind === 'tool_event' ? branch.condition.toolName : '',
    toolEvent: branch.condition?.kind === 'tool_event' ? branch.condition.event : 'succeeded',
    field: branch.condition?.kind === 'form_field' ? branch.condition.field : '',
    operator: branch.condition?.kind === 'form_field' ? branch.condition.operator : 'present',
    value: branch.condition?.kind === 'form_field' ? branch.condition.value || '' : '',
    signal: branch.condition?.kind === 'runtime_signal' ? branch.condition.signal : PROCEDURE_RUNTIME_SIGNALS[0],
    actions: branch.actions.map(actionDraftFromContract),
  }
}

function stepDraftFromContract(step: ProcedureV2StepContract): StepDraft {
  return {
    id: step.id,
    title: step.title,
    guidance: step.guidance,
    skipGuidance: step.skipGuidance || '',
    completionGuidance: step.completionGuidance || '',
    actions: step.actions.map(actionDraftFromContract),
    branches: step.branches.map(branchDraftFromContract),
  }
}

function legacyActionDraft(t: TranslateFn, step: NonNullable<ReturnType<typeof parseProcedure>>['steps'][number]): ActionDraft {
  switch (step.action) {
    case 'ask':
      return {
        ...buildActionDraft(t, 'ask', `${step.id}_ask`),
        label: step.guidance?.trim() || t('procedureEditor.defaults.legacyAskLabel'),
        guidance: step.guidance || '',
        required: step.required !== false,
        fields: step.target ? step.target.split(',').map((value) => value.trim()).filter(Boolean) : [],
      }
    case 'read':
      return {
        ...buildActionDraft(t, 'search_knowledge', `${step.id}_kb`),
        label: step.guidance?.trim() || t('procedureEditor.defaults.legacyKnowledgeLabel'),
        guidance: step.guidance || '',
        required: step.required !== false,
        suggestedSources: step.target ? [step.target] : [],
      }
    case 'escalate':
      return {
        ...buildActionDraft(t, 'request_human_handoff', `${step.id}_handoff`),
        label: step.guidance?.trim() || t('procedureEditor.defaults.legacyHandoffLabel'),
        guidance: step.guidance || '',
        required: step.required !== false,
        queue: step.target || 'general',
      }
    case 'finalize':
      return {
        ...buildActionDraft(t, 'end', `${step.id}_end`),
        label: step.guidance?.trim() || t('procedureEditor.defaults.legacyEndLabel'),
        guidance: step.guidance || '',
        required: step.required !== false,
        endStatus: step.target === 'cancelled' ? 'cancelled' : 'completed',
      }
    case 'tag':
      return {
        ...buildActionDraft(t, 'call_tool', `${step.id}_tag`),
        label: step.guidance?.trim() || t('procedureEditor.defaults.legacyTagLabel'),
        guidance: step.guidance || '',
        required: step.required !== false,
        toolName: step.target || 'update_case_tag',
      }
    case 'decide':
      return {
        ...buildActionDraft(t, 'ask', `${step.id}_decide`),
        label: step.guidance?.trim() || t('procedureEditor.defaults.legacyDecideLabel'),
        guidance: step.guidance || '',
        required: step.required !== false,
      }
    case 'use':
    default:
      return {
        ...buildActionDraft(t, 'call_tool', `${step.id}_tool`),
        label: step.guidance?.trim() || t('procedureEditor.defaults.legacyToolLabel'),
        guidance: step.guidance || '',
        required: step.required !== false,
        toolName: step.target || '',
      }
  }
}

function legacyStepToDraft(t: TranslateFn, step: NonNullable<ReturnType<typeof parseProcedure>>['steps'][number], index: number): StepDraft {
  const action = legacyActionDraft(t, step)
  if (step.when?.trim()) {
    return {
      id: step.id,
      title: titleFromLegacyStep(step),
      guidance: step.guidance || '',
      skipGuidance: '',
      completionGuidance: '',
      actions: [],
      branches: [{
        ...buildBranchDraft(t, 'if', `${step.id}_branch`),
        label: step.when,
        conditionKind: 'llm_eval',
        conditionLabel: step.when,
        llmPrompt: step.when,
        actions: [{ ...action, id: `${step.id}_branch_action` }],
      }],
    }
  }

  return {
    id: step.id,
    title: titleFromLegacyStep(step) || t('procedureEditor.defaults.stepTitle', { n: index + 1 }),
    guidance: step.guidance || '',
    skipGuidance: '',
    completionGuidance: '',
    actions: [action],
    branches: [],
  }
}

function createEmptyDraft(t: TranslateFn): ProcedureEditorDraft {
  return {
    type: '',
    displayName: '',
    description: '',
    icon: '📋',
    defaultGoal: '',
    enabled: true,
    maxAutoTurns: 10,
    requiredFacts: [],
    escalateOn: [],
    autoCloseConditions: [],
    whenToUse: '',
    overview: '',
    knowledgeGuidance: '',
    handoffGuidance: '',
    steps: [buildStepDraft(t, 0)],
  }
}

function toDraft(t: TranslateFn, item: CaseTypeItem): ProcedureEditorDraft {
  const parsedDefinition = parseProcedureDefinition(item.procedure ?? null)
  const legacy = parseProcedure(item.procedure ?? null)
  const steps = parsedDefinition && isProcedureV2Definition(parsedDefinition)
    ? parsedDefinition.steps.map(stepDraftFromContract)
    : (legacy?.steps ?? []).map((step, index) => legacyStepToDraft(t, step, index))

  return {
    type: item.type,
    displayName: item.displayName || '',
    description: item.description || '',
    icon: item.icon || '📋',
    defaultGoal: item.defaultGoal || '',
    enabled: item.enabled,
    maxAutoTurns: item.maxAutoTurns ?? 10,
    requiredFacts: parseList(item.requiredFacts),
    escalateOn: parseList(item.escalateOn),
    autoCloseConditions: parseList(item.autoCloseConditions ?? '[]'),
    whenToUse: parsedDefinition && isProcedureV2Definition(parsedDefinition)
      ? parsedDefinition.whenToUse
      : item.defaultGoal || '',
    overview: parsedDefinition && isProcedureV2Definition(parsedDefinition)
      ? parsedDefinition.overview || ''
      : item.description || '',
    knowledgeGuidance: parsedDefinition && isProcedureV2Definition(parsedDefinition)
      ? parsedDefinition.knowledgeGuidance || ''
      : '',
    handoffGuidance: parsedDefinition && isProcedureV2Definition(parsedDefinition)
      ? parsedDefinition.handoffGuidance || ''
      : '',
    steps: steps.length > 0 ? steps : [buildStepDraft(t, 0)],
  }
}

function toCondition(t: TranslateFn, branch: BranchDraft) {
  if (branch.kind === 'else') return undefined
  switch (branch.conditionKind) {
    case 'tool_event':
      return {
        kind: 'tool_event' as const,
        label: emptyToUndefined(branch.conditionLabel),
        toolName: branch.toolName.trim() || 'tool_name',
        event: branch.toolEvent,
      }
    case 'form_field':
      return {
        kind: 'form_field' as const,
        label: emptyToUndefined(branch.conditionLabel),
        field: branch.field.trim() || 'field_name',
        operator: branch.operator,
        value: branch.operator === 'equals' ? emptyToUndefined(branch.value) : undefined,
      }
    case 'runtime_signal':
      return {
        kind: 'runtime_signal' as const,
        label: emptyToUndefined(branch.conditionLabel),
        signal: branch.signal,
      }
    case 'llm_eval':
    default:
      return {
        id: branch.id,
        kind: 'llm_eval' as const,
        label: emptyToUndefined(branch.conditionLabel),
        prompt: branch.llmPrompt.trim() || branch.conditionLabel.trim() || t('procedureEditor.defaults.branchPrompt'),
      }
  }
}

function toAction(t: TranslateFn, action: ActionDraft): ProcedureV2ActionContract {
  switch (action.kind) {
    case 'ask':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label.trim() || actionLabel(t, action.kind),
        guidance: emptyToUndefined(action.guidance),
        required: action.required,
        fields: action.fields.filter(Boolean),
      }
    case 'search_knowledge':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label.trim() || actionLabel(t, action.kind),
        guidance: emptyToUndefined(action.guidance),
        required: action.required,
        suggestedSources: action.suggestedSources.filter(Boolean),
      }
    case 'call_tool':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label.trim() || actionLabel(t, action.kind),
        guidance: emptyToUndefined(action.guidance),
        required: action.required,
        toolName: action.toolName.trim() || 'tool_name',
      }
    case 'request_human_handoff':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label.trim() || actionLabel(t, action.kind),
        guidance: emptyToUndefined(action.guidance),
        required: action.required,
        queue: emptyToUndefined(action.queue),
      }
    case 'end':
      return {
        id: action.id,
        kind: action.kind,
        label: action.label.trim() || actionLabel(t, action.kind),
        guidance: emptyToUndefined(action.guidance),
        required: action.required,
        status: action.endStatus,
      }
  }
}

function toProcedureDefinition(t: TranslateFn, draft: ProcedureEditorDraft): ProcedureV2Contract {
  return {
    version: 'v2',
    whenToUse: draft.whenToUse.trim() || draft.defaultGoal.trim() || draft.displayName.trim() || t('procedureEditor.defaults.whenToUse'),
    overview: emptyToUndefined(draft.overview),
    knowledgeGuidance: emptyToUndefined(draft.knowledgeGuidance),
    handoffGuidance: emptyToUndefined(draft.handoffGuidance),
    steps: draft.steps.map((step, index) => ({
      id: step.id.trim() || `step_${index + 1}`,
      title: step.title.trim() || t('procedureEditor.defaults.stepTitle', { n: index + 1 }),
      guidance: step.guidance.trim() || t('procedureEditor.defaults.stepGuidance'),
      actions: step.actions.map((action) => toAction(t, action)),
      branches: step.branches.map((branch) => ({
        id: branch.id,
        kind: branch.kind,
        label: emptyToUndefined(branch.label),
        guidance: emptyToUndefined(branch.guidance),
        condition: toCondition(t, branch),
        actions: branch.actions.map((action) => toAction(t, action)),
      })),
      skipGuidance: emptyToUndefined(step.skipGuidance),
      completionGuidance: emptyToUndefined(step.completionGuidance),
    })),
  }
}

function nextStepId(steps: StepDraft[]) {
  return `step_${steps.length + 1}`
}

function MetaField({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-[11px] font-medium text-[var(--fog)]">{label}</span>
      {children}
    </label>
  )
}

function ActionEditor({
  t,
  action,
  onChange,
  onRemove,
  removable,
}: {
  t: TranslateFn
  action: ActionDraft
  onChange: (patch: Partial<ActionDraft>) => void
  onRemove: () => void
  removable: boolean
}) {
  return (
    <div className="rounded-[18px] border border-black/[0.06] bg-white/88 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--mist)]">{action.label || actionLabel(t, action.kind)}</p>
          <p className="mt-1 font-mono text-[10px] text-[var(--fog)]">{action.id}</p>
        </div>
        {removable ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-vermillion transition-colors hover:bg-vermillion/[0.06]"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {t('procedureEditor.actions.remove')}
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <MetaField label={t('procedureEditor.form.actionKind')}>
          <select
            value={action.kind}
            onChange={(event) => onChange({ kind: event.target.value as ProcedureV2ActionKindContract })}
            className="glass-input-console text-[13px]"
          >
            {PROCEDURE_V2_ACTION_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {actionLabel(t, kind)}
              </option>
            ))}
          </select>
        </MetaField>
        <MetaField label={t('procedureEditor.form.customerSafeLabel')}>
          <input
            value={action.label}
            onChange={(event) => onChange({ label: event.target.value })}
            className="glass-input-console text-[13px]"
          />
        </MetaField>
      </div>

      <MetaField label={t('procedureEditor.form.guidance')}>
        <textarea
          value={action.guidance}
          onChange={(event) => onChange({ guidance: event.target.value })}
          rows={2}
          className="glass-input-console mt-3 resize-y text-[13px]"
        />
      </MetaField>

      <label className="mt-3 inline-flex items-center gap-2 text-[12px] text-[var(--mist)]">
        <input
          type="checkbox"
          checked={action.required}
          onChange={(event) => onChange({ required: event.target.checked })}
          className="h-4 w-4 rounded border-[var(--color-border-subtle)]"
        />
        {t('procedureEditor.form.requiredBeforeStep')}
      </label>

      {action.kind === 'ask' ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.form.fieldsToCapture')}</p>
          <ChipInput
            values={action.fields}
            onChange={(values) => onChange({ fields: values })}
            placeholder={t('procedureEditor.placeholder.fieldsToCapture')}
          />
        </div>
      ) : null}

      {action.kind === 'search_knowledge' ? (
        <div className="mt-3 space-y-2">
          <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.form.suggestedKnowledgeSources')}</p>
          <ChipInput
            values={action.suggestedSources}
            onChange={(values) => onChange({ suggestedSources: values })}
            placeholder={t('procedureEditor.placeholder.suggestedKnowledgeSources')}
          />
        </div>
      ) : null}

      {action.kind === 'call_tool' ? (
        <MetaField label={t('procedureEditor.form.toolName')}>
          <input
            value={action.toolName}
            onChange={(event) => onChange({ toolName: event.target.value })}
            className="glass-input-console mt-3 font-mono text-[13px]"
            placeholder={t('procedureEditor.placeholder.toolName')}
          />
        </MetaField>
      ) : null}

      {action.kind === 'request_human_handoff' ? (
        <MetaField label={t('procedureEditor.form.queue')}>
          <input
            value={action.queue}
            onChange={(event) => onChange({ queue: event.target.value })}
            className="glass-input-console mt-3 text-[13px]"
            placeholder={t('procedureEditor.placeholder.queue')}
          />
        </MetaField>
      ) : null}

      {action.kind === 'end' ? (
        <MetaField label={t('procedureEditor.form.endStatus')}>
          <select
            value={action.endStatus}
            onChange={(event) => onChange({ endStatus: event.target.value as ActionDraft['endStatus'] })}
            className="glass-input-console mt-3 text-[13px]"
          >
            {END_STATUSES.map((status) => (
              <option key={status} value={status}>
                {endStatusLabel(t, status)}
              </option>
            ))}
          </select>
        </MetaField>
      ) : null}
    </div>
  )
}

function BranchEditor({
  t,
  branch,
  onChange,
  onActionChange,
  onActionAdd,
  onActionRemove,
  onRemove,
}: {
  t: TranslateFn
  branch: BranchDraft
  onChange: (patch: Partial<BranchDraft>) => void
  onActionChange: (actionId: string, patch: Partial<ActionDraft>) => void
  onActionAdd: () => void
  onActionRemove: (actionId: string) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-[18px] border border-[#357f7c]/16 bg-[#f6fbfb] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold text-[var(--mist)]">{branch.label || branchKindLabel(t, branch.kind)}</p>
          <p className="mt-1 font-mono text-[10px] text-[var(--fog)]">{branch.id}</p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium text-vermillion transition-colors hover:bg-vermillion/[0.06]"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('procedureEditor.actions.removeBranch')}
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <MetaField label={t('procedureEditor.form.branchKind')}>
          <select
            value={branch.kind}
            onChange={(event) => onChange({ kind: event.target.value as BranchDraft['kind'] })}
            className="glass-input-console text-[13px]"
          >
            {BRANCH_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {branchKindLabel(t, kind)}
              </option>
            ))}
          </select>
        </MetaField>
        <MetaField label={t('procedureEditor.form.label')}>
          <input
            value={branch.label}
            onChange={(event) => onChange({ label: event.target.value })}
            className="glass-input-console text-[13px]"
            placeholder={t('procedureEditor.placeholder.branchLabel')}
          />
        </MetaField>
      </div>

      <MetaField label={t('procedureEditor.form.operatorGuidance')}>
        <textarea
          value={branch.guidance}
          onChange={(event) => onChange({ guidance: event.target.value })}
          rows={2}
          className="glass-input-console mt-3 resize-y text-[13px]"
        />
      </MetaField>

      {branch.kind !== 'else' ? (
        <div className="mt-3 rounded-[16px] border border-black/[0.06] bg-white/80 p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <MetaField label={t('procedureEditor.form.conditionType')}>
              <select
                value={branch.conditionKind}
                onChange={(event) => onChange({ conditionKind: event.target.value as BranchDraft['conditionKind'] })}
                className="glass-input-console text-[13px]"
              >
                {PROCEDURE_CONDITION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {conditionKindLabel(t, kind)}
                  </option>
                ))}
              </select>
            </MetaField>
            <MetaField label={t('procedureEditor.form.conditionLabel')}>
              <input
                value={branch.conditionLabel}
                onChange={(event) => onChange({ conditionLabel: event.target.value })}
                className="glass-input-console text-[13px]"
                placeholder={t('procedureEditor.placeholder.conditionLabel')}
              />
            </MetaField>
          </div>

          {branch.conditionKind === 'llm_eval' ? (
            <MetaField label={t('procedureEditor.form.llmPrompt')}>
              <>
                <textarea
                  value={branch.llmPrompt}
                  onChange={(event) => onChange({ llmPrompt: event.target.value })}
                  rows={2}
                  className="glass-input-console mt-3 resize-y text-[13px]"
                  placeholder={t('procedureEditor.placeholder.llmPrompt')}
                />
                <p className="mt-2 text-[11px] text-[var(--fog)]">
                  {t('procedureEditor.hints.llmPrompt')}
                </p>
              </>
            </MetaField>
          ) : null}

          {branch.conditionKind === 'tool_event' ? (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <MetaField label={t('procedureEditor.form.toolName')}>
                <input
                  value={branch.toolName}
                  onChange={(event) => onChange({ toolName: event.target.value })}
                  className="glass-input-console font-mono text-[13px]"
                  placeholder={t('procedureEditor.placeholder.toolName')}
                />
              </MetaField>
              <MetaField label={t('procedureEditor.form.toolEvent')}>
                <select
                  value={branch.toolEvent}
                  onChange={(event) => onChange({ toolEvent: event.target.value as BranchDraft['toolEvent'] })}
                  className="glass-input-console text-[13px]"
                >
                  {TOOL_EVENTS.map((event) => (
                    <option key={event} value={event}>
                      {toolEventLabel(t, event)}
                    </option>
                  ))}
                </select>
              </MetaField>
            </div>
          ) : null}

          {branch.conditionKind === 'form_field' ? (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <MetaField label={t('procedureEditor.form.field')}>
                <input
                  value={branch.field}
                  onChange={(event) => onChange({ field: event.target.value })}
                  className="glass-input-console text-[13px]"
                  placeholder={t('procedureEditor.placeholder.field')}
                />
              </MetaField>
              <MetaField label={t('procedureEditor.form.operator')}>
                <select
                  value={branch.operator}
                  onChange={(event) => onChange({ operator: event.target.value as BranchDraft['operator'] })}
                  className="glass-input-console text-[13px]"
                >
                  <option value="present">{formOperatorLabel(t, 'present')}</option>
                  <option value="equals">{formOperatorLabel(t, 'equals')}</option>
                </select>
              </MetaField>
              <MetaField label={t('procedureEditor.form.value')}>
                <input
                  value={branch.value}
                  onChange={(event) => onChange({ value: event.target.value })}
                  className="glass-input-console text-[13px]"
                  disabled={branch.operator !== 'equals'}
                  placeholder={t('procedureEditor.placeholder.value')}
                />
              </MetaField>
            </div>
          ) : null}

          {branch.conditionKind === 'runtime_signal' ? (
            <MetaField label={t('procedureEditor.form.runtimeSignal')}>
              <>
                <select
                  value={branch.signal}
                  onChange={(event) => onChange({ signal: event.target.value as ProcedureRuntimeSignalContract })}
                  className="glass-input-console mt-3 text-[13px]"
                >
                  {PROCEDURE_RUNTIME_SIGNALS.map((signal) => (
                    <option key={signal} value={signal}>
                      {runtimeSignalLabel(t, signal)}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-[11px] text-[var(--fog)]">
                  {t('procedureEditor.hints.runtimeSignal')}
                </p>
              </>
            </MetaField>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-[16px] border border-dashed border-black/[0.08] bg-white/70 px-4 py-3 text-[12px] text-[var(--fog)]">
          {t('procedureEditor.hints.elseBranch')}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.branchActions')}</p>
          <button
            type="button"
            onClick={onActionAdd}
            className="inline-flex items-center gap-1.5 rounded-lg border border-indigo/18 bg-indigo/[0.08] px-3 py-1.5 text-[11px] font-semibold text-indigo transition-colors hover:bg-indigo/[0.14]"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('procedureEditor.actions.addBranchAction')}
          </button>
        </div>
        <div className="space-y-3">
          {branch.actions.map((action) => (
            <ActionEditor
              key={action.id}
              t={t}
              action={action}
              onChange={(patch) => onActionChange(action.id, patch)}
              onRemove={() => onActionRemove(action.id)}
              removable={branch.actions.length > 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function BuildProcedureDetailPage() {
  const { t } = useConsoleLocale()
  const params = useParams<{ name: string }>()
  const router = useRouter()
  const agentConfigId = useSelectedAgentId()
  const { orgId } = useSession()
  const procedureName = params.name

  const [item, setItem] = useState<CaseTypeItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [hooks, setHooks] = useState<ProcedureHook[]>([])
  const [hookBusyStepId, setHookBusyStepId] = useState<string | null>(null)
  const [hookStepDrafts, setHookStepDrafts] = useState<Record<string, string>>({})
  const [newHookDrafts, setNewHookDrafts] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState<ProcedureEditorDraft>(() => createEmptyDraft(t))
  const [simulation, setSimulation] = useState<ProcedureSimulationInputContract>({
    signals: [],
    toolNames: [],
    formFields: [],
    knowledgeSearches: 0,
    handoffRequested: false,
    ended: false,
    matchedLlmConditionIds: [],
  })

  const load = useCallback(async () => {
    if (!agentConfigId) {
      setLoading(false)
      setError(t('procedureEditor.error.selectAgent'))
      return
    }
    try {
      const [caseTypeResult, hooksResult] = await Promise.all([
        apiClient<{ caseType: CaseTypeItem }>(
          `/api/admin/case-types/${encodeURIComponent(procedureName)}?agentConfigId=${encodeURIComponent(agentConfigId)}`,
        ),
        apiClient<{ hooks: ProcedureHook[] }>(
          `/api/admin/hooks?agentConfigId=${encodeURIComponent(agentConfigId)}`,
        ).catch(() => ({ data: { hooks: [] } })),
      ])
      setItem(caseTypeResult.data.caseType)
      setDraft(toDraft(t, caseTypeResult.data.caseType))
      setHooks(hooksResult.data.hooks || [])
      setError(null)
      setSaveError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('procedureEditor.error.load'))
    } finally {
      setLoading(false)
    }
  }, [agentConfigId, procedureName, t])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const procedureDefinition = useMemo(() => toProcedureDefinition(t, draft), [draft, t])
  const simulationReceipt = useMemo(
    () => simulateProcedureDefinition(procedureDefinition, simulation),
    [procedureDefinition, simulation],
  )

  const getStepBindings = useCallback((stepId: string) => {
    if (!item) return []
    return hooks.flatMap((hook) =>
      hook.bindings
        .filter((binding) => binding.enabled && binding.scopeType === 'procedureStep' && binding.caseTypeId === item.id && binding.procedureStepId === stepId)
        .map((binding) => ({
          ...binding,
          hookName: binding.hookName || hook.name,
        })),
    )
  }, [hooks, item])

  const isHookAlreadyBoundToStep = useCallback((stepId: string, hookName: string) => {
    return getStepBindings(stepId).some((binding) => binding.hookName === hookName)
  }, [getStepBindings])

  const availableHooksForStep = useCallback((stepId: string) => {
    return hooks.filter((hook) => hook.enabled && !isHookAlreadyBoundToStep(stepId, hook.name))
  }, [hooks, isHookAlreadyBoundToStep])

  const dirty = useMemo(() => {
    if (!item) return false
    return JSON.stringify(draft) !== JSON.stringify(toDraft(t, item))
  }, [draft, item, t])

  const updateStep = useCallback((stepId: string, patch: Partial<StepDraft>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    }))
  }, [])

  const updateAction = useCallback((stepId: string, actionId: string, patch: Partial<ActionDraft>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId
          ? {
              ...step,
              actions: step.actions.map((action) => (action.id === actionId ? { ...action, ...patch } : action)),
            }
          : step
      )),
    }))
  }, [])

  const updateBranch = useCallback((stepId: string, branchId: string, patch: Partial<BranchDraft>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId
          ? {
              ...step,
              branches: step.branches.map((branch) => (branch.id === branchId ? { ...branch, ...patch } : branch)),
            }
          : step
      )),
    }))
  }, [])

  const updateBranchAction = useCallback((stepId: string, branchId: string, actionId: string, patch: Partial<ActionDraft>) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId
          ? {
              ...step,
              branches: step.branches.map((branch) => (
                branch.id === branchId
                  ? {
                      ...branch,
                      actions: branch.actions.map((action) => (action.id === actionId ? { ...action, ...patch } : action)),
                    }
                  : branch
              )),
            }
          : step
      )),
    }))
  }, [])

  const addStep = useCallback(() => {
    setDraft((current) => ({
      ...current,
      steps: [...current.steps, buildStepDraft(t, current.steps.length, nextStepId(current.steps))],
    }))
  }, [t])

  const removeStep = useCallback((stepId: string) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.filter((step) => step.id !== stepId),
    }))
  }, [])

  const addAction = useCallback((stepId: string) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId
          ? { ...step, actions: [...step.actions, buildActionDraft(t, 'call_tool')] }
          : step
      )),
    }))
  }, [t])

  const removeAction = useCallback((stepId: string, actionId: string) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId
          ? { ...step, actions: step.actions.filter((action) => action.id !== actionId) }
          : step
      )),
    }))
  }, [])

  const addBranch = useCallback((stepId: string, kind: BranchDraft['kind']) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId
          ? { ...step, branches: [...step.branches, buildBranchDraft(t, kind)] }
          : step
      )),
    }))
  }, [t])

  const removeBranch = useCallback((stepId: string, branchId: string) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId
          ? { ...step, branches: step.branches.filter((branch) => branch.id !== branchId) }
          : step
      )),
    }))
  }, [])

  const addBranchAction = useCallback((stepId: string, branchId: string) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId
          ? {
              ...step,
              branches: step.branches.map((branch) => (
                branch.id === branchId
                  ? { ...branch, actions: [...branch.actions, buildActionDraft(t, 'call_tool')] }
                  : branch
              )),
            }
          : step
      )),
    }))
  }, [t])

  const removeBranchAction = useCallback((stepId: string, branchId: string, actionId: string) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) => (
        step.id === stepId
          ? {
              ...step,
              branches: step.branches.map((branch) => (
                branch.id === branchId
                  ? { ...branch, actions: branch.actions.filter((action) => action.id !== actionId) }
                  : branch
              )),
            }
          : step
      )),
    }))
  }, [])

  const save = useCallback(async () => {
    if (!agentConfigId || !item) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(null)
    try {
      await apiClient(`/api/admin/case-types/${encodeURIComponent(item.type)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'PUT',
        body: {
          agentConfigId,
          type: draft.type,
          displayName: draft.displayName,
          description: draft.description,
          icon: draft.icon,
          defaultGoal: draft.defaultGoal,
          enabled: draft.enabled,
          maxAutoTurns: draft.maxAutoTurns,
          requiredFacts: draft.requiredFacts,
          escalateOn: draft.escalateOn,
          autoCloseConditions: draft.autoCloseConditions,
          procedure: procedureDefinition,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      setSaveSuccess(t('common.saved'))
      if (draft.type !== item.type) {
        router.replace(`/build/components/procedures/${encodeURIComponent(draft.type)}`)
        return
      }
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('procedureEditor.error.save'))
    } finally {
      setSaving(false)
    }
  }, [agentConfigId, draft, item, load, orgId, procedureDefinition, router, t])

  const deleteProcedure = useCallback(async () => {
    if (!agentConfigId || !item) return
    setSaving(true)
    try {
      await apiClient(`/api/admin/case-types/${encodeURIComponent(item.type)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'DELETE',
      })
      await bustConfigCache(orgId).catch(() => {})
      router.replace('/build/components/procedures')
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('procedureEditor.error.delete'))
    } finally {
      setSaving(false)
      setConfirmDelete(false)
    }
  }, [agentConfigId, item, orgId, router, t])

  const bindExistingHookToStep = useCallback(async (stepId: string) => {
    const hookName = hookStepDrafts[stepId]?.trim()
    if (!agentConfigId || !item || !hookName) return
    setHookBusyStepId(stepId)
    try {
      await apiClient(`/api/admin/hooks/${encodeURIComponent(hookName)}/bindings`, {
        method: 'POST',
        body: {
          agentConfigId,
          scopeType: 'procedureStep',
          caseTypeId: item.id,
          procedureStepId: stepId,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      setHookStepDrafts((current) => ({ ...current, [stepId]: '' }))
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('procedureEditor.error.bindHook'))
    } finally {
      setHookBusyStepId(null)
    }
  }, [agentConfigId, hookStepDrafts, item, load, orgId, t])

  const createAndBindHookToStep = useCallback(async (stepId: string) => {
    const hookName = newHookDrafts[stepId]?.trim()
    if (!agentConfigId || !item || !hookName) return
    setHookBusyStepId(stepId)
    try {
      const created = await apiClient<{ hook: { name: string } }>('/api/admin/hooks', {
        method: 'POST',
        body: {
          agentConfigId,
          name: hookName,
          checkpoint: 'PreToolUse',
          handlerKind: 'declarative',
          handler: {
            kind: 'declarative',
            check: {},
            effect: { action: 'allow' },
          },
          enabled: true,
          severity: 'medium',
        },
      })
      await apiClient(`/api/admin/hooks/${encodeURIComponent(created.data.hook.name)}/bindings`, {
        method: 'POST',
        body: {
          agentConfigId,
          scopeType: 'procedureStep',
          caseTypeId: item.id,
          procedureStepId: stepId,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      setNewHookDrafts((current) => ({ ...current, [stepId]: '' }))
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('procedureEditor.error.createHook'))
    } finally {
      setHookBusyStepId(null)
    }
  }, [agentConfigId, item, load, newHookDrafts, orgId, t])

  const removeStepBinding = useCallback(async (stepId: string, hookName: string, bindingId: string) => {
    if (!agentConfigId) return
    setHookBusyStepId(stepId)
    try {
      await apiClient(
        `/api/admin/hooks/${encodeURIComponent(hookName)}/bindings/${encodeURIComponent(bindingId)}?agentConfigId=${encodeURIComponent(agentConfigId)}`,
        { method: 'DELETE' },
      )
      await bustConfigCache(orgId).catch(() => {})
      await load()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : t('procedureEditor.error.removeHookBinding'))
    } finally {
      setHookBusyStepId(null)
    }
  }, [agentConfigId, load, orgId, t])

  const saveStateLabel = saving ? t('procedureEditor.status.saving') : dirty ? t('procedureEditor.status.unsaved') : t('common.saved')

  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.procedures"
      descriptionKey="procedureDetail"
    >
      <VersionContextBar />
      <PageLoader loading={loading} error={error} onRetry={() => load()}>
        <div className="mx-auto max-w-[1320px] px-8 py-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <Link
              href="/build/components/procedures"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--fog)] transition-colors hover:text-[var(--mist)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('procedureEditor.back')}
            </Link>

            <div className="flex items-center gap-2">
              {saveSuccess ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-malachite/18 bg-malachite/[0.08] px-3 py-1.5 text-[12px] font-medium text-malachite">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {saveSuccess}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-vermillion transition-colors hover:bg-vermillion/[0.06] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t('common.delete')}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="inline-flex items-center gap-2 rounded-xl border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-4 py-2.5 text-[13px] font-semibold text-[#357f7c] transition-colors hover:bg-[#357f7c]/[0.14] disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {t('procedureEditor.actions.saveProcedure')}
              </button>
            </div>
          </div>

          {saveError ? (
            <div className="mb-4 rounded-xl border border-vermillion/15 bg-vermillion/[0.06] px-4 py-3 text-[12px] text-vermillion">
              {saveError}
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.72fr)_minmax(360px,0.28fr)]">
            <section className="space-y-6">
              <div className="rounded-[26px] border border-black/[0.06] bg-[linear-gradient(145deg,rgba(255,255,255,0.94),rgba(247,251,250,0.84))] p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#357f7c]">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('procedureEditor.badge.v2')}
                  </div>
                    <h1 className="mt-4 text-[24px] font-semibold text-[var(--mist)]">{draft.displayName || draft.type || t('procedureEditor.defaults.newProcedure')}</h1>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded-full border border-black/[0.06] bg-white/78 px-3 py-1 text-[11px] font-semibold text-[var(--mist)]">
                        {t('procedureEditor.status.draft')}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-black/[0.06] bg-white/78 px-3 py-1 text-[11px] font-medium text-[var(--fog)]">
                        {saveStateLabel}
                      </span>
                    </div>
                    <p className="mt-2 max-w-[720px] text-[13px] leading-6 text-[var(--fog)]">
                      {t('procedureEditor.header.description')}
                    </p>
                  </div>
                  <div className="rounded-[20px] border border-black/[0.06] bg-white/70 px-4 py-3 text-[12px] text-[var(--fog)]">
                    <p className="font-semibold text-[var(--mist)]">{t('procedureEditor.header.compatibilityTitle')}</p>
                    <p className="mt-2 leading-5">
                      {t('procedureEditor.header.compatibilityBody')}
                    </p>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <MetaField label={t('procedureEditor.form.displayName')}>
                    <input
                      value={draft.displayName}
                      onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                      className="glass-input-console text-[13px]"
                    />
                  </MetaField>
                  <MetaField label={t('procedureEditor.form.procedureKey')}>
                    <input
                      value={draft.type}
                      onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}
                      className="glass-input-console font-mono text-[13px]"
                    />
                  </MetaField>
                  <MetaField label={t('procedureEditor.form.icon')}>
                    <input
                      value={draft.icon}
                      onChange={(event) => setDraft((current) => ({ ...current, icon: event.target.value }))}
                      className="glass-input-console text-[13px]"
                    />
                  </MetaField>
                  <MetaField label={t('procedureEditor.form.maxAutoTurns')}>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={draft.maxAutoTurns}
                      onChange={(event) => setDraft((current) => ({ ...current, maxAutoTurns: Number(event.target.value || 10) }))}
                      className="glass-input-console text-[13px]"
                    />
                  </MetaField>
                </div>

                <MetaField label={t('procedureEditor.form.whenToUse')}>
                  <textarea
                    value={draft.whenToUse}
                    onChange={(event) => setDraft((current) => ({ ...current, whenToUse: event.target.value }))}
                    rows={3}
                    className="glass-input-console mt-4 resize-y text-[13px]"
                    placeholder={t('procedureEditor.placeholder.whenToUse')}
                  />
                </MetaField>

                <MetaField label={t('common.description')}>
                  <textarea
                    value={draft.description}
                    onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    rows={2}
                    className="glass-input-console mt-4 resize-y text-[13px]"
                  />
                </MetaField>

                <MetaField label={t('procedureEditor.form.overview')}>
                  <textarea
                    value={draft.overview}
                    onChange={(event) => setDraft((current) => ({ ...current, overview: event.target.value }))}
                    rows={3}
                    className="glass-input-console mt-4 resize-y text-[13px]"
                    placeholder={t('procedureEditor.placeholder.overview')}
                  />
                </MetaField>

                <MetaField label={t('caseTypes.defaultGoal')}>
                  <textarea
                    value={draft.defaultGoal}
                    onChange={(event) => setDraft((current) => ({ ...current, defaultGoal: event.target.value }))}
                    rows={2}
                    className="glass-input-console mt-4 resize-y text-[13px]"
                  />
                </MetaField>

                <label className="mt-4 inline-flex items-center gap-2 text-[13px] text-[var(--mist)]">
                  <input
                    type="checkbox"
                    checked={draft.enabled}
                    onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
                    className="h-4 w-4 rounded border-[var(--color-border-subtle)]"
                  />
                  {t('caseTypes.enabledForRouting')}
                </label>
              </div>

              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.78] p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <div className="mb-5">
                  <h2 className="text-[15px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.knowledgeAndHandoff')}</h2>
                  <p className="mt-1 text-[12px] leading-5 text-[var(--fog)]">
                    {t('procedureEditor.section.knowledgeAndHandoffHint')}
                  </p>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.form.requiredFacts')}</p>
                    <ChipInput
                      values={draft.requiredFacts}
                      onChange={(values) => setDraft((current) => ({ ...current, requiredFacts: values }))}
                      placeholder={t('procedureEditor.placeholder.requiredFacts')}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.form.escalateOn')}</p>
                    <ChipInput
                      values={draft.escalateOn}
                      onChange={(values) => setDraft((current) => ({ ...current, escalateOn: values }))}
                      placeholder={t('procedureEditor.placeholder.escalateOn')}
                    />
                  </div>
                </div>

                <div className="mt-5 space-y-4">
                  <MetaField label={t('procedureEditor.form.knowledgeGuidance')}>
                    <textarea
                      value={draft.knowledgeGuidance}
                      onChange={(event) => setDraft((current) => ({ ...current, knowledgeGuidance: event.target.value }))}
                      rows={3}
                      className="glass-input-console resize-y text-[13px]"
                      placeholder={t('procedureEditor.placeholder.knowledgeGuidance')}
                    />
                  </MetaField>
                  <MetaField label={t('procedureEditor.form.handoffGuidance')}>
                    <textarea
                      value={draft.handoffGuidance}
                      onChange={(event) => setDraft((current) => ({ ...current, handoffGuidance: event.target.value }))}
                      rows={3}
                      className="glass-input-console resize-y text-[13px]"
                      placeholder={t('procedureEditor.placeholder.handoffGuidance')}
                    />
                  </MetaField>
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.form.autoCloseConditions')}</p>
                    <ChipInput
                      values={draft.autoCloseConditions}
                      onChange={(values) => setDraft((current) => ({ ...current, autoCloseConditions: values }))}
                      placeholder={t('procedureEditor.placeholder.autoCloseConditions')}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.78] p-6 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.orderedSteps')}</h2>
                    <p className="mt-1 text-[12px] leading-5 text-[var(--fog)]">
                      {t('procedureEditor.section.orderedStepsHint')}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addStep}
                    className="inline-flex items-center gap-2 rounded-xl border border-indigo/18 bg-indigo/[0.08] px-3.5 py-2 text-[12px] font-semibold text-indigo transition-colors hover:bg-indigo/[0.14]"
                  >
                    <Plus className="h-4 w-4" />
                    {t('procedureEditor.actions.addStep')}
                  </button>
                </div>

                <div className="space-y-6">
                  {draft.steps.map((step, index) => {
                    const bindings = getStepBindings(step.id)
                    const availableHooks = availableHooksForStep(step.id)
                    const busy = hookBusyStepId === step.id
                    return (
                      <div key={step.id} className="rounded-[22px] border border-black/[0.06] bg-[rgba(255,255,255,0.84)] p-5">
                        <div className="mb-4 flex items-start justify-between gap-4">
                          <div>
                            <p className="text-[13px] font-semibold text-[var(--mist)]">{step.title || t('procedureEditor.defaults.stepTitle', { n: index + 1 })}</p>
                            <p className="mt-1 font-mono text-[10px] text-[var(--fog)]">{step.id}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeStep(step.id)}
                            disabled={draft.steps.length === 1}
                            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-vermillion transition-colors hover:bg-vermillion/[0.06] disabled:opacity-40"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {t('procedureEditor.actions.remove')}
                          </button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-2">
                          <MetaField label={t('procedureEditor.form.stepKey')}>
                            <input
                              value={step.id}
                              onChange={(event) => updateStep(step.id, { id: event.target.value })}
                              className="glass-input-console font-mono text-[13px]"
                            />
                          </MetaField>
                          <MetaField label={t('procedureEditor.form.stepTitle')}>
                            <input
                              value={step.title}
                              onChange={(event) => updateStep(step.id, { title: event.target.value })}
                              className="glass-input-console text-[13px]"
                            />
                          </MetaField>
                        </div>

                        <MetaField label={t('procedureEditor.form.operatorGuidance')}>
                          <textarea
                            value={step.guidance}
                            onChange={(event) => updateStep(step.id, { guidance: event.target.value })}
                            rows={3}
                            className="glass-input-console mt-4 resize-y text-[13px]"
                          />
                        </MetaField>

                        <div className="mt-4 grid gap-4 md:grid-cols-2">
                          <MetaField label={t('procedureEditor.form.completionGuidance')}>
                            <textarea
                              value={step.completionGuidance}
                              onChange={(event) => updateStep(step.id, { completionGuidance: event.target.value })}
                              rows={2}
                              className="glass-input-console resize-y text-[13px]"
                              placeholder={t('procedureEditor.placeholder.completionGuidance')}
                            />
                          </MetaField>
                          <MetaField label={t('procedureEditor.form.skipGuidance')}>
                            <textarea
                              value={step.skipGuidance}
                              onChange={(event) => updateStep(step.id, { skipGuidance: event.target.value })}
                              rows={2}
                              className="glass-input-console resize-y text-[13px]"
                              placeholder={t('procedureEditor.placeholder.skipGuidance')}
                            />
                          </MetaField>
                        </div>

                        <div className="mt-5">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.defaultActions')}</p>
                            <button
                              type="button"
                              onClick={() => addAction(step.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo/18 bg-indigo/[0.08] px-3 py-1.5 text-[11px] font-semibold text-indigo transition-colors hover:bg-indigo/[0.14]"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              {t('procedureEditor.actions.addAction')}
                            </button>
                          </div>
                          <div className="space-y-3">
                            {step.actions.map((action) => (
                              <ActionEditor
                                key={action.id}
                                t={t}
                                action={action}
                                onChange={(patch) => updateAction(step.id, action.id, patch)}
                                onRemove={() => removeAction(step.id, action.id)}
                                removable={step.actions.length > 1}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="mt-6">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.branches')}</p>
                              <p className="mt-1 text-[11px] text-[var(--fog)]">
                                {t('procedureEditor.section.branchesHint')}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {step.branches.length === 0 ? (
                                <button
                                  type="button"
                                  onClick={() => addBranch(step.id, 'if')}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-3 py-1.5 text-[11px] font-semibold text-[#357f7c] transition-colors hover:bg-[#357f7c]/[0.14]"
                                >
                                  <GitBranch className="h-3.5 w-3.5" />
                                  {t('procedureEditor.actions.addIf')}
                                </button>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => addBranch(step.id, 'else_if')}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-3 py-1.5 text-[11px] font-semibold text-[#357f7c] transition-colors hover:bg-[#357f7c]/[0.14]"
                                  >
                                    <GitBranch className="h-3.5 w-3.5" />
                                    {t('procedureEditor.actions.addElseIf')}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => addBranch(step.id, 'else')}
                                    disabled={step.branches.some((branch) => branch.kind === 'else')}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[11px] font-semibold text-[var(--mist)] transition-colors hover:text-indigo disabled:opacity-40"
                                  >
                                    <GitBranch className="h-3.5 w-3.5" />
                                    {t('procedureEditor.actions.addElse')}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {step.branches.length === 0 ? (
                            <div className="rounded-[18px] border border-dashed border-black/[0.08] bg-white/60 px-4 py-4 text-[12px] text-[var(--fog)]">
                              {t('procedureEditor.section.branchesEmpty')}
                            </div>
                          ) : (
                            <div className="space-y-4">
                              {step.branches.map((branch) => (
                                <BranchEditor
                                  key={branch.id}
                                  t={t}
                                  branch={branch}
                                  onChange={(patch) => updateBranch(step.id, branch.id, patch)}
                                  onActionChange={(actionId, patch) => updateBranchAction(step.id, branch.id, actionId, patch)}
                                  onActionAdd={() => addBranchAction(step.id, branch.id)}
                                  onActionRemove={(actionId) => removeBranchAction(step.id, branch.id, actionId)}
                                  onRemove={() => removeBranch(step.id, branch.id)}
                                />
                              ))}
                            </div>
                          )}
                        </div>

                        <div className="mt-6 rounded-[18px] border border-black/[0.06] bg-[rgba(250,248,242,0.72)] p-4">
                          <div className="mb-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.stepHooks')}</p>
                              <p className="mt-1 text-[11px] text-[var(--fog)]">
                                {t('procedureEditor.section.stepHooksHint')}
                              </p>
                            </div>
                            <Link
                              href="/build/components/hooks"
                              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)] transition-colors hover:text-indigo"
                            >
                              {t('procedureEditor.actions.openHooks')}
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          </div>

                          <div className="mb-4 flex flex-wrap gap-2">
                            {bindings.length === 0 ? (
                              <span className="text-[11px] text-[var(--fog)]">{t('procedureEditor.section.noHookBindings')}</span>
                            ) : (
                              bindings.map((binding) => (
                                <span
                                  key={binding.id}
                                  className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white/82 px-3 py-1.5 text-[11px] font-medium text-[var(--mist)]"
                                >
                                  {binding.hookName}
                                  <button
                                    type="button"
                                    onClick={() => removeStepBinding(step.id, binding.hookName || '', binding.id)}
                                    disabled={busy}
                                    className="text-vermillion transition-opacity hover:opacity-80 disabled:opacity-40"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </span>
                              ))
                            )}
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2">
                              <span className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.section.bindExistingHook')}</span>
                              <div className="flex gap-2">
                                <select
                                  value={hookStepDrafts[step.id] || ''}
                                  onChange={(event) => setHookStepDrafts((current) => ({ ...current, [step.id]: event.target.value }))}
                                  className="glass-input-console text-[12px]"
                                >
                                  <option value="">{t('procedureEditor.placeholder.selectHook')}</option>
                                  {availableHooks.map((hook) => (
                                    <option key={hook.id} value={hook.name}>
                                      {hook.displayName || hook.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => bindExistingHookToStep(step.id)}
                                  disabled={!hookStepDrafts[step.id] || busy}
                                  className="rounded-xl border border-black/[0.06] bg-white/84 px-3 py-2 text-[12px] font-semibold text-[var(--mist)] transition-colors hover:text-indigo disabled:opacity-40"
                                >
                                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('procedureEditor.actions.bind')}
                                </button>
                              </div>
                            </div>

                            <div className="space-y-2">
                              <span className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.section.createAndBindHook')}</span>
                              <div className="flex gap-2">
                                <input
                                  value={newHookDrafts[step.id] || ''}
                                  onChange={(event) => setNewHookDrafts((current) => ({ ...current, [step.id]: event.target.value }))}
                                  placeholder={t('procedureEditor.placeholder.newHookName')}
                                  className="glass-input-console text-[12px]"
                                />
                                <button
                                  type="button"
                                  onClick={() => createAndBindHookToStep(step.id)}
                                  disabled={!newHookDrafts[step.id] || busy}
                                  className="rounded-xl border border-indigo/18 bg-indigo/[0.08] px-3 py-2 text-[12px] font-semibold text-indigo transition-colors hover:bg-indigo/[0.14] disabled:opacity-40"
                                >
                                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('procedureEditor.actions.create')}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </section>

            <aside className="space-y-6">
              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.78] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.preview.title')}</p>
                <p className="mt-3 text-[12px] leading-6 text-[var(--fog)]">{procedureDefinition.whenToUse}</p>
                {procedureDefinition.overview ? (
                  <p className="mt-3 text-[12px] leading-6 text-[var(--fog)]">{procedureDefinition.overview}</p>
                ) : null}

                <div className="mt-4 space-y-3">
                  {procedureDefinition.steps.map((step) => (
                    <div key={step.id} className="rounded-[16px] border border-black/[0.06] bg-white/88 p-3">
                      <p className="text-[12px] font-semibold text-[var(--mist)]">{step.title}</p>
                      <p className="mt-1 text-[11px] leading-5 text-[var(--fog)]">{step.guidance}</p>
                      {step.actions.length > 0 ? (
                        <div className="mt-2 space-y-1 text-[11px] text-[var(--fog)]">
                          {step.actions.map((action) => (
                            <div key={action.id}>{t('procedureEditor.preview.actionLine', { summary: summarizeAction(t, action) })}</div>
                          ))}
                        </div>
                      ) : null}
                      {step.branches.length > 0 ? (
                        <div className="mt-2 space-y-1 text-[11px] text-[var(--fog)]">
                          {step.branches.map((branch) => (
                            <div key={branch.id}>
                              {t('procedureEditor.preview.branchLine', { kind: branchKindLabel(t, branch.kind), summary: summarizeCondition(t, branch) })}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.78] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.simulation.title')}</p>
                    <p className="mt-1 text-[11px] leading-5 text-[var(--fog)]">
                      {t('procedureEditor.simulation.description')}
                    </p>
                  </div>
                  <span className="rounded-full border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-2.5 py-1 text-[11px] font-medium text-[#357f7c]">
                    {simulationStatusLabel(t, simulationReceipt.status)}
                  </span>
                </div>
                <div className="mt-3 rounded-[16px] border border-amber-500/20 bg-amber-500/[0.08] px-3 py-3 text-[11px] leading-5 text-[var(--mist)]">
                  {t('procedureEditor.simulation.previewWarning')}
                </div>

                <div className="mt-4 space-y-4">
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.simulation.activeSignals')}</p>
                    <div className="flex flex-wrap gap-2">
                      {PROCEDURE_RUNTIME_SIGNALS.map((signal) => {
                        const active = simulation.signals.includes(signal)
                        return (
                          <button
                            key={signal}
                            type="button"
                            onClick={() => setSimulation((current) => ({
                              ...current,
                              signals: active
                                ? current.signals.filter((value) => value !== signal)
                                : [...current.signals, signal],
                            }))}
                            className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors ${
                              active
                                ? 'border border-[#357f7c]/18 bg-[#357f7c]/[0.10] text-[#357f7c]'
                                : 'border border-black/[0.06] bg-white/84 text-[var(--fog)]'
                            }`}
                          >
                            {runtimeSignalLabel(t, signal)}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.simulation.toolNames')}</p>
                    <ChipInput
                      values={simulation.toolNames}
                      onChange={(values) => setSimulation((current) => ({ ...current, toolNames: values }))}
                      placeholder={t('procedureEditor.placeholder.simulationToolNames')}
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.simulation.formFields')}</p>
                    <ChipInput
                      values={simulation.formFields}
                      onChange={(values) => setSimulation((current) => ({ ...current, formFields: values }))}
                      placeholder={t('procedureEditor.placeholder.simulationFormFields')}
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.simulation.llmConditionIds')}</p>
                    <ChipInput
                      values={simulation.matchedLlmConditionIds || []}
                      onChange={(values) => setSimulation((current) => ({ ...current, matchedLlmConditionIds: values }))}
                      placeholder={t('procedureEditor.placeholder.llmConditionIds')}
                    />
                    <p className="text-[11px] text-[var(--fog)]">
                      {t('procedureEditor.simulation.llmConditionIdsHint')}
                    </p>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <MetaField label={t('procedureEditor.simulation.knowledgeSearches')}>
                      <input
                        type="number"
                        min={0}
                        value={simulation.knowledgeSearches}
                        onChange={(event) => setSimulation((current) => ({ ...current, knowledgeSearches: Number(event.target.value || 0) }))}
                        className="glass-input-console text-[13px]"
                      />
                    </MetaField>
                    <div className="space-y-2 pt-5 text-[12px] text-[var(--mist)]">
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={simulation.handoffRequested}
                          onChange={(event) => setSimulation((current) => ({ ...current, handoffRequested: event.target.checked }))}
                          className="h-4 w-4 rounded border-[var(--color-border-subtle)]"
                        />
                        {t('procedureEditor.simulation.handoffRequested')}
                      </label>
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={simulation.ended}
                          onChange={(event) => setSimulation((current) => ({ ...current, ended: event.target.checked }))}
                          className="h-4 w-4 rounded border-[var(--color-border-subtle)]"
                        />
                        {t('procedureEditor.simulation.ended')}
                      </label>
                    </div>
                  </div>
                </div>

                <div className="mt-5 rounded-[18px] border border-black/[0.06] bg-[rgba(247,250,249,0.84)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.simulation.receipt')}</p>
                    <span className="text-[11px] text-[var(--fog)]">{t('procedureEditor.simulation.activeStep', { stepId: simulationReceipt.activeStepId || t('procedureEditor.simulation.none') })}</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {simulationReceipt.steps.map((step) => (
                      <div key={step.stepId} className="rounded-[14px] border border-black/[0.06] bg-white/84 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-[12px] font-medium text-[var(--mist)]">{step.title}</p>
                          <span className="text-[11px] text-[var(--fog)]">{simulationStepStatusLabel(t, step.status)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.78] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.currentStatus')}</p>
                <div className="mt-3 space-y-2 text-[12px] text-[var(--fog)]">
                  <div className="flex items-center justify-between">
                    <span>{t('procedureEditor.status.routing')}</span>
                    <span className="font-medium text-[var(--mist)]">{draft.enabled ? t('common.enabled') : t('common.disabled')}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('procedureEditor.status.steps')}</span>
                    <span className="font-medium text-[var(--mist)]">{draft.steps.length}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('procedureEditor.status.branches')}</span>
                    <span className="font-medium text-[var(--mist)]">{draft.steps.reduce((count, step) => count + step.branches.length, 0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('procedureEditor.status.saveState')}</span>
                    <span className="font-medium text-[var(--mist)]">{saveStateLabel}</span>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </PageLoader>

      <ConfirmDialog
        open={confirmDelete}
        title={t('procedureEditor.confirm.deleteTitle')}
        message={draft.displayName || draft.type
          ? t('procedureEditor.confirm.deleteMessageNamed', { name: draft.displayName || draft.type })
          : t('procedureEditor.confirm.deleteMessage')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={deleteProcedure}
      />
    </BuildComponentsRouteShell>
  )
}
