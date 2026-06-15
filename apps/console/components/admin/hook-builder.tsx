'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Link2,
  Loader2,
  Plus,
  Save,
  Sparkles,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Unlink,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import SlashPlaceholderEditor, { type SlashPlaceholderGroup } from '@/components/admin/slash-placeholder-editor'
import { ApiClientError, apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import type { TranslateFn } from '@/lib/i18n/types'
import type { HookHandler } from '@intera/shared/contracts/hooks'

type HookCheckpoint = 'PreToolUse' | 'PostToolUse' | 'Stop'
type HookSeverity = 'low' | 'medium' | 'high' | 'critical'
type HandlerKind = 'declarative' | 'code' | 'http'
type ScopeType = 'agent' | 'caseType' | 'procedureStep' | 'tool'
type EvaluatorMode = 'rule' | 'llm'
type MatchAction = 'block' | 'warn' | 'escalate'
type RuleCondition = 'always' | 'inputContains' | 'outputContains' | 'forbiddenPhrases' | 'requireTools' | 'requireToolsAny' | 'denyTools'

interface HookBinding {
  id: string
  hookName?: string
  scopeType: ScopeType
  scopeKey: string
  caseTypeId?: string | null
  procedureStepId?: string | null
  toolId?: string | null
  enabled: boolean
}

interface HookItem {
  id: string
  agentConfigId: string
  name: string
  displayName?: string | null
  description?: string | null
  checkpoint: HookCheckpoint
  handlerKind: HandlerKind
  handler: HookHandler
  enabled: boolean
  severity: HookSeverity
  bindings: HookBinding[]
}

interface CaseTypeOption {
  id: string
  type: string
  displayName?: string | null
  enabled?: boolean
}

interface ProcedureStepOption {
  caseTypeId: string
  caseTypeType: string
  caseTypeDisplayName: string
  id: string
  guidance?: string | null
  label: string
}

interface ToolOption {
  id: string
  name: string
  description?: string | null
  mode?: string | null
  enabled?: boolean
}

interface HooksBootstrap {
  hooks: HookItem[]
  caseTypes: CaseTypeOption[]
  procedureSteps: ProcedureStepOption[]
  tools: ToolOption[]
}

interface HookDraft {
  name: string
  description: string
  checkpoint: HookCheckpoint
  evaluatorMode: EvaluatorMode
  enabled: boolean
  severity: HookSeverity
  whenMatched: MatchAction
  guidance: string
  rule: RuleDraft
  evaluationPrompt: string
  legacyHandlerKind: Exclude<HandlerKind, 'declarative'> | null
}

interface RuleDraft {
  matchToolNames: string[]
  condition: RuleCondition
  toolNames: string[]
  textValue: string
  reason: string
}

interface BindingDraft {
  scopeType: ScopeType
  caseTypeId: string
  procedureStepValue: string
  toolId: string
}

const CHECKPOINTS: HookCheckpoint[] = ['PreToolUse', 'PostToolUse', 'Stop']
const SEVERITIES: HookSeverity[] = ['low', 'medium', 'high', 'critical']
const EVALUATOR_MODES: Array<{ value: EvaluatorMode; icon: typeof ShieldCheck | typeof Sparkles }> = [
  { value: 'rule', icon: ShieldCheck },
  { value: 'llm', icon: Sparkles },
]
const MATCH_ACTIONS: MatchAction[] = ['block', 'warn', 'escalate']
const RULE_CONDITIONS: RuleCondition[] = ['always', 'inputContains', 'outputContains', 'forbiddenPhrases', 'requireTools', 'requireToolsAny', 'denyTools']

function jsonText(value: unknown, fallback = '{}') {
  if (value === undefined || value === null) return fallback
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

function splitList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function emptyDraft(): HookDraft {
  return {
    name: '',
    description: '',
    checkpoint: 'PreToolUse',
    evaluatorMode: 'rule',
    enabled: true,
    severity: 'medium',
    whenMatched: 'block',
    guidance: '',
    rule: {
      matchToolNames: [],
      condition: 'always',
      toolNames: [],
      textValue: '',
      reason: '',
    },
    evaluationPrompt: '',
    legacyHandlerKind: null,
  }
}

function humanizeStableName(name: string): string {
  const compact = name.trim().replace(/[_.-]+/g, ' ')
  return compact ? compact.replace(/\b\w/g, (ch) => ch.toUpperCase()) : ''
}

function checkpointLabel(checkpoint: HookCheckpoint, t: TranslateFn) {
  if (checkpoint === 'PreToolUse') return t('hooks.checkpoint.preToolUse')
  if (checkpoint === 'PostToolUse') return t('hooks.checkpoint.postToolUse')
  return t('hooks.checkpoint.stop')
}

function checkpointDescription(checkpoint: HookCheckpoint, t: TranslateFn) {
  if (checkpoint === 'PreToolUse') return t('hooks.checkpoint.preToolUseHint')
  if (checkpoint === 'PostToolUse') return t('hooks.checkpoint.postToolUseHint')
  return t('hooks.checkpoint.stopHint')
}

function severityLabel(severity: HookSeverity, t: TranslateFn) {
  if (severity === 'low') return t('hooks.severity.low')
  if (severity === 'medium') return t('hooks.severity.medium')
  if (severity === 'high') return t('hooks.severity.high')
  return t('hooks.severity.critical')
}

function evaluatorLabel(mode: EvaluatorMode, t: TranslateFn) {
  return mode === 'llm' ? t('hooks.evaluator.llm') : t('hooks.evaluator.rule')
}

function matchActionLabel(action: MatchAction, t: TranslateFn) {
  if (action === 'block') return t('hooks.match.block')
  if (action === 'warn') return t('hooks.match.warn')
  return t('hooks.match.escalate')
}

function isAiHandler(handler: HookHandler): handler is Extract<HookHandler, { kind: 'declarative' }> {
  return handler.kind === 'declarative'
    && typeof (handler.check as Record<string, unknown>)?.kind === 'string'
    && (handler.check as Record<string, unknown>).kind === 'ai'
    && typeof (handler.check as Record<string, unknown>).evaluationPrompt === 'string'
}

function parseMatchAction(value: unknown): MatchAction {
  return value === 'warn' || value === 'escalate' ? value : 'block'
}

function hookModeLabel(hook: HookItem, t: TranslateFn): string {
  if (hook.handler.kind === 'declarative') {
    return isAiHandler(hook.handler) ? t('hooks.evaluator.llm') : t('hooks.evaluator.rule')
  }
  return t('hooks.legacyMode', { mode: hook.handler.kind })
}

function matchActionDescription(action: MatchAction, checkpoint: HookCheckpoint, t: TranslateFn): string {
  if (action === 'block') {
    if (checkpoint === 'PreToolUse') return t('hooks.match.blockDesc.preToolUse')
    if (checkpoint === 'Stop') return t('hooks.match.blockDesc.stop')
    return t('hooks.match.blockDesc.default')
  }
  if (action === 'warn') {
    return t('hooks.match.warnDesc')
  }
  return t('hooks.match.escalateDesc')
}

function ruleConditionLabel(condition: RuleCondition, t: TranslateFn): string {
  if (condition === 'always') return t('hooks.rule.condition.always')
  if (condition === 'inputContains') return t('hooks.rule.condition.inputContains')
  if (condition === 'outputContains') return t('hooks.rule.condition.outputContains')
  if (condition === 'forbiddenPhrases') return t('hooks.rule.condition.forbiddenPhrases')
  if (condition === 'requireTools') return t('hooks.rule.condition.requireTools')
  if (condition === 'requireToolsAny') return t('hooks.rule.condition.requireToolsAny')
  return t('hooks.rule.condition.denyTools')
}

function ruleConditionHint(condition: RuleCondition, t: TranslateFn): string {
  if (condition === 'always') return t('hooks.rule.condition.alwaysHint')
  if (condition === 'inputContains') return t('hooks.rule.condition.inputContainsHint')
  if (condition === 'outputContains') return t('hooks.rule.condition.outputContainsHint')
  if (condition === 'forbiddenPhrases') return t('hooks.rule.condition.forbiddenPhrasesHint')
  if (condition === 'requireTools') return t('hooks.rule.condition.requireToolsHint')
  if (condition === 'requireToolsAny') return t('hooks.rule.condition.requireToolsAnyHint')
  return t('hooks.rule.condition.denyToolsHint')
}

function isToolCondition(condition: RuleCondition): boolean {
  return condition === 'requireTools' || condition === 'requireToolsAny' || condition === 'denyTools'
}

function isTextCondition(condition: RuleCondition): boolean {
  return condition === 'inputContains' || condition === 'outputContains' || condition === 'forbiddenPhrases'
}

function ruleDraftFromCheck(check: Record<string, unknown>): RuleDraft {
  const match = check.match && typeof check.match === 'object' && !Array.isArray(check.match)
    ? check.match as Record<string, unknown>
    : {}
  const matchToolNames = Array.isArray(match.tools) ? match.tools.filter((item): item is string => typeof item === 'string') : []
  const reason = typeof check.reason === 'string' ? check.reason : ''
  const arrayField = (key: string) => Array.isArray(check[key]) ? (check[key] as unknown[]).filter((item): item is string => typeof item === 'string') : []

  if (check.always === true) return { matchToolNames, condition: 'always', toolNames: [], textValue: '', reason }
  const inputContains = arrayField('inputContains')
  if (inputContains.length > 0) return { matchToolNames, condition: 'inputContains', toolNames: [], textValue: inputContains.join('\n'), reason }
  const outputContains = arrayField('outputContains')
  if (outputContains.length > 0) return { matchToolNames, condition: 'outputContains', toolNames: [], textValue: outputContains.join('\n'), reason }
  const forbiddenPhrases = [...arrayField('forbiddenPhrases'), ...arrayField('replyContains')]
  if (forbiddenPhrases.length > 0) return { matchToolNames, condition: 'forbiddenPhrases', toolNames: [], textValue: unique(forbiddenPhrases).join('\n'), reason }
  const requireTools = arrayField('requireTools')
  if (requireTools.length > 0) return { matchToolNames, condition: 'requireTools', toolNames: requireTools, textValue: '', reason }
  const requireToolsAny = arrayField('requireToolsAny')
  if (requireToolsAny.length > 0) return { matchToolNames, condition: 'requireToolsAny', toolNames: requireToolsAny, textValue: '', reason }
  const denyTools = arrayField('denyTools')
  if (denyTools.length > 0) return { matchToolNames, condition: 'denyTools', toolNames: denyTools, textValue: '', reason }

  return { matchToolNames, condition: 'always', toolNames: [], textValue: '', reason }
}

function ruleCheckFromDraft(rule: RuleDraft, t?: TranslateFn): Record<string, unknown> {
  const check: Record<string, unknown> = { kind: 'rule' }
  const matchToolNames = unique(rule.matchToolNames)
  if (matchToolNames.length > 0) check.match = { tools: matchToolNames }
  if (rule.reason.trim()) check.reason = rule.reason.trim()

  if (rule.condition === 'always') {
    check.always = true
    return check
  }

  if (isToolCondition(rule.condition)) {
    const toolNames = unique(rule.toolNames)
    if (toolNames.length === 0 && t) throw new Error(t('hooks.error.ruleToolRequired'))
    if (toolNames.length > 0) check[rule.condition] = toolNames
    return check
  }

  const values = splitList(rule.textValue)
  if (values.length === 0 && t) throw new Error(t('hooks.error.ruleTextRequired'))
  if (values.length > 0) {
    if (rule.condition === 'forbiddenPhrases') {
      check.forbiddenPhrases = values
    } else {
      check[rule.condition] = values
    }
  }
  return check
}

function isRuleDraftComplete(rule: RuleDraft): boolean {
  if (rule.condition === 'always') return true
  if (isToolCondition(rule.condition)) return rule.toolNames.length > 0
  return splitList(rule.textValue).length > 0
}

function ToolChipPicker({
  tools,
  selected,
  onChange,
  emptyText,
}: {
  tools: ToolOption[]
  selected: string[]
  onChange: (next: string[]) => void
  emptyText: string
}) {
  if (tools.length === 0) {
    return <div className="rounded-lg border border-dashed border-black/15 px-3 py-3 text-[12px] text-[var(--fog)]">{emptyText}</div>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {tools.map((tool) => {
        const active = selected.includes(tool.name)
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => onChange(toggleValue(selected, tool.name))}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition ${
              active
                ? 'border-[rgba(53,127,124,0.28)] bg-[rgba(53,127,124,0.10)] text-[var(--color-accent-primary)]'
                : 'border-black/[0.08] bg-white/70 text-[var(--fog)] hover:bg-white'
            }`}
          >
            {tool.name}
          </button>
        )
      })}
    </div>
  )
}

function draftFromHook(hook: HookItem): HookDraft {
  const draft = emptyDraft()
  draft.name = hook.name
  draft.description = hook.description ?? ''
  draft.checkpoint = hook.checkpoint
  draft.enabled = hook.enabled
  draft.severity = hook.severity
  draft.legacyHandlerKind = hook.handler.kind === 'declarative' ? null : hook.handler.kind

  if (hook.handler.kind === 'declarative') {
    draft.evaluatorMode = isAiHandler(hook.handler) ? 'llm' : 'rule'
    draft.whenMatched = parseMatchAction((hook.handler.effect as Record<string, unknown>)?.decision ?? (hook.handler.effect as Record<string, unknown>)?.action)
    draft.guidance = String((hook.handler.effect as Record<string, unknown>)?.guidance ?? '')
    if (draft.evaluatorMode === 'llm') {
      draft.evaluationPrompt = String((hook.handler.check as Record<string, unknown>).evaluationPrompt ?? '')
    } else {
      draft.rule = ruleDraftFromCheck(hook.handler.check as Record<string, unknown>)
    }
  }
  return draft
}

function handlerFromDraft(draft: HookDraft, t: TranslateFn): HookHandler {
  const effect: Record<string, unknown> = {
    decision: draft.whenMatched,
  }
  if (draft.guidance.trim()) effect.guidance = draft.guidance.trim()
  if (draft.whenMatched === 'escalate') effect.tool = 'create_human_task'

  if (draft.evaluatorMode === 'llm') {
    if (!draft.evaluationPrompt.trim()) throw new Error(t('hooks.error.promptRequired'))
    return {
      kind: 'declarative',
      check: {
        kind: 'ai',
        evaluationPrompt: draft.evaluationPrompt.trim(),
      },
      effect,
    }
  }

  const check = ruleCheckFromDraft(draft.rule, t)
  return {
    kind: 'declarative',
    check,
    effect,
  }
}

function bindingDraftDefault(): BindingDraft {
  return { scopeType: 'agent', caseTypeId: '', procedureStepValue: '', toolId: '' }
}

function procedureStepValue(step: ProcedureStepOption) {
  return JSON.stringify({ caseTypeId: step.caseTypeId, procedureStepId: step.id })
}

function parseProcedureStepValue(value: string) {
  try {
    return JSON.parse(value) as { caseTypeId: string; procedureStepId: string }
  } catch {
    return { caseTypeId: '', procedureStepId: '' }
  }
}

function scopeTypeLabel(scopeType: ScopeType, t: TranslateFn) {
  if (scopeType === 'agent') return t('hooks.scope.agent')
  if (scopeType === 'caseType') return t('hooks.scope.caseType')
  if (scopeType === 'procedureStep') return t('hooks.scope.procedureStep')
  return t('hooks.scope.tool')
}

export default function HookBuilder({ embedded = false }: { embedded?: boolean }) {
  const agentConfigId = useSelectedAgentId()
  const { orgId } = useSession()
  const { t } = useConsoleLocale()
  const [hooks, setHooks] = useState<HookItem[]>([])
  const [caseTypes, setCaseTypes] = useState<CaseTypeOption[]>([])
  const [procedureSteps, setProcedureSteps] = useState<ProcedureStepOption[]>([])
  const [tools, setTools] = useState<ToolOption[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [draft, setDraft] = useState<HookDraft>(emptyDraft)
  const [isNew, setIsNew] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bindingDraft, setBindingDraft] = useState<BindingDraft>(bindingDraftDefault)
  const selectedNameRef = useRef<string | null>(null)

  const selectedHook = useMemo(
    () => hooks.find((hook) => hook.name === selectedName) ?? null,
    [hooks, selectedName],
  )
  const saveDisabled = saving
    || !draft.name.trim()
    || (draft.evaluatorMode === 'llm' && !draft.evaluationPrompt.trim())
    || (draft.evaluatorMode === 'rule' && !isRuleDraftComplete(draft.rule))

  const placeholderGroups = useMemo<SlashPlaceholderGroup[]>(
    () => [
      {
        id: 'tool',
        label: t('hooks.placeholderGroup.tool.label'),
        description: t('hooks.placeholderGroup.tool.description'),
        items: [
          { token: 'tool_name', label: t('hooks.placeholder.toolName'), description: t('hooks.placeholder.toolNameDesc'), typeLabel: t('hooks.placeholder.type.string') },
          { token: 'tool_input', label: t('hooks.placeholder.toolInput'), description: t('hooks.placeholder.toolInputDesc'), typeLabel: t('hooks.placeholder.type.jsonString') },
          { token: 'tool_output', label: t('hooks.placeholder.toolOutput'), description: t('hooks.placeholder.toolOutputDesc'), typeLabel: t('hooks.placeholder.type.jsonString') },
        ],
      },
      {
        id: 'case',
        label: t('hooks.placeholderGroup.case.label'),
        description: t('hooks.placeholderGroup.case.description'),
        items: [
          { token: 'tools_called', label: t('hooks.placeholder.toolsCalled'), description: t('hooks.placeholder.toolsCalledDesc'), typeLabel: t('hooks.placeholder.type.jsonString') },
        ],
      },
      {
        id: 'reply',
        label: t('hooks.placeholderGroup.reply.label'),
        description: t('hooks.placeholderGroup.reply.description'),
        items: [
          { token: 'reply_draft', label: t('hooks.placeholder.replyDraft'), description: t('hooks.placeholder.replyDraftDesc'), typeLabel: t('hooks.placeholder.type.string') },
        ],
      },
    ],
    [t],
  )

  useEffect(() => {
    selectedNameRef.current = selectedName
  }, [selectedName])

  const load = useCallback(async () => {
    if (!agentConfigId) return
    setLoading(true)
    setError(null)
    try {
      const result = await apiClient<HooksBootstrap>(`/api/admin/hooks?agentConfigId=${encodeURIComponent(agentConfigId)}`)
      setHooks(result.data.hooks)
      setCaseTypes(result.data.caseTypes)
      setProcedureSteps(result.data.procedureSteps)
      setTools(result.data.tools)
      const currentSelected = selectedNameRef.current
      const nextSelected = currentSelected && result.data.hooks.some((hook) => hook.name === currentSelected)
        ? currentSelected
        : result.data.hooks[0]?.name ?? null
      setSelectedName(nextSelected)
      const nextHook = result.data.hooks.find((hook) => hook.name === nextSelected)
      if (nextHook) {
        setDraft(draftFromHook(nextHook))
        setIsNew(false)
      } else {
        setDraft(emptyDraft())
        setIsNew(true)
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : t('hooks.error.load'))
    } finally {
      setLoading(false)
    }
  }, [agentConfigId, t])

  useEffect(() => { load() }, [load])

  const selectHook = (hook: HookItem) => {
    selectedNameRef.current = hook.name
    setSelectedName(hook.name)
    setDraft(draftFromHook(hook))
    setIsNew(false)
    setError(null)
  }

  const startNew = () => {
    selectedNameRef.current = null
    setSelectedName(null)
    setDraft(emptyDraft())
    setIsNew(true)
    setError(null)
  }

  const saveHook = async () => {
    if (!agentConfigId) return
    setSaving(true)
    setError(null)
    try {
      const handler = handlerFromDraft(draft, t)
      const body = {
        agentConfigId,
        name: draft.name,
        displayName: humanizeStableName(draft.name) || null,
        description: draft.description || null,
        checkpoint: draft.checkpoint,
        handlerKind: 'declarative' as const,
        handler,
        enabled: draft.enabled,
        severity: draft.severity,
      }
      const url = isNew ? '/api/admin/hooks' : `/api/admin/hooks/${encodeURIComponent(selectedName ?? draft.name)}`
      const result = await apiClient<{ hook: HookItem }>(url, {
        method: isNew ? 'POST' : 'PUT',
        body,
      })
      await bustConfigCache(orgId).catch(() => {})
      selectedNameRef.current = result.data.hook.name
      setSelectedName(result.data.hook.name)
      setDraft(draftFromHook(result.data.hook))
      setIsNew(false)
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : err instanceof Error ? err.message : t('hooks.error.save'))
    } finally {
      setSaving(false)
    }
  }

  const deleteHook = async () => {
    if (!agentConfigId || !selectedHook) return
    setSaving(true)
    setError(null)
    try {
      await apiClient(`/api/admin/hooks/${encodeURIComponent(selectedHook.name)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'DELETE',
      })
      await bustConfigCache(orgId).catch(() => {})
      selectedNameRef.current = null
      setSelectedName(null)
      setDraft(emptyDraft())
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : t('hooks.error.delete'))
    } finally {
      setSaving(false)
    }
  }

  const addBinding = async () => {
    if (!agentConfigId || !selectedHook) return
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        agentConfigId,
        scopeType: bindingDraft.scopeType,
        enabled: true,
      }
      if (bindingDraft.scopeType === 'caseType') body.caseTypeId = bindingDraft.caseTypeId
      if (bindingDraft.scopeType === 'tool') body.toolId = bindingDraft.toolId
      if (bindingDraft.scopeType === 'procedureStep') {
        const parsed = parseProcedureStepValue(bindingDraft.procedureStepValue)
        body.caseTypeId = parsed.caseTypeId
        body.procedureStepId = parsed.procedureStepId
      }
      await apiClient(`/api/admin/hooks/${encodeURIComponent(selectedHook.name)}/bindings`, {
        method: 'POST',
        body,
      })
      await bustConfigCache(orgId).catch(() => {})
      setBindingDraft(bindingDraftDefault())
      await load()
    } catch (err) {
      setError(err instanceof ApiClientError ? err.envelope.error.message : t('hooks.error.bindingSave'))
    } finally {
      setSaving(false)
    }
  }

  const toggleBinding = async (binding: HookBinding) => {
    if (!agentConfigId || !selectedHook) return
    await apiClient(`/api/admin/hooks/${encodeURIComponent(selectedHook.name)}/bindings/${encodeURIComponent(binding.id)}`, {
      method: 'PUT',
      body: { agentConfigId, enabled: !binding.enabled },
    })
    await bustConfigCache(orgId).catch(() => {})
    await load()
  }

  const deleteBinding = async (binding: HookBinding) => {
    if (!agentConfigId || !selectedHook) return
    await apiClient(`/api/admin/hooks/${encodeURIComponent(selectedHook.name)}/bindings/${encodeURIComponent(binding.id)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
      method: 'DELETE',
    })
    await bustConfigCache(orgId).catch(() => {})
    await load()
  }

  const scopeLabel = (binding: HookBinding) => {
    if (binding.scopeType === 'agent') return t('hooks.scope.agent')
    if (binding.scopeType === 'caseType') {
      const ct = caseTypes.find((item) => item.id === binding.caseTypeId)
      return ct?.displayName || ct?.type || binding.scopeKey
    }
    if (binding.scopeType === 'procedureStep') {
      const step = procedureSteps.find((item) => item.caseTypeId === binding.caseTypeId && item.id === binding.procedureStepId)
      return step?.label || binding.scopeKey
    }
    const tool = tools.find((item) => item.id === binding.toolId)
    return tool?.name || binding.scopeKey
  }

  const bindingsPanel = (
    <section className="rounded-lg border border-black/[0.06] bg-white/70 p-5 shadow-[0_12px_36px_rgba(21,23,25,0.05)]">
      <div className="mb-4 flex items-center gap-2">
        <Link2 className="h-5 w-5 text-indigo" />
        <h2 className="text-[15px] font-semibold text-[var(--mist)]">{t('hooks.bindings.title')}</h2>
      </div>

      {!selectedHook ? (
        <div className="rounded-lg border border-dashed border-black/15 px-4 py-5 text-[13px] text-[var(--fog)]">{t('hooks.bindings.saveFirst')}</div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {selectedHook.bindings.length === 0 ? (
              <div className="rounded-lg border border-dashed border-black/15 px-4 py-4 text-[13px] text-[var(--fog)]">{t('hooks.bindings.empty')}</div>
            ) : selectedHook.bindings.map((binding) => (
              <div key={binding.id} className="rounded-lg border border-black/[0.06] bg-white/65 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="break-words text-[13px] font-medium text-[var(--mist)]">{scopeLabel(binding)}</div>
                    <div className="mt-1 text-[11px] text-[var(--fog)]">{scopeTypeLabel(binding.scopeType, t)}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggleBinding(binding)}
                      title={binding.enabled ? t('hooks.bindings.disable') : t('hooks.bindings.enable')}
                      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition ${binding.enabled ? 'border-emerald-500/20 text-emerald-700 hover:bg-emerald-500/10' : 'border-black/10 text-[var(--fog)] hover:bg-black/[0.04]'}`}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteBinding(binding)}
                      title={t('hooks.bindings.remove')}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 text-red-600 transition hover:bg-red-500/10"
                    >
                      <Unlink className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="border-t border-black/[0.06] pt-4">
            <label className="space-y-1.5">
              <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.bindings.scope')}</span>
              <select
                value={bindingDraft.scopeType}
                onChange={(event) => setBindingDraft({ ...bindingDraftDefault(), scopeType: event.target.value as ScopeType })}
                className="glass-input-console text-[13px]"
              >
                <option value="agent">{t('hooks.scope.agent')}</option>
                <option value="caseType">{t('hooks.scope.caseType')}</option>
                <option value="procedureStep">{t('hooks.scope.procedureStep')}</option>
                <option value="tool">{t('hooks.scope.tool')}</option>
              </select>
            </label>

            {bindingDraft.scopeType === 'caseType' ? (
              <label className="mt-3 block space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.scope.caseType')}</span>
                <select
                  value={bindingDraft.caseTypeId}
                  onChange={(event) => setBindingDraft({ ...bindingDraft, caseTypeId: event.target.value })}
                  className="glass-input-console text-[13px]"
                >
                  <option value="">{t('hooks.bindings.selectCaseType')}</option>
                  {caseTypes.map((ct) => <option key={ct.id} value={ct.id}>{ct.displayName || ct.type}</option>)}
                </select>
              </label>
            ) : null}

            {bindingDraft.scopeType === 'procedureStep' ? (
              <label className="mt-3 block space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.scope.procedureStep')}</span>
                <select
                  value={bindingDraft.procedureStepValue}
                  onChange={(event) => setBindingDraft({ ...bindingDraft, procedureStepValue: event.target.value })}
                  className="glass-input-console text-[13px]"
                >
                  <option value="">{t('hooks.bindings.selectProcedureStep')}</option>
                  {procedureSteps.map((step) => <option key={`${step.caseTypeId}:${step.id}`} value={procedureStepValue(step)}>{step.label}</option>)}
                </select>
              </label>
            ) : null}

            {bindingDraft.scopeType === 'tool' ? (
              <label className="mt-3 block space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.scope.tool')}</span>
                <select
                  value={bindingDraft.toolId}
                  onChange={(event) => setBindingDraft({ ...bindingDraft, toolId: event.target.value })}
                  className="glass-input-console text-[13px]"
                >
                  <option value="">{t('hooks.bindings.selectTool')}</option>
                  {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}
                </select>
              </label>
            ) : null}

            <button
              type="button"
              onClick={addBinding}
              disabled={saving}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-indigo/20 bg-indigo/[0.08] px-4 py-2 text-[13px] font-medium text-indigo transition hover:bg-indigo/[0.14] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {t('hooks.bindings.add')}
            </button>
          </div>
        </div>
      )}
    </section>
  )

  return (
    <div className={embedded ? 'relative isolate min-h-[calc(100dvh-176px)] rounded-[18px] bg-[var(--color-bg-app)]' : undefined}>
      {!embedded ? <VersionContextBar /> : null}
      <div className={embedded ? 'px-0 py-2' : 'px-8 py-8'}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('hooks.title')}</h1>
            <p className="mt-1 text-[13px] text-[var(--fog)]">{t('hooks.configuredControls', { n: hooks.length })}</p>
          </div>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex items-center gap-2 rounded-lg border border-indigo/20 bg-indigo/[0.08] px-4 py-2 text-[13px] font-medium text-indigo transition hover:bg-indigo/[0.14]"
          >
            <Plus className="h-4 w-4" />
            {t('hooks.new')}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white/60 px-4 py-3 text-[13px] text-[var(--fog)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('hooks.loading')}
          </div>
        ) : !agentConfigId ? (
          <div className="rounded-lg border border-black/[0.06] bg-white/60 px-4 py-3 text-[13px] text-[var(--fog)]">{t('hooks.selectAgent')}</div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)] xl:items-start">
            <aside className="space-y-4">
              <section className="rounded-lg border border-black/[0.06] bg-white/70 p-4 shadow-[0_12px_36px_rgba(21,23,25,0.05)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--fog)]">{t('hooks.listTitle')}</div>
                    <div className="mt-1 text-[12px] text-[var(--fog)]">{t('hooks.listHint')}</div>
                  </div>
                  <span className="rounded-full bg-black/[0.04] px-2.5 py-1 text-[11px] font-semibold text-[var(--fog)]">{hooks.length}</span>
                </div>

                <div className="space-y-3">
                  {hooks.length === 0 && !isNew ? (
                    <button
                      type="button"
                      onClick={startNew}
                      className="w-full rounded-lg border border-dashed border-black/15 bg-white/50 px-4 py-5 text-left text-[13px] text-[var(--fog)] transition hover:border-indigo/30 hover:text-[var(--mist)]"
                    >
                      {t('hooks.first')}
                    </button>
                  ) : null}
                  {hooks.map((hook) => (
                    <button
                      key={hook.id}
                      type="button"
                      onClick={() => selectHook(hook)}
                      className={`w-full rounded-lg border px-4 py-3 text-left transition ${hook.name === selectedName ? 'border-indigo/35 bg-indigo/[0.08]' : 'border-black/[0.06] bg-white/60 hover:border-black/10 hover:bg-white/80'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate text-[13px] font-semibold text-[var(--mist)]">{hook.displayName || humanizeStableName(hook.name) || hook.name}</span>
                        <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] ${hook.enabled ? 'bg-emerald-500/10 text-emerald-700' : 'bg-black/[0.05] text-[var(--fog)]'}`}>
                          {hook.enabled ? t('hooks.status.enabled') : t('hooks.status.disabled')}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-[var(--fog)]">
                        <span className="rounded-md bg-black/[0.04] px-2 py-0.5">{checkpointLabel(hook.checkpoint, t)}</span>
                        <span className="rounded-md bg-black/[0.04] px-2 py-0.5">{hookModeLabel(hook, t)}</span>
                        <span className="rounded-md bg-black/[0.04] px-2 py-0.5">{t('hooks.bindings.count', { n: hook.bindings.length })}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              {bindingsPanel}
            </aside>

            <main>
              <section className="rounded-lg border border-black/[0.06] bg-white/70 p-5 shadow-[0_12px_36px_rgba(21,23,25,0.05)]">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-indigo" />
                    <h2 className="text-[15px] font-semibold text-[var(--mist)]">{isNew ? t('hooks.editor.create') : t('hooks.editor.edit')}</h2>
                  </div>
                  <div className="flex items-center gap-2">
                    {!isNew && selectedHook ? (
                      <button
                        type="button"
                        onClick={deleteHook}
                        title={t('hooks.delete')}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-500/20 text-red-600 transition hover:bg-red-500/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-pressed={draft.enabled}
                      onClick={() => setDraft({ ...draft, enabled: !draft.enabled })}
                      className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-[13px] font-medium transition ${
                        draft.enabled
                          ? 'border-emerald-500/24 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/14'
                          : 'border-black/[0.08] bg-white/72 text-[var(--fog)] hover:bg-white'
                      }`}
                    >
                      {draft.enabled ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                      {draft.enabled ? t('hooks.status.enabled') : t('hooks.status.disabled')}
                    </button>
                    <button
                      type="button"
                      onClick={saveHook}
                      disabled={saveDisabled}
                      className="inline-flex items-center gap-2 rounded-lg bg-[var(--mist)] px-4 py-2 text-[13px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      {t('hooks.save')}
                    </button>
                  </div>
                </div>

                {error ? (
                  <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] text-red-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="break-words">{error}</span>
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <label className="space-y-1.5 lg:col-span-2">
                    <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.name')}</span>
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      className="glass-input-console text-[13px]"
                      placeholder={t('hooks.namePlaceholder')}
                    />
                    <p className="text-[11px] text-[var(--fog)]">{t('hooks.nameHint')}</p>
                  </label>
                  <label className="space-y-1.5 lg:col-span-2">
                    <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.note')}</span>
                    <textarea
                      value={draft.description}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      className="glass-input-console min-h-[88px] resize-y text-[13px]"
                    />
                  </label>
                </div>

                {draft.legacyHandlerKind ? (
                  <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-3 text-[12px] text-amber-800">
                    {t('hooks.legacyNotice', { mode: draft.legacyHandlerKind })}
                  </div>
                ) : null}

                <div className="mt-5 rounded-xl border border-black/[0.06] bg-white/55 p-4">
                  <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_220px]">
                    <div className="space-y-4">
                      <div>
                        <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.checkpoint.title')}</span>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {CHECKPOINTS.map((checkpoint) => (
                            <button
                              key={checkpoint}
                              type="button"
                              onClick={() => setDraft({ ...draft, checkpoint })}
                              className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition ${draft.checkpoint === checkpoint ? 'border-indigo/30 bg-indigo/[0.08] text-indigo' : 'border-black/[0.08] bg-white/70 text-[var(--fog)] hover:bg-white'}`}
                            >
                              {checkpointLabel(checkpoint, t)}
                            </button>
                          ))}
                        </div>
                        <p className="mt-2 text-[11px] leading-5 text-[var(--fog)]">{checkpointDescription(draft.checkpoint, t)}</p>
                      </div>

                      <div>
                        <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.evaluator.title')}</span>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {EVALUATOR_MODES.map((mode) => {
                            const Icon = mode.icon
                            return (
                              <button
                                key={mode.value}
                                type="button"
                                onClick={() => setDraft({ ...draft, evaluatorMode: mode.value })}
                              className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-[13px] transition ${draft.evaluatorMode === mode.value ? 'border-indigo/35 bg-indigo/[0.08] text-indigo' : 'border-black/[0.06] bg-white/60 text-[var(--fog)] hover:bg-white'}`}
                            >
                                <Icon className="h-4 w-4" />
                                {evaluatorLabel(mode.value, t)}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div>
                        <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.match.title')}</span>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {MATCH_ACTIONS.map((action) => (
                            <button
                              key={action}
                              type="button"
                              onClick={() => setDraft({ ...draft, whenMatched: action })}
                              className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition ${draft.whenMatched === action ? 'border-indigo/30 bg-indigo/[0.08] text-indigo' : 'border-black/[0.08] bg-white/70 text-[var(--fog)] hover:bg-white'}`}
                            >
                              {matchActionLabel(action, t)}
                            </button>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-3">
                          {MATCH_ACTIONS.map((action) => (
                            <div
                              key={action}
                              className={`rounded-lg border px-3 py-3 text-[12px] leading-5 ${draft.whenMatched === action ? 'border-indigo/20 bg-indigo/[0.05] text-[var(--mist)]' : 'border-black/[0.06] bg-white/65 text-[var(--fog)]'}`}
                            >
                              <div className="font-semibold">{matchActionLabel(action, t)}</div>
                              <p className="mt-1">{matchActionDescription(action, draft.checkpoint, t)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-3 rounded-xl border border-black/[0.06] bg-white/68 p-4">
                      <div>
                        <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.severity.title')}</span>
                        <select
                          value={draft.severity}
                          onChange={(event) => setDraft({ ...draft, severity: event.target.value as HookSeverity })}
                          className="glass-input-console mt-2 text-[13px]"
                        >
                          {SEVERITIES.map((severity) => <option key={severity} value={severity}>{severityLabel(severity, t)}</option>)}
                        </select>
                      </div>
                      <label className="block space-y-1.5">
                        <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.guidance')}</span>
                        <textarea
                          value={draft.guidance}
                          onChange={(event) => setDraft({ ...draft, guidance: event.target.value })}
                          className="glass-input-console min-h-[112px] resize-y text-[13px]"
                          placeholder={t('hooks.guidancePlaceholder')}
                        />
                      </label>
                    </div>
                  </div>
                </div>

                {draft.evaluatorMode === 'rule' ? (
                  <div className="mt-4 space-y-4 rounded-xl border border-black/[0.06] bg-white/60 p-4">
                    <div>
                      <div className="text-[12px] font-semibold text-[var(--mist)]">{t('hooks.rule.builderTitle')}</div>
                      <p className="mt-1 text-[11px] leading-5 text-[var(--fog)]">{t('hooks.rule.builderHint')}</p>
                    </div>

                    <div className="space-y-2">
                      <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.rule.appliesToTools')}</span>
                      <ToolChipPicker
                        tools={tools}
                        selected={draft.rule.matchToolNames}
                        onChange={(matchToolNames) => setDraft((current) => ({ ...current, rule: { ...current.rule, matchToolNames } }))}
                        emptyText={t('hooks.rule.noTools')}
                      />
                      <p className="text-[11px] leading-5 text-[var(--fog)]">{t('hooks.rule.appliesToToolsHint')}</p>
                    </div>

                    <div>
                      <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.rule.conditionTitle')}</span>
                      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                        {RULE_CONDITIONS.map((condition) => (
                          <button
                            key={condition}
                            type="button"
                            onClick={() => setDraft((current) => ({ ...current, rule: { ...current.rule, condition } }))}
                            className={`min-h-[72px] rounded-lg border px-3 py-2 text-left transition ${
                              draft.rule.condition === condition
                                ? 'border-indigo/30 bg-indigo/[0.08] text-[var(--mist)]'
                                : 'border-black/[0.06] bg-white/65 text-[var(--fog)] hover:bg-white'
                            }`}
                          >
                            <div className="text-[12px] font-semibold">{ruleConditionLabel(condition, t)}</div>
                            <div className="mt-1 text-[11px] leading-4">{ruleConditionHint(condition, t)}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    {isToolCondition(draft.rule.condition) ? (
                      <div className="space-y-2">
                        <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.rule.conditionTools')}</span>
                        <ToolChipPicker
                          tools={tools}
                          selected={draft.rule.toolNames}
                          onChange={(toolNames) => setDraft((current) => ({ ...current, rule: { ...current.rule, toolNames } }))}
                          emptyText={t('hooks.rule.noTools')}
                        />
                      </div>
                    ) : null}

                    {isTextCondition(draft.rule.condition) ? (
                      <label className="block space-y-1.5">
                        <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.rule.textValues')}</span>
                        <textarea
                          value={draft.rule.textValue}
                          onChange={(event) => setDraft((current) => ({ ...current, rule: { ...current.rule, textValue: event.target.value } }))}
                          className="glass-input-console min-h-[96px] resize-y text-[13px]"
                          placeholder={t('hooks.rule.textValuesPlaceholder')}
                        />
                        <p className="text-[11px] leading-5 text-[var(--fog)]">{t('hooks.rule.listHint')}</p>
                      </label>
                    ) : null}

                    <label className="block space-y-1.5">
                      <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.rule.reason')}</span>
                      <input
                        value={draft.rule.reason}
                        onChange={(event) => setDraft((current) => ({ ...current, rule: { ...current.rule, reason: event.target.value } }))}
                        className="glass-input-console text-[13px]"
                        placeholder={t('hooks.rule.reasonPlaceholder')}
                      />
                    </label>

                    <details className="rounded-lg border border-black/[0.06] bg-white/65 px-3 py-2">
                      <summary className="cursor-pointer text-[12px] font-medium text-[var(--fog)]">{t('hooks.rule.generatedJson')}</summary>
                      <pre className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg border border-black/[0.04] bg-black/[0.025] p-3 font-mono text-[11px] leading-5 text-[var(--mist)]">{jsonText(ruleCheckFromDraft(draft.rule))}</pre>
                    </details>
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[12px] font-semibold text-[var(--mist)]">{t('hooks.internalModel.title')}</div>
                          <p className="mt-1 text-[11px] text-[var(--fog)]">{t('hooks.internalModel.hint')}</p>
                        </div>
                        <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-[var(--mist)]">deepseek-v4-flash</span>
                      </div>
                    </div>

                    <label className="block space-y-1.5">
                      <span className="text-[12px] font-medium text-[var(--fog)]">{t('hooks.evaluationPrompt')}</span>
                      <SlashPlaceholderEditor
                        ariaLabel={t('hooks.evaluationPrompt')}
                        value={draft.evaluationPrompt}
                        onChange={(nextValue) => setDraft({ ...draft, evaluationPrompt: nextValue })}
                        groups={placeholderGroups}
                        minHeightClassName="min-h-[280px]"
                        helperText={t('hooks.evaluationPromptHint')}
                        placeholder={t('hooks.evaluationPromptPlaceholder')}
                      />
                    </label>

                    <div className="rounded-lg border border-black/[0.06] bg-white/65 px-3 py-3 text-[11px] leading-5 text-[var(--fog)]">
                      <strong className="text-[var(--mist)]">{'{{skill_input}}'}</strong> {t('hooks.compatAliasNote')}
                    </div>
                  </div>
                )}
              </section>
            </main>
          </div>
        )}
      </div>
    </div>
  )
}
