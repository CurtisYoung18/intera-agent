'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { AlertCircle, Brain, CheckCircle2, Loader2, Save, Rocket, Pencil } from 'lucide-react'
import HighlightedTextarea from '@/components/admin/highlighted-textarea'
import VersionContextBar, { useSelectedAgentId, useIsActiveVersion } from '@/components/admin/version-context-bar'
import { useConsoleLocale } from '@/components/locale-provider'
import { CORE_SYSTEM_PROMPT, DEFAULT_MODEL } from '@intera/shared/defaults'
import { drawerFieldClass, DrawerCheckboxRail, DrawerSection, DrawerShell } from '@/components/admin/agent-config-drawer-ui'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import { PageLoader } from '@/components/ui/page-loader'
import type { ModelInfo } from '@/app/admin/agent/types'

interface ModelConfig {
  model: string
  temperature: number
  thinkingBudget: number
  maxIterations: number
  maxOutputTokens: number
  coreSystemPrompt: string
  extendedThinking: boolean
  resumePrompt: string
}

export default function ModelPage() {
  const { t } = useConsoleLocale()
  const agentId = useSelectedAgentId()

  const [config, setConfig] = useState<ModelConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mainModels, setMainModels] = useState<ModelInfo[]>([])
  const [assembledPreview, setAssembledPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishNote, setPublishNote] = useState('')
  const [showPublishDialog, setShowPublishDialog] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const initialValues = useRef<Record<string, unknown> | null>(null)
  const configRef = useRef(config)
  const { orgId } = useSession()
  const isActiveVersion = useIsActiveVersion(agentId)

  useEffect(() => {
    configRef.current = config
  }, [config])

  // Dirty tracking — compare against last saved/loaded values
  useEffect(() => {
    if (!config) return
    if (!initialValues.current) {
      initialValues.current = { ...config }
      return
    }
    const dirty = Object.keys(config).some(
      (k) => config[k as keyof ModelConfig] !== initialValues.current![k]
    )
    setIsDirty(dirty)
  }, [config])

  // Navigation guard for unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  // Fetch config + models
  useEffect(() => {
    if (!agentId) return
    setLoading(true)
    Promise.all([
      apiClient(`/api/admin/agent?agentId=${agentId}`),
      apiClient('/api/admin/models'),
    ])
      .then(([agentResult, modelsResult]) => {
        const raw = (agentResult.data as any).config || {}
        const modelsData = (modelsResult.data as any)
        setConfig({
          model: raw.model || DEFAULT_MODEL,
          temperature: raw.temperature ?? 0.5,
          thinkingBudget: raw.thinkingBudget ?? 4096,
          maxIterations: raw.maxIterations ?? 20,
          maxOutputTokens: raw.maxOutputTokens ?? 4096,
          coreSystemPrompt: raw.coreSystemPrompt ? String(raw.coreSystemPrompt) : CORE_SYSTEM_PROMPT,
          extendedThinking: raw.extendedThinking ?? false,
          resumePrompt: raw.resumePrompt || '',
        })
        setMainModels(modelsData.models || [])
        setError(null)
      })
      .catch((err: Error) => setError(err.message || t('common.failedLoad')))
      .finally(() => setLoading(false))
  }, [agentId, t])

  // Fetch assembled prompt preview on config load
  useEffect(() => {
    if (!agentId || !config) return
    setPreviewLoading(true)
    apiClient(`/api/admin/agent/assembled-prompt?agentId=${agentId}`)
      .then((r: any) => setAssembledPreview(r.data?.discovery || null))
      .catch(() => setAssembledPreview(null))
      .finally(() => setPreviewLoading(false))
  }, [agentId, config?.coreSystemPrompt]) // refresh when prompt changes

  const handleSave = useCallback(async () => {
    if (!agentId || !configRef.current) return
    setSaving(true)
    try {
      await apiClient(`/api/admin/agent?agentId=${agentId}`, { body: configRef.current })
      // Don't bust cache on draft save (preserves live cache for active version)
      initialValues.current = { ...configRef.current }
      setIsDirty(false)
      setLastSavedAt(new Date())
    } catch {
      // Keep dirty state on failure
    } finally {
      setSaving(false)
    }
  }, [agentId])

  const handlePublish = useCallback(async () => {
    if (!agentId || !publishNote.trim()) return
    setPublishing(true)
    try {
      await apiClient(`/api/admin/agent-configs/${agentId}/activate`, {
        method: 'PUT',
        body: { releaseNote: publishNote.trim() },
      })
      await bustConfigCache(orgId)
      setPublishNote('')
      setShowPublishDialog(false)
      setIsDirty(false)
      setLastSavedAt(new Date())
      window.location.reload() // switch to viewing mode after publish
    } catch {
      // Keep publish dialog open on failure
    } finally {
      setPublishing(false)
    }
  }, [agentId, publishNote, orgId])

  const handleEditAsDraft = useCallback(async () => {
    if (!agentId) return
    try {
      const result: any = await apiClient(`/api/admin/agent-configs/${agentId}/fork`, { method: 'POST' })
      const newId = result.data?.config?.id
      if (newId) {
        window.location.href = `/admin/model?agentId=${newId}`
      }
    } catch {
      // keep current page on failure
    }
  }, [agentId])

  const update = useCallback(
    (field: string, value: unknown) => {
      setConfig((prev) => (prev ? { ...prev, [field]: value } : null))
      // No autosave — explicit Save button handles persistence
    },
    [],
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

  const displayError = error || (!loading && !config ? t('common.failedLoad') : null)

  if (!config) {
    return (
      <div>
        <VersionContextBar />
        <PageLoader loading={loading} error={displayError} onRetry={() => window.location.reload()}>
          <></>
        </PageLoader>
      </div>
    )
  }

  return (
    <div>
      <VersionContextBar />
      <PageLoader loading={false} error={null} onRetry={() => window.location.reload()}>
        <div className="px-8 py-8 animate-fade-up">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(139,111,245,0.15), rgba(139,111,245,0.05))', color: '#8b6ff5' }}>
                <Brain className="w-4 h-4" />
              </div>
              <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('model.title')}</h1>
            </div>
            <p className="text-[13px] text-[var(--fog)] mt-0.5">{t('model.subtitle')}</p>
          </div>

        </div>

        {/* Draft gate toolbar — explicit Save + Publish */}
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          {isActiveVersion ? (
            <div className="flex items-center gap-2 rounded-xl border border-lavender/30 bg-lavender/[0.04] px-3 py-2">
              <span className="text-[11px] font-medium text-[var(--fog)]">
                {t('model.viewingLive') || 'Viewing live version — read-only'}
              </span>
              <button
                onClick={handleEditAsDraft}
                className="flex items-center gap-1.5 rounded-lg border border-lavender/30 bg-white/70 px-3 py-1.5 text-[11px] font-semibold text-lavender shadow-sm hover:bg-lavender/15"
              >
                <Pencil className="w-3 h-3" />
                {t('model.editAsDraft') || 'Edit as draft'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-semibold shadow-sm transition ${
                  isDirty
                    ? 'border-malachite/40 bg-malachite/[0.06] text-malachite hover:bg-malachite/[0.12]'
                    : 'border-black/[0.06] bg-white/60 text-[var(--smoke)]'
                }`}
              >
                {saving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Save className="w-3 h-3" />
                )}
                {saving ? (t('model.saving') || 'Saving...') : isDirty ? (t('model.save') || 'Save') : (t('model.saved') || 'Saved')}
              </button>
              <button
                onClick={() => setShowPublishDialog(true)}
                disabled={publishing || saving}
                className="flex items-center gap-1.5 rounded-lg border border-lavender/40 bg-lavender/[0.06] px-3 py-1.5 text-[11px] font-semibold text-lavender shadow-sm hover:bg-lavender/[0.12]"
              >
                {publishing ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Rocket className="w-3 h-3" />
                )}
                {t('model.publish') || 'Publish'}
              </button>
              {lastSavedAt && (
                <span className="text-[10px] text-[var(--smoke)]">
                  {t('model.lastSaved') || 'Last saved'}: {lastSavedAt.toLocaleTimeString()}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Publish dialog */}
        {showPublishDialog && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
            <div className="rounded-2xl bg-white p-6 shadow-xl border border-black/[0.08] w-full max-w-md">
              <h2 className="text-[16px] font-semibold text-[var(--mist)] mb-2">
                {t('model.publishTitle') || 'Publish Version'}
              </h2>
              <p className="text-[12px] text-[var(--fog)] mb-4">
                {t('model.publishHelp') || 'This will make this draft the live version. All active conversations will use the new configuration. A commit message is required.'}
              </p>
              <textarea
                value={publishNote}
                onChange={(e) => setPublishNote(e.target.value)}
                placeholder={t('model.publishNotePlaceholder') || 'Describe what changed in this version...'}
                rows={3}
                className="glass-input-console w-full text-[12px] mb-4 rounded-lg border border-black/[0.08] p-2"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => { setShowPublishDialog(false); setPublishNote('') }}
                  className="rounded-lg border border-black/[0.06] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--fog)]"
                >
                  {t('common.cancel') || 'Cancel'}
                </button>
                <button
                  onClick={handlePublish}
                  disabled={publishing || !publishNote.trim()}
                  className="rounded-lg bg-lavender px-4 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-40"
                >
                  {publishing ? (t('model.publishing') || 'Publishing...') : (t('model.confirmPublish') || 'Publish')}
                </button>
              </div>
            </div>
          </div>
        )}

        <DrawerShell>
          {/* ── Model sub-section ── */}
          <DrawerSection
            accent="#8b6ff5"
            title={t('model.modelLabel')}
          >
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-medium text-[var(--fog)]">{t('model.modelLabel')}</span>
              <select
                value={config.model}
                onChange={(e) => update('model', e.target.value)}
                className={`glass-input-console ${drawerFieldClass(true)} w-full`}
              >
                {renderModelOptions(mainModels)}
              </select>
            </label>
          </DrawerSection>

          {/* ── Generation sub-section ── */}
          <DrawerSection accent="#8b6ff5" title="Generation">
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-medium text-[var(--fog)]">
                {t('model.temperature', { n: config.temperature })}
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
                label={t('model.thinkingBudget')}
                value={config.thinkingBudget}
                onChange={(v) => update('thinkingBudget', v)}
              />
              <NumField
                label={t('model.maxIterations')}
                value={config.maxIterations}
                onChange={(v) => update('maxIterations', v)}
              />
              <NumField
                label={t('model.maxOutputTokens')}
                value={config.maxOutputTokens}
                onChange={(v) => update('maxOutputTokens', v)}
              />
            </div>
            <DrawerCheckboxRail accent="#8b6ff5">
              {(() => {
                const selectedModel = mainModels.find(m => m.id === config.model)
                const supportsThinking = selectedModel?.supportsThinking ?? false
                return (
                  <label className={`flex items-center gap-2 rounded-lg px-1 py-0.5 ${supportsThinking ? 'cursor-pointer hover:bg-white/50' : 'cursor-not-allowed opacity-50'}`}>
                    <input
                      type="checkbox"
                      checked={!!config.extendedThinking && supportsThinking}
                      disabled={!supportsThinking}
                      onChange={(e) => update('extendedThinking', e.target.checked)}
                      className="accent-indigo rounded"
                    />
                    <span className="text-[12px] text-[var(--mist)]">
                      {t('model.extendedThinking')}
                      {!supportsThinking && <span className="ml-1 text-[10px] text-[var(--smoke)]">— {t('model.showThinkingUnsupported') || 'current model does not support extended thinking'}</span>}
                    </span>
                  </label>
                )
              })()}
            </DrawerCheckboxRail>
          </DrawerSection>

          {/* ── Core / Discovery Prompt ── */}
          <DrawerSection
            accent="#5b8af7"
            title={t('model.corePromptTitle')}
            lead={t('model.corePromptHelp')}
            actions={
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('model.promptResetConfirm')))
                    update('coreSystemPrompt', CORE_SYSTEM_PROMPT)
                }}
                className="rounded-full border border-lavender/30 bg-white/70 px-3.5 py-1.5 text-[11px] font-semibold text-lavender shadow-sm hover:bg-lavender/15"
              >
                {t('model.promptResetDefault')}
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
              />
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/[0.05] bg-black/[0.02] px-3 py-2 text-[10px] text-[var(--fog)]/75">
                <span>{t('model.promptAutosaveHint')}</span>
                <span className="font-mono tabular-nums opacity-95">
                  {t('model.promptCharCount', { n: config.coreSystemPrompt?.length ?? 0 })}
                </span>
              </div>
            </div>
          </DrawerSection>

          {/* ── Assembled Prompt Preview ── */}
          <DrawerSection
            accent="#5b8af7"
            title={t('model.assembledPreviewTitle') || 'Assembled Prompt'}
            lead={t('model.assembledPreviewHelp') || 'Read-only preview of the final system prompt with all context blocks injected. Tokens are resolved by the system — you do not need to place them in your prompt.'}
          >
            <div className="rounded-xl border border-lavender/20 bg-[var(--slate)]/50 p-4 max-h-96 overflow-y-auto">
              {previewLoading ? (
                <div className="flex items-center gap-2 text-[12px] text-[var(--fog)]">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  <span>Loading preview...</span>
                </div>
              ) : assembledPreview ? (
                <pre className="text-[11px] leading-relaxed text-[var(--mist)] whitespace-pre-wrap font-mono">
                  {assembledPreview}
                </pre>
              ) : (
                <span className="text-[11px] text-[var(--fog)]">{t('model.assembledPreviewEmpty') || 'Save the prompt to generate a preview.'}</span>
              )}
            </div>
          </DrawerSection>

        </DrawerShell>
      </div>
      </PageLoader>
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
