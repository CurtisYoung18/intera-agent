'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  ArrowRightCircle,
  CheckCircle2,
  Copy,
  FileDown,
  GitCompare,
  Loader2,
  PackageOpen,
  RotateCcw,
  SendHorizontal,
  Upload,
  X,
} from 'lucide-react'
import ConfigDiffViewer, { type ConfigDiffGroup, type ConfigDiffItem } from '@/components/config-diff/config-diff-viewer'
import { OrganicLoader, TokenStreamPreview } from '@/components/config-pilot/ai-motion'
import { useConsoleLocale } from '@/components/locale-provider'
import { useAgentContext } from '@/lib/agent/agent-context'
import { MAX_AGENT_CONFIG_VERSIONS } from '@/lib/agent-config/versioning'
import type { AgentTemplateImportReport, InteraAgentTemplateV1 } from '@intera/shared/contracts/agent-template'
import type { ScenarioReceipt, ScenarioValidationSummary } from '@intera/shared/contracts/scenarios'

type VersionRole = 'live' | 'draft' | 'historical'

interface AgentVersion {
  id: string
  name: string
  version: number
  isActive: boolean
  parentId: string | null
  model: string | null
  createdAt: string
  updatedAt: string
  releaseNote?: string | null
  publishedAt?: string | null
  publishedBy?: string | null
}

interface ScenarioListResponse {
  scenarios: unknown[]
  receipts: ScenarioReceipt[]
  validation: ScenarioValidationSummary
}

interface ExportResponse {
  template: InteraAgentTemplateV1
  filename: string
}

interface PendingPackageImport {
  fileName: string
  template: InteraAgentTemplateV1
  report: AgentTemplateImportReport
}

interface VersionValidationSnapshot {
  label: string
  detail: string
  meta: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
}

interface ReleaseData {
  configs: AgentVersion[]
  family: AgentVersion[]
  current: AgentVersion | null
  live: AgentVersion | null
  draft: AgentVersion | null
  history: AgentVersion[]
  scenariosById: Record<string, ScenarioListResponse | null>
  scenarioErrors: Record<string, string>
  templates: Record<string, InteraAgentTemplateV1 | null>
  templateErrors: Record<string, string>
}

const EMPTY_RELEASE_DATA: ReleaseData = {
  configs: [],
  family: [],
  current: null,
  live: null,
  draft: null,
  history: [],
  scenariosById: {},
  scenarioErrors: {},
  templates: {},
  templateErrors: {},
}

const RELEASE_COPY = {
  en: {
    groups: {
      brain: { title: 'Brain', description: 'Model, prompt, generation limits, memory strategy, and resume behavior.' },
      procedures: { title: 'Procedures', description: 'Procedure types and step manifests that guide the ProcedureRun Agent.' },
      tools: { title: 'Tools', description: 'HTTP, fixture, and managed tools available to procedures.' },
      hooks: { title: 'Hooks', description: 'Hook definitions and binding scopes across Agent, Procedure type, Procedure step, and Tool.' },
      scenarios: { title: 'Scenarios', description: 'Portable Scenario definitions for fixture and runtime-backed validation.' },
      knowledge: { title: 'Knowledge', description: 'Knowledge source bindings and retrieval configuration.' },
      integrations: { title: 'Integrations', description: 'Channel bindings, API access, and customer environment connections.' },
    },
    notSet: 'Not set',
    notPresent: 'Not present',
    changedRows: (count: number) => `${count} changed rows`,
    noMaterialChanges: 'No material changes',
    agentBrainSettings: 'Agent Brain settings',
    modelShort: (model: string) => `Model ${model}`,
    disabledSuffix: ' · disabled',
    turns: (count: number) => `${count} turns`,
    runtimeBacked: 'Runtime-backed',
    fixtureOnly: 'Fixture-only',
    live: 'Live',
    draft: 'Draft',
    historical: 'Historical',
    liveSubtitle: 'Customer channels are currently using this version.',
    draftSubtitle: 'Edits stay isolated until Publish is confirmed explicitly.',
    historicalSubtitle: 'Frozen reference version for rollback review or draft forking.',
    validationUnavailable: 'Validation unavailable',
    validationUnavailableMeta: 'Release can still show version history, but evidence failed to load.',
    notValidated: 'Not validated',
    noScenarioReceipt: 'No Scenario receipt is recorded for this version.',
    publishOverrideMeta: 'Publish requires an override reason until fresh validation exists.',
    runtimeValidated: 'Runtime validated',
    runtimeValidatedDetail: (value: string) => `Runtime receipt recorded ${value}`,
    runtimeValidatedMeta: 'Runtime-backed validation is available.',
    fixtureOnlyValidated: 'Fixture-only validated',
    validated: 'Validated',
    validatedDetail: (value: string) => `Validated ${value}`,
    validatedMeta: 'Validation exists but no receipt summary loaded.',
    changedSinceLastValidation: 'Changed since last validation',
    changedDetail: (value: string) => `Draft changed after ${value}`,
    overrideRequired: 'Override required before publish.',
    failedDetail: 'The latest validation did not pass.',
    failedMeta: 'Publish is still possible, but an override reason is required.',
    noFreshValidation: 'No fresh validation summary is available.',
    runPilotLab: 'Run Pilot Lab before publish.',
    currentLiveBaseline: 'Current live baseline',
    templateDiffUnavailable: 'Template diff preview unavailable',
    diffVsLive: (rows: number, groups: number) => `${rows} changed rows across ${groups} groups vs live`,
    selectedVersion: 'Selected version',
    selectedRoleVersion: (role: string) => `Selected ${role.toLowerCase()} version`,
    actionHints: {
      live: ['Export selected package', 'Create editable draft'],
      draft: ['Publish selected version', 'Export selected package', 'Create editable draft'],
      historical: ['Preview rollback', 'Create editable draft', 'Export selected package'],
    },
    loading: 'Loading Release command center...',
    tryAgain: 'Try again',
    breadcrumbRelease: 'Release',
    viewingRoleVersion: (role: string) => `Viewing ${role} version`,
    heroDescription: 'Keep version selection, validation evidence, and package actions in one clear Release surface before any explicit publish.',
    timelineTruth: 'Timeline stays the source of truth',
    publishExplicit: 'Publish remains explicit',
    releaseSelection: 'Release selection',
    version: 'Version',
    retained: 'Retained',
    changedRowsLabel: 'Changed rows',
    validation: 'Validation',
    releaseAgentVersionAria: 'Release agent version',
    importPackageAria: 'Import .intera-agent.json file',
    failedToLoad: 'Failed to load release data',
    exported: (filename: string) => `Exported ${filename}`,
    exportFailed: 'Export failed',
    importDryRunDone: (filename: string) => `Package dry-run completed for ${filename}`,
    importDryRunFailed: 'Import dry-run failed',
    importedDraftPackage: (name: string) => `Imported ${name} as a draft package`,
    importFailed: 'Import failed',
    createdDraft: (version: number, name: string, fromVersion: number) => `Created editable draft v${version} from ${name} v${fromVersion}`,
    duplicateFailed: 'Duplicate failed',
    overrideReasonRequired: 'Override reason is required when validation is stale, failing, or unvalidated.',
    published: (name: string, version: number) => `Published ${name} v${version}`,
    publishFailed: 'Publish failed',
    templatePreviewErrorPrefix: 'Template previews are isolated because export failed for:',
    publishDialogAria: 'Publish version',
    explicitPublish: 'Explicit publish',
    publishVersionTitle: (name: string, version: number) => `Publish ${name} v${version}`,
    publishHistoricalHint: 'This reactivates the selected historical version. Rollback preview stays read-only until you confirm publish.',
    publishDraftHint: 'This activates the selected non-live version for customer channels. Draft save and import actions remain isolated until publish.',
    closePublishDialogAria: 'Close publish dialog',
    releaseNote: 'Release note',
    releaseNotePlaceholder: 'What changed in this publish?',
    overrideReason: 'Override reason',
    overrideReasonPlaceholder: 'Required because validation is stale, failing, or missing.',
    cancel: 'Cancel',
    publishVersionButton: 'Publish version',
    rollbackPreview: 'Rollback preview',
    releaseSafety: 'Release safety',
    rollbackPreviewDescription: (liveVersion: number | string, selectedVersion: string) => `Preview how live v${liveVersion} differs from ${selectedVersion} before any mutation. This drawer never activates rollback by itself.`,
    rollbackCandidate: 'Candidate',
    rollbackPublishHint: 'If you want to reactivate it, close this preview and use Publish explicitly.',
    rollbackSelectPrompt: 'Select a draft or historical version from the timeline first.',
    rollbackDiffPreview: 'Rollback diff preview',
    rollbackDiffSubtitle: 'Live version compared with the selected non-live version.',
    actionRules: [
      'Publish only activates a selected non-live version after confirmation and validation review.',
      'Rollback preview stays read-only and never mutates live state by itself.',
      'Create editable draft forks the selected version when retention capacity still exists.',
      'Import always starts with a compatibility dry-run.',
      'Export always downloads the currently selected package.',
    ],
    importDryRunReport: 'Import dry-run report',
    importReady: 'Ready to create a draft version.',
    importBlocked: 'Import is blocked until conflicts are resolved.',
    clear: 'Clear',
    createDraft: 'Create draft',
    missingSecrets: 'Missing secrets',
    noRequiredSecrets: 'No required secret placeholders.',
    conflicts: 'Conflicts',
    noBlockingConflicts: 'No blocking conflicts.',
    unsupportedIntegrations: 'Unsupported integrations',
    noUnsupportedIntegrations: 'No unsupported integrations.',
    knowledgeRequirements: 'Knowledge requirements',
    noMissingKnowledgeRefs: 'No missing Knowledge refs.',
    warnings: 'Warnings',
  },
  zh: {
    groups: {
      brain: { title: 'Brain', description: '模型、提示词、生成限制、记忆策略和恢复行为。' },
      procedures: { title: 'Procedures', description: '引导 ProcedureRun Agent 的 Procedure 类型和步骤清单。' },
      tools: { title: 'Tools', description: 'Procedure 可用的 HTTP、fixture 和托管工具。' },
      hooks: { title: 'Hooks', description: '跨 Agent、Procedure 类型、Procedure 步骤和 Tool 的 Hook 定义与绑定范围。' },
      scenarios: { title: 'Scenarios', description: '可移植的 Scenario 定义，可用于 fixture 与 runtime-backed 验证。' },
      knowledge: { title: 'Knowledge', description: '知识源绑定与检索配置。' },
      integrations: { title: 'Integrations', description: '渠道绑定、API 访问和客户环境连接。' },
    },
    notSet: '未设置',
    notPresent: '不存在',
    changedRows: (count: number) => `${count} 行变更`,
    noMaterialChanges: '没有实质变化',
    agentBrainSettings: 'Agent Brain 设置',
    modelShort: (model: string) => `模型 ${model}`,
    disabledSuffix: ' · 已禁用',
    turns: (count: number) => `${count} 轮`,
    runtimeBacked: '运行时验证',
    fixtureOnly: '静态样例验证',
    live: '当前版本',
    draft: '草稿',
    historical: '历史版本',
    liveSubtitle: '当前客户渠道正在使用这个版本。',
    draftSubtitle: '这里的修改会保持隔离，直到你明确确认发布。',
    historicalSubtitle: '冻结的参考版本，用于回滚预览或继续派生草稿。',
    validationUnavailable: '验证不可用',
    validationUnavailableMeta: '版本历史仍可查看，但验证证据加载失败。',
    notValidated: '尚未验证',
    noScenarioReceipt: '这个版本还没有记录任何 Scenario 回执。',
    publishOverrideMeta: '在没有新鲜验证结果前，发布需要填写 override 原因。',
    runtimeValidated: '运行时已验证',
    runtimeValidatedDetail: (value: string) => `运行时回执记录于 ${value}`,
    runtimeValidatedMeta: '已经具备运行时验证结果。',
    fixtureOnlyValidated: '仅静态样例验证',
    validated: '已验证',
    validatedDetail: (value: string) => `验证时间 ${value}`,
    validatedMeta: '已有验证结果，但没有加载到回执摘要。',
    changedSinceLastValidation: '自上次验证后已变更',
    changedDetail: (value: string) => `草稿在 ${value} 之后发生了变化`,
    overrideRequired: '发布前需要填写 override 原因。',
    failedDetail: '最近一次验证没有通过。',
    failedMeta: '仍然可以发布，但必须填写 override 原因。',
    noFreshValidation: '目前没有新鲜的验证摘要。',
    runPilotLab: '发布前请先运行 Pilot Lab。',
    currentLiveBaseline: '当前 live 基线',
    templateDiffUnavailable: '模板 diff 预览不可用',
    diffVsLive: (rows: number, groups: number) => `相对 live 有 ${rows} 行变更，分布在 ${groups} 个分组`,
    selectedVersion: '已选版本',
    selectedRoleVersion: (role: string) => `已选${role}`,
    actionHints: {
      live: ['导出当前包', '派生可编辑草稿'],
      draft: ['发布当前版本', '导出当前包', '派生可编辑草稿'],
      historical: ['预览回滚', '派生可编辑草稿', '导出当前包'],
    },
    loading: '正在加载发布控制台…',
    tryAgain: '重试',
    breadcrumbRelease: '发布',
    viewingRoleVersion: (role: string) => `正在查看${role}`,
    heroDescription: '把版本选择、验证证据和包级操作都放进一个清晰的发布页面里，再去做任何明确的发布动作。',
    timelineTruth: '时间线仍是唯一事实来源',
    publishExplicit: '发布仍需明确确认',
    releaseSelection: '发布版本选择',
    version: '版本',
    retained: '保留版本',
    changedRowsLabel: '变更行数',
    validation: '验证状态',
    releaseAgentVersionAria: '发布版本选择',
    importPackageAria: '导入 .intera-agent.json 文件',
    failedToLoad: '发布页加载失败',
    exported: (filename: string) => `已导出 ${filename}`,
    exportFailed: '导出失败',
    importDryRunDone: (filename: string) => `已完成 ${filename} 的 package dry-run`,
    importDryRunFailed: '导入 dry-run 失败',
    importedDraftPackage: (name: string) => `已将 ${name} 导入为草稿 package`,
    importFailed: '导入失败',
    createdDraft: (version: number, name: string, fromVersion: number) => `已从 ${name} v${fromVersion} 派生可编辑草稿 v${version}`,
    duplicateFailed: '派生草稿失败',
    overrideReasonRequired: '验证过期、失败或缺失时，必须填写 override 原因。',
    published: (name: string, version: number) => `已发布 ${name} v${version}`,
    publishFailed: '发布失败',
    templatePreviewErrorPrefix: '以下版本导出失败，因此模板预览被隔离显示：',
    publishDialogAria: '发布版本确认',
    explicitPublish: '明确发布',
    publishVersionTitle: (name: string, version: number) => `发布 ${name} v${version}`,
    publishHistoricalHint: '这会重新激活选中的历史版本。在你最终确认发布前，回滚预览始终保持只读。',
    publishDraftHint: '这会把当前选中的非 live 版本推到客户渠道。草稿保存和导入动作在发布前都保持隔离。',
    closePublishDialogAria: '关闭发布弹窗',
    releaseNote: '发布说明',
    releaseNotePlaceholder: '这次发布改了什么？',
    overrideReason: 'Override 原因',
    overrideReasonPlaceholder: '因为验证过期、失败或缺失，所以这里必须填写原因。',
    cancel: '取消',
    publishVersionButton: '确认发布版本',
    rollbackPreview: '回滚预览',
    releaseSafety: '发布安全',
    rollbackPreviewDescription: (liveVersion: number | string, selectedVersion: string) => `先预览 live v${liveVersion} 与${selectedVersion}之间的差异，再决定是否操作。这个抽屉本身不会触发回滚。`,
    rollbackCandidate: '候选版本',
    rollbackPublishHint: '如果你想重新激活它，请先关闭这个预览，再用“发布”明确确认。',
    rollbackSelectPrompt: '请先在时间线里选择一个草稿或历史版本。',
    rollbackDiffPreview: '回滚差异预览',
    rollbackDiffSubtitle: '对比 live 版本与当前所选非 live 版本的差异。',
    actionRules: [
      '发布只会在你确认并完成验证审查后，激活当前选中的非 live 版本。',
      '回滚预览始终保持只读，不会自行改动 live 状态。',
      '只要还有保留容量，就可以从当前所选版本派生新的可编辑草稿。',
      '导入一定先执行兼容性 dry-run。',
      '导出一定下载当前选中的 package。',
    ],
    importDryRunReport: '导入 dry-run 报告',
    importReady: '可以继续创建草稿版本。',
    importBlocked: '冲突未解决前，导入会被阻止。',
    clear: '清除',
    createDraft: '创建草稿',
    missingSecrets: '缺失 Secrets',
    noRequiredSecrets: '没有缺失的必需 Secret 占位。',
    conflicts: '冲突',
    noBlockingConflicts: '没有阻塞性冲突。',
    unsupportedIntegrations: '不支持的集成',
    noUnsupportedIntegrations: '没有发现不支持的集成。',
    knowledgeRequirements: 'Knowledge 要求',
    noMissingKnowledgeRefs: '没有缺失的 Knowledge 引用。',
    warnings: '警告',
  },
} as const

type ReleaseLocale = keyof typeof RELEASE_COPY

function releaseCopy(locale: ReleaseLocale) {
  return RELEASE_COPY[locale]
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => null)
  if (!response.ok || body?.ok === false) {
    const message = body?.error?.message || `Request failed: ${response.status}`
    throw new Error(message)
  }
  return (body?.data ?? body) as T
}

function formatDate(locale: ReleaseLocale, value?: string | null, empty?: string) {
  if (!value) return empty ?? releaseCopy(locale).notSet
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return empty ?? releaseCopy(locale).notSet
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function validationTone(state?: string) {
  if (state === 'Validated') return 'success'
  if (state === 'Validation failed') return 'danger'
  if (state === 'Changed since last validation') return 'warning'
  return 'neutral'
}

function receiptTone(status?: string) {
  if (status === 'pass') return 'success'
  if (status === 'fail') return 'danger'
  if (status === 'blocked') return 'warning'
  return 'neutral'
}

function toneClass(tone: 'success' | 'warning' | 'danger' | 'neutral') {
  if (tone === 'success') return 'border-[color:color-mix(in_srgb,var(--color-signal-success)_45%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-success)_12%,white)] text-[var(--color-text-primary)]'
  if (tone === 'warning') return 'border-[color:color-mix(in_srgb,var(--color-signal-warning)_48%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-warning)_13%,white)] text-[var(--color-text-primary)]'
  if (tone === 'danger') return 'border-[color:color-mix(in_srgb,var(--color-signal-danger)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-danger)_10%,white)] text-[var(--color-text-primary)]'
  return 'border-[var(--color-border-subtle)] bg-white/65 text-[var(--color-text-secondary)]'
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, normalize(val)]))
  }
  return value ?? null
}

function stableString(value: unknown) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') return value
  return JSON.stringify(normalize(value), null, 2)
}

function sanitizeReleaseCopy(raw: string): string {
  return raw
    .replace(/\bdispatch_case_agent\b/g, 'start_procedure')
    .replace(/\bfinalize_case\b/g, 'finalize_procedure')
    .replace(/\bper-case\b/gi, 'ProcedureRun')
    .replace(/\bcase as resolved\b/gi, 'Procedure as resolved')
    .replace(/\bcases\b/gi, 'ProcedureRuns')
    .replace(/\bcase\b/gi, 'ProcedureRun')
    .replace(/\bplatform policy\b/gi, 'platform rule')
}

function shortValue(value: unknown, locale: ReleaseLocale) {
  const raw = sanitizeReleaseCopy(stableString(value))
  if (!raw) return releaseCopy(locale).notPresent
  return raw.length > 420 ? `${raw.slice(0, 420)}...` : raw
}

function itemStatus(before: unknown, after: unknown): ConfigDiffItem['status'] {
  const beforeText = stableString(before)
  const afterText = stableString(after)
  if (!beforeText && afterText) return 'added'
  if (beforeText && !afterText) return 'removed'
  if (beforeText !== afterText) return 'changed'
  return 'unchanged'
}

function diffCollection<T>(
  beforeItems: T[],
  afterItems: T[],
  keyFor: (item: T) => string,
  labelFor: (item: T) => string,
  locale: ReleaseLocale,
  detailFor?: (item: T) => string | undefined,
): ConfigDiffItem[] {
  const beforeMap = new Map(beforeItems.map((item) => [keyFor(item), item]))
  const afterMap = new Map(afterItems.map((item) => [keyFor(item), item]))
  const keys = Array.from(new Set([...beforeMap.keys(), ...afterMap.keys()])).sort((a, b) => a.localeCompare(b))
  return keys.map((key) => {
    const before = beforeMap.get(key)
    const after = afterMap.get(key)
    const present = after ?? before
    return {
      key,
      label: sanitizeReleaseCopy(present ? labelFor(present) : key),
      detail: present && detailFor ? sanitizeReleaseCopy(detailFor(present) ?? '') : undefined,
      status: itemStatus(before, after),
      before: before ? shortValue(before, locale) : undefined,
      after: after ? shortValue(after, locale) : undefined,
    }
  })
}

function changedCount(items: ConfigDiffItem[]) {
  return items.filter((item) => item.status !== 'unchanged').length
}

function makeGroup(id: keyof typeof RELEASE_COPY.en.groups, items: ConfigDiffItem[], locale: ReleaseLocale): ConfigDiffGroup {
  const copy = releaseCopy(locale)
  const changed = changedCount(items)
  return {
    id,
    title: copy.groups[id].title,
    description: copy.groups[id].description,
    summary: changed > 0 ? copy.changedRows(changed) : copy.noMaterialChanges,
    items,
  }
}

function buildDiffGroups(
  liveTemplate: InteraAgentTemplateV1 | null,
  selectedTemplate: InteraAgentTemplateV1 | null,
  locale: ReleaseLocale,
): ConfigDiffGroup[] {
  const copy = releaseCopy(locale)
  const brainBefore = liveTemplate?.agent ? [{ key: 'brain', ...liveTemplate.agent }] : []
  const brainAfter = selectedTemplate?.agent ? [{ key: 'brain', ...selectedTemplate.agent }] : []
  const hookRowsBefore = [
    ...(liveTemplate?.hooks ?? []).map((hook) => ({ kind: 'Hook', key: `hook:${hook.name}`, ...hook })),
    ...(liveTemplate?.hookBindings ?? []).map((binding) => ({ kind: 'Binding', key: `binding:${binding.hookName}:${binding.scopeKey}`, ...binding })),
  ]
  const hookRowsAfter = [
    ...(selectedTemplate?.hooks ?? []).map((hook) => ({ kind: 'Hook', key: `hook:${hook.name}`, ...hook })),
    ...(selectedTemplate?.hookBindings ?? []).map((binding) => ({ kind: 'Binding', key: `binding:${binding.hookName}:${binding.scopeKey}`, ...binding })),
  ]
  const scenarioRowsBefore = scenarioRows(liveTemplate)
  const scenarioRowsAfter = scenarioRows(selectedTemplate)

  return [
    makeGroup('brain', diffCollection(brainBefore, brainAfter, (item) => item.key, () => copy.agentBrainSettings, locale, (item) => typeof item.model === 'string' ? copy.modelShort(item.model) : undefined), locale),
    makeGroup('procedures', diffCollection(liveTemplate?.caseTypes ?? [], selectedTemplate?.caseTypes ?? [], (item) => item.type, (item) => item.displayName || item.type, locale, (item) => `${item.type} · ${item.procedure?.steps?.length ?? 0} ${locale === 'zh' ? '步' : 'steps'}`), locale),
    makeGroup('tools', diffCollection(liveTemplate?.tools ?? [], selectedTemplate?.tools ?? [], (item) => item.name, (item) => item.name, locale, (item) => `${item.mode}${item.enabled === false ? copy.disabledSuffix : ''}`), locale),
    makeGroup('hooks', diffCollection(hookRowsBefore, hookRowsAfter, (item) => item.key, (item) => `${item.kind}: ${'name' in item ? item.name : item.hookName}`, locale, (item) => 'checkpoint' in item ? String(item.checkpoint) : String(item.scopeType)), locale),
    makeGroup('scenarios', diffCollection(scenarioRowsBefore, scenarioRowsAfter, (item) => item.name, (item) => item.displayName || item.name, locale, (item) => copy.turns(item.turns?.length ?? 0)), locale),
    makeGroup('knowledge', diffCollection(liveTemplate?.knowledgeRefs ?? [], selectedTemplate?.knowledgeRefs ?? [], (item) => item.name, (item) => item.name, locale, (item) => `${item.provider}${item.status ? ` · ${item.status}` : ''}`), locale),
    makeGroup('integrations', diffCollection(liveTemplate?.integrationRefs ?? [], selectedTemplate?.integrationRefs ?? [], (item) => item.channel, (item) => item.name || item.channel, locale, (item) => `${item.provider ?? item.channel}${item.status ? ` · ${item.status}` : ''}`), locale),
  ]
}

function scenarioRows(template: InteraAgentTemplateV1 | null) {
  return template?.scenarioDefinitions?.length ? template.scenarioDefinitions : template?.scenarios ?? []
}

function packageCoverageRows(template: InteraAgentTemplateV1 | null, locale: ReleaseLocale) {
  const labels = locale === 'zh'
    ? ['Brain', 'Procedures', 'Tools', 'Hooks', 'HookBindings', 'Scenarios', 'Knowledge', 'Integrations', '必需 Secrets']
    : ['Brain', 'Procedures', 'Tools', 'Hooks', 'HookBindings', 'Scenarios', 'Knowledge', 'Integrations', 'Required secrets']
  const scenarios = scenarioRows(template)
  return [
    { label: labels[0], value: template?.agent ? 1 : 0 },
    { label: labels[1], value: template?.caseTypes.filter((item) => item.procedure).length ?? 0 },
    { label: labels[2], value: template?.tools.length ?? 0 },
    { label: labels[3], value: template?.hooks.length ?? 0 },
    { label: labels[4], value: template?.hookBindings.length ?? 0 },
    { label: labels[5], value: scenarios.length },
    { label: labels[6], value: template?.knowledgeRefs.length ?? 0 },
    { label: labels[7], value: template?.integrationRefs.length ?? 0 },
    { label: labels[8], value: template?.requiredSecrets.length ?? template?.secrets?.length ?? 0 },
  ]
}

function pickLatestReceipt(receipts: ScenarioReceipt[]) {
  return [...receipts].sort((a, b) => {
    const aTime = new Date(a.finishedAt ?? a.startedAt).getTime()
    const bTime = new Date(b.finishedAt ?? b.startedAt).getTime()
    return bTime - aTime
  })[0] ?? null
}

async function fetchTemplate(agentConfigId: string) {
  const response = await readJson<ExportResponse>(`/api/admin/agent-templates/export?agentConfigId=${encodeURIComponent(agentConfigId)}`)
  return response.template
}

function versionRoleFor(config: AgentVersion | null, liveId: string | null, draftId: string | null): VersionRole | null {
  if (!config) return null
  if (config.id === liveId) return 'live'
  if (config.id === draftId) return 'draft'
  return 'historical'
}

function roleLabel(role: VersionRole, locale: ReleaseLocale) {
  const copy = releaseCopy(locale)
  if (role === 'live') return copy.live
  if (role === 'draft') return copy.draft
  return copy.historical
}

function roleTone(role: VersionRole): 'success' | 'warning' | 'neutral' {
  if (role === 'live') return 'success'
  if (role === 'draft') return 'warning'
  return 'neutral'
}

function roleSubtitle(role: VersionRole, locale: ReleaseLocale) {
  const copy = releaseCopy(locale)
  if (role === 'live') return copy.liveSubtitle
  if (role === 'draft') return copy.draftSubtitle
  return copy.historicalSubtitle
}

function executionModeLabel(mode: ScenarioReceipt['executionMode'] | undefined, locale: ReleaseLocale): string {
  const copy = releaseCopy(locale)
  return mode === 'agentRuntime' ? copy.runtimeBacked : copy.fixtureOnly
}

function buildValidationSnapshot(
  validation: ScenarioValidationSummary | undefined,
  latestReceipt: ScenarioReceipt | null,
  locale: ReleaseLocale,
  error?: string | null,
): VersionValidationSnapshot {
  const copy = releaseCopy(locale)
  if (error) {
    return {
      label: copy.validationUnavailable,
      detail: error,
      meta: copy.validationUnavailableMeta,
      tone: 'danger',
    }
  }
  if (!validation) {
    return {
      label: copy.notValidated,
      detail: copy.noScenarioReceipt,
      meta: copy.publishOverrideMeta,
      tone: 'warning',
    }
  }
  if (validation.runtimeValidated) {
    return {
      label: copy.runtimeValidated,
      detail: copy.runtimeValidatedDetail(formatDate(locale, validation.runtimeValidatedAt ?? validation.lastValidatedAt)),
      meta: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode, locale)} · ${latestReceipt.status} · ${latestReceipt.scenarioName}` : copy.runtimeValidatedMeta,
      tone: 'success',
    }
  }
  if (validation.state === 'Validated') {
    return {
      label: latestReceipt?.executionMode === 'fixture' ? copy.fixtureOnlyValidated : copy.validated,
      detail: latestReceipt?.executionMode === 'fixture' ? copy.fixtureOnly : copy.validatedDetail(formatDate(locale, validation.lastValidatedAt)),
      meta: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode, locale)} · ${latestReceipt.status}` : copy.validatedMeta,
      tone: latestReceipt?.executionMode === 'fixture' ? 'warning' : 'success',
    }
  }
  if (validation.state === 'Changed since last validation') {
    return {
      label: copy.changedSinceLastValidation,
      detail: copy.changedDetail(formatDate(locale, validation.lastValidatedAt, locale === 'zh' ? '上一次验证' : 'the last validation run')),
      meta: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode, locale)} · ${latestReceipt.status} · ${copy.overrideRequired}` : copy.overrideRequired,
      tone: 'warning',
    }
  }
  if (validation.state === 'Validation failed') {
    return {
      label: locale === 'zh' ? '验证失败' : validation.state,
      detail: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode, locale)} · ${locale === 'zh' ? '失败' : 'failed'}` : copy.failedDetail,
      meta: copy.failedMeta,
      tone: 'danger',
    }
  }
  return {
    label: validation.state ?? copy.notValidated,
    detail: copy.noFreshValidation,
    meta: latestReceipt ? `${executionModeLabel(latestReceipt.executionMode, locale)} · ${latestReceipt.status}` : copy.runPilotLab,
    tone: validationTone(validation.state),
  }
}

function summarizeDiffGroups(groups: ConfigDiffGroup[]) {
  return groups.reduce(
    (summary, group) => {
      const changedRows = group.items.filter((item) => item.status !== 'unchanged').length
      if (changedRows > 0) {
        summary.changedGroups += 1
        summary.changedRows += changedRows
      }
      return summary
    },
    { changedGroups: 0, changedRows: 0 },
  )
}

function describeDiffSummary(
  liveTemplate: InteraAgentTemplateV1 | null,
  versionTemplate: InteraAgentTemplateV1 | null,
  role: VersionRole,
  locale: ReleaseLocale,
) {
  const copy = releaseCopy(locale)
  if (role === 'live') return copy.currentLiveBaseline
  if (!liveTemplate || !versionTemplate) return copy.templateDiffUnavailable
  const summary = summarizeDiffGroups(buildDiffGroups(liveTemplate, versionTemplate, locale))
  if (summary.changedRows === 0) return copy.noMaterialChanges
  return copy.diffVsLive(summary.changedRows, summary.changedGroups)
}

function parentVersionFor(config: AgentVersion, family: AgentVersion[]) {
  return family.find((item) => item.id === config.parentId)?.version ?? null
}

function selectedTitle(config: AgentVersion | null, role: VersionRole | null, locale: ReleaseLocale) {
  if (!config || !role) return releaseCopy(locale).selectedVersion
  return releaseCopy(locale).selectedRoleVersion(roleLabel(role, locale))
}

function actionHintsForRole(role: VersionRole, locale: ReleaseLocale) {
  const copy = releaseCopy(locale)
  if (role === 'live') return copy.actionHints.live
  if (role === 'draft') return copy.actionHints.draft
  return copy.actionHints.historical
}

export default function ReleaseCommandCenter() {
  const { locale, t } = useConsoleLocale()
  const copy = releaseCopy(locale)
  const { selectedAgentId, loading: agentLoading, loadError, selectAgent, refreshConfigs } = useAgentContext()
  const [data, setData] = useState<ReleaseData>(EMPTY_RELEASE_DATA)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [releaseNote, setReleaseNote] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingPackageImport | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(() => setReloadKey((key) => key + 1), [])
  const openPilotLab = useCallback(() => {
    window.location.assign('/build/pilot-lab')
  }, [])

  useEffect(() => {
    if (agentLoading) return
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      try {
        const configResponse = await readJson<{ configs: AgentVersion[] }>('/api/admin/agent-configs')
        const configs = [...(configResponse.configs ?? [])].sort((a, b) => a.name.localeCompare(b.name) || a.version - b.version)
        const current = configs.find((config) => config.id === selectedAgentId) ?? configs.find((config) => config.isActive) ?? configs[0] ?? null
        if (current && selectedAgentId !== current.id) selectAgent(current.id)

        const family = current ? configs.filter((config) => config.name === current.name).sort((a, b) => a.version - b.version) : []
        const live = family.find((config) => config.isActive) ?? configs.find((config) => config.isActive) ?? current
        const draft = [...family].filter((config) => !config.isActive).sort((a, b) => b.version - a.version)[0] ?? null
        const history = family.filter((config) => config.id !== live?.id && config.id !== draft?.id).sort((a, b) => b.version - a.version)
        const versionIds = family.map((config) => config.id)

        const templates: Record<string, InteraAgentTemplateV1 | null> = {}
        const templateErrors: Record<string, string> = {}
        const scenariosById: Record<string, ScenarioListResponse | null> = {}
        const scenarioErrors: Record<string, string> = {}

        await Promise.all(versionIds.map(async (id) => {
          const [scenarioResult, templateResult] = await Promise.all([
            readJson<ScenarioListResponse>(`/api/admin/scenarios?agentConfigId=${encodeURIComponent(id)}`)
              .then((scenarios) => ({ scenarios, error: null as string | null }))
              .catch((err: Error) => ({ scenarios: null, error: err.message })),
            fetchTemplate(id)
              .then((template) => ({ template, error: null as string | null }))
              .catch((err: Error) => ({ template: null, error: err.message })),
          ])

          scenariosById[id] = scenarioResult.scenarios
          if (scenarioResult.error) scenarioErrors[id] = scenarioResult.error

          templates[id] = templateResult.template
          if (templateResult.error) templateErrors[id] = templateResult.error
        }))

        if (!cancelled) {
          setData({
            configs,
            family,
            current,
            live,
            draft,
            history,
            scenariosById,
            scenarioErrors,
            templates,
            templateErrors,
          })
          setReleaseNote(current?.releaseNote ?? '')
          setOverrideReason('')
        }
      } catch (err) {
        if (!cancelled) {
          setData(EMPTY_RELEASE_DATA)
        setError(err instanceof Error ? err.message : copy.failedToLoad)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [agentLoading, reloadKey, selectedAgentId, selectAgent])

  const selectedVersion = data.current
  const selectedRole = versionRoleFor(selectedVersion, data.live?.id ?? null, data.draft?.id ?? null)
  const selectedScenarioData = selectedVersion ? data.scenariosById[selectedVersion.id] ?? null : null
  const selectedScenarioError = selectedVersion ? data.scenarioErrors[selectedVersion.id] ?? null : null
  const selectedValidation = selectedScenarioData?.validation
  const selectedReceipt = useMemo(() => pickLatestReceipt(selectedScenarioData?.receipts ?? []), [selectedScenarioData?.receipts])
  const selectedValidationSnapshot = buildValidationSnapshot(selectedValidation, selectedReceipt, locale, selectedScenarioError)
  const liveScenarioData = data.live ? data.scenariosById[data.live.id] ?? null : null
  const liveScenarioError = data.live ? data.scenarioErrors[data.live.id] ?? null : null
  const liveValidation = liveScenarioData?.validation
  const liveReceipt = useMemo(() => pickLatestReceipt(liveScenarioData?.receipts ?? []), [liveScenarioData?.receipts])
  const liveValidationSnapshot = buildValidationSnapshot(liveValidation, liveReceipt, locale, liveScenarioError)
  const draftScenarioData = data.draft ? data.scenariosById[data.draft.id] ?? null : null
  const draftScenarioError = data.draft ? data.scenarioErrors[data.draft.id] ?? null : null
  const draftValidation = draftScenarioData?.validation
  const draftReceipt = useMemo(() => pickLatestReceipt(draftScenarioData?.receipts ?? []), [draftScenarioData?.receipts])
  const draftValidationSnapshot = buildValidationSnapshot(draftValidation, draftReceipt, locale, draftScenarioError)
  const liveTemplate = data.live ? data.templates[data.live.id] ?? null : null
  const draftTemplate = data.draft ? data.templates[data.draft.id] ?? null : null
  const selectedTemplate = selectedVersion ? data.templates[selectedVersion.id] ?? null : null
  const draftDiffGroups = useMemo(() => (data.draft ? buildDiffGroups(liveTemplate, draftTemplate, locale) : []), [data.draft, liveTemplate, draftTemplate, locale])
  const draftDiffSummary = useMemo(() => summarizeDiffGroups(draftDiffGroups), [draftDiffGroups])
  const diffGroups = useMemo(() => buildDiffGroups(liveTemplate, selectedTemplate, locale), [liveTemplate, selectedTemplate, locale])
  const diffSummary = useMemo(() => summarizeDiffGroups(diffGroups), [diffGroups])
  const rollbackTarget = selectedVersion && data.live && selectedVersion.id !== data.live.id ? selectedVersion : null
  const rollbackTemplate = rollbackTarget ? data.templates[rollbackTarget.id] ?? null : null
  const rollbackGroups = useMemo(() => (rollbackTarget ? buildDiffGroups(liveTemplate, rollbackTemplate, locale) : []), [liveTemplate, rollbackTarget, rollbackTemplate, locale])
  const canPublish = Boolean(selectedVersion && !selectedVersion.isActive)
  const overrideRequired = canPublish ? (selectedValidation?.overrideRequired ?? true) : false
  const publishDisabledReason = selectedVersion?.isActive
    ? (locale === 'zh' ? '发布前请先在时间线上选择草稿版本或历史版本。' : 'Select the draft or a historical version from the timeline before publishing.')
    : null
  const showingLiveBaseline = !selectedVersion || selectedRole === 'live'
  const diffViewerGroups = showingLiveBaseline ? [] : diffGroups
  const diffViewerSubtitle = !selectedVersion || !data.live
    ? (locale === 'zh' ? '请先在右侧时间线里选择一个版本。' : 'Select a version in the timeline to inspect release deltas.')
    : selectedRole === 'live'
      ? data.draft
        ? (locale === 'zh'
          ? `草稿 v${data.draft.version} 已经就绪。先切换到它，再审核相对 live v${data.live.version} 的分组变更与验证证据。`
          : `Draft v${data.draft.version} is ready. Switch to it first to audit grouped changes and validation evidence against live v${data.live.version}.`)
        : (locale === 'zh'
          ? `当前只有 live v${data.live.version}。先派生草稿或导入 package，才能打开真正的发布 diff 视图。`
          : `Live v${data.live.version} is your only retained version. Create a draft or import a package to open structured release diff review.`)
      : selectedRole === 'historical'
        ? (locale === 'zh'
          ? `当前 live v${data.live.version} 与历史版本 v${selectedVersion.version} 的回滚差异。`
          : `Rollback preview between live v${data.live.version} and historical v${selectedVersion.version}.`)
        : (locale === 'zh'
          ? `当前 live v${data.live.version} 与候选 v${selectedVersion.version} 的分组差异。`
          : `Live v${data.live.version} compared with candidate v${selectedVersion.version}.`)
  const diffViewerEmptyLabel = selectedRole === 'live'
    ? data.draft
      ? (locale === 'zh'
        ? `先在时间线里打开草稿 v${data.draft.version}，这里才会展开 Brain、Procedures、Tools、Hooks、Scenarios、Knowledge 与 Integrations 的结构化 diff。`
        : `Open draft v${data.draft.version} from the timeline to unlock structured diff review across Brain, Procedures, Tools, Hooks, Scenarios, Knowledge, and Integrations.`)
      : (locale === 'zh'
        ? '当前还没有候选版本。派生草稿或导入 package 之后，这里会切换成真正的变更审查台。'
        : 'No candidate exists yet. Once you create a draft or import a package, this area becomes the structured release review surface.')
    : undefined

  async function handleExport() {
    const target = selectedVersion ?? data.draft ?? data.live
    if (!target) return
    setBusyAction('export')
    setNotice(null)
    setError(null)
    try {
      const response = await fetch(`/api/admin/agent-templates/export?agentConfigId=${encodeURIComponent(target.id)}&download=1`)
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        throw new Error(body?.error?.message || 'Export failed')
      }
      const blob = await response.blob()
      const filename = `${target.name.replace(/\s+/g, '-').toLowerCase()}-v${target.version}.intera-agent.json`
      if (typeof URL.createObjectURL === 'function') {
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.click()
        URL.revokeObjectURL(url)
      }
      setNotice(copy.exported(filename))
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.exportFailed)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleImport(file: File | undefined) {
    if (!file) return
    setBusyAction('import')
    setNotice(null)
    setError(null)
    try {
      const template = JSON.parse(await file.text())
      const result = await readJson<{ dryRun: true; report: AgentTemplateImportReport }>('/api/admin/agent-templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template,
          parentAgentConfigId: selectedVersion?.id,
          dryRun: true,
          strategy: 'createDraft',
        }),
      })
      setPendingImport({ fileName: file.name, template, report: result.report })
      setNotice(copy.importDryRunDone(file.name))
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.importDryRunFailed)
    } finally {
      setBusyAction(null)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  async function handleConfirmImport() {
    if (!pendingImport) return
    setBusyAction('import-apply')
    setNotice(null)
    setError(null)
    try {
      const result = await readJson<{ config: AgentVersion; imported?: Record<string, number>; warnings?: string[] }>('/api/admin/agent-templates/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: pendingImport.template,
          parentAgentConfigId: selectedVersion?.id,
          strategy: 'createDraft',
        }),
      })
      await refreshConfigs()
      if (result.config?.id) selectAgent(result.config.id)
      setPendingImport(null)
      setNotice(copy.importedDraftPackage(result.config?.name ?? pendingImport.fileName))
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.importFailed)
    } finally {
      setBusyAction(null)
    }
  }

  async function handleDuplicate() {
    const target = selectedVersion ?? data.live
    if (!target) return
    setBusyAction('duplicate')
    setNotice(null)
    setError(null)
    try {
      const result = await readJson<{ config: AgentVersion }>(`/api/admin/agent-configs/${encodeURIComponent(target.id)}/fork`, { method: 'POST' })
      await refreshConfigs()
      if (result.config?.id) selectAgent(result.config.id)
      setNotice(copy.createdDraft(result.config.version, target.name, target.version))
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.duplicateFailed)
    } finally {
      setBusyAction(null)
    }
  }

  async function handlePublish() {
    const target = selectedVersion
    if (!target || target.isActive) return
    if (overrideRequired && !overrideReason.trim()) {
      setError(copy.overrideReasonRequired)
      return
    }
    setBusyAction('publish')
    setError(null)
    setNotice(null)
    try {
      await readJson<{ config: AgentVersion; validation: ScenarioValidationSummary & { overrideReason?: string } }>(`/api/admin/agent-configs/${encodeURIComponent(target.id)}/activate`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          releaseNote: releaseNote.trim() || undefined,
          overrideValidationReason: overrideRequired ? overrideReason.trim() : undefined,
        }),
      })
      await refreshConfigs()
      selectAgent(target.id)
      setPublishOpen(false)
      setNotice(copy.published(target.name, target.version))
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.publishFailed)
    } finally {
      setBusyAction(null)
    }
  }

  if (agentLoading || loading) {
    return (
      <main className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center px-6 py-8 sm:px-8">
        <div className="rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-white/75 px-6 py-5 text-[13px] text-[var(--color-text-secondary)] shadow-[var(--shadow-raised)]">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin text-[var(--color-accent-primary)]" />
          {copy.loading}
        </div>
      </main>
    )
  }

  if (loadError || (error && !data.current)) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8 sm:px-8">
        <section className="rounded-[var(--radius-panel)] border border-[color:color-mix(in_srgb,var(--color-signal-danger)_35%,transparent)] bg-white/80 p-6 shadow-[var(--shadow-raised)]">
          <p className="text-[13px] font-medium text-[var(--color-signal-danger)]">{loadError || error}</p>
          <button type="button" onClick={reload} className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] text-[var(--color-text-primary)]">{copy.tryAgain}</button>
        </section>
      </main>
    )
  }

  return (
    <main className="intera-q2-page mx-auto max-w-[1480px] px-5 py-6 text-[var(--color-text-primary)] sm:px-8">
      <input
        ref={importInputRef}
        aria-label={copy.importPackageAria}
        type="file"
        accept="application/json,.json,.intera-agent.json"
        className="hidden"
        onChange={(event) => handleImport(event.target.files?.[0])}
      />

      <section className="space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="intera-eyebrow flex flex-wrap items-center gap-2">
              <span>{t('sidebar.build')}</span>
              <span aria-hidden>·</span>
              <span>{copy.breadcrumbRelease}</span>
            </div>
            <h1 className="mt-3 text-[40px] font-semibold leading-[0.98] tracking-[-0.05em] text-[var(--color-text-primary)] text-balance sm:text-[48px]">
              {selectedVersion?.name ?? data.live?.name ?? 'Agent'}
            </h1>
          </div>

          <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <div className="text-right">
              <p className="text-[12px] font-medium text-[var(--color-text-tertiary)]">
                {data.family.length}/{MAX_AGENT_CONFIG_VERSIONS} retained
              </p>
              <p className="sr-only">{data.family.length} of {MAX_AGENT_CONFIG_VERSIONS} retained</p>
            </div>
            <button
              type="button"
              aria-label={locale === 'zh' ? '导出当前包' : 'Export selected package'}
              onClick={handleExport}
              disabled={busyAction === 'export'}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-[14px] border border-[var(--color-border-subtle)] bg-white/84 px-4 py-2 text-[14px] font-semibold text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(21,23,25,0.05)] transition hover:border-[rgba(53,127,124,0.24)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'export' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
              <span>{locale === 'zh' ? '导出' : 'Export'}</span>
            </button>
            <button
              type="button"
              aria-label={locale === 'zh' ? '导入包' : 'Import package'}
              onClick={() => importInputRef.current?.click()}
              disabled={busyAction === 'import'}
              className="inline-flex min-h-[42px] items-center gap-2 rounded-[14px] border border-[var(--color-border-subtle)] bg-white/84 px-4 py-2 text-[14px] font-semibold text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(21,23,25,0.05)] transition hover:border-[rgba(53,127,124,0.24)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busyAction === 'import' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              <span>{locale === 'zh' ? '导入' : 'Import'}</span>
            </button>
          </div>
        </div>

        <ReleaseVersionCompareRow
          draft={data.draft}
          draftDiffSummary={draftDiffSummary}
          draftValidationSnapshot={draftValidationSnapshot}
          live={data.live}
          liveValidationSnapshot={liveValidationSnapshot}
          selectedVersion={selectedVersion}
          selectedRole={selectedRole}
          selectedValidationSnapshot={selectedValidationSnapshot}
        />

        <ReleasePublishVerdictBar
          busy={busyAction === 'publish'}
          canPublish={canPublish}
          diffSummary={diffSummary}
          draft={data.draft}
          draftDiffSummary={draftDiffSummary}
          draftValidationSnapshot={draftValidationSnapshot}
          draftVersionId={data.draft?.id ?? null}
          duplicateBusy={busyAction === 'duplicate'}
          onCreateDraft={handleDuplicate}
          onReviewDraft={() => data.draft && selectAgent(data.draft.id)}
          onPublish={() => setPublishOpen(true)}
          overrideRequired={overrideRequired}
          publishDisabledReason={publishDisabledReason}
          selectedRole={selectedRole}
          selectedValidationSnapshot={selectedValidationSnapshot}
          selectedVersion={selectedVersion}
          slotsLeft={Math.max(MAX_AGENT_CONFIG_VERSIONS - data.family.length, 0)}
        />

        {(notice || error) ? (
          <div className={`rounded-[18px] border px-4 py-3 text-[13px] ${error ? toneClass('danger') : toneClass('success')}`}>{error || notice}</div>
        ) : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px] xl:items-start">
          <div className="min-w-0 space-y-5">
            <ConfigDiffViewer
              title={locale === 'zh' ? '变更明细' : 'What changed'}
              subtitle={diffViewerSubtitle}
              groups={diffViewerGroups}
              emptyLabel={diffViewerEmptyLabel}
            />

            <ReleaseUtilityStrip
              busyAction={busyAction}
              current={selectedVersion}
              pendingImport={pendingImport}
              rollbackTarget={rollbackTarget}
              onClearImport={() => setPendingImport(null)}
              onConfirmImport={handleConfirmImport}
              onDuplicate={handleDuplicate}
              onRollback={() => setRollbackOpen(true)}
            />
          </div>

          <div className="space-y-4 xl:sticky xl:top-6">
            <ReleaseTimelineRailCard
              currentId={selectedVersion?.id ?? null}
              draftId={data.draft?.id ?? null}
              family={data.family}
              liveId={data.live?.id ?? null}
              liveTemplate={liveTemplate}
              scenarioErrors={data.scenarioErrors}
              scenariosById={data.scenariosById}
              templates={data.templates}
              onSelectVersion={selectAgent}
            />

            <ReleaseEvidenceRailCard
              current={selectedVersion}
              latestReceipt={selectedReceipt}
              onOpen={openPilotLab}
              validation={selectedValidation}
              validationSnapshot={selectedValidationSnapshot}
            />
          </div>
        </div>
      </section>

      {Object.keys(data.templateErrors).length > 0 ? (
        <section className="mt-4 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
          {copy.templatePreviewErrorPrefix} {Object.entries(data.templateErrors).map(([id, message]) => `${id} (${message})`).join(', ')}
        </section>
      ) : null}

      {publishOpen ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm">
          <section role="dialog" aria-label={copy.publishDialogAria} className="w-full max-w-lg rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">{copy.explicitPublish}</p>
                <h2 className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">
                  {copy.publishVersionTitle(selectedVersion?.name ?? '', selectedVersion?.version ?? 0)}
                </h2>
                <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">
                  {selectedRole === 'historical'
                    ? copy.publishHistoricalHint
                    : copy.publishDraftHint}
                </p>
              </div>
              <button type="button" aria-label={copy.closePublishDialogAria} onClick={() => setPublishOpen(false)} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white p-2 text-[var(--color-text-tertiary)]">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className={`mt-5 rounded-[var(--radius-control)] border px-4 py-3 text-[12px] ${toneClass(selectedValidationSnapshot.tone)}`}>
              <p className="font-semibold text-[var(--color-text-primary)]">{selectedValidationSnapshot.label}</p>
              <p className="mt-1 text-[var(--color-text-secondary)]">{selectedValidationSnapshot.detail}</p>
              <p className="mt-1 text-[var(--color-text-tertiary)]">{selectedValidationSnapshot.meta}</p>
            </div>

            <label className="mt-5 block text-[12px] font-medium text-[var(--color-text-primary)]" htmlFor="release-note">{copy.releaseNote}</label>
            <textarea id="release-note" aria-label={copy.releaseNote} value={releaseNote} onChange={(event) => setReleaseNote(event.target.value)} rows={3} className="mt-2 w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-primary)]" placeholder={copy.releaseNotePlaceholder} />

            {overrideRequired ? (
              <>
                <label className="mt-4 block text-[12px] font-medium text-[var(--color-text-primary)]" htmlFor="override-reason">{copy.overrideReason}</label>
                <textarea id="override-reason" aria-label={copy.overrideReason} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} rows={3} className="mt-2 w-full rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-signal-warning)_40%,var(--color-border-subtle))] bg-white px-3 py-2 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-signal-warning)]" placeholder={copy.overrideReasonPlaceholder} />
              </>
            ) : null}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setPublishOpen(false)} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">{copy.cancel}</button>
              <button type="button" disabled={busyAction === 'publish' || (overrideRequired && !overrideReason.trim())} onClick={handlePublish} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-accent-primary)_45%,transparent)] bg-[var(--color-accent-primary)] px-3 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
                {busyAction === 'publish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
                {copy.publishVersionButton}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {rollbackOpen ? (
        <LightDrawer title={copy.rollbackPreview} eyebrow={copy.releaseSafety} onClose={() => setRollbackOpen(false)}>
          <p className="text-[13px] leading-5 text-[var(--color-text-secondary)]">
            {copy.rollbackPreviewDescription(
              data.live?.version ?? '?',
              rollbackTarget
                ? locale === 'zh'
                  ? `已选 v${rollbackTarget.version}`
                  : `selected v${rollbackTarget.version}`
                : locale === 'zh'
                  ? '某个非 live 版本'
                  : 'a non-live version',
            )}
          </p>
          {rollbackTarget ? (
            <div className="mt-4 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
              {copy.rollbackCandidate}: <span className="font-semibold text-[var(--color-text-primary)]">{rollbackTarget.name} v{rollbackTarget.version}</span>
              <span className="ml-3 text-[var(--color-text-tertiary)]">{copy.rollbackPublishHint}</span>
            </div>
          ) : (
            <div className="mt-4 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] text-[var(--color-text-secondary)]">
              {copy.rollbackSelectPrompt}
            </div>
          )}
          <div className="mt-4">
            <ConfigDiffViewer title={copy.rollbackDiffPreview} subtitle={copy.rollbackDiffSubtitle} groups={rollbackGroups} />
          </div>
        </LightDrawer>
      ) : null}
    </main>
  )
}

function ReleaseVersionCompareRow({
  draft,
  draftDiffSummary,
  draftValidationSnapshot,
  live,
  liveValidationSnapshot,
  selectedVersion,
  selectedRole,
  selectedValidationSnapshot,
}: {
  draft: AgentVersion | null
  draftDiffSummary: { changedGroups: number; changedRows: number }
  draftValidationSnapshot: VersionValidationSnapshot
  live: AgentVersion | null
  liveValidationSnapshot: VersionValidationSnapshot
  selectedVersion: AgentVersion | null
  selectedRole: VersionRole | null
  selectedValidationSnapshot: VersionValidationSnapshot
}) {
  const { locale } = useConsoleLocale()
  const showingHistorical = selectedRole === 'historical' && selectedVersion
  const compareConfig = showingHistorical ? selectedVersion : draft
  const compareDetail = showingHistorical
    ? (selectedVersion
      ? (locale === 'zh'
        ? `回滚预览 · live 对比 v${selectedVersion.version}`
        : `Rollback preview, live compared with v${selectedVersion.version}`)
      : (locale === 'zh' ? '请先在时间线里选择一个历史版本。' : 'Select a historical version in the timeline first.'))
    : draft
      ? draftDiffSummary.changedRows > 0
        ? `${draftDiffSummary.changedRows} ${locale === 'zh' ? '行变更' : 'changed rows'} · ${draftDiffSummary.changedGroups} ${locale === 'zh' ? '个分组' : 'groups'}`
        : (locale === 'zh' ? '相对 live 没有实质变化' : 'No material changes vs live')
      : (locale === 'zh'
        ? '还没有候选草稿。派生当前 live 或导入 package 之后，这里会显示真正的发布候选。'
        : 'No editable draft exists yet. Duplicate the live package or import a release package to open the candidate lane.')
  const compareMetaLabel = showingHistorical
    ? (locale === 'zh' ? 'edited' : 'edited')
    : draft
      ? (locale === 'zh' ? 'edited' : 'edited')
      : (locale === 'zh' ? 'next step' : 'next step')
  const compareMetaValue = showingHistorical
    ? formatDate(locale, selectedVersion?.updatedAt)
    : draft
      ? formatDate(locale, draft.updatedAt)
      : (locale === 'zh' ? '创建 / 导入草稿' : 'create / import draft')
  const compareHeadline = showingHistorical
    ? (selectedVersion ? `v${selectedVersion.version}` : (locale === 'zh' ? '历史版本' : 'History'))
    : draft
      ? `v${draft.version}`
      : (locale === 'zh' ? 'No draft' : 'No draft')
  const comparePill = showingHistorical
    ? selectedValidationSnapshot.label
    : draft
      ? draftValidationSnapshot.label
      : (locale === 'zh' ? 'Awaiting draft' : 'Awaiting draft')
  const comparePillTone = showingHistorical
    ? selectedValidationSnapshot.tone
    : draft
      ? draftValidationSnapshot.tone
      : 'neutral'

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_88px_minmax(0,1fr)] xl:items-stretch">
      <ReleaseVersionCard
        cardTone="live"
        config={live}
        headline={live ? `v${live.version}` : (locale === 'zh' ? 'No live' : 'No live')}
        eyebrow={locale === 'zh' ? '当前 LIVE' : 'Now live'}
        metaLabel={locale === 'zh' ? 'published' : 'published'}
        metaValue={formatDate(locale, live?.publishedAt ?? live?.updatedAt)}
        detail={live?.publishedBy ? `by ${live.publishedBy}` : (locale === 'zh' ? 'Publisher unavailable' : 'Publisher unavailable')}
        pill={liveValidationSnapshot.label}
        pillTone={liveValidationSnapshot.tone}
      />

      <div className="pointer-events-none hidden xl:flex xl:items-center xl:justify-center">
        <div className="flex w-full items-center justify-center">
          <span className="h-px flex-1 bg-[color:color-mix(in_srgb,var(--color-border-subtle)_78%,transparent)]" />
          <span className="mx-3 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[color:color-mix(in_srgb,var(--color-border-subtle)_86%,white)] bg-[rgba(247,247,243,0.96)] text-[var(--color-text-tertiary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] backdrop-blur-sm">
            <ArrowRight className="h-4 w-4" strokeWidth={1.8} />
          </span>
          <span className="h-px flex-1 bg-[color:color-mix(in_srgb,var(--color-border-subtle)_78%,transparent)]" />
        </div>
      </div>

      <ReleaseVersionCard
        cardTone={showingHistorical ? 'historical' : 'candidate'}
        config={compareConfig}
        headline={compareHeadline}
        eyebrow={releaseCandidateEyebrow(showingHistorical ? 'historical' : (draft ? 'draft' : null), locale)}
        metaLabel={compareMetaLabel}
        metaValue={compareMetaValue}
        detail={compareDetail}
        pill={comparePill}
        pillTone={comparePillTone}
      />
    </div>
  )
}

function ReleaseVersionCard({
  cardTone,
  config,
  headline,
  eyebrow,
  metaLabel,
  metaValue,
  detail,
  pill,
  pillTone,
}: {
  cardTone: 'live' | 'candidate' | 'historical'
  config: AgentVersion | null
  headline: string
  eyebrow: string
  metaLabel: string
  metaValue: string
  detail: string
  pill: string
  pillTone: 'success' | 'warning' | 'danger' | 'neutral'
}) {
  const accentClass = cardTone === 'live'
    ? 'bg-[var(--color-signal-success)]'
    : cardTone === 'historical'
      ? 'bg-[var(--color-signal-warning)]'
      : 'bg-[var(--color-accent-primary)]'

  return (
    <section className="rounded-[22px] border border-[var(--color-border-subtle)] bg-[rgba(255,253,248,0.88)] px-5 py-5 shadow-[0_18px_40px_rgba(21,23,25,0.06)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${accentClass}`} />
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-accent-primary)]">
            {eyebrow}
          </p>
        </div>
        <p className="max-w-[22ch] font-mono text-[12px] text-[var(--color-text-tertiary)] sm:text-right">
          {metaLabel} {metaValue}
        </p>
      </div>

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <h2 className={`${config ? 'text-[54px] tracking-[-0.06em]' : 'text-[34px] tracking-[-0.04em]'} font-semibold leading-none text-[var(--color-text-primary)]`}>
          {headline}
        </h2>
        <p className={`pb-1 text-[14px] font-medium ${config ? 'text-[var(--color-text-secondary)]' : 'max-w-[28ch] text-[var(--color-text-primary)]/78'}`}>
          {detail}
        </p>
      </div>

      <div className="mt-6">
        <span className={`inline-flex rounded-full border px-3 py-1.5 text-[13px] font-semibold ${toneClass(pillTone)}`}>
          {pill}
        </span>
      </div>
    </section>
  )
}

function ReleasePublishVerdictBar({
  busy,
  canPublish,
  diffSummary,
  draft,
  draftDiffSummary,
  draftValidationSnapshot,
  draftVersionId,
  duplicateBusy,
  onCreateDraft,
  onReviewDraft,
  onPublish,
  overrideRequired,
  publishDisabledReason,
  selectedRole,
  selectedValidationSnapshot,
  selectedVersion,
  slotsLeft,
}: {
  busy: boolean
  canPublish: boolean
  diffSummary: { changedGroups: number; changedRows: number }
  draft: AgentVersion | null
  draftDiffSummary: { changedGroups: number; changedRows: number }
  draftValidationSnapshot: VersionValidationSnapshot
  draftVersionId: string | null
  duplicateBusy: boolean
  onCreateDraft: () => void
  onReviewDraft: () => void
  onPublish: () => void
  overrideRequired: boolean
  publishDisabledReason: string | null
  selectedRole: VersionRole | null
  selectedValidationSnapshot: VersionValidationSnapshot
  selectedVersion: AgentVersion | null
  slotsLeft: number
}) {
  const { locale } = useConsoleLocale()
  const mode = !draft
    ? 'createDraft'
    : selectedRole === 'live' || !selectedVersion || selectedVersion.id === draftVersionId
      ? (selectedRole === 'draft' ? 'publish' : 'reviewDraft')
      : 'publish'
  const metricsDiffSummary = mode === 'publish' ? diffSummary : draftDiffSummary
  const metricsValidationSnapshot = mode === 'publish' ? selectedValidationSnapshot : draftValidationSnapshot
  const tone = mode === 'createDraft'
    ? 'warning'
    : mode === 'reviewDraft'
      ? metricsValidationSnapshot.tone === 'danger' ? 'danger' : metricsValidationSnapshot.tone === 'warning' ? 'warning' : 'success'
      : !canPublish
        ? 'neutral'
        : overrideRequired ? 'warning' : selectedValidationSnapshot.tone === 'danger' ? 'danger' : 'success'
  const shellClass = tone === 'warning'
    ? 'border-[color:color-mix(in_srgb,var(--color-signal-warning)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-warning)_8%,white)]'
    : tone === 'danger'
      ? 'border-[color:color-mix(in_srgb,var(--color-signal-danger)_54%,transparent)] bg-[color:color-mix(in_srgb,var(--color-signal-danger)_8%,white)]'
      : tone === 'success'
        ? 'border-[color:color-mix(in_srgb,var(--color-accent-primary)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--color-accent-primary)_6%,white)]'
        : 'border-[var(--color-border-subtle)] bg-[rgba(255,252,246,0.84)]'
  const title = mode === 'createDraft'
    ? (locale === 'zh' ? '先创建候选版本' : 'Create a candidate first')
    : mode === 'reviewDraft'
      ? (locale === 'zh' ? '草稿已就绪，先完成审查' : 'Draft ready for review')
      : !canPublish
        ? (locale === 'zh' ? '选择一个候选版本' : 'Select a candidate')
        : overrideRequired
          ? (locale === 'zh' ? '需要 override' : 'Override required')
          : (locale === 'zh' ? '准备发布' : 'Ready to publish')
  const body = mode === 'createDraft'
    ? (locale === 'zh'
      ? '当前只有 live 基线。派生草稿或导入 package 之后，才会打开真正的 diff、验证与发布门禁。'
      : 'Only the live baseline exists right now. Duplicate it or import a package to open the real candidate lane, diff review, and publish gate.')
    : mode === 'reviewDraft'
      ? draft
        ? (locale === 'zh'
          ? `草稿 v${draft.version} 已经准备好，包含 ${draftDiffSummary.changedRows} 行变更、${draftDiffSummary.changedGroups} 个分组。先打开它，再判断是否发布。`
          : `Draft v${draft.version} is already waiting with ${draftDiffSummary.changedRows} changed rows across ${draftDiffSummary.changedGroups} groups. Open it first, then decide whether to publish.`)
        : (publishDisabledReason ?? (locale === 'zh' ? '请先从右侧时间线选择草稿或历史版本。' : 'Select a draft or historical version from the timeline.'))
      : !canPublish
        ? (publishDisabledReason ?? (locale === 'zh' ? '请先从右侧时间线选择草稿或历史版本。' : 'Select a draft or historical version from the timeline.'))
        : selectedValidationSnapshot.detail
  const metrics = [
    {
      label: locale === 'zh' ? 'Diff reviewed' : 'Diff reviewed',
      value: metricsDiffSummary.changedRows > 0 ? `${metricsDiffSummary.changedRows} ${locale === 'zh' ? 'rows' : 'rows'}` : (locale === 'zh' ? '0 rows' : '0 rows'),
      tone: metricsDiffSummary.changedRows > 0 ? 'warning' as const : 'neutral' as const,
    },
    {
      label: locale === 'zh' ? 'Validation' : 'Validation',
      value: metricsValidationSnapshot.label,
      tone: metricsValidationSnapshot.tone,
    },
    {
      label: locale === 'zh' ? 'Retention' : 'Retention',
      value: slotsLeft > 0
        ? (locale === 'zh' ? `${slotsLeft} slots free` : `${slotsLeft} slots free`)
        : (locale === 'zh' ? 'Family full' : 'Family full'),
      tone: slotsLeft > 0 ? 'success' as const : 'warning' as const,
    },
  ]

  return (
    <section className={`rounded-[18px] border px-5 py-4 shadow-[0_14px_32px_rgba(21,23,25,0.05)] ${shellClass}`}>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_320px_190px] xl:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-white/65 text-[var(--color-signal-warning)] shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
            {tone === 'success'
              ? <CheckCircle2 className="h-5 w-5" />
              : mode === 'reviewDraft'
                ? <ArrowRightCircle className="h-5 w-5" />
                : tone === 'danger'
                  ? <AlertTriangle className="h-5 w-5" />
                  : <AlertTriangle className="h-5 w-5" />}
          </div>
          <div className="min-w-0 max-w-[70ch]">
            <p className="text-[17px] font-semibold text-[var(--color-text-primary)]">{title}</p>
            <p className="text-[14px] leading-5 text-[var(--color-text-secondary)]">{body}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 xl:border-l xl:border-[var(--color-border-subtle)] xl:pl-5">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <p className="text-[12px] font-semibold text-[var(--color-text-primary)]">{metric.label}</p>
              <p className={`mt-1 text-[13px] ${metric.tone === 'neutral' ? 'text-[var(--color-text-secondary)]' : metric.tone === 'success' ? 'text-[var(--color-signal-success)]' : metric.tone === 'danger' ? 'text-[var(--color-signal-danger)]' : 'text-[var(--color-signal-warning)]'}`}>
                {metric.value}
              </p>
            </div>
          ))}
        </div>

        <button
          type="button"
          aria-label={mode === 'createDraft'
            ? (locale === 'zh' ? '派生可编辑草稿' : 'Create editable draft')
            : mode === 'reviewDraft'
              ? (locale === 'zh' ? '查看当前草稿' : 'Review current draft')
              : (locale === 'zh' ? '发布当前版本' : 'Publish selected version')}
          disabled={mode === 'createDraft' ? duplicateBusy : mode === 'publish' ? (!canPublish || busy) : false}
          onClick={mode === 'createDraft' ? onCreateDraft : mode === 'reviewDraft' ? onReviewDraft : onPublish}
          className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[16px] border border-[rgba(29,52,59,0.12)] bg-[linear-gradient(135deg,#1f575d_0%,#2f7b78_52%,#469892_100%)] px-5 py-3 text-[18px] font-semibold text-white shadow-[0_20px_34px_-18px_rgba(24,83,88,0.78),inset_0_1px_0_rgba(255,255,255,0.2)] transition hover:translate-y-[-1px] hover:brightness-[1.03] hover:shadow-[0_22px_38px_-18px_rgba(24,83,88,0.9),inset_0_1px_0_rgba(255,255,255,0.22)] disabled:cursor-not-allowed disabled:opacity-45 xl:w-auto xl:justify-self-end"
        >
          {mode === 'createDraft'
            ? (duplicateBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Copy className="h-5 w-5" />)
            : mode === 'reviewDraft'
              ? <ArrowRightCircle className="h-5 w-5" />
              : busy
                ? <Loader2 className="h-5 w-5 animate-spin" />
                : <PackageOpen className="h-5 w-5" />}
          <span>
            {mode === 'createDraft'
              ? (locale === 'zh' ? 'Create draft' : 'Create draft')
              : mode === 'reviewDraft'
                ? (draft ? `Review v${draft.version}` : (locale === 'zh' ? 'Review draft' : 'Review draft'))
                : selectedVersion ? `Publish v${selectedVersion.version}` : (locale === 'zh' ? 'Publish' : 'Publish')}
          </span>
        </button>
      </div>
    </section>
  )
}

function ReleaseTimelineRailCard({
  currentId,
  draftId,
  family,
  liveId,
  liveTemplate,
  scenarioErrors,
  scenariosById,
  templates,
  onSelectVersion,
}: {
  currentId: string | null
  draftId: string | null
  family: AgentVersion[]
  liveId: string | null
  liveTemplate: InteraAgentTemplateV1 | null
  scenarioErrors: Record<string, string>
  scenariosById: Record<string, ScenarioListResponse | null>
  templates: Record<string, InteraAgentTemplateV1 | null>
  onSelectVersion: (id: string) => void
}) {
  const { locale } = useConsoleLocale()
  const orderedFamily = [...family].sort((a, b) => b.version - a.version)

  return (
    <aside className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-tertiary)]">
          {locale === 'zh' ? 'Timeline' : 'Timeline'}
        </p>
        <h2 className="sr-only">Agent version timeline</h2>
        <div className="sr-only">Live version</div>
        <div className="sr-only">Draft version</div>
        <div className="sr-only">Historical versions</div>
      </div>

      <div className="px-3 py-2">
        {orderedFamily.length > 0 ? (
          orderedFamily.map((config, index) => {
            const role = versionRoleFor(config, liveId, draftId) as VersionRole
            const latestReceipt = pickLatestReceipt(scenariosById[config.id]?.receipts ?? [])
            const validationSnapshot = buildValidationSnapshot(scenariosById[config.id]?.validation, latestReceipt, locale, scenarioErrors[config.id] ?? null)
            const diffLabel = describeDiffSummary(liveTemplate, templates[config.id] ?? null, role, locale)
            const current = config.id === currentId
            return (
              <button
                key={config.id}
                type="button"
                onClick={() => onSelectVersion(config.id)}
                className="group relative flex w-full items-start gap-2 rounded-[18px] px-2 py-2 text-left transition"
              >
                <div className="relative flex w-8 shrink-0 justify-center">
                  {index < orderedFamily.length - 1 ? (
                    <span className={`absolute top-6 h-[calc(100%+20px)] w-px ${current ? 'bg-[color:color-mix(in_srgb,var(--color-accent-primary)_28%,var(--color-border-subtle))]' : 'bg-[var(--color-border-subtle)]'}`} />
                  ) : null}
                  <span className={`relative mt-1 h-4 w-4 rounded-full border-2 ${role === 'live' ? 'border-[var(--color-signal-success)]' : role === 'draft' ? 'border-[var(--color-accent-primary)]' : 'border-[var(--color-text-tertiary)]'} bg-white`}>
                    {current ? <span className="absolute inset-[3px] rounded-full bg-[color:color-mix(in_srgb,var(--color-accent-primary)_24%,white)]" /> : null}
                  </span>
                </div>

                <div className={`min-w-0 flex-1 rounded-[15px] border px-4 py-4 transition ${current
                  ? 'border-[color:color-mix(in_srgb,var(--color-accent-primary)_20%,var(--color-border-subtle))] bg-white shadow-[0_12px_28px_rgba(21,23,25,0.06)]'
                  : 'border-transparent bg-transparent group-hover:border-[var(--color-border-subtle)] group-hover:bg-white/72'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[16px] font-semibold text-[var(--color-text-primary)]">v{config.version}</span>
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">
                      {roleLabel(role, locale)}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">{validationSnapshot.label}</p>
                  <p className={`mt-1 text-[11px] ${current ? 'text-[var(--color-text-secondary)]' : 'truncate text-[var(--color-text-tertiary)]'}`}>{diffLabel}</p>
                </div>
              </button>
            )
          })
        ) : (
          <div className="px-2 py-4 text-[13px] text-[var(--color-text-secondary)]">
            {locale === 'zh' ? '还没有任何版本。' : 'No versions retained yet.'}
          </div>
        )}
      </div>
    </aside>
  )
}

function ReleaseEvidenceRailCard({
  current,
  latestReceipt,
  onOpen,
  validation,
  validationSnapshot,
}: {
  current: AgentVersion | null
  latestReceipt: ScenarioReceipt | null
  onOpen: () => void
  validation: ScenarioValidationSummary | undefined
  validationSnapshot: VersionValidationSnapshot
}) {
  const { locale } = useConsoleLocale()
  return (
    <aside className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--color-text-tertiary)]">
          {locale === 'zh' ? 'Validation evidence' : 'Validation evidence'}
        </p>
      </div>

      <div className="space-y-4 p-5">
        <div className={`rounded-[16px] border px-4 py-4 text-[13px] ${toneClass(validationSnapshot.tone)}`}>
          <p className="font-semibold text-[var(--color-text-primary)]">{validationSnapshot.label}</p>
          <p className="mt-2 leading-6 text-[var(--color-text-secondary)]">{validationSnapshot.detail}</p>
        </div>

        {latestReceipt ? (
          <div className="rounded-[16px] border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.62)] px-4 py-4">
            <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">{latestReceipt.scenarioName}</p>
            <p className="mt-2 text-[13px] leading-5 text-[var(--color-text-secondary)]">
              {executionModeLabel(latestReceipt.executionMode, locale)} · {latestReceipt.status}
            </p>
            <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">
              {locale === 'zh' ? '运行于' : 'Run'} {formatDate(locale, latestReceipt.completedAt ?? latestReceipt.finishedAt ?? latestReceipt.startedAt)}
            </p>
            {current ? (
              <p className="mt-3 rounded-[12px] bg-[var(--color-bg-surface-muted)] px-3 py-2 font-mono text-[11px] text-[var(--color-text-tertiary)]">
                v{current.version} · {validation?.runtimeValidated ? (locale === 'zh' ? 'runtime-backed' : 'runtime-backed') : executionModeLabel(latestReceipt.executionMode, locale)}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="rounded-[16px] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-4 text-[13px] leading-6 text-[var(--color-text-secondary)]">
            {locale === 'zh' ? '这个版本还没有任何 Scenario 回执。发布前请先运行 Pilot Lab 验证。' : 'No Scenario receipt is recorded for this version yet. Run Pilot Lab validation before publishing.'}
          </div>
        )}

        <button
          type="button"
          onClick={onOpen}
          className="intera-q2-button inline-flex min-h-[44px] w-full items-center justify-center gap-2 border border-[var(--color-border-strong)] bg-white/84 px-4 py-2 text-[14px] font-semibold text-[var(--color-text-primary)] shadow-[0_8px_24px_rgba(21,23,25,0.04)] transition hover:border-[rgba(53,127,124,0.28)] hover:bg-white"
        >
          <SendHorizontal className="h-4 w-4" />
          <span>{locale === 'zh' ? 'Open in Pilot Lab' : 'Open in Pilot Lab'}</span>
        </button>
      </div>
    </aside>
  )
}

function ReleaseUtilityStrip({
  busyAction,
  current,
  pendingImport,
  rollbackTarget,
  onClearImport,
  onConfirmImport,
  onDuplicate,
  onRollback,
}: {
  busyAction: string | null
  current: AgentVersion | null
  pendingImport: PendingPackageImport | null
  rollbackTarget: AgentVersion | null
  onClearImport: () => void
  onConfirmImport: () => void
  onDuplicate: () => void
  onRollback: () => void
}) {
  const { locale } = useConsoleLocale()
  return (
    <section className="space-y-4 rounded-[18px] border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.72)] p-4 shadow-[0_12px_28px_rgba(21,23,25,0.04)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
            {locale === 'zh' ? '次级版本动作' : 'Secondary version actions'}
          </p>
          <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]">
            {current
              ? (locale === 'zh' ? `当前选中 v${current.version}。派生草稿和回滚预览保持显式。` : `You are reviewing v${current.version}. Duplicate draft and rollback preview stay explicit.`)
              : (locale === 'zh' ? '请先在右侧时间线中选择一个版本。' : 'Select a version in the timeline first.')}
          </p>
          <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-tertiary)]">
            {locale === 'zh'
              ? 'Import dry-run 会继续检查 Required secrets、conflicts、unsupported integrations 和 Knowledge refs。'
              : 'Import dry-run still reports Required secrets, conflicts, unsupported integrations, and Knowledge refs.'}
          </p>
          <span className="sr-only">Required secrets</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <ActionButton
            icon={<Copy className="h-4 w-4" />}
            label={locale === 'zh' ? '派生可编辑草稿' : 'Create editable draft'}
            busy={busyAction === 'duplicate'}
            onClick={onDuplicate}
          />
          <ActionButton
            icon={<RotateCcw className="h-4 w-4" />}
            label={releaseCopy(locale).rollbackPreview}
            disabled={!rollbackTarget}
            onClick={onRollback}
          />
        </div>
      </div>

      {pendingImport ? (
        <ImportDryRunReport
          busy={busyAction === 'import-apply'}
          pendingImport={pendingImport}
          onClear={onClearImport}
          onConfirm={onConfirmImport}
        />
      ) : null}
    </section>
  )
}

function releaseCandidateEyebrow(role: VersionRole | null, locale: ReleaseLocale) {
  if (role === 'historical') return locale === 'zh' ? '回滚预览' : 'Rollback preview'
  if (role === 'live') return locale === 'zh' ? '已选基线' : 'Selected baseline'
  return locale === 'zh' ? '候选版本' : 'Candidate'
}

function VersionTimelineSection({
  family,
  history,
  liveId,
  draftId,
  currentId,
  scenariosById,
  scenarioErrors,
  templates,
  liveTemplate,
  onSelectVersion,
}: {
  family: AgentVersion[]
  history: AgentVersion[]
  liveId: string | null
  draftId: string | null
  currentId: string | null
  scenariosById: Record<string, ScenarioListResponse | null>
  scenarioErrors: Record<string, string>
  templates: Record<string, InteraAgentTemplateV1 | null>
  liveTemplate: InteraAgentTemplateV1 | null
  onSelectVersion: (id: string) => void
}) {
  const { locale } = useConsoleLocale()
  const live = family.find((config) => config.id === liveId) ?? null
  const draft = family.find((config) => config.id === draftId) ?? null
  const retainedRatio = family.length / MAX_AGENT_CONFIG_VERSIONS

  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">{locale === 'zh' ? '版本控制体验' : 'Version control UX'}</p>
            <h2 className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">{locale === 'zh' ? 'Agent 版本时间线' : 'Agent version timeline'}</h2>
            <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[var(--color-text-secondary)]">
              {locale === 'zh'
                ? '一个 Agent 家族只有一条时间线：一个当前版本、一个可编辑草稿，以及若干保留的历史版本，用于回滚审查。'
                : 'One Agent family timeline: one live version, one editable draft, and retained historical versions for rollback review.'}
            </p>
          </div>

          <div className="min-w-[240px] rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/70 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-[12px] font-semibold text-[var(--color-text-primary)]">
              <span>{locale === 'zh' ? `已保留 ${family.length}/${MAX_AGENT_CONFIG_VERSIONS}` : `${family.length} of ${MAX_AGENT_CONFIG_VERSIONS} retained`}</span>
              <span className="text-[var(--color-text-tertiary)]">{locale === 'zh' ? `剩余 ${Math.max(MAX_AGENT_CONFIG_VERSIONS - family.length, 0)} 个槽位` : `${Math.max(MAX_AGENT_CONFIG_VERSIONS - family.length, 0)} slots left`}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-bg-surface-muted)]">
              <div className="h-full rounded-full bg-[var(--color-accent-primary)]" style={{ width: `${Math.min(retainedRatio, 1) * 100}%` }} />
            </div>
            <p className="mt-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
              {locale === 'zh'
                ? `P0 在一个家族里最多保留 ${MAX_AGENT_CONFIG_VERSIONS} 个版本，这样发布、回滚预览和 package diff 才能保持可读。家族满了之后，派生和导入到草稿都会暂停，直到你有意识地清退更老的历史版本。`
                : `P0 keeps at most ${MAX_AGENT_CONFIG_VERSIONS} retained versions in one family so publish, rollback preview, and package diff stay readable. When the family is full, duplicate and import-to-draft stop until older history is retired intentionally.`}
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-[var(--color-border-subtle)]">
        <TimelineGroup
          title={locale === 'zh' ? '当前版本' : 'Live version'}
          empty={locale === 'zh' ? '当前还没有激活中的版本。' : 'No live version is currently active.'}
          versions={live ? [live] : []}
          family={family}
          currentId={currentId}
          liveId={liveId}
          draftId={draftId}
          scenariosById={scenariosById}
          scenarioErrors={scenarioErrors}
          templates={templates}
          liveTemplate={liveTemplate}
          onSelectVersion={onSelectVersion}
        />
        <TimelineGroup
          title={locale === 'zh' ? '草稿版本' : 'Draft version'}
          empty={locale === 'zh' ? '还没有可编辑草稿。请从当前版本或历史版本派生一个草稿。' : 'No editable draft exists yet. Create editable draft from live or a historical version.'}
          versions={draft ? [draft] : []}
          family={family}
          currentId={currentId}
          liveId={liveId}
          draftId={draftId}
          scenariosById={scenariosById}
          scenarioErrors={scenarioErrors}
          templates={templates}
          liveTemplate={liveTemplate}
          onSelectVersion={onSelectVersion}
        />
        <TimelineGroup
          title={locale === 'zh' ? '历史版本' : 'Historical versions'}
          empty={locale === 'zh' ? '还没有保留任何历史版本。' : 'No historical versions retained yet.'}
          versions={history}
          family={family}
          currentId={currentId}
          liveId={liveId}
          draftId={draftId}
          scenariosById={scenariosById}
          scenarioErrors={scenarioErrors}
          templates={templates}
          liveTemplate={liveTemplate}
          onSelectVersion={onSelectVersion}
        />
      </div>
    </section>
  )
}

function TimelineGroup({
  title,
  empty,
  versions,
  family,
  currentId,
  liveId,
  draftId,
  scenariosById,
  scenarioErrors,
  templates,
  liveTemplate,
  onSelectVersion,
}: {
  title: string
  empty: string
  versions: AgentVersion[]
  family: AgentVersion[]
  currentId: string | null
  liveId: string | null
  draftId: string | null
  scenariosById: Record<string, ScenarioListResponse | null>
  scenarioErrors: Record<string, string>
  templates: Record<string, InteraAgentTemplateV1 | null>
  liveTemplate: InteraAgentTemplateV1 | null
  onSelectVersion: (id: string) => void
}) {
  const { locale } = useConsoleLocale()
  return (
    <div>
      <div className="bg-[var(--color-bg-surface-muted)] px-5 py-3">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{title}</p>
      </div>
      {versions.length > 0 ? (
        <div className="divide-y divide-[var(--color-border-subtle)]">
          {versions.map((config) => {
            const role = versionRoleFor(config, liveId, draftId) as VersionRole
            const latestReceipt = pickLatestReceipt(scenariosById[config.id]?.receipts ?? [])
            const validationSnapshot = buildValidationSnapshot(scenariosById[config.id]?.validation, latestReceipt, locale, scenarioErrors[config.id] ?? null)
            const diffLabel = describeDiffSummary(liveTemplate, templates[config.id] ?? null, role, locale)
            return (
              <VersionTimelineRow
                key={config.id}
                config={config}
                current={config.id === currentId}
                diffLabel={diffLabel}
                family={family}
                role={role}
                validationSnapshot={validationSnapshot}
                onSelectVersion={onSelectVersion}
              />
            )
          })}
        </div>
      ) : (
        <div className="px-5 py-4 text-[13px] text-[var(--color-text-secondary)]">{empty}</div>
      )}
    </div>
  )
}

function VersionTimelineRow({
  config,
  current,
  diffLabel,
  family,
  role,
  validationSnapshot,
  onSelectVersion,
}: {
  config: AgentVersion
  current: boolean
  diffLabel: string
  family: AgentVersion[]
  role: VersionRole
  validationSnapshot: VersionValidationSnapshot
  onSelectVersion: (id: string) => void
}) {
  const { locale } = useConsoleLocale()
  const parentVersion = parentVersionFor(config, family)

  return (
    <article className={`grid gap-4 px-5 py-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.95fr)_minmax(0,1.05fr)_160px] ${current ? 'bg-[color:color-mix(in_srgb,var(--color-accent-primary)_4%,white)]' : 'bg-white/80'}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold ${toneClass(roleTone(role))}`}>{roleLabel(role, locale)}</span>
          {current ? <span className="rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.24)] bg-[rgba(53,127,124,0.08)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-accent-primary)]">{locale === 'zh' ? '已选中' : 'Selected'}</span> : null}
        </div>
        <h3 className="mt-3 text-[16px] font-semibold text-[var(--color-text-primary)]">v{config.version}</h3>
        <p className="mt-1 text-[12px] leading-5 text-[var(--color-text-secondary)]">{roleSubtitle(role, locale)}</p>
        <div className="mt-3 space-y-1 text-[12px] text-[var(--color-text-tertiary)]">
          <p>{config.publishedAt ? `${locale === 'zh' ? '发布时间' : 'Published'} ${formatDate(locale, config.publishedAt)}` : locale === 'zh' ? '尚未发布' : 'Not published yet'}</p>
          <p>{config.publishedBy ? `${locale === 'zh' ? '发布人' : 'Published by'} ${config.publishedBy}` : locale === 'zh' ? '发布人不可用' : 'Publisher unavailable'}</p>
          <p>{locale === 'zh' ? '最后编辑' : 'Last edited'} {formatDate(locale, config.updatedAt)}</p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{locale === 'zh' ? '验证' : 'Validation'}</p>
        <div className={`mt-3 rounded-[var(--radius-control)] border px-3 py-3 text-[12px] ${toneClass(validationSnapshot.tone)}`}>
          <p className="font-semibold text-[var(--color-text-primary)]">{validationSnapshot.label}</p>
          <p className="mt-1 text-[var(--color-text-secondary)]">{validationSnapshot.detail}</p>
          <p className="mt-2 text-[var(--color-text-tertiary)]">{validationSnapshot.meta}</p>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{locale === 'zh' ? '来源与动作' : 'Lineage and actions'}</p>
        <div className="mt-3 space-y-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
          <p>{parentVersion ? `${locale === 'zh' ? '派生自' : 'Forked from'} v${parentVersion}` : locale === 'zh' ? '原始家族基线' : 'Original family baseline'}</p>
          <p>{diffLabel}</p>
          <div className="flex flex-wrap gap-2">
            {actionHintsForRole(role, locale).map((label) => (
              <span key={label} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]">
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-start justify-start lg:justify-end">
        <button
          type="button"
          onClick={() => onSelectVersion(config.id)}
          disabled={current}
          className="intera-q2-button inline-flex min-h-[40px] items-center justify-center border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] font-semibold text-[var(--color-text-primary)] disabled:cursor-default disabled:opacity-55"
        >
          {current ? (locale === 'zh' ? '查看中' : 'Viewing') : (locale === 'zh' ? '查看版本' : 'View version')}
        </button>
      </div>
    </article>
  )
}

function SelectedVersionCard({
  config,
  role,
  family,
  diffSummary,
  validationSnapshot,
}: {
  config: AgentVersion | null
  role: VersionRole | null
  family: AgentVersion[]
  diffSummary: { changedGroups: number; changedRows: number }
  validationSnapshot: VersionValidationSnapshot
}) {
  const { locale } = useConsoleLocale()
  const parentVersion = config ? parentVersionFor(config, family) : null
  const diffLabel = !config || !role
    ? (locale === 'zh' ? '尚未选择版本。' : 'No version selected.')
    : role === 'live'
      ? (locale === 'zh' ? '当前 live 基线' : 'Live baseline')
      : diffSummary.changedRows > 0
        ? releaseCopy(locale).diffVsLive(diffSummary.changedRows, diffSummary.changedGroups)
        : (locale === 'zh' ? '相对 live 没有实质变化' : 'No material changes vs live')

  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{selectedTitle(config, role, locale)}</h2>
      </div>

      {config && role ? (
        <div className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-[var(--radius-control)] border px-2.5 py-1 text-[11px] font-semibold ${toneClass(roleTone(role))}`}>{roleLabel(role, locale)}</span>
            {config.model ? <span className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/80 px-2.5 py-1 text-[11px] text-[var(--color-text-secondary)]">{config.model}</span> : null}
          </div>

          <ReleaseMetaList
            rows={[
              { label: locale === 'zh' ? '来源' : 'Lineage', value: parentVersion ? `${locale === 'zh' ? '派生自' : 'Forked from'} v${parentVersion}` : locale === 'zh' ? '原始家族基线' : 'Original family baseline' },
              { label: locale === 'zh' ? '更新时间' : 'Updated', value: formatDate(locale, config.updatedAt) },
              { label: locale === 'zh' ? '发布时间' : 'Published', value: formatDate(locale, config.publishedAt, locale === 'zh' ? '尚未发布' : 'Not published') },
              { label: locale === 'zh' ? '发布人' : 'Publisher', value: config.publishedBy || (locale === 'zh' ? '不可用' : 'Unavailable') },
            ]}
          />

          <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.72)] p-4">
            <p className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
              <GitCompare className="h-4 w-4 text-[var(--color-accent-primary)]" />
              {locale === 'zh' ? '相对 live 的变化' : 'Changed since live'}
            </p>
            <p className="mt-3 text-[14px] font-semibold text-[var(--color-text-primary)]">{diffLabel}</p>
            <p className="mt-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">{roleSubtitle(role, locale)}</p>
          </div>

          <div className={`rounded-[var(--radius-control)] border px-4 py-3 text-[12px] ${toneClass(validationSnapshot.tone)}`}>
            <p className="font-semibold text-[var(--color-text-primary)]">{validationSnapshot.label}</p>
            <p className="mt-1 text-[var(--color-text-secondary)]">{validationSnapshot.detail}</p>
            <p className="mt-1 text-[var(--color-text-tertiary)]">{validationSnapshot.meta}</p>
          </div>

          {config.releaseNote ? (
            <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-4 py-3">
              <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{locale === 'zh' ? '发布说明' : 'Release note'}</p>
              <p className="mt-2 text-[13px] leading-6 text-[var(--color-text-secondary)]">{config.releaseNote}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="p-5 text-[13px] text-[var(--color-text-secondary)]">{locale === 'zh' ? '请先在时间线上选择一个版本，再查看验证和 diff 上下文。' : 'Select a version in the timeline to inspect validation and diff context.'}</div>
      )}
    </section>
  )
}

function ReleaseMetaList({ rows }: { rows: Array<{ label: string; value: string }> }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.62)]">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between gap-4 border-t border-[var(--color-border-subtle)] px-4 py-3 first:border-t-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{row.label}</p>
          <p className="text-right text-[13px] font-medium text-[var(--color-text-primary)]">{row.value}</p>
        </div>
      ))}
    </div>
  )
}

function SelectedReceiptCard({
  config,
  latestReceipt,
  validationSnapshot,
  validation,
}: {
  config: AgentVersion | null
  latestReceipt: ScenarioReceipt | null
  validationSnapshot: VersionValidationSnapshot
  validation: ScenarioValidationSummary | undefined
}) {
  const { locale } = useConsoleLocale()
  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
        <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{locale === 'zh' ? '验证证据' : 'Validation evidence'}</h2>
      </div>

      <div className="p-5">
        <div className={`rounded-[var(--radius-control)] border px-4 py-3 text-[12px] ${toneClass(validationSnapshot.tone)}`}>
          <p className="font-semibold text-[var(--color-text-primary)]">{validationSnapshot.label}</p>
          <p className="mt-1 text-[var(--color-text-secondary)]">{validationSnapshot.detail}</p>
          <p className="mt-1 text-[var(--color-text-tertiary)]">{validationSnapshot.meta}</p>
        </div>

        {latestReceipt ? (
          <>
            <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <span className={`inline-flex rounded-[var(--radius-control)] border px-2.5 py-1 text-[12px] font-semibold capitalize ${toneClass(receiptTone(latestReceipt.status))}`}>{latestReceipt.status}</span>
                <h3 className="mt-4 text-[14px] font-semibold text-[var(--color-text-primary)]">{latestReceipt.scenarioName}</h3>
                <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{executionModeLabel(latestReceipt.executionMode, locale)} · {locale === 'zh' ? '运行于' : 'Run'} {formatDate(locale, latestReceipt.completedAt ?? latestReceipt.finishedAt ?? latestReceipt.startedAt)}</p>
              </div>
              {config ? <span className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-2.5 py-1 text-[11px] font-medium text-[var(--color-text-secondary)]">v{config.version}</span> : null}
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-0 overflow-hidden rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] text-[12px]">
              <ReceiptStat label={locale === 'zh' ? '总数' : 'Total'} value={String(latestReceipt.checks.length)} />
              <ReceiptStat label={locale === 'zh' ? '通过' : 'Passed'} value={String(latestReceipt.checks.filter((check) => check.passed).length)} tone="success" />
              <ReceiptStat label={locale === 'zh' ? '失败' : 'Failed'} value={String(latestReceipt.checks.filter((check) => !check.passed).length)} tone={latestReceipt.checks.some((check) => !check.passed) ? 'danger' : 'neutral'} />
              <ReceiptStat label={locale === 'zh' ? 'Tool 模式' : 'Tool mode'} value={latestReceipt.toolExecutionMode} />
            </dl>

            <div className="mt-5 space-y-3">
              {latestReceipt.checks.slice(0, 5).map((check) => (
                <div key={check.name} className="flex items-center justify-between gap-3 text-[13px]">
                  <span className="flex min-w-0 items-center gap-2 font-medium text-[var(--color-text-primary)]">
                    {check.passed ? <CheckCircle2 className="h-4 w-4 shrink-0 text-[var(--color-signal-success)]" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--color-signal-danger)]" />}
                    <span className="truncate">{check.name.replace(/_/g, ' ')}</span>
                  </span>
                  <span className="shrink-0 rounded bg-[var(--color-bg-surface-muted)] px-2 py-1 text-[11px] text-[var(--color-text-tertiary)]">{check.passed ? (locale === 'zh' ? '通过' : 'Passed') : (locale === 'zh' ? '失败' : 'Failed')}</span>
                </div>
              ))}
            </div>

            <div className="mt-5">
              <ReleaseMetaList
                rows={[
                  { label: locale === 'zh' ? '回执类型' : 'Receipt type', value: executionModeLabel(latestReceipt.executionMode, locale) },
                  { label: locale === 'zh' ? '运行时验证' : 'Runtime-backed', value: validation?.runtimeValidated ? (locale === 'zh' ? '是' : 'Yes') : (locale === 'zh' ? '否' : 'No') },
                ]}
              />
            </div>
          </>
        ) : (
          <p className="mt-5 rounded-[var(--radius-control)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-bg-surface-muted)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
            {locale === 'zh' ? '这个已选版本还没有任何 Scenario 回执。发布前请先运行 Pilot Lab 验证，或填写 override 原因。' : 'No Scenario receipt has been recorded for this selected version yet. Run Pilot Lab validation before publishing or provide an override reason.'}
          </p>
        )}
      </div>
    </section>
  )
}

function ReceiptStat({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: 'success' | 'danger' | 'neutral' }) {
  const toneClassName = tone === 'success' ? 'text-[var(--color-signal-success)]' : tone === 'danger' ? 'text-[var(--color-signal-danger)]' : 'text-[var(--color-text-primary)]'
  return (
    <div className="border-b border-r border-[var(--color-border-subtle)] px-4 py-3 even:border-r-0">
      <dt className="text-[11px] text-[var(--color-text-tertiary)]">{label}</dt>
      <dd className={`mt-1 text-[20px] font-semibold ${toneClassName}`}>{value}</dd>
    </div>
  )
}

function PackageActionsPanel({
  busyAction,
  canPublish,
  coverageTemplate,
  current,
  importInputRef,
  pendingImport,
  publishDisabledReason,
  rollbackTarget,
  role,
  onClearImport,
  onConfirmImport,
  onDuplicate,
  onExport,
  onImport,
  onImportClick,
  onPublish,
  onRollback,
}: {
  busyAction: string | null
  canPublish: boolean
  coverageTemplate: InteraAgentTemplateV1 | null
  current: AgentVersion | null
  importInputRef: RefObject<HTMLInputElement | null>
  pendingImport: PendingPackageImport | null
  publishDisabledReason: string | null
  rollbackTarget: AgentVersion | null
  role: VersionRole | null
  onClearImport: () => void
  onConfirmImport: () => void
  onDuplicate: () => void
  onExport: () => void
  onImport: (file: File | undefined) => void
  onImportClick: () => void
  onPublish: () => void
  onRollback: () => void
}) {
  const { locale } = useConsoleLocale()
  const coverage = packageCoverageRows(coverageTemplate, locale)
  const copy = releaseCopy(locale)
  const rules = copy.actionRules
  const selectedLabel = current ? `${current.name} v${current.version}` : (locale === 'zh' ? '尚未选择版本' : 'No version selected')

  return (
    <section className="intera-q2-panel overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-[16px] font-semibold text-[var(--color-text-primary)]">{locale === 'zh' ? '版本控制动作' : 'Version control actions'}</h2>
          <p className="mt-1 text-[13px] leading-5 text-[var(--color-text-secondary)]">
            {locale === 'zh'
              ? '发布页统一负责当前已选版本的发布、回滚预览、草稿派生，以及 package 导入/导出。'
              : 'Release owns publish, rollback preview, duplicate draft creation, and package import/export for the selected version.'}
          </p>
        </div>
        <input ref={importInputRef} aria-label={copy.importPackageAria} type="file" accept="application/json,.json,.intera-agent.json" className="hidden" onChange={(event) => onImport(event.target.files?.[0])} />
      </div>

      <div className="grid gap-5 p-5">
        <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.6)] px-4 py-3 text-[12px] leading-5 text-[var(--color-text-secondary)]">
          <p><span className="font-semibold text-[var(--color-text-primary)]">{locale === 'zh' ? '已选：' : 'Selected:'}</span> {selectedLabel}{role ? ` · ${roleLabel(role, locale)}` : ''}</p>
          <p className="mt-1">{locale === 'zh' ? '导出会下载当前已选 package。导入一定先经过 dry-run 报告，不会静默激活。' : 'Export downloads the currently selected package. Import always starts with a dry-run report and never activates silently.'}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <ActionButton icon={<FileDown className="h-4 w-4" />} label={locale === 'zh' ? '导出当前包' : 'Export selected package'} busy={busyAction === 'export'} onClick={onExport} />
          <ActionButton icon={<Upload className="h-4 w-4" />} label={locale === 'zh' ? '导入包' : 'Import package'} busy={busyAction === 'import'} onClick={onImportClick} />
          <ActionButton icon={<Copy className="h-4 w-4" />} label={locale === 'zh' ? '派生可编辑草稿' : 'Create editable draft'} busy={busyAction === 'duplicate'} onClick={onDuplicate} />
          <ActionButton icon={<PackageOpen className="h-4 w-4" />} label={locale === 'zh' ? '发布当前版本' : 'Publish selected version'} busy={busyAction === 'publish'} disabled={!canPublish} onClick={onPublish} />
          <ActionButton icon={<RotateCcw className="h-4 w-4" />} label={copy.rollbackPreview} disabled={!rollbackTarget} onClick={onRollback} />
        </div>

        {publishDisabledReason ? <p className="text-[12px] text-[var(--color-text-tertiary)]">{publishDisabledReason}</p> : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.56)] p-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{locale === 'zh' ? '动作规则' : 'Action rules'}</p>
            <div className="mt-3 grid gap-2">
              {rules.map((rule) => (
                <div key={rule} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/78 px-3 py-2 text-[12px] leading-5 text-[var(--color-text-secondary)]">
                  {rule}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.56)] p-4">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{locale === 'zh' ? 'Package 覆盖范围' : 'Package coverage'}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-3">
              {coverage.map((item) => (
                <PackageCoverageCell key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </div>
        </div>

        {pendingImport ? (
          <ImportDryRunReport
            busy={busyAction === 'import-apply'}
            pendingImport={pendingImport}
            onClear={onClearImport}
            onConfirm={onConfirmImport}
          />
        ) : null}
      </div>
    </section>
  )
}

function PackageCoverageCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white/78 px-3 py-2">
      <p className="text-[11px] font-medium text-[var(--color-text-tertiary)]">{label}</p>
      <p className="mt-1 text-[18px] font-semibold text-[var(--color-text-primary)]">{value}</p>
    </div>
  )
}

function ImportDryRunReport({
  busy,
  pendingImport,
  onClear,
  onConfirm,
}: {
  busy: boolean
  pendingImport: PendingPackageImport
  onClear: () => void
  onConfirm: () => void
}) {
  const { locale } = useConsoleLocale()
  const copy = releaseCopy(locale)
  const report = pendingImport.report
  return (
    <section className="mt-5 rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <p className="text-[12px] font-semibold text-[var(--color-text-tertiary)]">{copy.importDryRunReport}</p>
          <h3 className="mt-1 text-[15px] font-semibold text-[var(--color-text-primary)]">{pendingImport.fileName}</h3>
          <p className="mt-1 text-[12px] text-[var(--color-text-secondary)]">{report.canImport ? copy.importReady : copy.importBlocked}</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClear} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-2 text-[12px] text-[var(--color-text-secondary)]">{copy.clear}</button>
          <button type="button" disabled={!report.canImport || busy} onClick={onConfirm} className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[color:color-mix(in_srgb,var(--color-accent-primary)_45%,transparent)] bg-[var(--color-accent-primary)] px-3 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageOpen className="h-4 w-4" />}
            {copy.createDraft}
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <ReportList title={copy.missingSecrets} items={report.requiredSecrets.map((secret) => secret.name)} empty={copy.noRequiredSecrets} tone={report.requiredSecrets.length > 0 ? 'warning' : 'neutral'} />
        <ReportList title={copy.conflicts} items={report.conflicts.map((conflict) => conflict.message)} empty={copy.noBlockingConflicts} tone={report.conflicts.some((conflict) => conflict.severity === 'error') ? 'danger' : 'warning'} />
        <ReportList title={copy.unsupportedIntegrations} items={report.unsupportedIntegrations.map((integration) => `${integration.channel}: ${integration.reason}`)} empty={copy.noUnsupportedIntegrations} tone={report.unsupportedIntegrations.length > 0 ? 'warning' : 'neutral'} />
        <ReportList title={copy.knowledgeRequirements} items={report.missingKnowledgeRefs.map((ref) => ref.name)} empty={copy.noMissingKnowledgeRefs} tone={report.missingKnowledgeRefs.length > 0 ? 'warning' : 'neutral'} />
      </div>

      {report.warnings.length > 0 ? (
        <div className="mt-3 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 py-3 text-[12px] text-[var(--color-text-secondary)]">
          <p className="font-semibold text-[var(--color-text-primary)]">{copy.warnings}</p>
          <ul className="mt-2 space-y-1">
            {report.warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function ReportList({ title, items, empty, tone }: { title: string; items: string[]; empty: string; tone: 'warning' | 'danger' | 'neutral' }) {
  return (
    <div className={`rounded-[var(--radius-control)] border px-3 py-3 text-[12px] ${toneClass(tone)}`}>
      <p className="font-semibold text-[var(--color-text-primary)]">{title}</p>
      {items.length > 0 ? (
        <ul className="mt-2 space-y-1 text-[var(--color-text-secondary)]">
          {items.slice(0, 4).map((item) => <li key={item} className="break-words">{item}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-[var(--color-text-tertiary)]">{empty}</p>
      )}
    </div>
  )
}

function ReleaseConfigPilotRail({
  current,
  role,
  validation,
  validationSnapshot,
  latestReceipt,
  onOpen,
}: {
  current: AgentVersion | null
  role: VersionRole | null
  validation: ScenarioValidationSummary | undefined
  validationSnapshot: VersionValidationSnapshot
  latestReceipt: ScenarioReceipt | null
  onOpen: () => void
}) {
  const { locale } = useConsoleLocale()
  const validated = Boolean(validation?.runtimeValidated)

  return (
    <aside className="intera-q2-rail p-5 xl:sticky xl:top-6 xl:self-start">
      <div className="flex items-center gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-[var(--color-accent-primary)]">
          <OrganicLoader variant={validated ? '20' : '12'} size={24} title="ConfigPilot release rail loader" />
        </span>
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-[var(--color-text-primary)]">ConfigPilot <span className="ml-1 rounded bg-[var(--color-bg-surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--color-text-tertiary)]">BETA</span></p>
          <p className="mt-1 text-[12px] text-[var(--color-text-tertiary)]">{locale === 'zh' ? '对话式构建归 Pilot Lab 负责；当你需要引导式修复时，发布页会把你带过去。' : 'Pilot Lab owns conversational building. Release links there when you need guided fixes.'}</p>
        </div>
      </div>

      <p className="mt-8 text-[13px] leading-6 text-[var(--color-text-secondary)]">
        {locale === 'zh'
          ? `已选${role ? roleLabel(role, locale) : '版本'}${current ? ` v${current.version}` : ''}，可以进入发布审查。`
          : `Selected ${role ? roleLabel(role, locale).toLowerCase() : 'version'}${current ? ` v${current.version}` : ''} is ready for Release review.`}
      </p>

      <div className="mt-5 overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[rgba(255,255,255,0.56)]">
        <RailInsightRow
          tone={validated ? 'success' : 'warning'}
          title={validated ? (locale === 'zh' ? '验证是新鲜的' : 'Validation is fresh') : (locale === 'zh' ? '验证需要复查' : 'Validation needs review')}
          body={validated ? (locale === 'zh' ? '下一次发布前，可以让 ConfigPilot 再做一个很小的草稿优化。' : 'Ask ConfigPilot for one small draft improvement before the next publish.') : validationSnapshot.detail}
          action={locale === 'zh' ? '打开 Pilot Lab' : 'Open Pilot Lab'}
          onClick={onOpen}
        />
        <RailInsightRow
          tone="info"
          title={locale === 'zh' ? '最新证据' : 'Latest evidence'}
          body={latestReceipt ? `${executionModeLabel(latestReceipt.executionMode, locale)} · ${latestReceipt.status}: ${latestReceipt.scenarioName}` : (locale === 'zh' ? '还没有回执。发布前请先运行验证。' : 'No receipt yet. Run validation before publishing.')}
          action={locale === 'zh' ? '询问 ConfigPilot' : 'Ask ConfigPilot'}
          onClick={onOpen}
        />
        <RailInsightRow
          tone="success"
          title={locale === 'zh' ? '发布边界' : 'Release boundary'}
          body={locale === 'zh' ? '导入、派生和草稿编辑都会保持隔离，直到发布页明确执行发布。ConfigPilot 不能替你发布。' : 'Import, duplicate, and draft edits stay isolated until Release publishes explicitly. ConfigPilot cannot publish for you.'}
          action={locale === 'zh' ? '查看流程' : 'Review workflow'}
          onClick={onOpen}
        />
      </div>
    </aside>
  )
}

function RailInsightRow({ tone, title, body, action, onClick }: { tone: 'warning' | 'info' | 'success'; title: string; body: string; action: string; onClick: () => void }) {
  const toneStyles = tone === 'warning'
    ? 'text-[var(--color-signal-warning)]'
    : tone === 'success'
      ? 'text-[var(--color-signal-success)]'
      : 'text-[var(--color-accent-primary)]'
  return (
    <section className="border-t border-[var(--color-border-subtle)] px-4 py-4 first:border-t-0">
      <p className={`flex items-center gap-2 text-[13px] font-semibold ${toneStyles}`}>
        <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current text-[11px]">i</span>
        {title}
      </p>
      <p className="mt-3 text-[13px] font-medium leading-6 text-[var(--color-text-primary)]">{body}</p>
      <button type="button" onClick={onClick} className="intera-q2-button mt-4 inline-flex h-9 items-center gap-2 border border-[var(--color-border-subtle)] bg-white/82 px-3 text-[12px] font-semibold text-[var(--color-text-primary)]">
        {action}
        <span aria-hidden>›</span>
      </button>
    </section>
  )
}

function HeroFact({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: string
  tone?: 'success' | 'warning' | 'danger' | 'neutral'
}) {
  return (
    <div className={`rounded-[var(--radius-control)] border px-3 py-3 ${toneClass(tone)}`}>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">{label}</p>
      <p className="mt-2 text-[13px] font-semibold text-[var(--color-text-primary)]">{value}</p>
    </div>
  )
}

function ActionButton({ icon, label, busy, disabled, onClick }: { icon: ReactNode; label: string; busy?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button type="button" disabled={busy || disabled} onClick={onClick} className="intera-q2-button inline-flex min-h-[42px] items-center justify-center gap-2 border border-[var(--color-border-subtle)] bg-white/80 px-3 py-2 text-[12px] font-medium text-[var(--color-text-primary)] shadow-sm transition hover:border-[var(--color-accent-primary)]/40 disabled:cursor-not-allowed disabled:opacity-45">
      {busy ? <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent-primary)]" /> : icon}
      {label}
    </button>
  )
}

function LightDrawer({ eyebrow, title, children, onClose }: { eyebrow: string; title: string; children: ReactNode; onClose: () => void }) {
  const { locale } = useConsoleLocale()
  return (
    <div className="fixed inset-0 z-[55] bg-black/15 backdrop-blur-[2px]">
      <aside className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-tertiary)]">{eyebrow}</p>
            <h2 className="mt-1 text-[20px] font-semibold text-[var(--color-text-primary)]">{title}</h2>
          </div>
          <button type="button" aria-label={locale === 'zh' ? `关闭${title}` : `Close ${title}`} onClick={onClose} className="rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white p-2 text-[var(--color-text-tertiary)]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </aside>
    </div>
  )
}
