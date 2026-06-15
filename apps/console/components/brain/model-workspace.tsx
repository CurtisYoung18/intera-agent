'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Loader2, Save } from 'lucide-react'
import HighlightedTextarea from '@/components/admin/highlighted-textarea'
import { useConsoleLocale } from '@/components/locale-provider'
import { PageLoader } from '@/components/ui/page-loader'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { emitAgentConfigUpdated } from '@/lib/agent-config-events'
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

type ModelWorkspaceCopy = {
  loadFailed: string
  saved: string
  saveFailed: string
  saveDraft: string
  sections: {
    modelConfigTitle: string
    modelConfigDescription: string
    corePromptTitle: string
    corePromptDescription: string
    previewTitle: string
    previewDescription: string
  }
  fields: {
    model: string
    temperature: string
    thinkingBudget: string
    maxIterations: string
    maxOutputTokens: string
    extendedThinking: string
    unsupportedByModel: string
  }
  actions: {
    resetToDefault: string
    resetConfirm: string
  }
  preview: {
    loading: string
    unavailable: string
    chars: string
    runtimeNotePrefix: string
    runtimeNoteSuffix: string
  }
}

function stripTokens(text: string) {
  return text.replace(/\s*\{\{[a-z_]+\}\}\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

const CLEAN_CORE_PROMPT = stripTokens(CORE_SYSTEM_PROMPT)

const MODEL_WORKSPACE_COPY: Record<'en' | 'zh', ModelWorkspaceCopy> = {
  en: {
    loadFailed: 'Failed to load Brain model settings',
    saved: 'Saved',
    saveFailed: 'Save failed',
    saveDraft: 'Save draft',
    sections: {
      modelConfigTitle: 'Model configuration',
      modelConfigDescription: 'Control the runtime model and generation limits that shape the customer-facing Agent response.',
      corePromptTitle: 'Core prompt',
      corePromptDescription: 'Stable prompt prefix. Runtime Procedure overlays and Memory context append later.',
      previewTitle: 'Assembled prompt preview',
      previewDescription: 'Inspect the backend-assembled discovery prompt that the runtime will actually send after save.',
    },
    fields: {
      model: 'Model',
      temperature: 'Temperature',
      thinkingBudget: 'Thinking budget',
      maxIterations: 'Max iterations',
      maxOutputTokens: 'Max output tokens',
      extendedThinking: 'Extended thinking',
      unsupportedByModel: 'unsupported by selected model',
    },
    actions: {
      resetToDefault: 'Reset to default',
      resetConfirm: 'Reset the core prompt to the current default?',
    },
    preview: {
      loading: 'Loading preview',
      unavailable: 'Preview unavailable.',
      chars: 'chars',
      runtimeNotePrefix: 'System tokens like',
      runtimeNoteSuffix: 'are injected at runtime and kept out of the editable text.',
    },
  },
  zh: {
    loadFailed: '大脑模型配置加载失败',
    saved: '已保存',
    saveFailed: '保存失败',
    saveDraft: '保存草稿',
    sections: {
      modelConfigTitle: '模型配置',
      modelConfigDescription: '配置会直接影响面向客户回复的 runtime 模型与生成限制。',
      corePromptTitle: '核心提示词',
      corePromptDescription: '稳定提示词前缀。运行时会在后面追加 Procedure 覆盖与 Memory 上下文。',
      previewTitle: '组装后提示词预览',
      previewDescription: '查看保存后 runtime 实际发送的后端组装提示词。',
    },
    fields: {
      model: '模型',
      temperature: '温度',
      thinkingBudget: '思考预算',
      maxIterations: '最大迭代次数',
      maxOutputTokens: '最大输出 Token',
      extendedThinking: '扩展思考',
      unsupportedByModel: '当前模型不支持',
    },
    actions: {
      resetToDefault: '恢复默认',
      resetConfirm: '要将核心提示词恢复为当前默认值吗？',
    },
    preview: {
      loading: '加载预览中',
      unavailable: '当前无可用预览。',
      chars: '字符',
      runtimeNotePrefix: '像',
      runtimeNoteSuffix: '这样的系统占位符会在运行时注入，不会出现在可编辑文本中。',
    },
  },
}

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
        className="glass-input-console h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 font-mono text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-primary)]"
      />
    </label>
  )
}

export default function ModelWorkspace() {
  const agentId = useSelectedAgentId()
  const { orgId } = useSession()
  const { locale } = useConsoleLocale()
  const copy = MODEL_WORKSPACE_COPY[locale]

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
      apiClient(`/api/admin/agent?agentId=${agentId}`, { cache: 'no-store' }),
      apiClient('/api/admin/models', { cache: 'no-store' }),
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
      .catch((err: Error) => setError(err.message || copy.loadFailed))
      .finally(() => setLoading(false))
  }, [agentId, copy.loadFailed])

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
      await bustConfigCache(orgId, agentId)
      emitAgentConfigUpdated(agentId)
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
      <PageLoader loading={loading} error={error || (!loading ? copy.loadFailed : null)} onRetry={() => window.location.reload()}>
        <div />
      </PageLoader>
    )
  }

  const selectedModel = models.find((item) => item.id === config.model)
  const supportsThinking = selectedModel?.supportsThinking ?? false
  const fieldClass = 'glass-input-console h-11 w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-[var(--color-accent-primary)]'

  return (
    <PageLoader loading={false} error={null} onRetry={() => window.location.reload()}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div className="flex min-h-9 items-center gap-2">
            {saveResult === 'saved' ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] font-medium text-emerald-800">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {copy.saved}
              </span>
            ) : saveResult === 'error' ? (
              <span className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700">
                {copy.saveFailed}
              </span>
            ) : null}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--mist)] px-3.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[var(--mist)]/90 disabled:opacity-45"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {copy.saveDraft}
            </button>
          </div>
        </div>

        <section className="intera-q2-panel overflow-hidden">
          <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
            <h2 className="text-[16px] font-semibold text-[var(--mist)]">{copy.sections.modelConfigTitle}</h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--fog)]">
              {copy.sections.modelConfigDescription}
            </p>
          </div>
          <div className="grid gap-4 px-5 py-5 md:grid-cols-2">
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-[11px] font-medium text-[var(--fog)]">{copy.fields.model}</span>
              <select
                value={config.model}
                onChange={(event) => update('model', event.target.value)}
                className={fieldClass}
              >
                {renderModelOptions(models)}
              </select>
            </label>

            <div className="space-y-2">
              <span className="text-[11px] font-medium text-[var(--fog)]">{copy.fields.temperature}</span>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.1"
                  value={config.temperature}
                  onChange={(event) => update('temperature', parseFloat(event.target.value) || 0)}
                  className={`${fieldClass} w-[96px] font-mono`}
                />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={config.temperature}
                  onChange={(event) => update('temperature', parseFloat(event.target.value))}
                  className="w-full accent-[var(--color-accent-primary)]"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <NumField label={copy.fields.thinkingBudget} value={config.thinkingBudget} onChange={(value) => update('thinkingBudget', value)} />
              <NumField label={copy.fields.maxIterations} value={config.maxIterations} onChange={(value) => update('maxIterations', value)} />
            </div>

            <div className="md:col-span-2 lg:max-w-[360px]">
              <NumField label={copy.fields.maxOutputTokens} value={config.maxOutputTokens} onChange={(value) => update('maxOutputTokens', value)} />
            </div>

            <label className={`inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface-muted)] px-3 py-2 text-[12px] ${supportsThinking ? 'text-[var(--mist)]' : 'cursor-not-allowed text-[var(--smoke)] opacity-70'}`}>
              <input
                type="checkbox"
                checked={!!config.extendedThinking && supportsThinking}
                disabled={!supportsThinking}
                onChange={(event) => update('extendedThinking', event.target.checked)}
                className="rounded accent-[var(--color-accent-primary)]"
              />
              <span>
                {copy.fields.extendedThinking}
                {!supportsThinking ? <span className="ml-1 text-[10px]">{copy.fields.unsupportedByModel}</span> : null}
              </span>
            </label>
          </div>
        </section>

        <section className="intera-q2-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border-subtle)] px-5 py-4">
            <div>
              <h2 className="text-[16px] font-semibold text-[var(--mist)]">{copy.sections.corePromptTitle}</h2>
              <p className="mt-1 text-[12px] leading-5 text-[var(--fog)]">
                {copy.sections.corePromptDescription}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(copy.actions.resetConfirm)) {
                  update('coreSystemPrompt', CLEAN_CORE_PROMPT)
                }
              }}
              className="rounded-full border border-[var(--color-border-subtle)] bg-white px-3.5 py-1.5 text-[11px] font-semibold text-[var(--color-accent-primary)] shadow-sm hover:bg-[var(--color-bg-surface-muted)]"
            >
              {copy.actions.resetToDefault}
            </button>
          </div>
          <div className="space-y-3 px-5 py-5">
            <HighlightedTextarea
              id="brain-core-system-prompt"
              value={config.coreSystemPrompt}
              onChange={(value) => update('coreSystemPrompt', value)}
              spellCheck={false}
              className="min-h-[320px] w-full rounded-[var(--radius-control)] border border-[var(--color-border-subtle)] bg-white px-4 py-3 text-[13px] text-[var(--color-text-primary)]"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/[0.05] bg-black/[0.02] px-3 py-2 text-[10px] text-[var(--fog)]/75">
              <span>{config.coreSystemPrompt?.length ?? 0} {copy.preview.chars}</span>
              <span>
                {copy.preview.runtimeNotePrefix} <code>{'{{...}}'}</code> {copy.preview.runtimeNoteSuffix}
              </span>
            </div>
          </div>
        </section>

        <section className="intera-q2-panel overflow-hidden">
          <div className="border-b border-[var(--color-border-subtle)] px-5 py-4">
            <h2 className="text-[16px] font-semibold text-[var(--mist)]">{copy.sections.previewTitle}</h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--fog)]">
              {copy.sections.previewDescription}
            </p>
          </div>
          <div className="px-5 py-5">
            {previewLoading ? (
              <div className="flex items-center gap-2 py-2 text-[12px] text-[var(--fog)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                {copy.preview.loading}
              </div>
            ) : assembledPreview ? (
              <pre className="max-h-96 overflow-y-auto rounded-xl border border-black/[0.08] bg-[var(--slate)]/50 p-4 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-[var(--mist)]">
                {assembledPreview}
              </pre>
            ) : (
              <span className="text-[11px] text-[var(--fog)]">{copy.preview.unavailable}</span>
            )}
          </div>
        </section>
      </div>
    </PageLoader>
  )
}
