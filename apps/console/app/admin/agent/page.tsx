'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { AlertCircle, Brain, Database, Shield, Users, MessageSquareText, Search, X, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import HighlightedTextarea from '@/components/admin/highlighted-textarea'
import AgentBlueprint from '@/components/admin/agent-blueprint'
import GuardrailSummaryList from '@/components/admin/guardrail-summary-list'
import SubAgentSummaryList from '@/components/admin/sub-agent-summary-list'
import AgentHumanInteractionPanel from '@/components/admin/agent-human-interaction-panel'
import Link from 'next/link'
import {
  DrawerCheckboxRail,
  DrawerSection,
  DrawerShell,
  drawerFieldClass,
} from '@/components/admin/agent-config-drawer-ui'
import { chatApiUrl } from '@/lib/chat-api'
import type { AgentConfigData, KnowledgeRetrievalConfig, MemoryStrategy, ModelInfo } from './types'
import { DEFAULT_KNOWLEDGE_RETRIEVAL, DEFAULT_MEMORY } from './types'
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_CONSULTATION_PROMPT, CORE_SYSTEM_PROMPT } from '@intera/shared/defaults'
import { clampComposerMinDraftChars } from '@intera/shared/composer-min-draft'
import { useConsoleLocale } from '@/components/locale-provider'

type Section = 'brain' | 'memory' | 'guardrails' | 'subAgents' | 'humanOps' | 'knowledge'
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

function detectMemoryTier(ms: MemoryStrategy): MemoryTier {
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
  const [kbSourceCount, setKbSourceCount] = useState(0)
  const [mainModels, setMainModels] = useState<ModelInfo[]>([])
  const [activeSection, setActiveSection] = useState<Section | null>(null)
  const [memoryTier, setMemoryTier] = useState<MemoryTier>('balanced')
  const [showMemoryAdvanced, setShowMemoryAdvanced] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const configRef = useRef(config)

  const sectionMeta = useMemo(
    () =>
      ({
        brain: { icon: <Brain className="w-4 h-4" />, title: t('agent.section.brain'), color: '#8b6ff5' },
        memory: { icon: <Database className="w-4 h-4" />, title: t('agent.section.memory'), color: '#d4912e' },
        guardrails: { icon: <Shield className="w-4 h-4" />, title: t('agent.section.guardrails'), color: '#2ea04a' },
        subAgents: { icon: <Users className="w-4 h-4" />, title: t('agent.section.subAgents'), color: '#e75c8a' },
        humanOps: { icon: <MessageSquareText className="w-4 h-4" />, title: t('agent.section.humanOps'), color: '#5bb8f7' },
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
      fetch('/api/admin/knowledge/sources').then(r => r.ok ? r.json() : null).then(d => {
        if (d?.sources) setKbSourceCount(d.sources.filter((s: {enabled: boolean}) => s.enabled).length)
      }).catch(() => {}),
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
          fallbackModel: raw.fallbackModel || '',
          temperature: raw.temperature ?? 0.5,
          thinkingBudget: raw.thinkingBudget ?? 4096,
          maxIterations: raw.maxIterations ?? 20,
          maxOutputTokens: raw.maxOutputTokens ?? 4096,
          systemPrompt: raw.systemPrompt || '',
          coreSystemPrompt: (raw as Record<string, unknown>).coreSystemPrompt
            ? String((raw as Record<string, unknown>).coreSystemPrompt)
            : CORE_SYSTEM_PROMPT,
          showThinking: raw.showThinking ?? false,
          memoryStrategy,
          policyHooks,
          resumePrompt: raw.resumePrompt || '',
          formResponseTemplate: raw.formResponseTemplate || '',
          humanSkills: raw.humanSkills || '',
          consultationPrompt: raw.consultationPrompt || DEFAULT_CONSULTATION_PROMPT,
          debugMode: Boolean(raw.debugMode),
          enableLlmSanitization: Boolean((raw as Record<string, unknown>).enableLlmSanitization),
          invariantCheck: Boolean((raw as Record<string, unknown>).invariantCheck),
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
        setMemoryTier(detectMemoryTier(memoryStrategy))
        setMainModels(modelsData.models || [])
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
        const cacheBody = JSON.stringify({ vendorId: 'default' })
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
      // When user manually edits any advanced field, mark tier as custom
      setMemoryTier('custom')
      autoSave()
    },
    [autoSave],
  )

  const applyTierPreset = useCallback(
    (tier: MemoryTier) => {
      if (tier === 'custom') return
      const preset = TIER_PRESETS[tier]
      setConfig((prev) =>
        prev
          ? {
              ...prev,
              memoryStrategy: { ...prev.memoryStrategy, ...preset },
            }
          : null,
      )
      setMemoryTier(tier)
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
    ['invariantCheck', 'agent.invariantCheck'],
  ]

  const memToggles: Array<[keyof MemoryStrategy, string, string]> = [
    ['enableAutocompact', 'agent.ms.toggleAutocompact', 'agent.ms.hintAutocompact'],
    ['enableMicrocompact', 'agent.ms.toggleMicrocompact', 'agent.ms.hintMicrocompact'],
    ['enableContextCollapse', 'agent.ms.toggleContextCollapse', 'agent.ms.hintContextCollapse'],
    ['enableSnip', 'agent.ms.toggleSnip', 'agent.ms.hintSnip'],
    ['enableChatMemory', 'agent.ms.toggleChatMemory', 'agent.ms.hintChatMemory'],
  ]

  function renderModelOptions(models: ModelInfo[]) {
    const groups = new Map<string, ModelInfo[]>()
    for (const m of models) {
      const g = groups.get(m.provider) || []
      g.push(m)
      groups.set(m.provider, g)
    }
    return Array.from(groups.entries()).map(([provider, ms]) => (
      <optgroup key={provider} label={ms[0]?.providerLabel || provider}>
        {ms.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </optgroup>
    ))
  }

  return (
    <div className="flex" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="flex-1 min-w-0 overflow-hidden relative">
        <AgentBlueprint
          config={config}
          activeSection={activeSection}
          onSelectSection={(s) => setActiveSection((prev) => (prev === s ? null : s))}
          syncStatus={syncStatus}
          kbSourceCount={kbSourceCount}
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
                  {activeSection === 'guardrails' && <Link href="/admin/guardrails" className="text-[10px] text-indigo hover:text-indigo/80 mt-0.5 inline-block">Open Guardrails page →</Link>}
                  {activeSection === 'knowledge' && <Link href="/admin/knowledge" className="text-[10px] text-indigo hover:text-indigo/80 mt-0.5 inline-block">Open Knowledge page →</Link>}
                  {activeSection === 'humanOps' && <Link href="/admin/channels/livechat" className="text-[10px] text-indigo hover:text-indigo/80 mt-0.5 inline-block">Configure in Channels →</Link>}
                  {activeSection === 'subAgents' && <Link href="/admin/case-types" className="text-[10px] text-indigo hover:text-indigo/80 mt-0.5 inline-block">Manage in Case Types →</Link>}
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
            {activeSection === 'brain' && (
              <>
                {/* ── Prompt sub-section ── */}
                <DrawerSection
                  accent="#8b6ff5"
                  eyebrow={t('agent.promptEyebrow')}
                  title={t('agent.casePromptTitle')}
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

                {/* ── Core / Discovery Prompt sub-section ── */}
                <DrawerSection
                  accent="#5b8af7"
                  eyebrow={t('agent.corePromptEyebrow')}
                  title={t('agent.corePromptTitle')}
                  lead={t('agent.corePromptHelp')}
                  actions={
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t('agent.promptResetConfirm')))
                          update('coreSystemPrompt', CORE_SYSTEM_PROMPT)
                      }}
                      className="rounded-full border border-lavender/30 bg-white/70 px-3.5 py-1.5 text-[11px] font-semibold text-lavender shadow-sm hover:bg-lavender/15"
                    >
                      {t('agent.promptResetDefault')}
                    </button>
                  }
                >
                  <div className="flex flex-col gap-3">
                    <HighlightedTextarea
                      id="core-system-prompt-textarea"
                      value={config.coreSystemPrompt}
                      onChange={(v) => update('coreSystemPrompt', v)}
                      spellCheck={false}
                      className={`w-full ${drawerFieldClass(true)}`}
                      highlights={[
                        { pattern: /\{\{available_tools\}\}/g, color: '#7c5ce7' },
                        { pattern: /\{\{case_types\}\}/g, color: '#2ea04a' },
                        { pattern: /\{\{session_binding\}\}/g, color: '#5b8af7' },
                      ]}
                    />
                    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-black/[0.05] bg-black/[0.02] px-3 py-2.5 text-[10px] text-[var(--fog)]/60">
                      <span className="mr-1 font-medium text-[var(--fog)]/80">{t('agent.promptPlaceholders')}</span>
                      {[
                        { key: '{{available_tools}}', desc: t('agent.plhAvailableTools') },
                        { key: '{{case_types}}', desc: t('agent.plhCaseTypes') },
                        { key: '{{session_binding}}', desc: t('agent.plhSessionBinding') },
                      ].map((ph) => (
                        <button
                          key={ph.key}
                          type="button"
                          title={ph.desc}
                          onClick={() => {
                            const ta = document.getElementById('core-system-prompt-textarea') as HTMLTextAreaElement | null
                            if (!ta) { update('coreSystemPrompt', (config.coreSystemPrompt + '\n' + ph.key).trimStart()); return }
                            const start = ta.selectionStart ?? ta.value.length
                            const end = ta.selectionEnd ?? start
                            const next = ta.value.slice(0, start) + ph.key + ta.value.slice(end)
                            update('coreSystemPrompt', next)
                            requestAnimationFrame(() => {
                              const el = document.getElementById('core-system-prompt-textarea') as HTMLTextAreaElement | null
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
                        {t('agent.promptCharCount', { n: config.coreSystemPrompt?.length ?? 0 })}
                      </span>
                    </div>
                  </div>
                </DrawerSection>

                {/* ── Model sub-section ── */}
                <DrawerSection
                  accent="#8b6ff5"
                  title={t('agent.brain.subModel')}
                  lead={t('agent.modelCaseTypeNote')}
                >
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.modelMain')}</span>
                    <select
                      value={config.model}
                      onChange={(e) => update('model', e.target.value)}
                      className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                    >
                      {renderModelOptions(mainModels)}
                    </select>
                    <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">{t('agent.modelMainHint')}</span>
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Fallback Model</span>
                    <select
                      value={config.fallbackModel}
                      onChange={(e) => update('fallbackModel', e.target.value)}
                      className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                    >
                      <option value="">-- None --</option>
                      {renderModelOptions(mainModels)}
                    </select>
                    <span className="text-[10px] text-[var(--fog)]/70 leading-snug block">Switches to this model after 3 consecutive 529 (overloaded) errors from the main model.</span>
                  </label>
                  <label className="space-y-1.5 block">
                    <span className="text-[11px] font-medium text-[var(--fog)]">{t('agent.evaluationModel')}</span>
                    <select
                      value={config.evaluationModel}
                      onChange={(e) => update('evaluationModel', e.target.value)}
                      className={`glass-input-console ${drawerFieldClass(true)} w-full`}
                    >
                      <option value="">-- Default (haiku) --</option>
                      {renderModelOptions(mainModels)}
                    </select>
                    <span className="text-[10px] text-[var(--fog)]/55 leading-snug block">
                      {t('agent.evaluationModelHint')}
                    </span>
                  </label>
                </DrawerSection>

                {/* ── Generation sub-section ── */}
                <DrawerSection accent="#8b6ff5" title={t('agent.brain.subGeneration')}>
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
                  <DrawerCheckboxRail accent="#8b6ff5">
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
              </>
            )}

            {activeSection === 'memory' && (
              <>
                <DrawerSection
                  accent="#d4912e"
                  title={t('agent.drawer.memoryTiers')}
                  lead={t('agent.drawer.memoryTiersLead')}
                >
                  {/* ── Memory tier slider ── */}
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
                          {TIER_LABELS[tier]}
                        </button>
                      )
                    })}
                  </div>
                  {memoryTier === 'custom' && (
                    <p className="text-[10px] text-[var(--fog)]/60 mt-1.5 px-1">
                      Custom — advanced fields have been manually edited
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2 mt-2 text-[10px] text-[var(--fog)]/70 px-1">
                    <span>Autocompact: {ms.autocompactThresholdTokens.toLocaleString()} tokens</span>
                    <span>Keep: {ms.compactionKeepMin} msgs</span>
                    <span>L1 max: {ms.l1MaxMessages} msgs</span>
                  </div>

                  {/* ── Advanced toggle ── */}
                  <button
                    type="button"
                    onClick={() => setShowMemoryAdvanced(!showMemoryAdvanced)}
                    className="flex items-center gap-1.5 mt-3 text-[11px] font-medium text-[var(--fog)] hover:text-[var(--mist)] transition-colors"
                  >
                    {showMemoryAdvanced ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    Advanced
                  </button>
                </DrawerSection>

                {/* ── Advanced fields (collapsible) ── */}
                {showMemoryAdvanced && (
                  <>
                    <DrawerSection accent="#d4912e" title="Thresholds">
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
                          {renderModelOptions(mainModels)}
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
                      <NumField
                        label={t('agent.mem.microcompactMinAge')}
                        hint={t('agent.mem.hint.microcompactMinAge')}
                        value={ms.microcompactMinAgeMs ?? 300000}
                        onChange={(v) => updateMem('microcompactMinAgeMs', v)}
                        unit={u.ms}
                      />
                      <NumField
                        label={t('agent.mem.chatMemoryMaxTokens')}
                        hint={t('agent.mem.hint.chatMemoryMaxTokens')}
                        value={ms.chatMemoryMaxTokens ?? 4000}
                        onChange={(v) => updateMem('chatMemoryMaxTokens', v)}
                        unit={u.tokens}
                      />
                    </DrawerSection>
                  </>
                )}
              </>
            )}

            {activeSection === 'guardrails' && (
              <DrawerSection accent="#2ea04a" title={t('agent.section.guardrails')} dense>
                <GuardrailSummaryList policyHooks={config.policyHooks} />
              </DrawerSection>
            )}

            {activeSection === 'subAgents' && (
              <DrawerSection accent="#e75c8a" title={t('agent.section.subAgents')}>
                <SubAgentSummaryList />
              </DrawerSection>
            )}

            {activeSection === 'humanOps' && (
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
              <DrawerSection
                accent="#14b8a6"
                eyebrow="Knowledge Retrieval"
                title={t('agent.section.knowledge')}
                lead="Knowledge search tools (kb_search_*) are auto-generated from GPTBots knowledge sources."
              >
                {/* GPTBots status */}
                <div className="rounded-xl border border-teal-500/20 bg-teal-500/[0.04] p-4 space-y-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-teal-500/[0.1] flex items-center justify-center">
                      <Search className="w-4 h-4 text-teal-600" />
                    </div>
                    <div>
                      <p className="text-[13px] font-semibold text-[var(--mist)]">GPTBots · {kbSourceCount} source{kbSourceCount !== 1 ? 's' : ''} active</p>
                      <p className="text-[11px] text-[var(--fog)]">{kbSourceCount > 0 ? `${kbSourceCount} kb_search_* tool${kbSourceCount !== 1 ? 's' : ''} generated` : 'No knowledge sources configured'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-[var(--fog)]">
                    <span className={`w-1.5 h-1.5 rounded-full ${kbSourceCount > 0 ? 'bg-malachite' : 'bg-[var(--fog)]/30'}`} />
                    Each enabled{' '}
                    <Link href="/admin/knowledge" className="text-teal-600 hover:text-teal-700 underline font-medium">
                      Knowledge Source
                    </Link>
                    {' '}becomes a <code className="text-[10px] bg-teal-500/[0.08] px-1 rounded">kb_search_&lt;name&gt;</code> tool.
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--fog)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                    The agent reads each source&apos;s description and picks which one(s) to query — in parallel when needed.
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--fog)]">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                    Per-source settings (topK, reranker, relevance threshold) are configured on the Knowledge page.
                  </div>

                  <Link
                    href="/admin/knowledge"
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-teal-600 hover:text-teal-700 mt-1"
                  >
                    <ExternalLink className="w-3.5 h-3.5" /> Manage Knowledge Sources
                  </Link>
                </div>
              </DrawerSection>
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
