'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertCircle, CheckCircle2, Database, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { useConsoleLocale } from '@/components/locale-provider'
import { drawerFieldClass, DrawerCheckboxRail, DrawerSection, DrawerShell } from '@/components/admin/agent-config-drawer-ui'

import type { MemoryStrategy as MemStrategy, ModelInfo } from '@/app/admin/agent/types'
import { DEFAULT_MEMORY } from '@/app/admin/agent/types'

type MemoryTier = 'short' | 'balanced' | 'long' | 'custom'

const TIER_LABELS: Record<MemoryTier, string> = {
  short: 'Short-term',
  balanced: 'Balanced',
  long: 'Long-term',
  custom: 'Custom',
}

interface TierPreset {
  autocompactThresholdTokens: number
  compactionKeepMin: number
  l1MaxMessages: number
}

const TIER_PRESETS: Record<Exclude<MemoryTier, 'custom'>, TierPreset> = {
  short: { autocompactThresholdTokens: 20000, compactionKeepMin: 4, l1MaxMessages: 8 },
  balanced: { autocompactThresholdTokens: 40000, compactionKeepMin: 8, l1MaxMessages: 20 },
  long: { autocompactThresholdTokens: 80000, compactionKeepMin: 16, l1MaxMessages: 40 },
}

function detectMemoryTier(ms: MemStrategy): MemoryTier {
  for (const tier of ['short', 'balanced', 'long'] as const) {
    const p = TIER_PRESETS[tier]
    if (
      ms.autocompactThresholdTokens === p.autocompactThresholdTokens &&
      ms.compactionKeepMin === p.compactionKeepMin &&
      ms.l1MaxMessages === p.l1MaxMessages
    ) {
      return tier
    }
  }
  return 'custom'
}

export default function MemoryPage() {
  const { t } = useConsoleLocale()
  const agentId = useSelectedAgentId()

  const [memory, setMemory] = useState<MemStrategy>(DEFAULT_MEMORY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mainModels, setMainModels] = useState<ModelInfo[]>([])
  const [memoryTier, setMemoryTier] = useState<MemoryTier>('balanced')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const memRef = useRef(memory)

  useEffect(() => {
    memRef.current = memory
  }, [memory])

  useEffect(() => {
    if (!agentId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/admin/agent?agentId=${agentId}`).then((r) => {
        if (!r.ok) throw new Error(`Config: ${r.status}`)
        return r.json()
      }),
      fetch('/api/admin/models').then((r) => {
        if (!r.ok) throw new Error(`Models: ${r.status}`)
        return r.json()
      }),
    ])
      .then(([agentData, modelsData]) => {
        const raw = agentData.config || {}
        let memoryStrategy = DEFAULT_MEMORY
        try {
          const parsed =
            typeof raw.memoryStrategy === 'string'
              ? JSON.parse(raw.memoryStrategy || '{}')
              : raw.memoryStrategy || {}
          memoryStrategy = { ...DEFAULT_MEMORY, ...parsed }
          if (typeof memoryStrategy.compactableTools === 'string')
            memoryStrategy.compactableTools = (memoryStrategy.compactableTools as string)
              .split(',')
              .map((s: string) => s.trim())
        } catch { /* ignore */ }
        setMemory(memoryStrategy)
        setMemoryTier(detectMemoryTier(memoryStrategy))
        setMainModels(modelsData.models || [])
        setError(null)
      })
      .catch((err: Error) => setError(err.message || t('common.failedLoad')))
      .finally(() => setLoading(false))
  }, [agentId, t])

  const autoSave = useCallback(() => {
    if (!agentId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSyncStatus('syncing')
    saveTimer.current = setTimeout(async () => {
      const current = memRef.current
      try {
        const res = await fetch(`/api/admin/agent?agentId=${agentId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memoryStrategy: JSON.stringify(current) }),
        })
        if (!res.ok) throw new Error(`Save: ${res.status}`)
        fetch('/api/admin/config-changed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId: 'default' }),
        }).catch(() => {})
        setSyncStatus('synced')
        setTimeout(() => setSyncStatus('idle'), 2500)
      } catch {
        setSyncStatus('error')
      }
    }, 800)
  }, [agentId])

  const updateMem = useCallback(
    (field: string, value: unknown) => {
      setMemory((prev) => ({ ...prev, [field]: value }))
      setMemoryTier('custom')
      autoSave()
    },
    [autoSave],
  )

  const applyTierPreset = useCallback(
    (tier: MemoryTier) => {
      if (tier === 'custom') return
      const preset = TIER_PRESETS[tier]
      setMemory((prev) => ({ ...prev, ...preset }))
      setMemoryTier(tier)
      autoSave()
    },
    [autoSave],
  )

  function renderModelOptions(models: ModelInfo[]) {
    const groups = new Map<string, ModelInfo[]>()
    for (const m of models) {
      const g = groups.get(m.provider) || []
      g.push(m)
      groups.set(m.provider, g)
    }
    return Array.from(groups.entries()).map(([provider, ms]) => (
      <optgroup key={provider} label={ms[0]?.providerLabel || provider}>
        {ms.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </optgroup>
    ))
  }

  const u = {
    tokens: t('common.unitTokens'),
    msgs: t('common.unitMsgs'),
    cases: t('common.unitCases'),
    traces: t('common.unitTraces'),
    failures: t('common.unitFailures'),
    ms: t('common.unitMs'),
  }

  const memToggles: Array<[keyof MemStrategy, string, string]> = [
    ['enableAutocompact', 'memory.toggleAutocompact', 'memory.hintAutocompact'],
    ['enableMicrocompact', 'memory.toggleMicrocompact', 'memory.hintMicrocompact'],
    ['enableContextCollapse', 'memory.toggleContextCollapse', 'memory.hintContextCollapse'],
    ['enableSnip', 'memory.toggleSnip', 'memory.hintSnip'],
    ['enableChatMemory', 'memory.toggleChatMemory', 'memory.hintChatMemory'],
  ]

  if (loading) {
    return (
      <div>
        <VersionContextBar />
        <div className="p-8 space-y-4">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-[60vh] w-full rounded-2xl" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <VersionContextBar />
        <div className="p-8 max-w-lg mx-auto text-center mt-20 space-y-4">
          <AlertCircle className="w-10 h-10 text-vermillion/60 mx-auto" />
          <p className="text-[var(--fog)]">{error}</p>
          <button type="button" onClick={() => window.location.reload()} className="px-5 py-2.5 rounded-xl bg-indigo/[0.08] border border-indigo/20 text-indigo">
            {t('common.retry')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <VersionContextBar />

      <div className="px-8 py-8 animate-fade-up">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(212,145,46,0.15), rgba(212,145,46,0.05))', color: '#d4912e' }}>
                <Database className="w-4 h-4" />
              </div>
              <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('memPage.title')}</h1>
            </div>
            <p className="text-[13px] text-[var(--fog)] mt-0.5">{t('memory.subtitle')}</p>
          </div>

        </div>

        {/* Save status bar */}
        {syncStatus !== 'idle' && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2 w-fit">
            {syncStatus === 'syncing' ? (
              <><Loader2 className="w-3 h-3 animate-spin text-amber" /><span className="text-[11px] font-medium text-amber">{t('memPage.saving')}</span></>
            ) : syncStatus === 'synced' ? (
              <><CheckCircle2 className="w-3 h-3 text-malachite" /><span className="text-[11px] font-medium text-malachite">{t('memPage.saved')}</span></>
            ) : syncStatus === 'error' ? (
              <><AlertCircle className="w-3 h-3 text-vermillion" /><span className="text-[11px] font-medium text-vermillion">{t('common.saveError')}</span></>
            ) : null}
          </div>
        )}

        <DrawerShell>
          {/* ── Memory tier slider ── */}
          <DrawerSection
            accent="#d4912e"
            title={t('memory.tiers')}
            lead={t('memory.tiersLead')}
          >
            <div className="flex rounded-xl border border-black/[0.08] bg-black/[0.02] p-1 gap-1">
              {(['short', 'balanced', 'long'] as const).map((tier) => {
                const isActive = memoryTier === tier
                const isCustom = memoryTier === 'custom'
                return (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => applyTierPreset(tier)}
                    className={`flex-1 rounded-lg px-3 py-2 text-[12px] font-medium transition-all ${
                      isActive
                        ? 'bg-[#d4912e] text-white shadow-sm'
                        : isCustom
                          ? 'text-[var(--fog)] hover:bg-black/[0.04]'
                          : 'text-[var(--fog)] hover:bg-black/[0.04]'
                    }`}
                  >
                    {t(`memory.tier${tier.charAt(0).toUpperCase() + tier.slice(1)}` as any) || TIER_LABELS[tier]}
                  </button>
                )
              })}
            </div>
            {memoryTier === 'custom' && (
              <p className="text-[10px] text-[var(--fog)]/60 mt-1.5 px-1">
                {t('memory.tierCustom')} — advanced fields have been manually edited
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 mt-2 text-[10px] text-[var(--fog)]/70 px-1">
              <span>Autocompact: {memory.autocompactThresholdTokens.toLocaleString()} tokens</span>
              <span>Keep: {memory.compactionKeepMin} msgs</span>
              <span>L1 max: {memory.l1MaxMessages} msgs</span>
            </div>

            {/* Advanced toggle */}
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 mt-3 text-[11px] font-medium text-[var(--fog)] hover:text-[var(--mist)] transition-colors"
            >
              {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              {t('memory.advanced')}
            </button>
          </DrawerSection>

          {/* ── Advanced fields ── */}
          {showAdvanced && (
            <>
              <DrawerSection accent="#d4912e" title={t('memory.thresholds')}>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label={t('memory.autocompact')} hint={t('agent.mem.hint.autocompact')} value={memory.autocompactThresholdTokens} onChange={(v) => updateMem('autocompactThresholdTokens', v)} unit={u.tokens} />
                  <NumField label={t('memory.warning')} hint={t('agent.mem.hint.warning')} value={memory.warningThresholdTokens} onChange={(v) => updateMem('warningThresholdTokens', v)} unit={u.tokens} />
                  <NumField label={t('memory.error')} hint={t('agent.mem.hint.error')} value={memory.errorThresholdTokens} onChange={(v) => updateMem('errorThresholdTokens', v)} unit={u.tokens} />
                  <NumField label={t('memory.blocking')} hint={t('agent.mem.hint.blocking')} value={memory.blockingThresholdTokens} onChange={(v) => updateMem('blockingThresholdTokens', v)} unit={u.tokens} />
                  <NumField label={t('memory.l1Max')} hint={t('agent.mem.hint.l1Max')} value={memory.l1MaxMessages} onChange={(v) => updateMem('l1MaxMessages', v)} unit={u.msgs} />
                  <NumField label={t('memory.l2Summary')} hint={t('agent.mem.hint.l2Summary')} value={memory.l2SummaryMaxTokens} onChange={(v) => updateMem('l2SummaryMaxTokens', v)} unit={u.tokens} />
                  <NumField label={t('memory.l4Historical')} hint={t('agent.mem.hint.l4Historical')} value={memory.l4MaxHistoricalCases} onChange={(v) => updateMem('l4MaxHistoricalCases', v)} unit={u.cases} />
                  <NumField label={t('memory.maxTraces')} hint={t('agent.mem.hint.maxTraces')} value={memory.maxRecentTraces} onChange={(v) => updateMem('maxRecentTraces', v)} unit={u.traces} />
                </div>
              </DrawerSection>

              <DrawerSection accent="#d4912e" title={t('memory.compaction')} lead={t('memory.compactionLead')}>
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-medium text-[var(--fog)]">{t('memory.compactModel')}</span>
                  <select
                    value={memory.compactModel}
                    onChange={(e) => updateMem('compactModel', e.target.value)}
                    className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                  >
                    {renderModelOptions(mainModels)}
                  </select>
                  <span className="block text-[10px] leading-snug text-[var(--smoke)]">{t('memory.compactModelHint')}</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <NumField label={t('memory.compactMaxMsgs')} hint={t('agent.mem.hint.compactMaxMsgs')} value={memory.compactMaxMessages} onChange={(v) => updateMem('compactMaxMessages', v)} unit={u.msgs} />
                  <NumField label={t('memory.compactTemp')} hint={t('agent.mem.hint.compactTemp')} value={memory.compactTemperature} onChange={(v) => updateMem('compactTemperature', v)} step={0.1} min={0} max={1} />
                  <NumField label={t('memory.compactMaxTokens')} hint={t('agent.mem.hint.compactMaxTokens')} value={memory.compactMaxTokensCap} onChange={(v) => updateMem('compactMaxTokensCap', v)} unit={u.tokens} />
                  <NumField label={t('memory.minSummaryLen')} hint={t('agent.mem.hint.minSummaryLen')} value={memory.compactMinSummaryLength} onChange={(v) => updateMem('compactMinSummaryLength', v)} unit={u.tokens} />
                  <NumField label={t('memory.keepMin')} hint={t('agent.mem.hint.keepMin')} value={memory.compactionKeepMin} onChange={(v) => updateMem('compactionKeepMin', v)} unit={u.msgs} />
                  <NumField label={t('memory.keepRatio')} hint={t('agent.mem.hint.keepRatio')} value={memory.compactionKeepRatio} onChange={(v) => updateMem('compactionKeepRatio', v)} step={0.1} min={0} max={1} />
                </div>
                <DrawerCheckboxRail accent="#d4912e" layout="stack">
                  {memToggles.map(([key, tk, hintKey]) => (
                    <label key={key} className="flex cursor-pointer gap-3 rounded-xl border border-black/[0.04] bg-white/25 px-2.5 py-2 hover:bg-white/45">
                      <input
                        type="checkbox"
                        checked={!!memory[key]}
                        onChange={(e) => updateMem(key, e.target.checked)}
                        className="accent-amber mt-0.5 shrink-0 rounded"
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block text-[12px] font-medium text-[var(--mist)]">{t(tk)}</span>
                        <span className="block text-[10px] leading-snug text-[var(--smoke)]">{t(hintKey)}</span>
                      </span>
                    </label>
                  ))}
                </DrawerCheckboxRail>
                <NumField
                  label={t('memory.microcompactMinAge')}
                  hint={t('memory.hintMicrocompactMinAge')}
                  value={memory.microcompactMinAgeMs ?? 300000}
                  onChange={(v) => updateMem('microcompactMinAgeMs', v)}
                  unit={u.ms}
                />
                <NumField
                  label={t('memory.chatMemoryMaxTokens')}
                  hint={t('memory.hintChatMemoryMaxTokens')}
                  value={memory.chatMemoryMaxTokens ?? 4000}
                  onChange={(v) => updateMem('chatMemoryMaxTokens', v)}
                  unit={u.tokens}
                />
                <label className="block space-y-1.5">
                  <span className="text-[11px] font-medium text-[var(--fog)]">{t('memory.compactPrompt')}</span>
                  <textarea
                    value={memory.compactPrompt ?? ''}
                    onChange={(e) => updateMem('compactPrompt', e.target.value)}
                    rows={6}
                    spellCheck={false}
                    className="w-full px-3 py-2 text-[12px] font-mono border border-black/[0.08] rounded-xl bg-white outline-none focus:border-amber/30 resize-y"
                    placeholder={t('memory.compactPromptPlaceholder')}
                  />
                  <span className="block text-[10px] leading-snug text-[var(--smoke)]">{t('memory.compactPromptHint')}</span>
                </label>
              </DrawerSection>
            </>
          )}
        </DrawerShell>
      </div>
    </div>
  )
}

function NumField({
  label,
  hint,
  value,
  onChange,
  unit,
  min,
  max,
  step,
}: {
  label: string
  hint?: string
  value: number
  onChange: (v: number) => void
  unit?: string
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-[var(--fog)]">{label}</span>
      {hint ? <p className="text-[10px] text-[var(--smoke)] leading-snug -mt-0.5">{hint}</p> : null}
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          min={min}
          max={max}
          step={step}
          className={`glass-input-console w-full font-mono ${drawerFieldClass(true)}`}
        />
        {unit && <span className="text-[10px] text-[var(--smoke)] flex-shrink-0">{unit}</span>}
      </div>
    </label>
  )
}
