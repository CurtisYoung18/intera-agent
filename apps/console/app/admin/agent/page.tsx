'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AlertCircle, Brain, Cpu, Database, Shield, FileText, Search, X } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import HighlightedTextarea from '@/components/admin/highlighted-textarea'
import AgentBlueprint from '@/components/admin/agent-blueprint'
import AgentPolicyHooksPicker from '@/components/admin/agent-policy-hooks-picker'
import AgentHumanInteractionPanel from '@/components/admin/agent-human-interaction-panel'
import {
  DrawerCheckboxRail,
  DrawerSection,
  DrawerShell,
  drawerFieldClass,
} from '@/components/admin/agent-config-drawer-ui'
import { chatApiUrl } from '@/lib/chat-api'
import type { AgentConfigData, KnowledgeRetrievalConfig, MemoryStrategy, ModelInfo } from './types'
import { DEFAULT_KNOWLEDGE_RETRIEVAL, DEFAULT_MEMORY } from './types'
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_CONSULTATION_PROMPT } from '@intera/shared/defaults'
import { clampComposerMinDraftChars } from '@intera/shared/composer-min-draft'
import { useConsoleLocale } from '@/components/locale-provider'

type Section = 'prompt' | 'model' | 'memory' | 'policy' | 'templates' | 'knowledge'

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
        templates: { icon: <FileText className="w-4 h-4" />, title: t('agent.section.humanOps'), color: '#5bb8f7' },
        knowledge: { icon: <Search className="w-4 h-4" />, title: t('agent.section.knowledge'), color: '#14b8a6' },
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
        let knowledgeRetrieval: typeof DEFAULT_KNOWLEDGE_RETRIEVAL = { ...DEFAULT_KNOWLEDGE_RETRIEVAL }
        try {
          const kbRaw = (raw as Record<string, unknown>).knowledgeRetrieval
          if (kbRaw) {
            const parsed = typeof kbRaw === 'string' ? JSON.parse(kbRaw as string) : kbRaw
            knowledgeRetrieval = { ...DEFAULT_KNOWLEDGE_RETRIEVAL, ...parsed }
          }
        } catch { /* use default */ }

        setConfig({
          model: raw.model || 'MiniMax-M2.7-highspeed',
          temperature: raw.temperature ?? 0.5,
          thinkingBudget: raw.thinkingBudget ?? 4096,
          maxIterations: raw.maxIterations ?? 20,
          maxOutputTokens: raw.maxOutputTokens ?? 4096,
          systemPrompt: raw.systemPrompt || '',
          showThinking: raw.showThinking ?? false,
          memoryStrategy,
          policyHooks,
          resumePrompt: raw.resumePrompt || '',
          formResponseTemplate: raw.formResponseTemplate || '',
          humanSkills: raw.humanSkills || '',
          consultationPrompt: raw.consultationPrompt || DEFAULT_CONSULTATION_PROMPT,
          debugMode: Boolean(raw.debugMode),
          enableLlmSanitization: Boolean((raw as Record<string, unknown>).enableLlmSanitization),
          evaluationModel: raw.evaluationModel || '',
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
          knowledgeRetrieval,
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
        const { prefixContinuationStopText, memoryStrategy, policyHooks: ph, knowledgeRetrieval: kb, ...persist } = current
        const res = await fetch('/api/admin/agent', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...persist,
            policyHooks: ph,
            memoryStrategy: JSON.stringify(memoryStrategy),
            knowledgeRetrieval: JSON.stringify(kb),
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

  const updateKb = useCallback(
    (field: keyof KnowledgeRetrievalConfig, value: unknown) => {
      setConfig((prev) =>
        prev ? { ...prev, knowledgeRetrieval: { ...prev.knowledgeRetrieval, [field]: value } } : null,
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
    ['showThinking', 'agent.showThinking'],
    ['enableLlmSanitization', 'agent.enableLlmSanitization'],
  ]

  const memToggles: Array<[keyof MemoryStrategy, string, string]> = [
    ['enableAutocompact', 'agent.ms.toggleAutocompact', 'agent.ms.hintAutocompact'],
    ['enableMicrocompact', 'agent.ms.toggleMicrocompact', 'agent.ms.hintMicrocompact'],
    ['enableContextCollapse', 'agent.ms.toggleContextCollapse', 'agent.ms.hintContextCollapse'],
    ['enableSnip', 'agent.ms.toggleSnip', 'agent.ms.hintSnip'],
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
        className={`relative flex flex-col flex-shrink-0 self-stretch h-full min-h-0 overflow-hidden transition-all duration-300 ease-out ${
          activeSection
            ? 'w-[480px] opacity-100 border-l border-black/[0.05] bg-transparent'
            : 'w-0 opacity-0 border-transparent shadow-none pointer-events-none'
        }`}
      >
        {/* Left accent rail */}
        <div
          aria-hidden
          className={`absolute left-0 top-10 bottom-10 w-[3px] rounded-full transition-opacity duration-300 ${
            activeSection ? 'opacity-70' : 'opacity-0'
          }`}
          style={{
            background: activeSection
              ? `linear-gradient(180deg, ${sectionMeta[activeSection].color}aa 0%, ${sectionMeta[activeSection].color}22 52%, transparent 100%)`
              : undefined,
          }}
        />

        {activeSection && (
          <div className="relative z-[1] flex flex-col flex-1 min-h-0 animate-slide-right">
            <header className="mx-4 mt-4 mb-2 flex flex-shrink-0 items-start justify-between gap-3 rounded-2xl border border-white/55 bg-white/[0.38] px-4 py-3.5 shadow-[0_12px_36px_-28px_rgba(15,23,42,0.45)] backdrop-blur-xl backdrop-saturate-[1.15]">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ring-4 ring-white/50 shadow-sm"
                  style={{
                    background: `linear-gradient(135deg, ${sectionMeta[activeSection].color}22 0%, ${sectionMeta[activeSection].color}08 100%)`,
                    color: sectionMeta[activeSection].color,
                  }}
                >
                  {sectionMeta[activeSection].icon}
                </div>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-[var(--mist)]">
                    {sectionMeta[activeSection].title}
                  </h2>
                  <div className="flex items-center gap-1.5 mt-1">
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
              <button
                type="button"
                onClick={() => setActiveSection(null)}
                className="shrink-0 rounded-xl p-2 text-[var(--fog)] hover:bg-black/[0.06] hover:text-[var(--mist)] transition-colors"
                title={t('agent.drawerClose')}
                aria-label={t('agent.drawerClose')}
              >
                <X className="w-4 h-4" />
              </button>
            </header>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pb-3 pt-0">
              <div
                className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain"
                style={
                  syncStatus === 'syncing' && activeSection
                    ? {
                        boxShadow: `inset 0 0 0 1px ${sectionMeta[activeSection].color}40`,
                        borderRadius: '14px',
                      }
                    : undefined
                }
              >
                <DrawerShell>
            {activeSection === 'prompt' && (
              <DrawerSection
                accent="#8b6ff5"
                eyebrow={t('agent.promptEyebrow')}
                title={t('agent.section.prompt')}
                lead={t('agent.promptHelp')}
                actions={
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('agent.promptResetConfirm')))
                        update('systemPrompt', DEFAULT_SYSTEM_PROMPT)
                    }}
                    className="rounded-full border border-lavender/30 bg-white/70 px-3.5 py-1.5 text-[11px] font-semibold text-lavender shadow-sm hover:bg-lavender/15"
                  >
                    {t('agent.promptResetDefault')}
                  </button>
                }
              >
                <div className="flex flex-col gap-3">
                  <HighlightedTextarea
                    id="system-prompt-textarea"
                    value={config.systemPrompt}
                    onChange={(v) => update('systemPrompt', v)}
                    spellCheck={false}
                    className={`w-full ${drawerFieldClass(true)}`}
                    highlights={[
                      { pattern: /\{\{case_types\}\}/g, color: '#7c5ce7' },
                      { pattern: /\{\{active_policies\}\}/g, color: '#e75c8a' },
                      { pattern: /\{\{case_schema\}\}/g, color: '#2ea04a' },
                      { pattern: /\{\{case_state\}\}/g, color: '#d4912e' },
                      { pattern: /\{\{session_binding\}\}/g, color: '#5b8af7' },
                    ]}
                  />
                  <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-black/[0.05] bg-black/[0.02] px-3 py-2.5 text-[10px] text-[var(--fog)]/60">
                    <span className="mr-1 font-medium text-[var(--fog)]/80">{t('agent.promptPlaceholders')}</span>
                    {[
                      { key: '{{case_types}}', desc: t('agent.plhCaseTypes') },
                      { key: '{{active_policies}}', desc: t('agent.plhPolicies') },
                      { key: '{{case_schema}}', desc: t('agent.plhCaseSchema') },
                      { key: '{{case_state}}', desc: t('agent.plhCaseState') },
                      { key: '{{session_binding}}', desc: t('agent.plhSessionBinding') },
                    ].map((ph) => (
                      <button
                        key={ph.key}
                        type="button"
                        title={ph.desc}
                        onClick={() => {
                          const ta = document.getElementById('system-prompt-textarea') as HTMLTextAreaElement | null
                          if (!ta) { update('systemPrompt', (config.systemPrompt + '\n' + ph.key).trimStart()); return }
                          const start = ta.selectionStart ?? ta.value.length
                          const end = ta.selectionEnd ?? start
                          const next = ta.value.slice(0, start) + ph.key + ta.value.slice(end)
                          update('systemPrompt', next)
                          requestAnimationFrame(() => {
                            const el = document.getElementById('system-prompt-textarea') as HTMLTextAreaElement | null
                            if (el) { el.selectionStart = el.selectionEnd = start + ph.key.length; el.focus() }
                          })
                        }}
                        className="rounded-full border border-black/[0.06] bg-white/70 px-2 py-0.5 font-mono text-[10px] leading-relaxed hover:bg-lavender/15 hover:border-lavender/30 transition-colors"
                      >
                        {ph.key}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/[0.05] bg-black/[0.02] px-3 py-2 text-[10px] text-[var(--fog)]/75">
                    <span>{t('agent.promptAutosaveHint')}</span>
                    <span className="font-mono tabular-nums opacity-95">
                      {t('agent.promptCharCount', { n: config.systemPrompt?.length ?? 0 })}
                    </span>
                  </div>
                </div>
              </DrawerSection>
            )}

            {activeSection === 'model' && (
              <>
                <DrawerSection
                  accent="#5b8af7"
                  title={t('agent.section.model')}
                  lead={t('agent.modelCaseTypeNote')}
                >
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.modelMain')}</span>
                    <select
                      value={config.model}
                      onChange={(e) => update('model', e.target.value)}
                      className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                    >
                      {mainModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.modelMainHint')}</span>
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.evaluationModel')}</span>
                    <select
                      value={config.evaluationModel}
                      onChange={(e) => update('evaluationModel', e.target.value)}
                      className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                    >
                      <option value="">— Default (haiku) —</option>
                      {mainModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <span className="text-[10px] text-[var(--fog)]/55 leading-snug block">
                      {t('agent.evaluationModelHint')}
                    </span>
                  </label>
                </DrawerSection>
                <DrawerSection accent="#5b8af7" title={t('agent.drawer.perfTitle')}>
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] font-medium text-[var(--fog)]">
                      {t('agent.temperature', { n: config.temperature })}
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={config.temperature}
                      onChange={(e) => update('temperature', parseFloat(e.target.value))}
                      className="w-full accent-indigo mt-1"
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
                  <DrawerCheckboxRail accent="#5b8af7">
                    {modelCheckboxes.map(([key, tk]) => (
                      <label key={String(key)} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-white/50">
                        <input
                          type="checkbox"
                          checked={!!config[key]}
                          onChange={(e) => update(key, e.target.checked)}
                          className="accent-indigo rounded"
                        />
                        <span className="text-[12px] text-[var(--mist)]">{t(tk)}</span>
                      </label>
                    ))}
                  </DrawerCheckboxRail>
                </DrawerSection>

                {/* ── Composer Assist (Beta) ── moved here from Advanced */}
                <DrawerSection
                  accent="#5b8af7"
                  eyebrow={t('agent.drawer.composerEyebrow')}
                  title={t('agent.prefixToggle')}
                  lead={t('agent.prefixSubtitle')}
                  actions={
                    <button
                      type="button"
                      role="switch"
                      aria-checked={config.prefixContinuationEnabled}
                      aria-label={t('agent.prefixToggle')}
                      onClick={() => update('prefixContinuationEnabled', !config.prefixContinuationEnabled)}
                      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                        config.prefixContinuationEnabled
                          ? 'bg-indigo shadow-[0_0_0_3px_rgba(99,102,241,0.15)]'
                          : 'bg-black/[0.12]'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 h-6 w-6 rounded-full bg-white shadow-sm transition-transform ${
                          config.prefixContinuationEnabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  }
                >
                  <p className="rounded-lg border border-black/[0.05] bg-black/[0.025] px-3 py-2 text-[10px] leading-relaxed text-[var(--fog)]">
                    {t('agent.prefixEnvHint')}
                  </p>
                  {config.prefixContinuationEnabled && (
                    <div className="space-y-3 rounded-xl border border-black/[0.06] bg-white/30 p-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="block space-y-1">
                          <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.prefixBaseUrl')}</span>
                          <input
                            type="text"
                            value={config.prefixContinuationBaseUrl}
                            onChange={(e) => update('prefixContinuationBaseUrl', e.target.value)}
                            className={`glass-input-console w-full ${drawerFieldClass(true)}`}
                            spellCheck={false}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.prefixChatModel')}</span>
                          <input
                            type="text"
                            value={config.prefixContinuationChatModel}
                            onChange={(e) => update('prefixContinuationChatModel', e.target.value)}
                            className={`glass-input-console w-full ${drawerFieldClass(true)}`}
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
                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.prefixComposerNotes')}</span>
                        <textarea
                          value={config.prefixContinuationAssistantPrefix}
                          onChange={(e) => update('prefixContinuationAssistantPrefix', e.target.value)}
                          rows={3}
                          className={`glass-input-console w-full resize-y leading-relaxed ${drawerFieldClass()}`}
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.prefixStop')}</span>
                        <textarea
                          value={config.prefixContinuationStopText}
                          onChange={(e) => update('prefixContinuationStopText', e.target.value)}
                          rows={2}
                          className={`glass-input-console w-full resize-y ${drawerFieldClass(true)}`}
                        />
                      </label>
                    </div>
                  )}
                </DrawerSection>
              </>
            )}

            {activeSection === 'memory' && (
              <>
                <DrawerSection
                  accent="#d4912e"
                  title={t('agent.drawer.memoryTiers')}
                  lead={t('agent.drawer.memoryTiersLead')}
                >
                  <div className="grid grid-cols-2 gap-3">
                    <NumField
                      label={t('agent.mem.autocompact')}
                      hint={t('agent.mem.hint.autocompact')}
                      value={ms.autocompactThresholdTokens}
                      onChange={(v) => updateMem('autocompactThresholdTokens', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.mem.warning')}
                      hint={t('agent.mem.hint.warning')}
                      value={ms.warningThresholdTokens}
                      onChange={(v) => updateMem('warningThresholdTokens', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.mem.error')}
                      hint={t('agent.mem.hint.error')}
                      value={ms.errorThresholdTokens}
                      onChange={(v) => updateMem('errorThresholdTokens', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.mem.blocking')}
                      hint={t('agent.mem.hint.blocking')}
                      value={ms.blockingThresholdTokens}
                      onChange={(v) => updateMem('blockingThresholdTokens', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.mem.l1Max')}
                      hint={t('agent.mem.hint.l1Max')}
                      value={ms.l1MaxMessages}
                      onChange={(v) => updateMem('l1MaxMessages', v)}
                      unit={u.msgs}
                    />
                    <NumField
                      label={t('agent.mem.l2Summary')}
                      hint={t('agent.mem.hint.l2Summary')}
                      value={ms.l2SummaryMaxTokens}
                      onChange={(v) => updateMem('l2SummaryMaxTokens', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.mem.l4Historical')}
                      hint={t('agent.mem.hint.l4Historical')}
                      value={ms.l4MaxHistoricalCases}
                      onChange={(v) => updateMem('l4MaxHistoricalCases', v)}
                      unit={u.cases}
                    />
                    <NumField
                      label={t('agent.mem.maxTraces')}
                      hint={t('agent.mem.hint.maxTraces')}
                      value={ms.maxRecentTraces}
                      onChange={(v) => updateMem('maxRecentTraces', v)}
                      unit={u.traces}
                    />
                  </div>
                </DrawerSection>
                <DrawerSection
                  accent="#d4912e"
                  title={t('agent.drawer.memoryCompact')}
                  lead={t('agent.drawer.memoryCompactLead')}
                >
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.mem.compactModel')}</span>
                    <select
                      value={ms.compactModel}
                      onChange={(e) => updateMem('compactModel', e.target.value)}
                      className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                    >
                      {mainModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <span className="block text-[10px] leading-snug text-[var(--smoke)]">{t('agent.mem.hint.compactModel')}</span>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <NumField
                      label={t('agent.mem.compactMaxMsgs')}
                      hint={t('agent.mem.hint.compactMaxMsgs')}
                      value={ms.compactMaxMessages}
                      onChange={(v) => updateMem('compactMaxMessages', v)}
                      unit={u.msgs}
                    />
                    <NumField
                      label={t('agent.mem.compactTemp')}
                      hint={t('agent.mem.hint.compactTemp')}
                      value={ms.compactTemperature}
                      onChange={(v) => updateMem('compactTemperature', v)}
                      step={0.1}
                      min={0}
                      max={1}
                    />
                    <NumField
                      label={t('agent.mem.compactMaxTokens')}
                      hint={t('agent.mem.hint.compactMaxTokens')}
                      value={ms.compactMaxTokensCap}
                      onChange={(v) => updateMem('compactMaxTokensCap', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.mem.minSummaryLen')}
                      hint={t('agent.mem.hint.minSummaryLen')}
                      value={ms.compactMinSummaryLength}
                      onChange={(v) => updateMem('compactMinSummaryLength', v)}
                      unit={u.tokens}
                    />
                    <NumField
                      label={t('agent.mem.keepMin')}
                      hint={t('agent.mem.hint.keepMin')}
                      value={ms.compactionKeepMin}
                      onChange={(v) => updateMem('compactionKeepMin', v)}
                      unit={u.msgs}
                    />
                    <NumField
                      label={t('agent.mem.keepRatio')}
                      hint={t('agent.mem.hint.keepRatio')}
                      value={ms.compactionKeepRatio}
                      onChange={(v) => updateMem('compactionKeepRatio', v)}
                      step={0.1}
                      min={0}
                      max={1}
                    />
                  </div>
                  <DrawerCheckboxRail accent="#d4912e" layout="stack">
                    {memToggles.map(([key, tk, hintKey]) => (
                      <label
                        key={key}
                        className="flex cursor-pointer gap-3 rounded-xl border border-black/[0.04] bg-white/25 px-2.5 py-2 hover:bg-white/45"
                      >
                        <input
                          type="checkbox"
                          checked={!!ms[key]}
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
                </DrawerSection>

                <DrawerSection
                  accent="#b8944c"
                  eyebrow="Debug"
                  title="API Data Flow Logging"
                  lead="Write full API request/response payloads to debug-logs/ directory for troubleshooting."
                  actions={
                    <label className="flex items-center gap-2 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={config.debugMode}
                        onChange={(e) => update('debugMode', e.target.checked)}
                        className="accent-amber rounded"
                      />
                      <span className="text-[11px] font-medium text-[var(--mist)]">Enable</span>
                    </label>
                  }
                >
                  <p className="text-[10px] text-[var(--fog)]/60">When enabled, raw API payloads are written to <code className="text-[10px] bg-black/[0.04] px-1 rounded">debug-logs/&lt;caseId&gt;/</code> as JSON files. Restart not required.</p>
                </DrawerSection>
              </>
            )}

            {activeSection === 'policy' && (
              <DrawerSection accent="#2ea04a" title={t('agent.section.policy')} lead={t('agent.policyLead')} dense>
                <div className="flex flex-1 flex-col min-h-0">
                  <AgentPolicyHooksPicker value={config.policyHooks} onChange={(v) => update('policyHooks', v)} />
                </div>
              </DrawerSection>
            )}

            {activeSection === 'templates' && (
              <DrawerSection accent="#5bb8f7" title={t('agent.section.humanOps')} lead={t('agent.section.humanOpsLead')}>
                <AgentHumanInteractionPanel
                  consultationPrompt={config.consultationPrompt}
                  humanSkills={config.humanSkills}
                  onConsultationPromptChange={(v) => update('consultationPrompt', v)}
                  onHumanSkillsChange={(v) => update('humanSkills', v)}
                />
              </DrawerSection>
            )}

            {activeSection === 'knowledge' && (
              <>
                <DrawerSection
                  accent="#14b8a6"
                  eyebrow="Knowledge Retrieval"
                  title={t('agent.section.knowledge')}
                  lead={t('agent.section.knowledgeLead')}
                >
                  {/* Mode selector */}
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] font-medium text-[var(--fog)]">{t('kb.modeLabel')}</span>
                    <select
                      value={config.knowledgeRetrieval.mode}
                      onChange={(e) => updateKb('mode', e.target.value)}
                      className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                    >
                      <option value="disabled">{t('kb.modeDisabled')}</option>
                      <option value="external-api">{t('kb.modeExternal')}</option>
                      <option value="intera-native">{t('kb.modeNative')}</option>
                    </select>
                  </label>

                  {/* External RAG API */}
                  {config.knowledgeRetrieval.mode === 'external-api' && (
                    <div className="space-y-3 rounded-xl border border-teal-500/20 bg-teal-500/[0.03] p-3">
                      <label className="space-y-1 block">
                        <span className="text-[11px] font-medium text-[var(--fog)]">{t('kb.externalEndpoint')}</span>
                        <input
                          type="text"
                          value={config.knowledgeRetrieval.externalEndpoint}
                          onChange={(e) => updateKb('externalEndpoint', e.target.value)}
                          placeholder="https://your-rag.com/api/search"
                          className={`glass-input-console w-full ${drawerFieldClass(true)}`}
                          spellCheck={false}
                        />
                        <span className="text-[10px] text-[var(--fog)]/60 leading-snug block">{t('kb.externalEndpointHint')}</span>
                      </label>
                      <label className="space-y-1 block">
                        <span className="text-[11px] font-medium text-[var(--fog)]">{t('kb.externalApiKeyEnvVar')}</span>
                        <input
                          type="text"
                          value={config.knowledgeRetrieval.externalApiKeyEnvVar}
                          onChange={(e) => updateKb('externalApiKeyEnvVar', e.target.value)}
                          placeholder="RAG_API_KEY"
                          className={`glass-input-console w-full ${drawerFieldClass(true)}`}
                          spellCheck={false}
                        />
                        <span className="text-[10px] text-[var(--fog)]/60 leading-snug block">{t('kb.externalApiKeyEnvVarHint')}</span>
                      </label>
                    </div>
                  )}

                  {/* Intera-native Hybrid */}
                  {config.knowledgeRetrieval.mode === 'intera-native' && (
                    <div className="space-y-3 rounded-xl border border-teal-500/20 bg-teal-500/[0.03] p-3">
                      <label className="space-y-1.5 block">
                        <span className="text-[11px] font-medium text-[var(--fog)]">{t('kb.embeddingProvider')}</span>
                        <select
                          value={config.knowledgeRetrieval.embeddingProvider}
                          onChange={(e) => updateKb('embeddingProvider', e.target.value)}
                          className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                        >
                          <option value="openai">OpenAI</option>
                          <option value="cohere">Cohere</option>
                          <option value="self-hosted">{t('kb.selfHosted')}</option>
                        </select>
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="space-y-1 block col-span-2 sm:col-span-1">
                          <span className="text-[11px] font-medium text-[var(--fog)]">{t('kb.embeddingModel')}</span>
                          <input
                            type="text"
                            value={config.knowledgeRetrieval.embeddingModel}
                            onChange={(e) => updateKb('embeddingModel', e.target.value)}
                            placeholder="text-embedding-3-small"
                            className={`glass-input-console w-full ${drawerFieldClass(true)}`}
                            spellCheck={false}
                          />
                        </label>
                        {config.knowledgeRetrieval.embeddingProvider === 'self-hosted' && (
                          <label className="space-y-1 block col-span-2 sm:col-span-1">
                            <span className="text-[11px] font-medium text-[var(--fog)]">{t('kb.embeddingBaseUrl')}</span>
                            <input
                              type="text"
                              value={config.knowledgeRetrieval.embeddingBaseUrl}
                              onChange={(e) => updateKb('embeddingBaseUrl', e.target.value)}
                              placeholder="http://localhost:8080"
                              className={`glass-input-console w-full ${drawerFieldClass(true)}`}
                              spellCheck={false}
                            />
                            <span className="text-[10px] text-[var(--fog)]/60 leading-snug block">{t('kb.embeddingBaseUrlHint')}</span>
                          </label>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Shared retrieval params — shown when not disabled */}
                  {config.knowledgeRetrieval.mode !== 'disabled' && (
                    <div className="grid grid-cols-2 gap-3">
                      <NumField
                        label={t('kb.topK')}
                        hint={t('kb.topKHint')}
                        value={config.knowledgeRetrieval.topK}
                        onChange={(v) => updateKb('topK', v)}
                        min={1}
                        max={20}
                        step={1}
                      />
                      <NumField
                        label={t('kb.minRelevance')}
                        hint={t('kb.minRelevanceHint')}
                        value={config.knowledgeRetrieval.minRelevanceScore}
                        onChange={(v) => updateKb('minRelevanceScore', v)}
                        step={0.05}
                        min={0}
                        max={1}
                      />
                    </div>
                  )}

                  {/* Placeholder when disabled */}
                  {config.knowledgeRetrieval.mode === 'disabled' && (
                    <div className="rounded-xl border border-dashed border-teal-500/25 bg-teal-500/[0.02] px-4 py-6 text-center">
                      <p className="text-[12px] font-medium text-teal-600/60">{t('kb.statusPending')}</p>
                      <p className="mt-1 text-[10px] text-[var(--fog)]/50">{t('kb.statusPendingHint')}</p>
                    </div>
                  )}
                </DrawerSection>

                {/* Advanced features — Intera-native only */}
                {config.knowledgeRetrieval.mode === 'intera-native' && (
                  <DrawerSection accent="#14b8a6" title={t('kb.advancedTitle')}>
                    <DrawerCheckboxRail accent="#14b8a6" layout="stack">
                      <label className="flex cursor-pointer gap-3 rounded-xl border border-black/[0.04] bg-white/25 px-2.5 py-2 hover:bg-white/45">
                        <input
                          type="checkbox"
                          checked={config.knowledgeRetrieval.enableReranker}
                          onChange={(e) => updateKb('enableReranker', e.target.checked)}
                          className="accent-teal-500 mt-0.5 shrink-0 rounded"
                        />
                        <span className="min-w-0 space-y-0.5">
                          <span className="block text-[12px] font-medium text-[var(--mist)]">{t('kb.enableReranker')}</span>
                          <span className="block text-[10px] leading-snug text-[var(--smoke)]">{t('kb.enableRerankerHint')}</span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer gap-3 rounded-xl border border-black/[0.04] bg-white/25 px-2.5 py-2 hover:bg-white/45">
                        <input
                          type="checkbox"
                          checked={config.knowledgeRetrieval.enableContextualRetrieval}
                          onChange={(e) => updateKb('enableContextualRetrieval', e.target.checked)}
                          className="accent-teal-500 mt-0.5 shrink-0 rounded"
                        />
                        <span className="min-w-0 space-y-0.5">
                          <span className="block text-[12px] font-medium text-[var(--mist)]">{t('kb.enableContextual')}</span>
                          <span className="block text-[10px] leading-snug text-[var(--smoke)]">{t('kb.contextualHint')}</span>
                        </span>
                      </label>
                    </DrawerCheckboxRail>

                    {config.knowledgeRetrieval.enableReranker && (
                      <label className="space-y-1.5 block">
                        <span className="text-[11px] font-medium text-[var(--fog)]">{t('kb.rerankProvider')}</span>
                        <select
                          value={config.knowledgeRetrieval.rerankProvider}
                          onChange={(e) => updateKb('rerankProvider', e.target.value)}
                          className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                        >
                          <option value="cohere">Cohere Rerank</option>
                          <option value="self-hosted">{t('kb.selfHosted')} (BGE-Reranker)</option>
                        </select>
                      </label>
                    )}

                    {config.knowledgeRetrieval.enableContextualRetrieval && (
                      <label className="space-y-1.5 block">
                        <span className="text-[11px] font-medium text-[var(--fog)]">{t('kb.contextualModel')}</span>
                        <select
                          value={config.knowledgeRetrieval.contextualModel}
                          onChange={(e) => updateKb('contextualModel', e.target.value)}
                          className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                        >
                          {mainModels.map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                        <span className="text-[10px] text-[var(--fog)]/60 leading-snug block">{t('kb.contextualModelHint')}</span>
                      </label>
                    )}
                  </DrawerSection>
                )}
              </>
            )}
                </DrawerShell>
              </div>
            </div>
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
          className={`glass-input-console w-full font-mono ${drawerFieldClass(true)}`}
        />
        {unit && <span className="text-[10px] text-[var(--smoke)] flex-shrink-0">{unit}</span>}
      </div>
    </label>
  )
}
