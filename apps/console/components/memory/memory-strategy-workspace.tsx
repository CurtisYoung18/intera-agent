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
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { emitAgentConfigUpdated } from '@/lib/agent-config-events'
import { useSession } from '@/lib/hooks/use-session'
import { useSelectedAgentId } from '@/components/admin/version-context-bar'
import {
  applyMemoryMode,
  detectMemoryMode,
  normalizeMemoryStrategy,
  type MemoryMode,
  type MemoryStrategyUi,
} from './memory-strategy-utils'

const MODE_OPTIONS: Array<{
  id: MemoryMode
  label: string
  description: string
}> = [
  { id: 'short', label: 'Short', description: 'Prefer quick compaction for short support turns.' },
  { id: 'balanced', label: 'Balanced', description: 'Default delivery setting for most agents.' },
  { id: 'long', label: 'Long', description: 'Keep more recent context before compacting.' },
  { id: 'custom', label: 'Custom', description: 'Current thresholds no longer match a preset.' },
]

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
  return `rounded-lg border border-black/[0.08] bg-white/[0.74] shadow-[0_18px_40px_-34px_rgba(15,23,42,0.5)] ${extra}`
}

function fieldClass(extra = '') {
  return `w-full rounded-lg border border-black/[0.09] bg-white px-3 py-2 text-[13px] text-[var(--mist)] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] outline-none transition focus:border-[rgba(53,127,124,0.34)] focus:ring-2 focus:ring-[rgba(53,127,124,0.12)] ${extra}`
}

export default function MemoryStrategyWorkspace({ embedded = false }: { embedded?: boolean }) {
  const agentId = useSelectedAgentId()
  const { orgId } = useSession()

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
        if (!cancelled) setError(err.message || 'Failed to load memory strategy')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [agentId])

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

  return (
    <PageLoader loading={loading} error={error} onRetry={() => window.location.reload()}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            {!embedded ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">
                Build / Components / Brain
              </p>
            ) : null}
            <h2 className={`${embedded ? '' : 'mt-2 '}text-[24px] font-semibold tracking-tight text-[var(--mist)]`}>
              Memory strategy
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--fog)]">
              Tune compaction, long-term memory, and fact extraction with runtime-backed controls only.
            </p>
          </div>

          <div className="flex min-h-9 items-center gap-2">
            {saveStatus === 'saving' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] px-3 py-2 text-[12px] font-medium text-[var(--color-accent-primary)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving
              </span>
            ) : saveStatus === 'saved' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(53,127,124,0.18)] bg-[rgba(53,127,124,0.08)] px-3 py-2 text-[12px] font-medium text-[var(--color-accent-primary)]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved
              </span>
            ) : saveStatus === 'error' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
                <AlertCircle className="h-3.5 w-3.5" />
                Save failed
              </span>
            ) : dirty ? (
              <span className="rounded-lg border border-black/[0.08] bg-white px-3 py-2 text-[12px] font-medium text-[var(--fog)]">
                Unsaved changes
              </span>
            ) : null}

            <button
              type="button"
              onClick={saveMemory}
              disabled={!dirty || saveStatus === 'saving'}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--color-accent-primary)] px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save draft
            </button>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <section className={panelClass('p-5')}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
                  <Database className="h-4 w-4 text-[var(--color-accent-primary)]" />
                  Compaction posture
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">
                  Choose how aggressively the agent compacts working context before it reaches pressure.
                </p>
              </div>
              <span className="rounded-md border border-[rgba(53,127,124,0.16)] bg-[rgba(53,127,124,0.08)] px-2 py-1 text-[11px] font-medium text-[var(--color-accent-primary)]">
                {activeMode === 'custom' ? 'Custom' : activeMode}
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {MODE_OPTIONS.map((option) => {
                const active = activeMode === option.id
                const presetButton = option.id !== 'custom'
                return (
                  <button
                    key={option.id}
                    type="button"
                    disabled={!presetButton}
                    onClick={presetButton ? () => applyMode(option.id as Exclude<MemoryMode, 'custom'>) : undefined}
                    className={`min-h-[94px] rounded-lg border px-3 py-3 text-left transition ${
                      active
                        ? 'border-[rgba(53,127,124,0.24)] bg-[rgba(53,127,124,0.08)] text-[var(--mist)] shadow-sm'
                        : 'border-black/[0.08] bg-white/70 text-[var(--mist)] hover:border-black/[0.14] hover:bg-white'
                    } ${presetButton ? '' : 'cursor-default'}`}
                  >
                    <span className="block text-[13px] font-semibold">{option.label}</span>
                    <span className="mt-1 block text-[11px] leading-snug text-current/70">{option.description}</span>
                  </button>
                )
              })}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              <SwitchField
                label="Auto compact"
                description="Run compaction when the current posture reaches its token threshold."
                checked={memory.enableAutocompact}
                onChange={(checked) => setMemoryField('enableAutocompact', checked)}
              />

              <label className="space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--mist)]">Compact model</span>
                <select
                  value={memory.compactModel}
                  onChange={(event) => setMemoryField('compactModel', event.target.value)}
                  className={fieldClass()}
                >
                  {renderModelOptions(models, memory.compactModel)}
                </select>
                <span className="block text-[11px] leading-snug text-[var(--fog)]">
                  Used for internal summary passes only.
                </span>
              </label>
            </div>
          </section>

          <section className={panelClass('p-5')}>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
              <ShieldCheck className="h-4 w-4 text-[var(--color-accent-primary)]" />
              Long-term memory
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">
              Keep only the real long-term memory controls that the runtime actually consumes.
            </p>

            <div className="mt-4 space-y-3">
              <SwitchField
                label="Enable long-term memory"
                description="Allow the runtime to accumulate durable user memory across sessions."
                checked={memory.enableChatMemory}
                onChange={(checked) => setMemoryField('enableChatMemory', checked)}
              />

              <NumberField
                label="Long-term memory budget"
                value={memory.chatMemoryMaxTokens}
                onChange={(value) => setNumberField('chatMemoryMaxTokens', value)}
                unit="tokens"
              />

              <NumberField
                label="Session memory age"
                value={memory.sessionMemoryMaxAgeMs}
                onChange={(value) => setNumberField('sessionMemoryMaxAgeMs', value)}
                unit="ms"
              />
            </div>
          </section>

          <section className={panelClass('p-5 xl:col-span-2')}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div>
                <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
                  <History className="h-4 w-4 text-[var(--color-accent-primary)]" />
                  Fact extraction
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">
                  Control the model and instructions used when stable business facts are written into memory.
                </p>

                <label className="mt-4 block space-y-1.5">
                  <span className="text-[12px] font-medium text-[var(--mist)]">Fact extraction model</span>
                  <select
                    value={memory.factExtractionModel || memory.compactModel}
                    onChange={(event) => setMemoryField('factExtractionModel', event.target.value)}
                    className={fieldClass()}
                  >
                    {renderModelOptions(models, memory.factExtractionModel || memory.compactModel)}
                  </select>
                </label>
              </div>

              <label className="block space-y-1.5">
                <span className="text-[12px] font-medium text-[var(--mist)]">Extraction guidance</span>
                <textarea
                  value={memory.factExtractionPrompt || ''}
                  onChange={(event) => setMemoryField('factExtractionPrompt', event.target.value)}
                  rows={7}
                  className={fieldClass('resize-y leading-relaxed')}
                  placeholder="Extract stable business facts only."
                />
              </label>
            </div>
          </section>

          <section className={panelClass('xl:col-span-2')}>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left"
              aria-expanded={showAdvanced}
            >
              <span className="flex min-w-0 items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-[var(--fog)]" />
                <span>
                  <span className="block text-[13px] font-semibold text-[var(--mist)]">Advanced engineering parameters</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--fog)]">
                    Thresholds, retention knobs, compact temperature, circuit breaker, and custom compact prompt.
                  </span>
                </span>
              </span>
              {showAdvanced ? <ChevronDown className="h-4 w-4 text-[var(--fog)]" /> : <ChevronRight className="h-4 w-4 text-[var(--fog)]" />}
            </button>

            {showAdvanced ? (
              <div className="border-t border-black/[0.07] p-5">
                <div className="grid gap-5 lg:grid-cols-2">
                  <AdvancedGroup title="Pressure thresholds">
                    <NumberField label="Auto compact threshold" value={memory.autocompactThresholdTokens} onChange={(value) => setNumberField('autocompactThresholdTokens', value)} unit="tokens" />
                    <NumberField label="Warning threshold" value={memory.warningThresholdTokens} onChange={(value) => setNumberField('warningThresholdTokens', value)} unit="tokens" />
                    <NumberField label="Error threshold" value={memory.errorThresholdTokens} onChange={(value) => setNumberField('errorThresholdTokens', value)} unit="tokens" />
                    <NumberField label="Blocking threshold" value={memory.blockingThresholdTokens} onChange={(value) => setNumberField('blockingThresholdTokens', value)} unit="tokens" />
                  </AdvancedGroup>

                  <AdvancedGroup title="Compaction limits">
                    <NumberField label="L1 max messages" value={memory.l1MaxMessages} onChange={(value) => setNumberField('l1MaxMessages', value)} unit="messages" />
                    <NumberField label="Compact max messages" value={memory.compactMaxMessages} onChange={(value) => setNumberField('compactMaxMessages', value)} unit="messages" />
                    <NumberField label="Keep minimum messages" value={memory.compactionKeepMin} onChange={(value) => setNumberField('compactionKeepMin', value)} unit="messages" />
                    <NumberField label="Keep ratio" value={memory.compactionKeepRatio} onChange={(value) => setNumberField('compactionKeepRatio', value)} step={0.05} min={0} max={1} />
                    <NumberField label="Compact temperature" value={memory.compactTemperature} onChange={(value) => setNumberField('compactTemperature', value)} step={0.1} min={0} max={1} />
                    <NumberField label="Compact max tokens" value={memory.compactMaxTokensCap} onChange={(value) => setNumberField('compactMaxTokensCap', value)} unit="tokens" />
                    <NumberField label="Minimum summary length" value={memory.compactMinSummaryLength} onChange={(value) => setNumberField('compactMinSummaryLength', value)} unit="tokens" />
                    <NumberField label="Circuit breaker failures" value={memory.compactCircuitBreakerMaxFailures} onChange={(value) => setNumberField('compactCircuitBreakerMaxFailures', value)} unit="failures" />
                  </AdvancedGroup>

                  <AdvancedGroup title="Token estimation knobs">
                    <NumberField label="Key event max chars" value={memory.keyEventMaxChars} onChange={(value) => setNumberField('keyEventMaxChars', value)} unit="chars" />
                    <NumberField label="Tokens per key event" value={memory.tokensPerKeyEvent} onChange={(value) => setNumberField('tokensPerKeyEvent', value)} unit="tokens" />
                    <NumberField label="Tokens per fact" value={memory.tokensPerFact} onChange={(value) => setNumberField('tokensPerFact', value)} unit="tokens" />
                    <NumberField label="Tokens per tool" value={memory.tokensPerTool} onChange={(value) => setNumberField('tokensPerTool', value)} unit="tokens" />
                    <NumberField label="CJK chars per token" value={memory.cjkCharPerToken} onChange={(value) => setNumberField('cjkCharPerToken', value)} step={0.1} />
                    <NumberField label="Latin chars per token" value={memory.latinCharPerToken} onChange={(value) => setNumberField('latinCharPerToken', value)} step={0.1} />
                    <NumberField label="Minimum token estimate" value={memory.minTokenEstimate} onChange={(value) => setNumberField('minTokenEstimate', value)} unit="tokens" />
                    <NumberField label="Tool result token ratio" value={memory.toolResultTokenRatio} onChange={(value) => setNumberField('toolResultTokenRatio', value)} step={0.1} />
                    <NumberField label="Context window" value={memory.contextWindow} onChange={(value) => setNumberField('contextWindow', value)} unit="tokens" />
                    <NumberField label="Reserved output tokens" value={memory.outputTokensReserved} onChange={(value) => setNumberField('outputTokensReserved', value)} unit="tokens" />
                  </AdvancedGroup>

                  <AdvancedGroup title="Custom compact prompt">
                    <textarea
                      value={memory.compactPrompt || ''}
                      onChange={(event) => setMemoryField('compactPrompt', event.target.value)}
                      rows={10}
                      spellCheck={false}
                      className={fieldClass('resize-y font-mono text-[12px] leading-relaxed sm:col-span-2')}
                      placeholder="Leave empty to use the built-in compact prompt."
                    />
                  </AdvancedGroup>
                </div>
              </div>
            ) : null}
          </section>
        </div>
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
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-black/[0.07] bg-white/70 px-3 py-3 transition hover:bg-white">
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
    <div className="rounded-lg border border-black/[0.07] bg-white/62 p-4">
      <h3 className="text-[12px] font-semibold text-[var(--mist)]">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  )
}
