'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  History,
  Loader2,
  Save,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'
import type { ModelInfo } from '@/app/admin/agent/types'
import { DEFAULT_MODEL } from '@intera/shared/defaults'
import { PageLoader } from '@/components/ui/page-loader'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { emitAgentConfigUpdated } from '@/lib/agent-config-events'
import { useSession } from '@/lib/hooks/use-session'
import { useSelectedAgentId } from '@/components/admin/version-context-bar'
import {
  applyMemoryMode,
  detectMemoryMode,
  MEMORY_MODE_PRESETS,
  normalizeMemoryStrategy,
  type MemoryMode,
  type MemoryStrategyUi,
} from './memory-strategy-utils'

type MemoryCopy = {
  eyebrow: string
  pageTitle: string
  pageDescription: string
  loadFailed: string
  saveDraft: string
  saving: string
  saved: string
  saveFailed: string
  unsaved: string
  postureTitle: string
  postureDescription: string
  autoCompact: string
  autoCompactDescription: string
  compactModel: string
  compactModelDescription: string
  longTermTitle: string
  longTermDescription: string
  longTermEnabled: string
  longTermEnabledDescription: string
  longTermBudget: string
  sessionMemoryAge: string
  factTitle: string
  factDescription: string
  factModel: string
  factGuidance: string
  factPlaceholder: string
  advancedTitle: string
  advancedDescription: string
  groups: {
    thresholds: string
    compaction: string
    estimation: string
    prompt: string
  }
  modes: Record<
    MemoryMode,
    {
      label: string
      description: string
    }
  >
  modeSummary: {
    tokenThreshold: string
    workingWindow: string
    compactWindow: string
    keepMinimum: string
    messageUnit: string
    turnEstimate: (turns: number) => string
  }
  fields: {
    autoCompactThreshold: string
    warningThreshold: string
    errorThreshold: string
    blockingThreshold: string
    l1MaxMessages: string
    compactMaxMessages: string
    keepMinimumMessages: string
    keepRatio: string
    compactTemperature: string
    compactMaxTokens: string
    minimumSummaryLength: string
    circuitBreakerFailures: string
    keyEventMaxChars: string
    tokensPerKeyEvent: string
    tokensPerFact: string
    tokensPerTool: string
    cjkCharsPerToken: string
    latinCharsPerToken: string
    minimumTokenEstimate: string
    toolResultTokenRatio: string
    contextWindow: string
    reservedOutputTokens: string
    compactPrompt: string
    compactPromptPlaceholder: string
  }
  units: {
    tokens: string
    messages: string
    chars: string
    failures: string
    ms: string
  }
}

const MEMORY_COPY: Record<'en' | 'zh', MemoryCopy> = {
  en: {
    eyebrow: 'Build / Components / Brain',
    pageTitle: 'Memory strategy',
    pageDescription: 'Tune compaction, long-term memory, and fact extraction with runtime-backed controls only.',
    loadFailed: 'Failed to load memory strategy',
    saveDraft: 'Save draft',
    saving: 'Saving',
    saved: 'Saved',
    saveFailed: 'Save failed',
    unsaved: 'Unsaved changes',
    postureTitle: 'Compaction posture',
    postureDescription: 'Choose how aggressively the agent compacts working context before it reaches pressure.',
    autoCompact: 'Auto compact',
    autoCompactDescription: 'Run compaction when the current posture reaches its token threshold.',
    compactModel: 'Compact model',
    compactModelDescription: 'Used for internal summary passes only.',
    longTermTitle: 'Long-term memory',
    longTermDescription: 'Keep only the long-term memory controls the runtime actually consumes.',
    longTermEnabled: 'Enable long-term memory',
    longTermEnabledDescription: 'Allow the runtime to accumulate durable user memory across sessions.',
    longTermBudget: 'Long-term memory budget',
    sessionMemoryAge: 'Session memory age',
    factTitle: 'Fact extraction',
    factDescription: 'Control the model and instructions used when stable business facts are written into memory.',
    factModel: 'Fact extraction model',
    factGuidance: 'Extraction guidance',
    factPlaceholder: 'Extract stable business facts only.',
    advancedTitle: 'Advanced engineering parameters',
    advancedDescription: 'Thresholds, retention knobs, compact temperature, circuit breaker, and custom compact prompt.',
    groups: {
      thresholds: 'Pressure thresholds',
      compaction: 'Compaction limits',
      estimation: 'Token estimation knobs',
      prompt: 'Custom compact prompt',
    },
    modes: {
      short: { label: 'Short', description: 'Prefer quick compaction for short support turns.' },
      balanced: { label: 'Balanced', description: 'Default delivery setting for most agents.' },
      long: { label: 'Long', description: 'Keep more recent context before compacting.' },
      custom: { label: 'Custom', description: 'Current thresholds no longer match a preset.' },
    },
    modeSummary: {
      tokenThreshold: 'Auto compact at',
      workingWindow: 'Keep recent working context',
      compactWindow: 'Compaction window',
      keepMinimum: 'Keep at least',
      messageUnit: 'messages',
      turnEstimate: (turns) => `approx ${turns} turns`,
    },
    fields: {
      autoCompactThreshold: 'Auto compact threshold',
      warningThreshold: 'Warning threshold',
      errorThreshold: 'Error threshold',
      blockingThreshold: 'Blocking threshold',
      l1MaxMessages: 'L1 max messages',
      compactMaxMessages: 'Compact max messages',
      keepMinimumMessages: 'Keep minimum messages',
      keepRatio: 'Keep ratio',
      compactTemperature: 'Compact temperature',
      compactMaxTokens: 'Compact max tokens',
      minimumSummaryLength: 'Minimum summary length',
      circuitBreakerFailures: 'Circuit breaker failures',
      keyEventMaxChars: 'Key event max chars',
      tokensPerKeyEvent: 'Tokens per key event',
      tokensPerFact: 'Tokens per fact',
      tokensPerTool: 'Tokens per tool',
      cjkCharsPerToken: 'CJK chars per token',
      latinCharsPerToken: 'Latin chars per token',
      minimumTokenEstimate: 'Minimum token estimate',
      toolResultTokenRatio: 'Tool result token ratio',
      contextWindow: 'Context window',
      reservedOutputTokens: 'Reserved output tokens',
      compactPrompt: 'Compact prompt',
      compactPromptPlaceholder: 'Leave empty to use the built-in compact prompt.',
    },
    units: {
      tokens: 'tokens',
      messages: 'messages',
      chars: 'chars',
      failures: 'failures',
      ms: 'ms',
    },
  },
  zh: {
    eyebrow: '构建 / 组件 / 大脑',
    pageTitle: '记忆策略',
    pageDescription: '只保留 runtime 真正使用的压缩、长期记忆与事实提取配置。',
    loadFailed: '记忆策略加载失败',
    saveDraft: '保存草稿',
    saving: '保存中',
    saved: '已保存',
    saveFailed: '保存失败',
    unsaved: '有未保存更改',
    postureTitle: '压缩策略',
    postureDescription: '决定上下文在接近压力阈值前如何被压缩和保留。',
    autoCompact: '自动压缩',
    autoCompactDescription: '达到当前策略阈值后自动运行压缩。',
    compactModel: '压缩模型',
    compactModelDescription: '仅用于内部摘要轮次。',
    longTermTitle: '长期记忆',
    longTermDescription: '这里只保留 runtime 真正消费的长期记忆控制项。',
    longTermEnabled: '启用长期记忆',
    longTermEnabledDescription: '允许 runtime 跨会话累积稳定的用户记忆。',
    longTermBudget: '长期记忆预算',
    sessionMemoryAge: '会话记忆时长',
    factTitle: '事实提取',
    factDescription: '控制稳定业务事实写入记忆时所使用的模型和附加指令。',
    factModel: '事实提取模型',
    factGuidance: '提取指引',
    factPlaceholder: '只提取稳定的业务事实。',
    advancedTitle: '高级工程参数',
    advancedDescription: '阈值、保留策略、压缩温度、熔断次数和自定义压缩提示词。',
    groups: {
      thresholds: '压力阈值',
      compaction: '压缩限制',
      estimation: 'Token 估算参数',
      prompt: '自定义压缩提示词',
    },
    modes: {
      short: { label: '短', description: '更快压缩，适合短轮次支持对话。' },
      balanced: { label: '均衡', description: '默认交付配置，适合大多数 Agent。' },
      long: { label: '长', description: '在压缩前保留更多近期上下文。' },
      custom: { label: '自定义', description: '当前阈值已不再匹配预设。' },
    },
    modeSummary: {
      tokenThreshold: '自动压缩阈值',
      workingWindow: '近期工作上下文',
      compactWindow: '压缩窗口上限',
      keepMinimum: '至少保留',
      messageUnit: '条消息',
      turnEstimate: (turns) => `约 ${turns} 轮对话`,
    },
    fields: {
      autoCompactThreshold: '自动压缩阈值',
      warningThreshold: '预警阈值',
      errorThreshold: '高压阈值',
      blockingThreshold: '阻断阈值',
      l1MaxMessages: 'L1 最大消息数',
      compactMaxMessages: '压缩最大消息数',
      keepMinimumMessages: '最少保留消息数',
      keepRatio: '保留比例',
      compactTemperature: '压缩温度',
      compactMaxTokens: '压缩最大 Token',
      minimumSummaryLength: '最小摘要长度',
      circuitBreakerFailures: '熔断失败次数',
      keyEventMaxChars: '关键事件最大字符数',
      tokensPerKeyEvent: '每条关键事件 Token',
      tokensPerFact: '每条事实 Token',
      tokensPerTool: '每个 Tool Token',
      cjkCharsPerToken: '中日韩字符 / Token',
      latinCharsPerToken: '拉丁字符 / Token',
      minimumTokenEstimate: '最小 Token 估算',
      toolResultTokenRatio: '工具结果倍率',
      contextWindow: '上下文窗口',
      reservedOutputTokens: '预留输出 Token',
      compactPrompt: '压缩提示词',
      compactPromptPlaceholder: '留空使用内置压缩提示词。',
    },
    units: {
      tokens: 'Token',
      messages: '条消息',
      chars: '字符',
      failures: '次',
      ms: '毫秒',
    },
  },
}

function renderModelOptions(models: ModelInfo[], fallbackModel: string) {
  if (!models.length) {
    return <option value={fallbackModel}>{fallbackModel}</option>
  }

  const groups = new Map<string, ModelInfo[]>()
  let hasFallback = false
  for (const model of models) {
    if (model.id === fallbackModel) hasFallback = true
    const group = groups.get(model.provider) || []
    group.push(model)
    groups.set(model.provider, group)
  }

  return (
    <>
      {!hasFallback ? <option value={fallbackModel}>{fallbackModel}</option> : null}
      {Array.from(groups.entries()).map(([provider, providerModels]) => (
        <optgroup key={provider} label={providerModels[0]?.providerLabel || provider}>
          {providerModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  )
}

function panelClass(extra = '') {
  return `rounded-[20px] border border-black/[0.08] bg-white/[0.8] shadow-[0_22px_44px_-34px_rgba(15,23,42,0.5)] ${extra}`
}

function fieldClass(extra = '') {
  return `w-full rounded-xl border border-black/[0.09] bg-white px-3 py-2.5 text-[13px] text-[var(--mist)] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] outline-none transition focus:border-[rgba(53,127,124,0.34)] focus:ring-2 focus:ring-[rgba(53,127,124,0.12)] ${extra}`
}

function headerBandClass() {
  return 'border-b border-black/[0.06] bg-[linear-gradient(135deg,rgba(53,127,124,0.08),rgba(255,255,255,0.86))]'
}

function formatTokenCount(value: number, locale: 'en' | 'zh') {
  if (value >= 1000) {
    const compact = value % 1000 === 0 ? `${value / 1000}` : `${(value / 1000).toFixed(1)}`
    return locale === 'zh' ? `${compact}k Token` : `${compact}k tokens`
  }
  return locale === 'zh' ? `${value} Token` : `${value} tokens`
}

function formatMessageTurns(messages: number, messageUnit: string, turnEstimate: (turns: number) => string) {
  const approxTurns = Math.max(1, Math.round(messages / 2))
  return `${messages} ${messageUnit} / ${turnEstimate(approxTurns)}`
}

export default function MemoryStrategyWorkspace({ embedded = false }: { embedded?: boolean }) {
  const agentId = useSelectedAgentId()
  const { orgId } = useSession()
  const { locale } = useConsoleLocale()
  const copy = MEMORY_COPY[locale]

  const [memory, setMemory] = useState<MemoryStrategyUi>(() => normalizeMemoryStrategy('{}'))
  const [primaryModel, setPrimaryModel] = useState<string>(DEFAULT_MODEL)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    setLoading(true)
    Promise.all([apiClient(`/api/admin/agent?agentId=${agentId}`), apiClient('/api/admin/models')])
      .then(([agentResult, modelsResult]) => {
        if (cancelled) return
        const raw = (agentResult.data as any).config || {}
        const modelsData = (modelsResult.data as any).models || []
        const nextMemory = normalizeMemoryStrategy(raw.memoryStrategy)
        setMemory(nextMemory)
        setModels(modelsData)
        const loadedModel =
          typeof raw.model === 'string' && raw.model.trim()
            ? raw.model.trim()
            : modelsData[0]?.id
              ? String(modelsData[0].id)
              : DEFAULT_MODEL
        setPrimaryModel(loadedModel)
        setDirty(false)
        setSaveStatus('idle')
        setError(null)
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message || copy.loadFailed)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [agentId, copy.loadFailed])

  const setMemoryField = useCallback(<K extends keyof MemoryStrategyUi>(field: K, value: MemoryStrategyUi[K]) => {
    setMemory((prev) => ({ ...prev, [field]: value }))
    setDirty(true)
    setSaveStatus('idle')
  }, [])

  const setNumberField = useCallback(
    (field: keyof MemoryStrategyUi, value: number) => {
      setMemoryField(field, value as never)
    },
    [setMemoryField],
  )

  const applyMode = useCallback((mode: Exclude<MemoryMode, 'custom'>) => {
    setMemory((prev) => applyMemoryMode(prev, mode))
    setDirty(true)
    setSaveStatus('idle')
  }, [])

  const saveMemory = useCallback(async () => {
    if (!agentId) return
    setSaveStatus('saving')
    try {
      const payload = { model: primaryModel, memoryStrategy: JSON.stringify(memory) }
      await apiClient(`/api/admin/agent?agentId=${agentId}`, {
        method: 'PUT',
        body: payload,
      })
      await bustConfigCache(orgId, agentId)
      emitAgentConfigUpdated(agentId)
      setDirty(false)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2400)
    } catch {
      setSaveStatus('error')
    }
  }, [agentId, memory, orgId, primaryModel])

  const activeMode = useMemo(() => detectMemoryMode(memory), [memory])
  const modeLabel = copy.modes[activeMode].label

  return (
    <PageLoader loading={loading} error={error} onRetry={() => window.location.reload()}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            {!embedded ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">{copy.eyebrow}</p>
            ) : null}
            <h2 className={`${embedded ? '' : 'mt-2 '}text-[24px] font-semibold tracking-tight text-[var(--mist)]`}>
              {copy.pageTitle}
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--fog)]">{copy.pageDescription}</p>
          </div>

          <div className="flex min-h-9 items-center gap-2">
            {saveStatus === 'saving' ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] px-3 py-2 text-[12px] font-medium text-[var(--color-accent-primary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {copy.saving}
              </span>
            ) : saveStatus === 'saved' ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] px-3 py-2 text-[12px] font-medium text-[var(--color-accent-primary)]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {copy.saved}
              </span>
            ) : saveStatus === 'error' ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
                <AlertCircle className="h-3.5 w-3.5" />
                {copy.saveFailed}
              </span>
            ) : dirty ? (
              <span className="rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-[12px] font-medium text-[var(--fog)]">
                {copy.unsaved}
              </span>
            ) : null}

            <button
              type="button"
              onClick={saveMemory}
              disabled={!dirty || saveStatus === 'saving'}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--color-accent-primary)] px-4 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {copy.saveDraft}
            </button>
          </div>
        </div>

        <section className={panelClass('overflow-hidden')}>
          <div className={`${headerBandClass()} flex flex-wrap items-start justify-between gap-3 px-5 py-4`}>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
                <Database className="h-4 w-4 text-[var(--color-accent-primary)]" />
                {copy.postureTitle}
              </div>
              <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-[var(--fog)]">{copy.postureDescription}</p>
            </div>
            <span className="rounded-full border border-[rgba(53,127,124,0.18)] bg-white/80 px-3 py-1 text-[11px] font-semibold text-[var(--color-accent-primary)]">
              {modeLabel}
            </span>
          </div>

          <div className="space-y-4 px-5 py-5">
            <div className="grid gap-2 lg:grid-cols-4">
              {(Object.keys(copy.modes) as MemoryMode[]).map((mode) => {
                const option = copy.modes[mode]
                const active = activeMode === mode
                const presetButton = mode !== 'custom'
                const summarySource =
                  mode === 'custom'
                    ? {
                        autocompactThresholdTokens: memory.autocompactThresholdTokens,
                        l1MaxMessages: memory.l1MaxMessages,
                        compactMaxMessages: memory.compactMaxMessages,
                        compactionKeepMin: memory.compactionKeepMin,
                      }
                    : MEMORY_MODE_PRESETS[mode]
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={!presetButton}
                    onClick={presetButton ? () => applyMode(mode as Exclude<MemoryMode, 'custom'>) : undefined}
                    className={`min-h-[92px] rounded-2xl border px-3.5 py-3 text-left transition ${
                      active
                        ? 'border-[rgba(53,127,124,0.26)] bg-[rgba(53,127,124,0.08)] text-[var(--mist)] shadow-sm'
                        : 'border-black/[0.08] bg-white/70 text-[var(--mist)] hover:border-black/[0.14] hover:bg-white'
                    } ${presetButton ? '' : 'cursor-default'}`}
                  >
                    <span className="block text-[13px] font-semibold">{option.label}</span>
                    <span className="mt-1 block text-[11px] leading-snug text-current/72">{option.description}</span>
                    <div className="mt-3 space-y-1.5 border-t border-black/[0.06] pt-2.5 text-[10px] leading-snug text-current/72">
                      <div className="flex items-start justify-between gap-3">
                        <span>{copy.modeSummary.tokenThreshold}</span>
                        <span className="text-right font-medium text-current">
                          {formatTokenCount(summarySource.autocompactThresholdTokens, locale)}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span>{copy.modeSummary.workingWindow}</span>
                        <span className="text-right font-medium text-current">
                          {formatMessageTurns(
                            summarySource.l1MaxMessages,
                            copy.modeSummary.messageUnit,
                            copy.modeSummary.turnEstimate,
                          )}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span>{copy.modeSummary.compactWindow}</span>
                        <span className="text-right font-medium text-current">
                          {formatMessageTurns(
                            summarySource.compactMaxMessages,
                            copy.modeSummary.messageUnit,
                            copy.modeSummary.turnEstimate,
                          )}
                        </span>
                      </div>
                      <div className="flex items-start justify-between gap-3">
                        <span>{copy.modeSummary.keepMinimum}</span>
                        <span className="text-right font-medium text-current">
                          {formatMessageTurns(
                            summarySource.compactionKeepMin,
                            copy.modeSummary.messageUnit,
                            copy.modeSummary.turnEstimate,
                          )}
                        </span>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
              <SwitchField
                label={copy.autoCompact}
                description={copy.autoCompactDescription}
                checked={memory.enableAutocompact}
                onChange={(checked) => setMemoryField('enableAutocompact', checked)}
              />

              <label className="rounded-2xl border border-black/[0.07] bg-white/72 px-4 py-3">
                <span className="block text-[12px] font-semibold text-[var(--mist)]">{copy.compactModel}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--fog)]">{copy.compactModelDescription}</span>
                <select
                  value={memory.compactModel}
                  onChange={(event) => setMemoryField('compactModel', event.target.value)}
                  className={fieldClass('mt-3')}
                >
                  {renderModelOptions(models, memory.compactModel)}
                </select>
              </label>
            </div>
          </div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)]">
          <section className={panelClass('overflow-hidden')}>
            <div className={`${headerBandClass()} px-5 py-4`}>
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
                <ShieldCheck className="h-4 w-4 text-[var(--color-accent-primary)]" />
                {copy.longTermTitle}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">{copy.longTermDescription}</p>
            </div>

            <div className="space-y-3 px-5 py-5">
              <SwitchField
                label={copy.longTermEnabled}
                description={copy.longTermEnabledDescription}
                checked={memory.enableChatMemory}
                onChange={(checked) => setMemoryField('enableChatMemory', checked)}
              />

              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField
                  label={copy.longTermBudget}
                  value={memory.chatMemoryMaxTokens}
                  onChange={(value) => setNumberField('chatMemoryMaxTokens', value)}
                  unit={copy.units.tokens}
                />
                <NumberField
                  label={copy.sessionMemoryAge}
                  value={memory.sessionMemoryMaxAgeMs}
                  onChange={(value) => setNumberField('sessionMemoryMaxAgeMs', value)}
                  unit={copy.units.ms}
                />
              </div>
            </div>
          </section>

          <section className={panelClass('overflow-hidden')}>
            <div className={`${headerBandClass()} px-5 py-4`}>
              <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
                <History className="h-4 w-4 text-[var(--color-accent-primary)]" />
                {copy.factTitle}
              </div>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">{copy.factDescription}</p>
            </div>

            <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <label className="rounded-2xl border border-black/[0.07] bg-white/72 px-4 py-3">
                <span className="block text-[12px] font-semibold text-[var(--mist)]">{copy.factModel}</span>
                <select
                  value={memory.factExtractionModel || memory.compactModel}
                  onChange={(event) => setMemoryField('factExtractionModel', event.target.value)}
                  className={fieldClass('mt-3')}
                >
                  {renderModelOptions(models, memory.factExtractionModel || memory.compactModel)}
                </select>
              </label>

              <label className="rounded-2xl border border-black/[0.07] bg-white/72 px-4 py-3">
                <span className="block text-[12px] font-semibold text-[var(--mist)]">{copy.factGuidance}</span>
                <textarea
                  value={memory.factExtractionPrompt || ''}
                  onChange={(event) => setMemoryField('factExtractionPrompt', event.target.value)}
                  rows={7}
                  className={fieldClass('mt-3 resize-y leading-relaxed')}
                  placeholder={copy.factPlaceholder}
                />
              </label>
            </div>
          </section>
        </div>

        <section className={panelClass('overflow-hidden')}>
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
            aria-expanded={showAdvanced}
          >
            <span className="flex min-w-0 items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-[var(--fog)]" />
              <span>
                <span className="block text-[13px] font-semibold text-[var(--mist)]">{copy.advancedTitle}</span>
                <span className="mt-0.5 block text-[11px] text-[var(--fog)]">{copy.advancedDescription}</span>
              </span>
            </span>
            {showAdvanced ? <ChevronDown className="h-4 w-4 text-[var(--fog)]" /> : <ChevronRight className="h-4 w-4 text-[var(--fog)]" />}
          </button>

          {showAdvanced ? (
            <div className="border-t border-black/[0.07] p-5">
              <div className="grid gap-5 lg:grid-cols-2">
                <AdvancedGroup title={copy.groups.thresholds}>
                  <NumberField label={copy.fields.autoCompactThreshold} value={memory.autocompactThresholdTokens} onChange={(value) => setNumberField('autocompactThresholdTokens', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.warningThreshold} value={memory.warningThresholdTokens} onChange={(value) => setNumberField('warningThresholdTokens', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.errorThreshold} value={memory.errorThresholdTokens} onChange={(value) => setNumberField('errorThresholdTokens', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.blockingThreshold} value={memory.blockingThresholdTokens} onChange={(value) => setNumberField('blockingThresholdTokens', value)} unit={copy.units.tokens} />
                </AdvancedGroup>

                <AdvancedGroup title={copy.groups.compaction}>
                  <NumberField label={copy.fields.l1MaxMessages} value={memory.l1MaxMessages} onChange={(value) => setNumberField('l1MaxMessages', value)} unit={copy.units.messages} />
                  <NumberField label={copy.fields.compactMaxMessages} value={memory.compactMaxMessages} onChange={(value) => setNumberField('compactMaxMessages', value)} unit={copy.units.messages} />
                  <NumberField label={copy.fields.keepMinimumMessages} value={memory.compactionKeepMin} onChange={(value) => setNumberField('compactionKeepMin', value)} unit={copy.units.messages} />
                  <NumberField label={copy.fields.keepRatio} value={memory.compactionKeepRatio} onChange={(value) => setNumberField('compactionKeepRatio', value)} step={0.05} min={0} max={1} />
                  <NumberField label={copy.fields.compactTemperature} value={memory.compactTemperature} onChange={(value) => setNumberField('compactTemperature', value)} step={0.1} min={0} max={1} />
                  <NumberField label={copy.fields.compactMaxTokens} value={memory.compactMaxTokensCap} onChange={(value) => setNumberField('compactMaxTokensCap', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.minimumSummaryLength} value={memory.compactMinSummaryLength} onChange={(value) => setNumberField('compactMinSummaryLength', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.circuitBreakerFailures} value={memory.compactCircuitBreakerMaxFailures} onChange={(value) => setNumberField('compactCircuitBreakerMaxFailures', value)} unit={copy.units.failures} />
                </AdvancedGroup>

                <AdvancedGroup title={copy.groups.estimation}>
                  <NumberField label={copy.fields.keyEventMaxChars} value={memory.keyEventMaxChars} onChange={(value) => setNumberField('keyEventMaxChars', value)} unit={copy.units.chars} />
                  <NumberField label={copy.fields.tokensPerKeyEvent} value={memory.tokensPerKeyEvent} onChange={(value) => setNumberField('tokensPerKeyEvent', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.tokensPerFact} value={memory.tokensPerFact} onChange={(value) => setNumberField('tokensPerFact', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.tokensPerTool} value={memory.tokensPerTool} onChange={(value) => setNumberField('tokensPerTool', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.cjkCharsPerToken} value={memory.cjkCharPerToken} onChange={(value) => setNumberField('cjkCharPerToken', value)} step={0.1} />
                  <NumberField label={copy.fields.latinCharsPerToken} value={memory.latinCharPerToken} onChange={(value) => setNumberField('latinCharPerToken', value)} step={0.1} />
                  <NumberField label={copy.fields.minimumTokenEstimate} value={memory.minTokenEstimate} onChange={(value) => setNumberField('minTokenEstimate', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.toolResultTokenRatio} value={memory.toolResultTokenRatio} onChange={(value) => setNumberField('toolResultTokenRatio', value)} step={0.1} />
                  <NumberField label={copy.fields.contextWindow} value={memory.contextWindow} onChange={(value) => setNumberField('contextWindow', value)} unit={copy.units.tokens} />
                  <NumberField label={copy.fields.reservedOutputTokens} value={memory.outputTokensReserved} onChange={(value) => setNumberField('outputTokensReserved', value)} unit={copy.units.tokens} />
                </AdvancedGroup>

                <AdvancedGroup title={copy.groups.prompt}>
                  <label className="sm:col-span-2">
                    <span className="block text-[11px] font-medium text-[var(--fog)]">{copy.fields.compactPrompt}</span>
                    <textarea
                      value={memory.compactPrompt || ''}
                      onChange={(event) => setMemoryField('compactPrompt', event.target.value)}
                      rows={10}
                      spellCheck={false}
                      className={fieldClass('mt-2 resize-y font-mono text-[12px] leading-relaxed')}
                      placeholder={copy.fields.compactPromptPlaceholder}
                    />
                  </label>
                </AdvancedGroup>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </PageLoader>
  )
}

function SwitchField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-black/[0.07] bg-white/72 px-4 py-3 transition hover:bg-white">
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold text-[var(--mist)]">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-[var(--fog)]">{description}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 shrink-0 rounded border-black/[0.18] accent-[var(--color-accent-primary)]"
      />
    </label>
  )
}

function NumberField({
  label,
  value,
  onChange,
  unit,
  min,
  max,
  step,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  unit?: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-[var(--fog)]">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(event) => onChange(parseFloat(event.target.value) || 0)}
          className={fieldClass('font-mono')}
        />
        {unit ? <span className="w-16 shrink-0 text-[10px] text-[var(--fog)]">{unit}</span> : null}
      </span>
    </label>
  )
}

function AdvancedGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/[0.07] bg-white/62 p-4">
      <h3 className="text-[12px] font-semibold text-[var(--mist)]">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}
