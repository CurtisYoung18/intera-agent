'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  FlaskConical,
  History,
  Loader2,
  MessageSquareText,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Wrench,
} from 'lucide-react'
import { DEFAULT_MEMORY } from '@/app/admin/agent/types'
import type { ModelInfo } from '@/app/admin/agent/types'
import { PageLoader } from '@/components/ui/page-loader'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import { useSelectedAgentId } from '@/components/admin/version-context-bar'
import {
  applyMemoryMode,
  detectMemoryMode,
  normalizeMemoryStrategy,
  runCompactFixture,
  type CompactFixtureResult,
  type MemoryMode,
  type MemoryStrategyUi,
  type PreserveField,
} from './memory-strategy-utils'

type BrainMemorySection = 'memory' | 'profile' | 'compact-test'

const MEMORY_SECTIONS: Array<{
  id: BrainMemorySection
  label: string
  description: string
  icon: typeof Database
}> = [
  {
    id: 'memory',
    label: 'Memory',
    description: 'Strategy, preservation rules, and extraction behavior.',
    icon: Database,
  },
  {
    id: 'profile',
    label: 'Profile',
    description: 'Long-term profile memory and promotion policy.',
    icon: UserRound,
  },
  {
    id: 'compact-test',
    label: 'Compact Test',
    description: 'Dry-run a fixture before delivery staff publish anything.',
    icon: FlaskConical,
  },
]

const MODE_OPTIONS: Array<{
  id: MemoryMode
  label: string
  description: string
}> = [
  { id: 'short', label: 'Short', description: 'Prefer quick compaction for short support turns.' },
  { id: 'balanced', label: 'Balanced', description: 'Default delivery setting for most agents.' },
  { id: 'long', label: 'Long', description: 'Keep more recent context before compacting.' },
  { id: 'custom', label: 'Custom', description: 'Advanced thresholds were edited manually.' },
]

const PRESERVE_RULES: Array<{
  field: PreserveField
  label: string
  description: string
  icon: typeof BadgeCheck
}> = [
  {
    field: 'preserveFacts',
    label: 'Business facts',
    description: 'Confirmed facts about the customer, case, transaction, or stated need.',
    icon: BadgeCheck,
  },
  {
    field: 'preserveToolEvidence',
    label: 'Tool evidence',
    description: 'Tool source, result status, freshness, and lookup payload needed for audit.',
    icon: Wrench,
  },
  {
    field: 'preserveProcedureProgress',
    label: 'Procedure progress',
    description: 'procedureRun and current step stay in working memory, not confirmedFacts.',
    icon: History,
  },
  {
    field: 'preserveHumanHandoffStatus',
    label: 'Human handoff status',
    description: 'Handoff reason, target group, and waiting state remain visible.',
    icon: MessageSquareText,
  },
  {
    field: 'preserveProfileSignals',
    label: 'User profile signals',
    description: 'Stable preference and identity signals may feed long-term profile memory.',
    icon: UserRound,
  },
]

const SAMPLE_OPTIONS = [
  {
    id: 'deposit-handoff',
    label: 'Deposit investigation with handoff',
    text:
      'User: My deposit of 500 USDT is missing. Member ID vip_2048.\n' +
      'Agent: I will check the latest deposit record.\n' +
      'Tool get_latest_deposit result: transaction txn_7781 is pending provider confirmation, amount 500 USDT, updated 4 minutes ago.\n' +
      'Procedure step verify_deposit: evidence collected, waiting for provider status.\n' +
      'Agent: I found the pending transaction and will transfer this to the payments group.\n' +
      'Human handoff: waiting_human, group Payments, reason provider confirmation required.',
  },
  {
    id: 'profile-preference',
    label: 'Profile preference and resolved case',
    text:
      'User: Please reply in Vietnamese next time. My registered email is player@example.com.\n' +
      'Agent: I will keep the preference after confirming it.\n' +
      'Tool query_user_profile result: email verified, preferred language not set.\n' +
      'Procedure step collect_profile_signal: stable preference confirmed by user answer.\n' +
      'Agent: I updated the support note and resolved this case.',
  },
]

function statusTone(status: CompactFixtureResult['checks'][number]['status']) {
  if (status === 'preserved') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'disabled') return 'border-zinc-200 bg-zinc-50 text-zinc-600'
  return 'border-amber-200 bg-amber-50 text-amber-800'
}

function boolLabel(value: boolean | undefined) {
  return value === false ? 'Off' : 'On'
}

function renderModelOptions(models: ModelInfo[], fallbackModel: string) {
  if (!models.length) {
    return <option value={fallbackModel}>{fallbackModel}</option>
  }

  const groups = new Map<string, ModelInfo[]>()
  for (const model of models) {
    const group = groups.get(model.provider) || []
    group.push(model)
    groups.set(model.provider, group)
  }

  return Array.from(groups.entries()).map(([provider, providerModels]) => (
    <optgroup key={provider} label={providerModels[0]?.providerLabel || provider}>
      {providerModels.map((model) => (
        <option key={model.id} value={model.id}>
          {model.name}
        </option>
      ))}
    </optgroup>
  ))
}

function panelClass(extra = '') {
  return `rounded-lg border border-black/[0.08] bg-white/[0.74] shadow-[0_18px_40px_-34px_rgba(15,23,42,0.5)] ${extra}`
}

function fieldClass(extra = '') {
  return `w-full rounded-lg border border-black/[0.09] bg-white px-3 py-2 text-[13px] text-[var(--mist)] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] outline-none transition focus:border-cyan-500/40 focus:ring-2 focus:ring-cyan-500/15 ${extra}`
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toLocaleString() : '0'
}

export default function MemoryStrategyWorkspace({
  initialSection = 'memory',
}: {
  initialSection?: BrainMemorySection
}) {
  const agentId = useSelectedAgentId()
  const { orgId } = useSession()

  const [section, setSection] = useState<BrainMemorySection>(initialSection)
  const [memory, setMemory] = useState<MemoryStrategyUi>(() => normalizeMemoryStrategy(DEFAULT_MEMORY))
  const [memoryMode, setMemoryMode] = useState<MemoryMode>('balanced')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [selectedSampleId, setSelectedSampleId] = useState(SAMPLE_OPTIONS[0].id)
  const [sample, setSample] = useState(SAMPLE_OPTIONS[0].text)
  const [compactResult, setCompactResult] = useState<CompactFixtureResult | null>(null)

  useEffect(() => {
    setSection(initialSection)
  }, [initialSection])

  useEffect(() => {
    if (!agentId) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      apiClient(`/api/admin/agent?agentId=${agentId}`),
      apiClient('/api/admin/models'),
    ])
      .then(([agentResult, modelsResult]) => {
        if (cancelled) return
        const raw = (agentResult.data as any).config || {}
        const nextMemory = normalizeMemoryStrategy(raw.memoryStrategy)
        setMemory(nextMemory)
        setMemoryMode(detectMemoryMode(nextMemory))
        setModels((modelsResult.data as any).models || [])
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

  const setMemoryField = useCallback(
    <K extends keyof MemoryStrategyUi>(field: K, value: MemoryStrategyUi[K], affectsMode = false) => {
      setMemory((prev) => {
        const next = { ...prev, [field]: value }
        if (affectsMode) setMemoryMode(detectMemoryMode(next))
        return next
      })
      setDirty(true)
      setSaveStatus('idle')
      setCompactResult(null)
    },
    [],
  )

  const setNumberField = useCallback(
    (field: keyof MemoryStrategyUi, value: number, affectsMode = false) => {
      setMemoryField(field, value as never, affectsMode)
    },
    [setMemoryField],
  )

  const applyMode = useCallback(
    (mode: MemoryMode) => {
      if (mode === 'custom') {
        setMemoryMode('custom')
        return
      }
      setMemory((prev) => applyMemoryMode(prev, mode))
      setMemoryMode(mode)
      setDirty(true)
      setSaveStatus('idle')
      setCompactResult(null)
    },
    [],
  )

  const saveMemory = useCallback(async () => {
    if (!agentId) return
    setSaveStatus('saving')
    try {
      await apiClient(`/api/admin/agent?agentId=${agentId}`, {
        method: 'PUT',
        body: { memoryStrategy: JSON.stringify(memory) },
      })
      await bustConfigCache(orgId)
      setDirty(false)
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2400)
    } catch {
      setSaveStatus('error')
    }
  }, [agentId, memory, orgId])

  const runTest = useCallback(() => {
    setCompactResult(runCompactFixture(sample, memory))
  }, [memory, sample])

  const activeMode = useMemo(() => detectMemoryMode(memory), [memory])

  return (
    <PageLoader loading={loading} error={error} onRetry={() => window.location.reload()}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--fog)]">
              Build / Components / Brain
            </p>
            <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-[var(--mist)]">
              Brain workspace
            </h1>
            <p className="mt-2 text-[13px] leading-relaxed text-[var(--fog)]">
              Configure how this agent preserves business memory, keeps procedure runtime state,
              and proves compaction behavior before a delivery package goes live.
            </p>
          </div>
          <div className="flex min-h-9 items-center gap-2">
            {saveStatus === 'saving' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Saving
              </span>
            ) : saveStatus === 'saved' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800">
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
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--mist)] px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[var(--mist)]/90 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saveStatus === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save draft
            </button>
          </div>
        </div>

        <div className="grid gap-2 rounded-lg border border-black/[0.08] bg-white/65 p-1 sm:grid-cols-3">
          {MEMORY_SECTIONS.map((item) => {
            const active = section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`flex min-h-[68px] items-start gap-3 rounded-md px-3 py-2.5 text-left transition ${
                  active ? 'bg-white shadow-sm ring-1 ring-black/[0.08]' : 'hover:bg-white/70'
                }`}
              >
                <item.icon className={`mt-0.5 h-4 w-4 ${active ? 'text-cyan-700' : 'text-[var(--fog)]'}`} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[var(--mist)]">{item.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-[var(--fog)]">{item.description}</span>
                </span>
              </button>
            )
          })}
        </div>

        {section === 'memory' ? (
          <MemoryPanel
            memory={memory}
            memoryMode={memoryMode}
            activeMode={activeMode}
            models={models}
            showAdvanced={showAdvanced}
            setShowAdvanced={setShowAdvanced}
            applyMode={applyMode}
            setMemoryField={setMemoryField}
            setNumberField={setNumberField}
          />
        ) : null}

        {section === 'profile' ? (
          <ProfilePanel
            memory={memory}
            setMemoryField={setMemoryField}
            setNumberField={setNumberField}
          />
        ) : null}

        {section === 'compact-test' ? (
          <CompactTestPanel
            memory={memory}
            selectedSampleId={selectedSampleId}
            setSelectedSampleId={setSelectedSampleId}
            sample={sample}
            setSample={setSample}
            compactResult={compactResult}
            runTest={runTest}
          />
        ) : null}
      </div>
    </PageLoader>
  )
}

function MemoryPanel({
  memory,
  memoryMode,
  activeMode,
  models,
  showAdvanced,
  setShowAdvanced,
  applyMode,
  setMemoryField,
  setNumberField,
}: {
  memory: MemoryStrategyUi
  memoryMode: MemoryMode
  activeMode: MemoryMode
  models: ModelInfo[]
  showAdvanced: boolean
  setShowAdvanced: (value: boolean) => void
  applyMode: (mode: MemoryMode) => void
  setMemoryField: <K extends keyof MemoryStrategyUi>(field: K, value: MemoryStrategyUi[K], affectsMode?: boolean) => void
  setNumberField: (field: keyof MemoryStrategyUi, value: number, affectsMode?: boolean) => void
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
      <section className={panelClass('p-5')}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
              <Database className="h-4 w-4 text-cyan-700" />
              Memory Mode
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">
              Choose the delivery posture first. Raw thresholds stay in Advanced for engineering review.
            </p>
          </div>
          {memoryMode === 'custom' || activeMode === 'custom' ? (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800">
              Custom
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          {MODE_OPTIONS.map((option) => {
            const active = memoryMode === option.id || (option.id === 'custom' && activeMode === 'custom')
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => applyMode(option.id)}
                className={`min-h-[94px] rounded-lg border px-3 py-3 text-left transition ${
                  active
                    ? 'border-cyan-600/35 bg-cyan-50 text-cyan-950 shadow-sm'
                    : 'border-black/[0.08] bg-white/70 text-[var(--mist)] hover:border-black/[0.14] hover:bg-white'
                }`}
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
            description="Run compaction when the selected memory mode reaches pressure."
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
              Used only for internal summary passes. It does not replace the customer-facing model.
            </span>
          </label>
        </div>
      </section>

      <section className={panelClass('p-5')}>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
          <ShieldCheck className="h-4 w-4 text-cyan-700" />
          Preserve rules
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">
          These are the memories delivery staff inspect after compacting. Runtime state stays separate from business facts.
        </p>
        <div className="mt-4 space-y-2">
          {PRESERVE_RULES.map((rule) => (
            <label
              key={rule.field}
              className="flex cursor-pointer gap-3 rounded-lg border border-black/[0.07] bg-white/70 px-3 py-3 transition hover:bg-white"
            >
              <input
                type="checkbox"
                checked={memory[rule.field] !== false}
                onChange={(event) => setMemoryField(rule.field, event.target.checked)}
                className="mt-1 h-4 w-4 rounded border-black/[0.18] accent-cyan-700"
              />
              <rule.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--fog)]" />
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[var(--mist)]">
                  {rule.label}
                  <span className="rounded-md bg-black/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-[var(--fog)]">
                    {boolLabel(memory[rule.field])}
                  </span>
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-[var(--fog)]">{rule.description}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className={panelClass('p-5 xl:col-span-2')}>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
              <BadgeCheck className="h-4 w-4 text-cyan-700" />
              Fact extraction rules
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">
              Business facts come from user extraction, form answers, tool-result mapping, and human-task answers.
              P0 exposes controlled memory writes through remember(scope=&quot;chat&quot; | &quot;user&quot;), not a free-form fact recorder.
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
              placeholder="Extract stable business facts only. Keep procedureRun, tool runtime state, and handoff queue state out of confirmedFacts."
            />
            <span className="block text-[11px] leading-snug text-[var(--fog)]">
              confirmedFacts are business facts. Procedure runtime state belongs to structured working memory.
            </span>
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
                Thresholds, token estimation knobs, compact temperature, circuit breaker, and custom compact prompt.
              </span>
            </span>
          </span>
          {showAdvanced ? <ChevronDown className="h-4 w-4 text-[var(--fog)]" /> : <ChevronRight className="h-4 w-4 text-[var(--fog)]" />}
        </button>

        {showAdvanced ? (
          <div className="border-t border-black/[0.07] p-5">
            <div className="grid gap-5 lg:grid-cols-2">
              <AdvancedGroup title="Pressure thresholds">
                <NumberField label="Auto compact threshold" value={memory.autocompactThresholdTokens} onChange={(value) => setNumberField('autocompactThresholdTokens', value, true)} unit="tokens" />
                <NumberField label="Warning threshold" value={memory.warningThresholdTokens} onChange={(value) => setNumberField('warningThresholdTokens', value)} unit="tokens" />
                <NumberField label="Error threshold" value={memory.errorThresholdTokens} onChange={(value) => setNumberField('errorThresholdTokens', value)} unit="tokens" />
                <NumberField label="Blocking threshold" value={memory.blockingThresholdTokens} onChange={(value) => setNumberField('blockingThresholdTokens', value)} unit="tokens" />
              </AdvancedGroup>

              <AdvancedGroup title="Compaction limits">
                <NumberField label="L1 max messages" value={memory.l1MaxMessages} onChange={(value) => setNumberField('l1MaxMessages', value, true)} unit="messages" />
                <NumberField label="Compact max messages" value={memory.compactMaxMessages} onChange={(value) => setNumberField('compactMaxMessages', value, true)} unit="messages" />
                <NumberField label="Keep minimum messages" value={memory.compactionKeepMin} onChange={(value) => setNumberField('compactionKeepMin', value, true)} unit="messages" />
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
                  className={fieldClass('resize-y font-mono text-[12px] leading-relaxed')}
                  placeholder="Leave empty to use the built-in compact prompt."
                />
              </AdvancedGroup>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function ProfilePanel({
  memory,
  setMemoryField,
  setNumberField,
}: {
  memory: MemoryStrategyUi
  setMemoryField: <K extends keyof MemoryStrategyUi>(field: K, value: MemoryStrategyUi[K], affectsMode?: boolean) => void
  setNumberField: (field: keyof MemoryStrategyUi, value: number, affectsMode?: boolean) => void
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className={panelClass('p-5')}>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
          <UserRound className="h-4 w-4 text-cyan-700" />
          Long-term profile memory
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">
          Profile memory is for stable user signals. It is separate from ProcedureRun confirmedFacts and procedure runtime state.
        </p>
        <div className="mt-4 space-y-3">
          <SwitchField
            label="Long-term memory"
            description="Accumulate compact summaries into a persistent user profile."
            checked={memory.enableChatMemory}
            onChange={(checked) => setMemoryField('enableChatMemory', checked)}
          />
          <NumberField
            label="Historical ProcedureRun load"
            value={memory.l4MaxHistoricalCases}
            onChange={(value) => setNumberField('l4MaxHistoricalCases', value)}
            unit="runs"
          />
          <NumberField
            label="Profile memory budget"
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

      <section className={panelClass('p-5')}>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
          <BadgeCheck className="h-4 w-4 text-cyan-700" />
          Profile promotion rules
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">
          First slice: keep this as operator-readable promotion rules stored on memoryStrategy.
        </p>
        <textarea
          value={memory.profilePromotionRules || ''}
          onChange={(event) => setMemoryField('profilePromotionRules', event.target.value)}
          rows={10}
          className={fieldClass('mt-4 resize-y leading-relaxed')}
        />
        <div className="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-3 text-[12px] leading-relaxed text-cyan-950">
          Promote profile memory from repeated user confirmation, verified form answers, tool-result mapping,
          or human-task answers. Do not promote transient procedureRun or queue state.
        </div>
      </section>
    </div>
  )
}

function CompactTestPanel({
  memory,
  selectedSampleId,
  setSelectedSampleId,
  sample,
  setSample,
  compactResult,
  runTest,
}: {
  memory: MemoryStrategyUi
  selectedSampleId: string
  setSelectedSampleId: (value: string) => void
  sample: string
  setSample: (value: string) => void
  compactResult: CompactFixtureResult | null
  runTest: () => void
}) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.85fr)]">
      <section className={panelClass('p-5')}>
        <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
          <FlaskConical className="h-4 w-4 text-cyan-700" />
          Compact Test
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-[var(--fog)]">
          Local fixture only. This dry run uses the current unsaved memoryStrategy in the browser and does not publish, activate, or call a backend compact route.
        </p>

        <label className="mt-4 block space-y-1.5">
          <span className="text-[12px] font-medium text-[var(--mist)]">Conversation sample</span>
          <select
            value={selectedSampleId}
            onChange={(event) => {
              const next = event.target.value
              setSelectedSampleId(next)
              const fixture = SAMPLE_OPTIONS.find((option) => option.id === next)
              if (fixture) setSample(fixture.text)
            }}
            className={fieldClass()}
          >
            {SAMPLE_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
            <option value="custom">Custom pasted sample</option>
          </select>
        </label>

        <textarea
          aria-label="Compact test sample"
          value={sample}
          onChange={(event) => {
            setSelectedSampleId('custom')
            setSample(event.target.value)
          }}
          rows={12}
          className={fieldClass('mt-3 resize-y font-mono text-[12px] leading-relaxed')}
        />

        <button
          type="button"
          onClick={runTest}
          className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-cyan-700 px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-cyan-800"
        >
          <FlaskConical className="h-3.5 w-3.5" />
          Run compact test
        </button>
      </section>

      <section className={panelClass('p-5')}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--mist)]">
            <ShieldCheck className="h-4 w-4 text-cyan-700" />
            Preservation result
          </div>
          <span className="rounded-md border border-black/[0.08] bg-white px-2 py-1 text-[11px] text-[var(--fog)]">
            {boolLabel(memory.enableAutocompact)} auto compact
          </span>
        </div>

        {compactResult ? (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <ResultMetric
                label="Before"
                value={`${formatNumber(compactResult.before.approxTokens)} tokens`}
                detail={`${compactResult.before.messages} sample lines`}
              />
              <ResultMetric
                label="After"
                value={`${formatNumber(compactResult.after.approxTokens)} tokens`}
                detail="local fixture summary"
              />
            </div>

            <div className="rounded-lg border border-black/[0.07] bg-white/72 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--fog)]">Before summary</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--mist)]">{compactResult.before.summary}</p>
            </div>
            <div className="rounded-lg border border-black/[0.07] bg-white/72 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--fog)]">After summary</p>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--mist)]">{compactResult.after.summary}</p>
            </div>

            <div className="space-y-2">
              {compactResult.checks.map((check) => (
                <div key={check.key} className={`rounded-lg border px-3 py-2 ${statusTone(check.status)}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold">{check.label}</span>
                    <span className="rounded-md bg-white/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]">
                      {check.status}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-snug text-current/75">{check.detail}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-black/[0.16] bg-white/60 px-4 py-8 text-center">
            <FlaskConical className="mx-auto h-5 w-5 text-[var(--fog)]" />
            <p className="mt-2 text-[13px] font-semibold text-[var(--mist)]">No compact test run yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-[var(--fog)]">
              Run the local fixture to compare before and after summaries and inspect preservation rules.
            </p>
          </div>
        )}
      </section>
    </div>
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
        className="h-4 w-4 shrink-0 rounded border-black/[0.18] accent-cyan-700"
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

function ResultMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-black/[0.07] bg-white/72 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--fog)]">{label}</p>
      <p className="mt-1 text-[16px] font-semibold text-[var(--mist)]">{value}</p>
      <p className="mt-0.5 text-[11px] text-[var(--fog)]">{detail}</p>
    </div>
  )
}
