'use client'

import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  GitBranch,
  ListChecks,
  Loader2,
  Lock,
  Play,
  Plus,
  Settings,
  Sparkles,
  Square,
  Trash2,
  X,
} from 'lucide-react'
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
  parseProcedure,
  PROCEDURE_CONDITION_KINDS,
  PROCEDURE_RUNTIME_SIGNALS,
  PROCEDURE_V2_ACTION_KINDS,
  simulateProcedure,
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

// tool_event / form_field / runtime_signal are deterministic completion gates;
// llm_eval is a soft AI judgment that needs a runtime evaluator receipt.
function conditionGateKind(kind: BranchDraft['conditionKind']): 'hard' | 'soft' {
  return kind === 'llm_eval' ? 'soft' : 'hard'
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
  const parsedProcedure = parseProcedure(item.procedure ?? null)
  const steps = parsedProcedure?.steps.map(stepDraftFromContract) ?? []

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
    whenToUse: parsedProcedure?.whenToUse || item.defaultGoal || '',
    overview: parsedProcedure?.overview || item.description || '',
    knowledgeGuidance: parsedProcedure?.knowledgeGuidance || '',
    handoffGuidance: parsedProcedure?.handoffGuidance || '',
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

function toProcedure(t: TranslateFn, draft: ProcedureEditorDraft): ProcedureV2Contract {
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
    <div className="group/action rounded-[16px] border border-transparent bg-white/55 px-3 py-3 transition hover:border-black/[0.06] hover:bg-white">
      <div className="grid gap-2 lg:grid-cols-[168px_minmax(0,1fr)_auto]">
        <select
          value={action.kind}
          onChange={(event) => onChange({ kind: event.target.value as ProcedureV2ActionKindContract })}
          className="h-10 rounded-full border border-black/[0.07] bg-black/[0.03] px-3 text-[12px] font-semibold text-[var(--mist)] outline-none transition focus:border-[#357f7c]/40 focus:bg-white"
          aria-label={t('procedureEditor.form.actionKind')}
        >
          {PROCEDURE_V2_ACTION_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {actionLabel(t, kind)}
            </option>
          ))}
        </select>
        <input
          value={action.label}
          onChange={(event) => onChange({ label: event.target.value })}
          className="h-10 rounded-xl border border-black/[0.07] bg-white px-3 text-[14px] text-[var(--mist)] outline-none transition placeholder:text-[var(--fog)]/55 focus:border-[#357f7c]/40 focus:ring-4 focus:ring-[#357f7c]/[0.08]"
          placeholder={actionLabel(t, action.kind)}
          aria-label={t('procedureEditor.form.customerSafeLabel')}
        />
        {removable ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--fog)] transition hover:bg-vermillion/[0.08] hover:text-vermillion"
            aria-label={t('procedureEditor.actions.remove')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <textarea
        value={action.guidance}
        onChange={(event) => onChange({ guidance: event.target.value })}
        rows={2}
        className="mt-2 min-h-[64px] w-full resize-y rounded-xl border border-transparent bg-transparent px-3 py-2 text-[13px] leading-6 text-[var(--mist)] outline-none transition placeholder:text-[var(--fog)]/55 focus:border-black/[0.08] focus:bg-white"
        placeholder={t('procedureEditor.form.guidance')}
      />

      <details className="mt-1 rounded-xl border border-black/[0.05] bg-black/[0.015] px-3 py-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium text-[var(--fog)]">
          <span className="inline-flex items-center gap-2">
            <ListChecks className="h-3.5 w-3.5" />
            {t('procedureEditor.form.actionDetails')}
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </summary>
        <div className="mt-3 space-y-3">
          <label className="inline-flex items-center gap-2 text-[12px] text-[var(--mist)]">
            <input
              type="checkbox"
              checked={action.required}
              onChange={(event) => onChange({ required: event.target.checked })}
              className="h-4 w-4 rounded border-[var(--color-border-subtle)]"
            />
            {t('procedureEditor.form.requiredBeforeStep')}
          </label>

          {action.kind === 'ask' ? (
            <div className="space-y-2">
              <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.form.fieldsToCapture')}</p>
              <ChipInput
                values={action.fields}
                onChange={(values) => onChange({ fields: values })}
                placeholder={t('procedureEditor.placeholder.fieldsToCapture')}
              />
            </div>
          ) : null}

          {action.kind === 'search_knowledge' ? (
            <div className="space-y-2">
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
                className="glass-input-console font-mono text-[13px]"
                placeholder={t('procedureEditor.placeholder.toolName')}
              />
            </MetaField>
          ) : null}

          {action.kind === 'request_human_handoff' ? (
            <MetaField label={t('procedureEditor.form.queue')}>
              <input
                value={action.queue}
                onChange={(event) => onChange({ queue: event.target.value })}
                className="glass-input-console text-[13px]"
                placeholder={t('procedureEditor.placeholder.queue')}
              />
            </MetaField>
          ) : null}

          {action.kind === 'end' ? (
            <MetaField label={t('procedureEditor.form.endStatus')}>
              <select
                value={action.endStatus}
                onChange={(event) => onChange({ endStatus: event.target.value as ActionDraft['endStatus'] })}
                className="glass-input-console text-[13px]"
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
      </details>
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
  const conditionText = branch.kind === 'else'
    ? t('procedureEditor.hints.elseBranch')
    : branch.conditionLabel || branch.llmPrompt || branch.toolName || branch.field || branchKindLabel(t, branch.kind)

  return (
    <div className="relative pl-9">
      <div className="absolute left-3 top-9 bottom-0 w-px bg-black/[0.08]" />
      <div className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-lg bg-[#eee9ff] text-indigo shadow-sm">
        <GitBranch className="h-3.5 w-3.5" />
      </div>

      <div className="rounded-[20px] border border-black/[0.07] bg-white p-4 shadow-[0_12px_32px_rgba(20,27,35,0.045)]">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={branch.kind}
            onChange={(event) => onChange({ kind: event.target.value as BranchDraft['kind'] })}
            className="h-9 rounded-full border border-black/[0.07] bg-black/[0.03] px-3 text-[12px] font-semibold text-[var(--mist)] outline-none focus:border-[#357f7c]/40"
            aria-label={t('procedureEditor.form.branchKind')}
          >
            {BRANCH_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {branchKindLabel(t, kind)}
              </option>
            ))}
          </select>
          {branch.kind !== 'else' ? (
            <>
              <select
                value={branch.conditionKind}
                onChange={(event) => onChange({ conditionKind: event.target.value as BranchDraft['conditionKind'] })}
                className="h-9 rounded-full border border-black/[0.07] bg-white px-3 text-[12px] font-medium text-[var(--mist)] outline-none focus:border-[#357f7c]/40"
                aria-label={t('procedureEditor.form.conditionType')}
              >
                {PROCEDURE_CONDITION_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {conditionKindLabel(t, kind)}
                  </option>
                ))}
              </select>
              {conditionGateKind(branch.conditionKind) === 'hard' ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#0f6e56]/[0.09] px-2.5 py-1 text-[11px] font-medium text-[#0f6e56]">
                  <Lock className="h-3 w-3" />
                  {t('procedureEditor.gate.hard')}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#b6791f]/[0.12] px-2.5 py-1 text-[11px] font-medium text-[#8a5d11]">
                  <Sparkles className="h-3 w-3" />
                  {t('procedureEditor.gate.soft')}
                </span>
              )}
            </>
          ) : null}
          <input
            value={branch.label}
            onChange={(event) => onChange({ label: event.target.value })}
            className="h-9 min-w-0 flex-1 rounded-full border border-transparent bg-transparent px-3 text-[13px] font-medium text-[var(--mist)] outline-none transition placeholder:text-[var(--fog)]/55 focus:border-black/[0.08] focus:bg-white"
            placeholder={t('procedureEditor.placeholder.branchLabel')}
            aria-label={t('procedureEditor.form.label')}
          />
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[var(--fog)] transition hover:bg-vermillion/[0.08] hover:text-vermillion"
            aria-label={t('procedureEditor.actions.removeBranch')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <textarea
          value={branch.kind === 'else' ? branch.guidance : conditionText}
          onChange={(event) => {
            if (branch.kind === 'else') {
              onChange({ guidance: event.target.value })
            } else if (branch.conditionKind === 'llm_eval') {
              onChange({ llmPrompt: event.target.value })
            } else {
              onChange({ conditionLabel: event.target.value })
            }
          }}
          rows={2}
          className="mt-3 min-h-[58px] w-full resize-y rounded-xl border border-black/[0.07] bg-white px-4 py-3 text-[14px] leading-6 text-[var(--mist)] outline-none transition focus:border-[#357f7c]/40 focus:ring-4 focus:ring-[#357f7c]/[0.08]"
          placeholder={branch.kind === 'else' ? t('procedureEditor.hints.elseBranch') : t('procedureEditor.form.condition')}
        />

        <details className="mt-3 rounded-xl border border-black/[0.05] bg-black/[0.015] px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium text-[var(--fog)]">
            <span className="inline-flex items-center gap-2">
              <Settings className="h-3.5 w-3.5" />
              {t('procedureEditor.form.conditionDetails')}
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </summary>

          <div className="mt-3 space-y-3">
            <MetaField label={t('procedureEditor.form.operatorGuidance')}>
              <textarea
                value={branch.guidance}
                onChange={(event) => onChange({ guidance: event.target.value })}
                rows={2}
                className="glass-input-console resize-y text-[13px]"
              />
            </MetaField>

            {branch.kind !== 'else' ? (
              <>
                <MetaField label={t('procedureEditor.form.conditionLabel')}>
                  <input
                    value={branch.conditionLabel}
                    onChange={(event) => onChange({ conditionLabel: event.target.value })}
                    className="glass-input-console text-[13px]"
                    placeholder={t('procedureEditor.placeholder.conditionLabel')}
                  />
                </MetaField>

                {branch.conditionKind === 'llm_eval' ? (
                  <MetaField label={t('procedureEditor.form.llmPrompt')}>
                    <>
                      <textarea
                        value={branch.llmPrompt}
                        onChange={(event) => onChange({ llmPrompt: event.target.value })}
                        rows={2}
                        className="glass-input-console resize-y text-[13px]"
                        placeholder={t('procedureEditor.placeholder.llmPrompt')}
                      />
                      <p className="mt-2 text-[11px] text-[var(--fog)]">
                        {t('procedureEditor.hints.llmPrompt')}
                      </p>
                    </>
                  </MetaField>
                ) : null}

                {branch.conditionKind === 'tool_event' ? (
                  <div className="grid gap-3 md:grid-cols-2">
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
                  <div className="grid gap-3 md:grid-cols-3">
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
                        className="glass-input-console text-[13px]"
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
              </>
            ) : null}
          </div>
        </details>

        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.branchActions')}</p>
            <button
              type="button"
              onClick={onActionAdd}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--mist)] transition hover:border-indigo/20 hover:text-indigo"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('procedureEditor.actions.addBranchAction')}
            </button>
          </div>
          {branch.actions.map((action, index) => (
            <div key={action.id} className="grid gap-3 md:grid-cols-[28px_minmax(0,1fr)]">
              <span className="pt-4 text-right text-[12px] font-medium text-[var(--fog)]">{index + 1}.</span>
              <ActionEditor
                t={t}
                action={action}
                onChange={(patch) => onActionChange(action.id, patch)}
                onRemove={() => onActionRemove(action.id)}
                removable={branch.actions.length > 1}
              />
            </div>
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
  const [selectedKey, setSelectedKey] = useState<string>('')
  const [rightPanelMode, setRightPanelMode] = useState<'preview' | 'simulation'>('simulation')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [simulation, setSimulation] = useState<ProcedureSimulationInputContract>({
    signals: [],
    toolNames: [],
    knowledgeToolNames: [],
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

  // Auto-dismiss the save-success confirmation so it does not permanently
  // duplicate the persistent saved-state label in the header.
  useEffect(() => {
    if (!saveSuccess) return
    const id = setTimeout(() => setSaveSuccess(null), 2500)
    return () => clearTimeout(id)
  }, [saveSuccess])

  const procedure = useMemo(() => toProcedure(t, draft), [draft, t])
  const simulationReceipt = useMemo(
    () => simulateProcedure(procedure, simulation),
    [procedure, simulation],
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
    if (!draft.displayName.trim()) {
      setSaveSuccess(null)
      setSaveError(t('procedureEditor.error.displayNameRequired'))
      return
    }
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
          procedure,
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
  }, [agentConfigId, draft, item, load, orgId, procedure, router, t])

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

  const stepIds = draft.steps.map((step) => step.id)
  const selected = selectedKey && (selectedKey === 'overview' || stepIds.includes(selectedKey))
    ? selectedKey
    : (stepIds[0] ?? 'overview')

  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.procedures"
      descriptionKey="procedureDetail"
    >
      <VersionContextBar />
      <PageLoader loading={loading} error={error} onRetry={() => load()}>
        <div className="min-h-[calc(100vh-112px)] bg-[#fbfaf6]">
          <div className="sticky top-0 z-30 border-b border-black/[0.08] bg-[#fffefa]/95 backdrop-blur-xl">
            <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Link
                  href="/build/components/procedures"
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--fog)] transition hover:bg-black/[0.04] hover:text-[var(--mist)]"
                  aria-label={t('procedureEditor.back')}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/[0.08] bg-white text-[var(--mist)] shadow-sm">
                  <ListChecks className="h-4 w-4" />
                </span>
                <input
                  value={draft.displayName}
                  onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))}
                  className="min-w-0 flex-1 bg-transparent text-[22px] font-semibold leading-tight text-[var(--mist)] outline-none placeholder:text-[var(--fog)]/60 md:text-[26px]"
                  placeholder={t('procedureEditor.defaults.newProcedure')}
                  aria-label={t('procedureEditor.form.displayName')}
                />
                <span className="hidden shrink-0 rounded-full bg-black/[0.04] px-3 py-1 text-[12px] font-medium text-[var(--mist)] sm:inline-flex">
                  {t('procedureEditor.status.draft')}
                </span>
                {(dirty || saving) && (
                  <span className="hidden shrink-0 text-[13px] text-[var(--fog)] sm:inline-flex">
                    {saveStateLabel}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {saveSuccess ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-malachite/18 bg-malachite/[0.08] px-3 py-1.5 text-[12px] font-medium text-malachite">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {saveSuccess}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setAdvancedOpen((open) => !open)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-[var(--mist)] transition hover:bg-black/[0.07]"
                  aria-label={t('procedureEditor.actions.settings')}
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || !dirty}
                  className="inline-flex items-center gap-2 rounded-full bg-[#128a20] px-4 py-2 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(18,138,32,0.22)] transition hover:bg-[#0f7a1c] disabled:bg-black/[0.08] disabled:text-[var(--fog)] disabled:shadow-none"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-[var(--fog)] transition hover:bg-vermillion/[0.08] hover:text-vermillion disabled:opacity-50"
                  aria-label={t('common.delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <Link
                  href="/build/components/procedures"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.04] text-[var(--mist)] transition hover:bg-black/[0.07]"
                  aria-label={t('procedureEditor.actions.close')}
                >
                  <X className="h-4 w-4" />
                </Link>
              </div>
            </div>
            {saveError ? (
              <div className="border-t border-vermillion/15 bg-vermillion/[0.06] px-6 py-2 text-[12px] text-vermillion">
                {saveError}
              </div>
            ) : null}
          </div>

          <div className="grid xl:grid-cols-[300px_minmax(0,1fr)]">
            <aside className="min-w-0 border-r border-black/[0.08] bg-[#fbfaf6]">
              <div className="sticky top-[73px] max-h-[calc(100vh-73px)] overflow-y-auto px-4 py-6">
                <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--fog)]">{t('procedureEditor.section.orderedSteps')}</p>
                <button
                  type="button"
                  onClick={() => setSelectedKey('overview')}
                  className={`mt-2 flex w-full items-center gap-2 rounded-[14px] border px-3 py-2.5 text-left text-[13px] font-medium transition ${selected === 'overview' ? 'border-[#357f7c]/30 bg-[#357f7c]/[0.08] text-[var(--mist)]' : 'border-transparent text-[var(--fog)] hover:bg-black/[0.03]'}`}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {t('procedureEditor.form.whenToUse')}
                </button>
                <div className="mt-3 space-y-1.5">
                  {draft.steps.map((step, index) => {
                    const stepBindings = getStepBindings(step.id)
                    const active = selected === step.id
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setSelectedKey(step.id)}
                        className={`flex w-full items-start gap-2.5 rounded-[14px] border px-3 py-2.5 text-left transition ${active ? 'border-[#5b8af7]/30 bg-[#5b8af7]/[0.08]' : 'border-transparent hover:bg-black/[0.03]'}`}
                      >
                        <span className={`mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-medium ${active ? 'bg-[#bcd3f6] text-[#0c447c]' : 'bg-black/[0.05] text-[var(--fog)]'}`}>{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-[var(--mist)]">{step.title || t('procedureEditor.defaults.stepTitle', { n: index + 1 })}</span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {step.branches.length > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-[#357f7c]/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-[#357f7c]"><GitBranch className="h-3 w-3" />{step.branches.length}</span>
                            ) : null}
                            {stepBindings.length > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-[#b6791f]/[0.12] px-1.5 py-0.5 text-[10px] font-medium text-[#8a5d11]"><Lock className="h-3 w-3" />{stepBindings.length}</span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                <button
                  type="button"
                  onClick={addStep}
                  className="mt-3 flex w-full items-center gap-1.5 rounded-[14px] border border-dashed border-black/[0.12] bg-white px-3 py-2.5 text-[13px] font-medium text-[var(--fog)] transition hover:border-[#357f7c]/30 hover:text-[#357f7c]"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('procedureEditor.actions.addStep')}
                </button>
              </div>
            </aside>
            <main className="min-w-0 bg-[#fffefa]">
              <div className="mx-auto max-w-[1020px] px-4 py-8 md:px-8 lg:px-12">
                {selected === 'overview' ? (
                <section className="grid gap-5 md:grid-cols-[72px_minmax(0,1fr)]">
                  <div className="hidden justify-end pt-9 md:flex">
                    <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/[0.04] text-[var(--mist)]">
                      <ListChecks className="h-5 w-5" />
                    </span>
                  </div>
                  <div>
                    <div className="mb-5 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-2 rounded-full border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-3 py-1 text-[11px] font-semibold uppercase text-[#357f7c]">
                        <Sparkles className="h-3.5 w-3.5" />
                        {t('procedureEditor.badge.v2')}
                      </span>
                      <span className="rounded-full border border-black/[0.07] bg-white px-3 py-1 text-[11px] font-medium text-[var(--fog)]">
                        {draft.type || t('procedureEditor.form.procedureKey')}
                      </span>
                      <span className="rounded-full border border-black/[0.07] bg-white px-3 py-1 text-[11px] font-medium text-[var(--fog)]">
                        {draft.enabled ? t('common.enabled') : t('common.disabled')}
                      </span>
                    </div>
                    <h2 className="text-[24px] font-semibold leading-tight text-[var(--mist)] md:text-[28px]">
                      {t('procedureEditor.form.whenToUse')}
                    </h2>
                    <textarea
                      value={draft.whenToUse}
                      onChange={(event) => setDraft((current) => ({ ...current, whenToUse: event.target.value }))}
                      rows={6}
                      className="mt-5 w-full resize-y rounded-[18px] border border-black/[0.10] bg-white px-5 py-4 text-[17px] leading-8 text-[var(--mist)] shadow-[0_16px_44px_rgba(20,27,35,0.08)] outline-none transition placeholder:text-[var(--fog)]/55 focus:border-[#357f7c]/40 focus:ring-4 focus:ring-[#357f7c]/[0.08]"
                      placeholder={t('procedureEditor.placeholder.whenToUse')}
                    />
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-[12px] text-[var(--mist)]">
                        <ListChecks className="h-3.5 w-3.5" />
                        {t('procedureEditor.section.orderedSteps')}: {draft.steps.length}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-[12px] text-[var(--mist)]">
                        <GitBranch className="h-3.5 w-3.5" />
                        {t('procedureEditor.status.branches')}: {draft.steps.reduce((count, step) => count + step.branches.length, 0)}
                      </span>
                    </div>

                    <details
                      open={advancedOpen}
                      onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
                      className="mt-5 rounded-[18px] border border-black/[0.07] bg-black/[0.02] px-4 py-3"
                    >
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[13px] font-semibold text-[var(--mist)]">
                        <span>{t('procedureEditor.section.advanced')}</span>
                        <ChevronDown className="h-4 w-4 text-[var(--fog)]" />
                      </summary>
                      <div className="mt-4 space-y-5">
                        <div className="grid gap-4 md:grid-cols-2">
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
                          <label className="flex items-end gap-2 pb-2 text-[13px] text-[var(--mist)]">
                            <input
                              type="checkbox"
                              checked={draft.enabled}
                              onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
                              className="h-4 w-4 rounded border-[var(--color-border-subtle)]"
                            />
                            {t('caseTypes.enabledForRouting')}
                          </label>
                        </div>
                        <MetaField label={t('common.description')}>
                          <textarea
                            value={draft.description}
                            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                            rows={2}
                            className="glass-input-console resize-y text-[13px]"
                          />
                        </MetaField>
                        <MetaField label={t('procedureEditor.form.overview')}>
                          <textarea
                            value={draft.overview}
                            onChange={(event) => setDraft((current) => ({ ...current, overview: event.target.value }))}
                            rows={3}
                            className="glass-input-console resize-y text-[13px]"
                            placeholder={t('procedureEditor.placeholder.overview')}
                          />
                        </MetaField>
                        <MetaField label={t('caseTypes.defaultGoal')}>
                          <textarea
                            value={draft.defaultGoal}
                            onChange={(event) => setDraft((current) => ({ ...current, defaultGoal: event.target.value }))}
                            rows={2}
                            className="glass-input-console resize-y text-[13px]"
                          />
                        </MetaField>
                        <div className="grid gap-4 md:grid-cols-2">
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
                        <div className="grid gap-4 md:grid-cols-2">
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
                        </div>
                        <div className="space-y-2">
                          <p className="text-[11px] font-medium text-[var(--fog)]">{t('procedureEditor.form.autoCloseConditions')}</p>
                          <ChipInput
                            values={draft.autoCloseConditions}
                            onChange={(values) => setDraft((current) => ({ ...current, autoCloseConditions: values }))}
                            placeholder={t('procedureEditor.placeholder.autoCloseConditions')}
                          />
                        </div>
                      </div>
                    </details>
                  </div>
                </section>
                ) : null}

                {selected !== 'overview' && (
                <section className="mt-14 space-y-10">
                  {draft.steps.map((step, index) => {
                    const bindings = getStepBindings(step.id)
                    const availableHooks = availableHooksForStep(step.id)
                    const busy = hookBusyStepId === step.id
                    if (selected !== step.id) return null
                    return (
                      <div key={step.id} className="grid gap-4 md:grid-cols-[72px_minmax(0,1fr)]">
                        <div className="pt-3 text-right text-[13px] font-medium text-[var(--fog)]">
                          {index + 1}.
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-start gap-3">
                            <input
                              value={step.title}
                              onChange={(event) => updateStep(step.id, { title: event.target.value })}
                              className="min-w-0 flex-1 rounded-xl border border-transparent bg-transparent px-2 py-1 text-[18px] font-semibold leading-7 text-[var(--mist)] outline-none transition placeholder:text-[var(--fog)]/55 focus:border-black/[0.08] focus:bg-white"
                              placeholder={t('procedureEditor.defaults.stepTitle', { n: index + 1 })}
                              aria-label={t('procedureEditor.form.stepTitle')}
                            />
                            <button
                              type="button"
                              onClick={() => removeStep(step.id)}
                              disabled={draft.steps.length === 1}
                              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--fog)] transition hover:bg-vermillion/[0.08] hover:text-vermillion disabled:opacity-40"
                              aria-label={t('procedureEditor.actions.remove')}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>

                          <textarea
                            value={step.guidance}
                            onChange={(event) => updateStep(step.id, { guidance: event.target.value })}
                            rows={3}
                            className="mt-2 min-h-[84px] w-full resize-y rounded-[16px] border border-transparent bg-transparent px-2 py-2 text-[16px] leading-8 text-[var(--mist)] outline-none transition placeholder:text-[var(--fog)]/55 focus:border-black/[0.08] focus:bg-white"
                            placeholder={t('procedureEditor.form.operatorGuidance')}
                          />

                          <details className="mt-2 rounded-xl border border-black/[0.05] bg-black/[0.015] px-3 py-2">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[11px] font-medium text-[var(--fog)]">
                              <span>{t('procedureEditor.section.stepControls')}</span>
                              <ChevronDown className="h-3.5 w-3.5" />
                            </summary>
                            <div className="mt-3 grid gap-3 md:grid-cols-3">
                              <MetaField label={t('procedureEditor.form.stepKey')}>
                                <input
                                  value={step.id}
                                  onChange={(event) => updateStep(step.id, { id: event.target.value })}
                                  className="glass-input-console font-mono text-[13px]"
                                />
                              </MetaField>
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
                          </details>

                          <div className="mt-4 space-y-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.defaultActions')}</p>
                              <button
                                type="button"
                                onClick={() => addAction(step.id)}
                                className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--mist)] transition hover:border-indigo/20 hover:text-indigo"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                {t('procedureEditor.actions.addAction')}
                              </button>
                            </div>
                            {step.actions.map((action, actionIndex) => (
                              <div key={action.id} className="grid gap-3 md:grid-cols-[28px_minmax(0,1fr)]">
                                <span className="pt-4 text-right text-[12px] font-medium text-[var(--fog)]">{actionIndex + 1}.</span>
                                <ActionEditor
                                  t={t}
                                  action={action}
                                  onChange={(patch) => updateAction(step.id, action.id, patch)}
                                  onRemove={() => removeAction(step.id, action.id)}
                                  removable={step.actions.length > 1}
                                />
                              </div>
                            ))}
                          </div>

                          <div className="mt-5 space-y-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-[12px] font-semibold text-[var(--mist)]">{t('procedureEditor.section.branches')}</p>
                                <p className="mt-1 text-[11px] text-[var(--fog)]">{t('procedureEditor.section.branchesHint')}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {step.branches.length === 0 ? (
                                  <button
                                    type="button"
                                    onClick={() => addBranch(step.id, 'if')}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-3 py-1.5 text-[11px] font-semibold text-[#357f7c] transition hover:bg-[#357f7c]/[0.14]"
                                  >
                                    <GitBranch className="h-3.5 w-3.5" />
                                    {t('procedureEditor.actions.addIf')}
                                  </button>
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => addBranch(step.id, 'else_if')}
                                      className="inline-flex items-center gap-1.5 rounded-full border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-3 py-1.5 text-[11px] font-semibold text-[#357f7c] transition hover:bg-[#357f7c]/[0.14]"
                                    >
                                      <GitBranch className="h-3.5 w-3.5" />
                                      {t('procedureEditor.actions.addElseIf')}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => addBranch(step.id, 'else')}
                                      disabled={step.branches.some((branch) => branch.kind === 'else')}
                                      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.07] bg-white px-3 py-1.5 text-[11px] font-semibold text-[var(--mist)] transition hover:text-indigo disabled:opacity-40"
                                    >
                                      <GitBranch className="h-3.5 w-3.5" />
                                      {t('procedureEditor.actions.addElse')}
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            {step.branches.length === 0 ? (
                              <div className="rounded-[16px] border border-dashed border-black/[0.10] bg-black/[0.015] px-4 py-4 text-[12px] text-[var(--fog)]">
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

                          <details className="mt-5 rounded-[16px] border border-black/[0.06] bg-[#faf8f1] px-4 py-3">
                            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12px] font-semibold text-[var(--mist)]">
                              <span>{t('procedureEditor.section.stepHooks')}</span>
                              <ChevronDown className="h-3.5 w-3.5 text-[var(--fog)]" />
                            </summary>
                            <div className="mt-4 space-y-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <p className="text-[11px] leading-5 text-[var(--fog)]">{t('procedureEditor.section.stepHooksHint')}</p>
                                <Link
                                  href="/build/components/hooks"
                                  className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--mist)] transition hover:text-indigo"
                                >
                                  {t('procedureEditor.actions.openHooks')}
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </Link>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {bindings.length === 0 ? (
                                  <span className="text-[11px] text-[var(--fog)]">{t('procedureEditor.section.noHookBindings')}</span>
                                ) : (
                                  bindings.map((binding) => (
                                    <span
                                      key={binding.id}
                                      className="inline-flex items-center gap-2 rounded-full border border-black/[0.06] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--mist)]"
                                    >
                                      {binding.hookName}
                                      <button
                                        type="button"
                                        onClick={() => removeStepBinding(step.id, binding.hookName || '', binding.id)}
                                        disabled={busy}
                                        className="text-vermillion transition-opacity hover:opacity-80 disabled:opacity-40"
                                        aria-label={t('procedureEditor.actions.remove')}
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
                                      className="rounded-xl border border-black/[0.06] bg-white px-3 py-2 text-[12px] font-semibold text-[var(--mist)] transition hover:text-indigo disabled:opacity-40"
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
                                      className="rounded-xl border border-indigo/18 bg-indigo/[0.08] px-3 py-2 text-[12px] font-semibold text-indigo transition hover:bg-indigo/[0.14] disabled:opacity-40"
                                    >
                                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t('procedureEditor.actions.create')}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </details>
                        </div>
                      </div>
                    )
                  })}
                  <div className="grid gap-4 md:grid-cols-[72px_minmax(0,1fr)]">
                    <div className="hidden md:block" />
                    <button
                      type="button"
                      onClick={addStep}
                      className="inline-flex w-fit items-center gap-2 rounded-full border border-black/[0.07] bg-white px-4 py-2 text-[13px] font-semibold text-[var(--mist)] shadow-sm transition hover:border-indigo/20 hover:text-indigo"
                    >
                      <Plus className="h-4 w-4" />
                      {t('procedureEditor.actions.addStep')}
                    </button>
                  </div>
                </section>
                )}
              </div>
            </main>


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
