'use client'

import { useCallback, useEffect, useState } from 'react'
import { Brain, CheckCircle2, Loader2, Save } from 'lucide-react'
import HighlightedTextarea from '@/components/admin/highlighted-textarea'
import {
  drawerFieldClass,
  DrawerCheckboxRail,
  DrawerSection,
  DrawerShell,
} from '@/components/admin/agent-config-drawer-ui'
import { PageLoader } from '@/components/ui/page-loader'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { CORE_SYSTEM_PROMPT, DEFAULT_MODEL } from '@intera/shared/defaults'
import type { ModelInfo } from '@/app/admin/agent/types'

type ModelConfig = {
  model: string
  temperature: number
  thinkingBudget: number
  maxIterations: number
  maxOutputTokens: number
  coreSystemPrompt: string
  extendedThinking: boolean
  resumePrompt: string
}

function stripTokens(text: string) {
  return text.replace(/\s*\{\{[a-z_]+\}\}\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const CLEAN_CORE_PROMPT = stripTokens(CORE_SYSTEM_PROMPT)

function renderModelOptions(models: ModelInfo[]) {
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

function NumField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] text-[var(--fog)]">{label}</span>
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(parseFloat(event.target.value) || 0)}
        min={min}
        max={max}
        step={step}
        className={`glass-input-console w-full font-mono ${drawerFieldClass(true)}`}
      />
    </label>
  )
}

export default function ModelWorkspace() {
  const agentId = useSelectedAgentId()
  const { orgId } = useSession()

  const [config, setConfig] = useState<ModelConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<'idle' | 'saved' | 'error'>('idle')
  const [assembledPreview, setAssembledPreview] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

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
          coreSystemPrompt: raw.coreSystemPrompt != null ? stripTokens(String(raw.coreSystemPrompt)) : CLEAN_CORE_PROMPT,
          extendedThinking: raw.extendedThinking ?? false,
          resumePrompt: raw.resumePrompt || '',
        })
        setModels(modelsData.models || [])
        setError(null)
      })
      .catch((err: Error) => setError(err.message || 'Failed to load Brain model settings'))
      .finally(() => setLoading(false))
  }, [agentId])

  const refreshPreview = useCallback(() => {
    if (!agentId) return
    setPreviewLoading(true)
    apiClient(`/api/admin/agent/assembled-prompt?agentId=${agentId}`)
      .then((result: any) => setAssembledPreview(result.data?.discovery || null))
      .catch(() => setAssembledPreview(null))
      .finally(() => setPreviewLoading(false))
  }, [agentId])

  useEffect(() => {
    refreshPreview()
  }, [refreshPreview])

  const update = useCallback((field: keyof ModelConfig, value: unknown) => {
    setConfig((prev) => (prev ? { ...prev, [field]: value } : null))
    setSaveResult('idle')
  }, [])

  const handleSave = useCallback(async () => {
    if (!agentId || !config) return
    setSaving(true)
    setSaveResult('idle')
    try {
      await apiClient(`/api/admin/agent?agentId=${agentId}`, {
        body: config,
      })
      await bustConfigCache(orgId)
      setSaveResult('saved')
      refreshPreview()
      setTimeout(() => setSaveResult('idle'), 2500)
    } catch {
      setSaveResult('error')
    } finally {
      setSaving(false)
    }
  }, [agentId, config, orgId, refreshPreview])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 's') {
        event.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  if (!config) {
    return (
      <PageLoader loading={loading} error={error || (!loading ? 'Failed to load Brain model settings' : null)} onRetry={() => window.location.reload()}>
        <div />
      </PageLoader>
    )
  }

  const selectedModel = models.find((item) => item.id === config.model)
  const supportsThinking = selectedModel?.supportsThinking ?? false

  return (
    <PageLoader loading={false} error={null} onRetry={() => window.location.reload()}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="text-[18px] font-semibold tracking-tight text-[var(--mist)]">
              Model and prompts
            </h2>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--fog)]">
              Control the customer-facing model, generation limits, and the stable core prompt that defines this Agent&apos;s behavior.
            </p>
          </div>
          <div className="flex min-h-9 items-center gap-2">
            {saveResult === 'saved' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Saved
              </span>
            ) : saveResult === 'error' ? (
              <span className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
                Save failed
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--mist)] px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[var(--mist)]/90 disabled:opacity-45"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save draft
            </button>
          </div>
        </div>

        <DrawerShell>
          <DrawerSection
            accent="#8b6ff5"
            title="Runtime model"
            lead="The primary model handles customer-facing responses. These controls stay in Brain rather than a detached admin page."
          >
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-medium text-[var(--fog)]">Model</span>
              <select
                value={config.model}
                onChange={(event) => update('model', event.target.value)}
                className={`glass-input-console ${drawerFieldClass(true)} w-full`}
              >
                {renderModelOptions(models)}
              </select>
            </label>
          </DrawerSection>

          <DrawerSection accent="#8b6ff5" title="Generation controls">
            <label className="space-y-1.5 block">
              <span className="text-[11px] font-medium text-[var(--fog)]">
                Temperature ({config.temperature})
              </span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={config.temperature}
                onChange={(event) => update('temperature', parseFloat(event.target.value))}
                className="mt-1 w-full accent-indigo"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Thinking budget" value={config.thinkingBudget} onChange={(value) => update('thinkingBudget', value)} />
              <NumField label="Max iterations" value={config.maxIterations} onChange={(value) => update('maxIterations', value)} />
              <NumField label="Max output tokens" value={config.maxOutputTokens} onChange={(value) => update('maxOutputTokens', value)} />
            </div>

            <DrawerCheckboxRail accent="#8b6ff5">
              <label className={`flex items-center gap-2 rounded-lg px-1 py-0.5 ${supportsThinking ? 'cursor-pointer hover:bg-white/50' : 'cursor-not-allowed opacity-50'}`}>
                <input
                  type="checkbox"
                  checked={!!config.extendedThinking && supportsThinking}
                  disabled={!supportsThinking}
                  onChange={(event) => update('extendedThinking', event.target.checked)}
                  className="rounded accent-indigo"
                />
                <span className="text-[12px] text-[var(--mist)]">
                  Extended thinking
                  {!supportsThinking ? <span className="ml-1 text-[10px] text-[var(--smoke)]">unsupported by selected model</span> : null}
                </span>
              </label>
            </DrawerCheckboxRail>
          </DrawerSection>

          <DrawerSection
            accent="#5b8af7"
            title="Core prompt"
            lead="Stable prompt prefix. Runtime Procedure overlays and Memory context append later."
            actions={
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Reset the core prompt to the current default?')) {
                    update('coreSystemPrompt', CLEAN_CORE_PROMPT)
                  }
                }}
                className="rounded-full border border-lavender/30 bg-white/70 px-3.5 py-1.5 text-[11px] font-semibold text-lavender shadow-sm hover:bg-lavender/15"
              >
                Reset to default
              </button>
            }
          >
            <div className="flex flex-col gap-3">
              <HighlightedTextarea
                id="brain-core-system-prompt"
                value={config.coreSystemPrompt}
                onChange={(value) => update('coreSystemPrompt', value)}
                spellCheck={false}
                className={`w-full ${drawerFieldClass(true)}`}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/[0.05] bg-black/[0.02] px-3 py-2 text-[10px] text-[var(--fog)]/75">
                <span>{config.coreSystemPrompt?.length ?? 0} chars</span>
                <span>
                  System tokens like <code>{'{{...}}'}</code> are injected at runtime and kept out of the editable text.
                </span>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection
            accent="#357f7c"
            title="Assembled prompt preview"
            lead="Current backend-assembled discovery prompt after save. Use this to inspect what the runtime will actually send."
          >
            {previewLoading ? (
              <div className="flex items-center gap-2 py-2 text-[12px] text-[var(--fog)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading preview
              </div>
            ) : assembledPreview ? (
              <pre className="max-h-96 overflow-y-auto rounded-xl border border-black/[0.08] bg-[var(--slate)]/50 p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--mist)]">
                {assembledPreview}
              </pre>
            ) : (
              <span className="text-[11px] text-[var(--fog)]">Preview unavailable.</span>
            )}
          </DrawerSection>
        </DrawerShell>
      </div>
    </PageLoader>
  )
}
