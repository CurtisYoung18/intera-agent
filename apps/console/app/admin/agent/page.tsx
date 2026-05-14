'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AlertCircle, Brain, Cpu, Database, Shield, FileText, Settings } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import AgentBlueprint from '@/components/admin/agent-blueprint'
import { chatApiUrl } from '@/lib/chat-api'
import type { AgentConfigData, MemoryStrategy, ModelInfo } from './types'
import { DEFAULT_MEMORY } from './types'
import { clampComposerMinDraftChars } from '@intera/shared/composer-min-draft'
import { useConsoleLocale } from '@/components/locale-provider'

type Section = 'prompt' | 'model' | 'memory' | 'policy' | 'templates' | 'advanced'

function parseStopJsonSafe(raw: unknown): string[] {
  if (!raw || typeof raw !== 'string') return []
  try {
    const j = JSON.parse(raw)
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function stopArrayToMultiline(arr: string[]): string {
  return arr.join('\n')
}

/** One stop marker per non-empty line → JSON array for DB. */
function multilineToStopJson(text: string): string {
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
  return JSON.stringify(lines.length ? lines : [])
}

export default function AgentConfigPage() {
  const { t } = useConsoleLocale()
  const [config, setConfig] = useState<AgentConfigData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  const [mainModels, setMainModels] = useState<string[]>([])
  const [activeSection, setActiveSection] = useState<Section | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const configRef = useRef(config)

  const sectionMeta = useMemo(
    () =>
      ({
        prompt: { icon: <Brain className="w-4 h-4" />, title: t('agent.section.prompt'), color: '#8b6ff5' },
        model: { icon: <Cpu className="w-4 h-4" />, title: t('agent.section.model'), color: '#5b8af7' },
        memory: { icon: <Database className="w-4 h-4" />, title: t('agent.section.memory'), color: '#d4912e' },
        policy: { icon: <Shield className="w-4 h-4" />, title: t('agent.section.policy'), color: '#2ea04a' },
        templates: { icon: <FileText className="w-4 h-4" />, title: t('agent.section.templates'), color: '#5bb8f7' },
        advanced: { icon: <Settings className="w-4 h-4" />, title: t('agent.section.advanced'), color: '#b8944c' },
      }) satisfies Record<Section, { icon: React.ReactNode; title: string; color: string }>,
    [t],
  )

  useEffect(() => {
    configRef.current = config
  }, [config])

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/agent').then((r) => {
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
        let policyHooks = '{}'
        try {
          const parsed =
            typeof raw.memoryStrategy === 'string'
              ? JSON.parse(raw.memoryStrategy || '{}')
              : raw.memoryStrategy || {}
          memoryStrategy = { ...DEFAULT_MEMORY, ...parsed }
          if (typeof memoryStrategy.notReceivedKeywords === 'string')
            memoryStrategy.notReceivedKeywords = (memoryStrategy.notReceivedKeywords as string)
              .split(',')
              .map((s: string) => s.trim())
          if (typeof memoryStrategy.compactableTools === 'string')
            memoryStrategy.compactableTools = (memoryStrategy.compactableTools as string)
              .split(',')
              .map((s: string) => s.trim())
        } catch {
          /* ignore */
        }
        try {
          policyHooks =
            typeof raw.policyHooks === 'string' ? raw.policyHooks : JSON.stringify(raw.policyHooks || {}, null, 2)
        } catch {
          policyHooks = '{}'
        }
        setConfig({
          model: raw.model || 'MiniMax-M2.70-highspeed',
          temperature: raw.temperature ?? 0.5,
          thinkingBudget: raw.thinkingBudget ?? 4096,
          maxIterations: raw.maxIterations ?? 20,
          maxOutputTokens: raw.maxOutputTokens ?? 4096,
          systemPrompt: raw.systemPrompt || '',
          toolParallelism: raw.toolParallelism ?? true,
          isConcurrencySafe: raw.isConcurrencySafe ?? true,
          showThinking: raw.showThinking ?? false,
          memoryStrategy,
          policyHooks,
          resumePrompt: raw.resumePrompt || '',
          formResponseTemplate: raw.formResponseTemplate || '',
          evaluationModel: raw.evaluationModel || '',
          intentModel: raw.intentModel || '',
          prefixContinuationEnabled: Boolean((raw as Record<string, unknown>).prefixContinuationEnabled),
          prefixContinuationChatModel:
            String((raw as Record<string, unknown>).prefixContinuationChatModel || '') || 'deepseek-chat',
          prefixContinuationBaseUrl:
            String((raw as Record<string, unknown>).prefixContinuationBaseUrl || '') || 'https://api.deepseek.com/beta',
          prefixContinuationAssistantPrefix:
            ((raw as Record<string, unknown>).prefixContinuationAssistantPrefix as string | null | undefined) ?? '',
          prefixContinuationStopText: stopArrayToMultiline(
            parseStopJsonSafe((raw as Record<string, unknown>).prefixContinuationStop),
          ),
          prefixContinuationMinDraftChars: clampComposerMinDraftChars(
            (raw as Record<string, unknown>).prefixContinuationMinDraftChars,
            4,
          ),
        })
        setMainModels((modelsData.models || []).map((m: ModelInfo) => m.id))
        setError(null)
      })
      .catch((err: Error) => setError(err.message || t('agent.loadError')))
      .finally(() => setLoading(false))
  }, [t])

  const autoSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSyncStatus('syncing')
    saveTimer.current = setTimeout(async () => {
      const current = configRef.current
      if (!current) return
      try {
        const { prefixContinuationStopText, memoryStrategy, policyHooks: ph, ...persist } = current
        const res = await fetch('/api/admin/agent', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...persist,
            policyHooks: ph,
            memoryStrategy: JSON.stringify(memoryStrategy),
            prefixContinuationStop: multilineToStopJson(prefixContinuationStopText),
          }),
        })
        if (!res.ok) throw new Error(`Save: ${res.status}`)
        const cacheBody = JSON.stringify({ customerId: 'default' })
        Promise.allSettled([
          fetch('/api/admin/config-changed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: cacheBody,
          }),
          fetch(chatApiUrl('/api/admin/config-changed'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: cacheBody,
          }),
        ]).catch(() => {})
        setSyncStatus('synced')
        setTimeout(() => setSyncStatus('idle'), 2500)
      } catch {
        setSyncStatus('error')
      }
    }, 800)
  }, [])

  const update = useCallback(
    (field: string, value: unknown) => {
      setConfig((prev) => (prev ? { ...prev, [field]: value } : null))
      autoSave()
    },
    [autoSave],
  )

  const updateMem = useCallback(
    (field: keyof MemoryStrategy, value: unknown) => {
      setConfig((prev) =>
        prev ? { ...prev, memoryStrategy: { ...prev.memoryStrategy, [field]: value } } : null,
      )
      autoSave()
    },
    [autoSave],
  )

  const u = {
    tokens: t('common.unitTokens'),
    msgs: t('common.unitMsgs'),
    cases: t('common.unitCases'),
    traces: t('common.unitTraces'),
    failures: t('common.unitFailures'),
    ms: t('common.unitMs'),
  }

  if (loading)
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[60vh] w-full rounded-2xl" />
      </div>
    )
  if (error || !config)
    return (
      <div className="p-8 max-w-lg mx-auto text-center mt-20 space-y-4">
        <AlertCircle className="w-10 h-10 text-vermillion/60 mx-auto" />
        <p className="text-[var(--fog)]">{error || t('common.failedLoad')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl bg-indigo/[0.08] border border-indigo/20 text-indigo"
        >
          {t('common.retry')}
        </button>
      </div>
    )

  const ms = config.memoryStrategy

  const modelCheckboxes: Array<[keyof AgentConfigData, string]> = [
    ['toolParallelism', 'agent.toolParallelism'],
    ['isConcurrencySafe', 'agent.concurrencySafe'],
    ['showThinking', 'agent.showThinking'],
  ]

  const memToggles: Array<[keyof MemoryStrategy, string]> = [
    ['enableAutocompact', 'agent.ms.toggleAutocompact'],
    ['enableMicrocompact', 'agent.ms.toggleMicrocompact'],
    ['enableContextCollapse', 'agent.ms.toggleContextCollapse'],
    ['enableSnip', 'agent.ms.toggleSnip'],
  ]

  return (
    <div className="flex" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="flex-1 min-w-0 overflow-hidden relative">
        <AgentBlueprint
          config={config}
          activeSection={activeSection}
          onSelectSection={(s) => setActiveSection((prev) => (prev === s ? null : s))}
          syncStatus={syncStatus}
        />
      </div>

      <div
        className={`flex-shrink-0 border-l border-black/5 bg-white/90 overflow-y-auto transition-all duration-300 ease-out ${
          activeSection ? 'w-[400px] opacity-100' : 'w-0 opacity-0 overflow-hidden'
        }`}
      >
        {activeSection && (
          <div className="p-6 animate-slide-right">
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{
                  background: `${sectionMeta[activeSection].color}15`,
                  color: sectionMeta[activeSection].color,
                }}
              >
                {sectionMeta[activeSection].icon}
              </div>
              <div>
                <h2 className="text-[15px] font-semibold">{sectionMeta[activeSection].title}</h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      syncStatus === 'synced'
                        ? 'bg-malachite'
                        : syncStatus === 'syncing'
                          ? 'bg-amber animate-breathe'
                          : 'bg-[var(--fog)]'
                    }`}
                  />
                  <span className="text-[10px] text-[var(--fog)]">
                    {syncStatus === 'synced'
                      ? t('agent.sync.saved')
                      : syncStatus === 'syncing'
                        ? t('agent.sync.saving')
                        : t('agent.sync.editing')}
                  </span>
                </div>
              </div>
            </div>

            {activeSection === 'prompt' && (
              <div className="space-y-3">
                <p className="text-[12px] text-[var(--fog)]">{t('agent.promptHelp')}</p>
                <textarea
                  value={config.systemPrompt}
                  onChange={(e) => update('systemPrompt', e.target.value)}
                  rows={22}
                  className="glass-input-console text-[13px] leading-relaxed font-mono resize-y w-full"
                />
              </div>
            )}

            {activeSection === 'model' && (
              <div className="space-y-4">
                <p className="text-[12px] text-[var(--fog)] leading-relaxed">{t('agent.modelCaseTypeNote')}</p>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('agent.modelMain')}</span>
                  <select
                    value={config.model}
                    onChange={(e) => update('model', e.target.value)}
                    className="glass-input-console text-[13px] font-mono w-full"
                  >
                    {mainModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-[var(--fog)]/70 mt-0.5 block leading-snug">
                    {t('agent.modelMainHint')}
                  </span>
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('agent.intentModel')}</span>
                  <select
                    value={config.intentModel}
                    onChange={(e) => update('intentModel', e.target.value)}
                    className="glass-input-console text-[13px] font-mono w-full"
                  >
                    <option value="">— Default (haiku) —</option>
                    {mainModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-[var(--fog)]/50 mt-0.5 block">
                    {t('agent.intentModelHint')}
                  </span>
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('agent.evaluationModel')}</span>
                  <select
                    value={config.evaluationModel}
                    onChange={(e) => update('evaluationModel', e.target.value)}
                    className="glass-input-console text-[13px] font-mono w-full"
                  >
                    <option value="">— Default (haiku) —</option>
                    {mainModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-[var(--fog)]/50 mt-0.5 block">
                    {t('agent.evaluationModelHint')}
                  </span>
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">
                    {t('agent.temperature', { n: config.temperature })}
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={config.temperature}
                    onChange={(e) => update('temperature', parseFloat(e.target.value))}
                    className="w-full accent-indigo"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label={t('agent.thinkingBudget')}
                    value={config.thinkingBudget}
                    onChange={(v) => update('thinkingBudget', v)}
                  />
                  <NumField
                    label={t('agent.maxIterations')}
                    value={config.maxIterations}
                    onChange={(v) => update('maxIterations', v)}
                  />
                  <NumField
                    label={t('agent.maxOutputTokens')}
                    value={config.maxOutputTokens}
                    onChange={(v) => update('maxOutputTokens', v)}
                    unit={u.tokens}
                  />
                </div>
                <div className="space-y-2">
                  {modelCheckboxes.map(([key, tk]) => (
                    <label key={String(key)} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!config[key]}
                        onChange={(e) => update(key, e.target.checked)}
                        className="accent-indigo rounded"
                      />
                      <span className="text-[12px] text-[var(--fog)]">{t(tk)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {activeSection === 'memory' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label={t('agent.mem.autocompact')}
                    value={ms.autocompactThresholdTokens}
                    onChange={(v) => updateMem('autocompactThresholdTokens', v)}
                    unit={u.tokens}
                  />
                  <NumField
                    label={t('agent.mem.warning')}
                    value={ms.warningThresholdTokens}
                    onChange={(v) => updateMem('warningThresholdTokens', v)}
                    unit={u.tokens}
                  />
                  <NumField
                    label={t('agent.mem.error')}
                    value={ms.errorThresholdTokens}
                    onChange={(v) => updateMem('errorThresholdTokens', v)}
                    unit={u.tokens}
                  />
                  <NumField
                    label={t('agent.mem.blocking')}
                    value={ms.blockingThresholdTokens}
                    onChange={(v) => updateMem('blockingThresholdTokens', v)}
                    unit={u.tokens}
                  />
                  <NumField
                    label={t('agent.mem.l1Max')}
                    value={ms.l1MaxMessages}
                    onChange={(v) => updateMem('l1MaxMessages', v)}
                    unit={u.msgs}
                  />
                  <NumField
                    label={t('agent.mem.l2Summary')}
                    value={ms.l2SummaryMaxTokens}
                    onChange={(v) => updateMem('l2SummaryMaxTokens', v)}
                    unit={u.tokens}
                  />
                  <NumField
                    label={t('agent.mem.l4Historical')}
                    value={ms.l4MaxHistoricalCases}
                    onChange={(v) => updateMem('l4MaxHistoricalCases', v)}
                    unit={u.cases}
                  />
                  <NumField
                    label={t('agent.mem.maxTraces')}
                    value={ms.maxRecentTraces}
                    onChange={(v) => updateMem('maxRecentTraces', v)}
                    unit={u.traces}
                  />
                </div>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('agent.mem.compactModel')}</span>
                  <select
                    value={ms.compactModel}
                    onChange={(e) => updateMem('compactModel', e.target.value)}
                    className="glass-input-console text-[13px] font-mono w-full"
                  >
                    {mainModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <NumField
                    label={t('agent.mem.compactMaxMsgs')}
                    value={ms.compactMaxMessages}
                    onChange={(v) => updateMem('compactMaxMessages', v)}
                    unit={u.msgs}
                  />
                  <NumField
                    label={t('agent.mem.compactTemp')}
                    value={ms.compactTemperature}
                    onChange={(v) => updateMem('compactTemperature', v)}
                    step={0.1}
                    min={0}
                    max={1}
                  />
                  <NumField
                    label={t('agent.mem.compactMaxTokens')}
                    value={ms.compactMaxTokensCap}
                    onChange={(v) => updateMem('compactMaxTokensCap', v)}
                    unit={u.tokens}
                  />
                  <NumField
                    label={t('agent.mem.minSummaryLen')}
                    value={ms.compactMinSummaryLength}
                    onChange={(v) => updateMem('compactMinSummaryLength', v)}
                    unit={u.tokens}
                  />
                  <NumField
                    label={t('agent.mem.keepMin')}
                    value={ms.compactionKeepMin}
                    onChange={(v) => updateMem('compactionKeepMin', v)}
                    unit={u.msgs}
                  />
                  <NumField
                    label={t('agent.mem.keepRatio')}
                    value={ms.compactionKeepRatio}
                    onChange={(v) => updateMem('compactionKeepRatio', v)}
                    step={0.1}
                    min={0}
                    max={1}
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  {memToggles.map(([key, tk]) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!ms[key]}
                        onChange={(e) => updateMem(key, e.target.checked)}
                        className="accent-amber rounded"
                      />
                      <span className="text-[12px] text-[var(--fog)]">{t(tk)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {activeSection === 'policy' && (
              <div className="space-y-3">
                <p className="text-[12px] text-[var(--fog)] leading-relaxed">{t('agent.policyLead')}</p>
                <ul className="text-[11px] text-[var(--fog)]/90 list-disc pl-4 space-y-1 leading-relaxed">
                  <li>{t('agent.policyHookPreToolDesc')}</li>
                  <li>{t('agent.policyHookPostToolDesc')}</li>
                  <li>{t('agent.policyHookPreFinalizeDesc')}</li>
                </ul>
                <p className="text-[12px] text-[var(--fog)] leading-relaxed">{t('agent.policyNamesNote')}</p>
                <p className="text-[12px] text-[var(--fog)] leading-relaxed">{t('agent.policyCaseTypeNote')}</p>
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-wide text-[var(--fog)]/60">
                    {t('agent.policyExampleLabel')}
                  </span>
                  <pre className="rounded-lg border border-black/[0.06] bg-black/[0.03] p-3 text-[11px] font-mono text-[var(--mist)] leading-relaxed overflow-x-auto whitespace-pre">
                    {t('agent.policyExampleBlock')}
                  </pre>
                </div>
                <textarea
                  value={config.policyHooks}
                  onChange={(e) => update('policyHooks', e.target.value)}
                  rows={14}
                  spellCheck={false}
                  className="glass-input-console text-[12px] font-mono resize-y w-full"
                />
              </div>
            )}

            {activeSection === 'templates' && (
              <div className="space-y-4">
                <p className="text-[12px] text-[var(--fog)] leading-relaxed">{t('agent.templatesLead')}</p>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('agent.resumePrompt')}</span>
                  <textarea
                    value={config.resumePrompt}
                    onChange={(e) => update('resumePrompt', e.target.value)}
                    rows={10}
                    className="glass-input-console text-[12px] font-mono resize-y w-full"
                  />
                  <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.resumePromptHint')}</span>
                </label>
                <label className="space-y-1.5 block">
                  <span className="text-[11px] text-[var(--fog)]">{t('agent.formResponseTemplate')}</span>
                  <textarea
                    value={config.formResponseTemplate}
                    onChange={(e) => update('formResponseTemplate', e.target.value)}
                    rows={10}
                    className="glass-input-console text-[12px] font-mono resize-y w-full"
                  />
                  <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">
                    {t('agent.formResponseTemplateHint')}
                  </span>
                </label>
              </div>
            )}

            {activeSection === 'advanced' && (
              <div className="space-y-5">
                {/* Composer assist — compact */}
                <div className="rounded-xl border border-black/[0.06] bg-white/[0.35] px-4 py-3 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={config.prefixContinuationEnabled}
                        onClick={() => update('prefixContinuationEnabled', !config.prefixContinuationEnabled)}
                        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                          config.prefixContinuationEnabled ? 'bg-indigo' : 'bg-black/[0.12]'
                        }`}
                      >
                        <span
                          className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                            config.prefixContinuationEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-[var(--mist)]">{t('agent.prefixToggle')}</p>
                        <p className="text-[10px] text-[var(--smoke)] mt-0.5 leading-snug">{t('agent.prefixSubtitle')}</p>
                      </div>
                    </div>
                  </div>
                  <p className="text-[10px] text-[var(--fog)] border-t border-black/[0.05] pt-2">{t('agent.prefixEnvHint')}</p>
                  {config.prefixContinuationEnabled && (
                    <div className="space-y-3 border-t border-black/[0.06] pt-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="space-y-1 block">
                          <span className="text-[11px] text-[var(--fog)]">{t('agent.prefixBaseUrl')}</span>
                          <input
                            type="text"
                            value={config.prefixContinuationBaseUrl}
                            onChange={(e) => update('prefixContinuationBaseUrl', e.target.value)}
                            className="glass-input-console text-[12px] font-mono w-full"
                            spellCheck={false}
                          />
                        </label>
                        <label className="space-y-1 block">
                          <span className="text-[11px] text-[var(--fog)]">{t('agent.prefixChatModel')}</span>
                          <input
                            type="text"
                            value={config.prefixContinuationChatModel}
                            onChange={(e) => update('prefixContinuationChatModel', e.target.value)}
                            className="glass-input-console text-[13px] font-mono w-full"
                            spellCheck={false}
                          />
                        </label>
                      </div>
                      <NumField
                        label={t('agent.prefixMinDraft')}
                        hint={t('agent.prefixMinDraftHint')}
                        value={config.prefixContinuationMinDraftChars}
                        onChange={(v) => update('prefixContinuationMinDraftChars', clampComposerMinDraftChars(v, 4))}
                        min={1}
                        max={120}
                        step={1}
                      />
                      <label className="space-y-1 block">
                        <span className="text-[11px] text-[var(--fog)]">{t('agent.prefixComposerNotes')}</span>
                        <textarea
                          value={config.prefixContinuationAssistantPrefix}
                          onChange={(e) => update('prefixContinuationAssistantPrefix', e.target.value)}
                          rows={3}
                          className="glass-input-console text-[12px] resize-y w-full leading-relaxed"
                          placeholder=""
                        />
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-[11px] text-[var(--fog)]">{t('agent.prefixStop')}</span>
                        <textarea
                          value={config.prefixContinuationStopText}
                          onChange={(e) => update('prefixContinuationStopText', e.target.value)}
                          rows={2}
                          className="glass-input-console text-[12px] font-mono resize-y w-full"
                        />
                      </label>
                    </div>
                  )}
                </div>

                {/* Memory compaction heuristics */}
                <div className="space-y-3">
                  <div>
                    <p className="text-[12px] font-medium text-[var(--mist)]">{t('agent.advancedEstimationTitle')}</p>
                    <p className="text-[10px] text-[var(--smoke)] mt-1 leading-snug">{t('agent.advancedEstimationLead')}</p>
                  </div>
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-[var(--fog)]">{t('agent.txnIdPattern')}</span>
                    <p className="text-[10px] text-[var(--smoke)] leading-snug">{t('agent.hint.txnIdPattern')}</p>
                    <input
                      type="text"
                      value={ms.txnIdPattern}
                      onChange={(e) => updateMem('txnIdPattern', e.target.value)}
                      className="glass-input-console text-[13px] font-mono w-full"
                    />
                  </label>
                  <label className="space-y-1 block">
                    <span className="text-[11px] text-[var(--fog)]">{t('agent.amountPattern')}</span>
                    <p className="text-[10px] text-[var(--smoke)] leading-snug">{t('agent.hint.amountPattern')}</p>
                    <input
                      type="text"
                      value={ms.amountPattern}
                      onChange={(e) => updateMem('amountPattern', e.target.value)}
                      className="glass-input-console text-[13px] font-mono w-full"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <NumField
                      label={t('agent.tokensKeyEvent')}
                      hint={t('agent.hint.tokensKeyEvent')}
                      value={ms.tokensPerKeyEvent}
                      onChange={(v) => updateMem('tokensPerKeyEvent', v)}
                    />
                    <NumField
                      label={t('agent.tokensFact')}
                      hint={t('agent.hint.tokensFact')}
                      value={ms.tokensPerFact}
                      onChange={(v) => updateMem('tokensPerFact', v)}
                    />
                    <NumField
                      label={t('agent.tokensSkill')}
                      hint={t('agent.hint.tokensSkill')}
                      value={ms.tokensPerSkill}
                      onChange={(v) => updateMem('tokensPerSkill', v)}
                    />
                    <NumField
                      label={t('agent.cjkCharToken')}
                      hint={t('agent.hint.cjkCharToken')}
                      value={ms.cjkCharPerToken}
                      onChange={(v) => updateMem('cjkCharPerToken', v)}
                      step={0.1}
                    />
                    <NumField
                      label={t('agent.latinCharToken')}
                      hint={t('agent.hint.latinCharToken')}
                      value={ms.latinCharPerToken}
                      onChange={(v) => updateMem('latinCharPerToken', v)}
                      step={0.1}
                    />
                    <NumField
                      label={t('agent.minTokenEst')}
                      hint={t('agent.hint.minTokenEst')}
                      value={ms.minTokenEstimate}
                      onChange={(v) => updateMem('minTokenEstimate', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.toolResultRatio')}
                      hint={t('agent.hint.toolResultRatio')}
                      value={ms.toolResultTokenRatio}
                      onChange={(v) => updateMem('toolResultTokenRatio', v)}
                      step={0.1}
                    />
                    <NumField
                      label={t('agent.contextWindow')}
                      hint={t('agent.hint.contextWindow')}
                      value={ms.contextWindow}
                      onChange={(v) => updateMem('contextWindow', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.outputReserved')}
                      hint={t('agent.hint.outputReserved')}
                      value={ms.outputTokensReserved}
                      onChange={(v) => updateMem('outputTokensReserved', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.circuitBreaker')}
                      hint={t('agent.hint.circuitBreaker')}
                      value={ms.compactCircuitBreakerMaxFailures}
                      onChange={(v) => updateMem('compactCircuitBreakerMaxFailures', v)}
                      unit={u.failures}
                    />
                    <NumField
                      label={t('agent.sessionMaxAge')}
                      hint={t('agent.hint.sessionMaxAge')}
                      value={ms.sessionMemoryMaxAgeMs}
                      onChange={(v) => updateMem('sessionMemoryMaxAgeMs', v)}
                      unit={u.ms}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
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
          className="glass-input-console text-[13px] font-mono w-full"
        />
        {unit && <span className="text-[10px] text-[var(--smoke)] flex-shrink-0">{unit}</span>}
      </div>
    </label>
  )
}
