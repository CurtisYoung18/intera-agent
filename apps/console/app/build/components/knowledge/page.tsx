'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  X,
} from 'lucide-react'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import EmptyState from '@/components/ui/empty-state'
import { PageLoader } from '@/components/ui/page-loader'
import { apiClient, ApiClientError, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import type { CaseTypeItem } from '@intera/shared/contracts/case-types'

type KnowledgeSource = {
  id: string
  name: string
  description: string | null
  groupIds: string
  dataIds: string | null
  embeddingRate: number
  topK: number
  rerankVersion: string | null
  docCorrelation: number | null
  modelControlTopK: boolean
  caseTypeTag: string | null
  enabled: boolean
}

type GptBotKb = {
  id: string
  name: string
  desc: string
  chunk: number
  doc: number
}

type SearchResult = {
  content: string
  data_id: string
  document_name: string
  chunk_id?: string | number | null
  score: number
}

type RetrievalMeta = {
  query: string
  topK: number
  sourceName?: string | null
  groupIds?: string[]
}

type EditingSource = {
  id?: string
  name: string
  description: string
  groupIds: string[]
  embeddingRate: number
  topK: number
  rerankVersion: string
  docCorrelation: number
  caseTypeTag: string
  enabled: boolean
}

const RERANK_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'Jina-reranker-v2-base-multilingual', label: 'Jina Reranker v2 (Multilingual)' },
  { value: 'BGE-Rerank', label: 'BGE Rerank' },
  { value: 'Jina-colbert-v2', label: 'Jina ColBERT v2' },
  { value: 'BCE-Rerank', label: 'BCE Rerank' },
]

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function toEditingSource(source?: KnowledgeSource | null): EditingSource {
  return {
    id: source?.id,
    name: source?.name || '',
    description: source?.description || '',
    groupIds: parseJsonArray(source?.groupIds),
    embeddingRate: source?.embeddingRate ?? 0.9,
    topK: source?.topK ?? 15,
    rerankVersion: source?.rerankVersion || 'BGE-Rerank',
    docCorrelation: source?.docCorrelation ?? 0.3,
    caseTypeTag: source?.caseTypeTag || '',
    enabled: source?.enabled ?? true,
  }
}

function getToolName(name: string) {
  return `kb_search_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`
}

function getKbName(kbs: GptBotKb[], groupId: string) {
  const kb = kbs.find((item) => item.id === groupId)
  return kb ? `${kb.name} (${kb.chunk} chunks)` : `${groupId.slice(0, 8)}...`
}

function ApiKeyInput({
  agentConfigId,
  onSaved,
}: {
  agentConfigId: string | null
  onSaved: () => void
}) {
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiClient('/api/admin/knowledge/gptbots', {
        method: 'PUT',
        body: {
          agentConfigId: agentConfigId ?? '',
          apiKey: value,
        },
      })
      setStatus('saved')
      onSaved()
      setTimeout(() => setStatus('idle'), 2000)
    } catch {
      setStatus('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Key className="h-4 w-4 flex-shrink-0 text-[var(--color-accent-primary)]" />
      <div className="relative flex-1">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setStatus('idle')
          }}
          placeholder="app-..."
          className="glass-input-console pr-10 text-[12px]"
        />
        <button
          type="button"
          onClick={() => setShow((current) => !current)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-tertiary)]"
        >
          {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
      </div>
      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !value.trim()}
        className="rounded-xl bg-[var(--color-accent-primary)] px-3 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : status === 'saved' ? 'Saved' : status === 'error' ? 'Retry' : 'Save'}
      </button>
    </div>
  )
}

export default function BuildKnowledgePage() {
  const agentConfigId = useSelectedAgentId()
  const { orgId } = useSession()

  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [procedureTypes, setProcedureTypes] = useState<CaseTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [gptKbs, setGptKbs] = useState<GptBotKb[]>([])
  const [gptKbsLoading, setGptKbsLoading] = useState(false)
  const [gptConnected, setGptConnected] = useState<boolean | null>(null)
  const [showAddPicker, setShowAddPicker] = useState(false)

  const [tab, setTab] = useState<'sources' | 'test'>('sources')
  const [editingSource, setEditingSource] = useState<EditingSource | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const [testQuery, setTestQuery] = useState('')
  const [testSourceId, setTestSourceId] = useState('')
  const [testTopK, setTestTopK] = useState(15)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<SearchResult[] | null>(null)
  const [testTotal, setTestTotal] = useState(0)
  const [retrievalMeta, setRetrievalMeta] = useState<RetrievalMeta | null>(null)

  const fetchSources = useCallback(async () => {
    if (!agentConfigId) {
      setSources([])
      return
    }
    const params = `?agentConfigId=${encodeURIComponent(agentConfigId)}`
    const result = await apiClient<{ sources: KnowledgeSource[] }>(`/api/admin/knowledge/sources${params}`)
    setSources(result.data.sources || [])
  }, [agentConfigId])

  const fetchProcedureTypes = useCallback(async () => {
    if (!agentConfigId) {
      setProcedureTypes([])
      return
    }
    const result = await apiClient<{ types: CaseTypeItem[] }>(`/api/admin/case-types?agentConfigId=${encodeURIComponent(agentConfigId)}`)
    setProcedureTypes(result.data.types || [])
  }, [agentConfigId])

  const fetchGptKbs = useCallback(async () => {
    setGptKbsLoading(true)
    try {
      const params = agentConfigId ? `?agentConfigId=${encodeURIComponent(agentConfigId)}` : ''
      const result = await apiClient<{ knowledge_base?: GptBotKb[]; note?: string }>(`/api/admin/knowledge/gptbots${params}`)
      if (Array.isArray(result.data.knowledge_base)) {
        setGptKbs(result.data.knowledge_base)
        setGptConnected(true)
      } else {
        setGptKbs([])
        setGptConnected(false)
      }
    } catch {
      setGptKbs([])
      setGptConnected(false)
    } finally {
      setGptKbsLoading(false)
    }
  }, [agentConfigId])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([fetchSources(), fetchProcedureTypes(), fetchGptKbs()])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Knowledge workspace')
    } finally {
      setLoading(false)
    }
  }, [fetchGptKbs, fetchProcedureTypes, fetchSources])

  useEffect(() => {
    load()
  }, [load])

  const enabledCount = sources.filter((source) => source.enabled).length
  const usedKbIds = useMemo(() => new Set(sources.flatMap((source) => parseJsonArray(source.groupIds))), [sources])
  const availableKbs = useMemo(() => gptKbs.filter((kb) => !usedKbIds.has(kb.id)), [gptKbs, usedKbIds])
  const procedureScopeOptions = useMemo(() => procedureTypes.map((item) => ({
    value: item.type,
    label: item.displayName || item.type,
  })), [procedureTypes])

  const handleSave = useCallback(async () => {
    if (!editingSource?.name || !agentConfigId) return
    setSaving(true)
    setSaveError(null)
    try {
      const url = editingSource.id
        ? `/api/admin/knowledge/sources/${editingSource.id}`
        : '/api/admin/knowledge/sources'
      const method = editingSource.id ? 'PUT' : 'POST'
      await apiClient(url, {
        method,
        body: {
          agentConfigId,
          name: editingSource.name,
          description: editingSource.description || null,
          groupIds: editingSource.groupIds,
          embeddingRate: editingSource.embeddingRate,
          topK: editingSource.topK,
          rerankVersion: editingSource.rerankVersion || null,
          docCorrelation: editingSource.docCorrelation,
          caseTypeTag: editingSource.caseTypeTag || null,
          enabled: editingSource.enabled,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      setEditingSource(null)
      await fetchSources()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save Knowledge source')
    } finally {
      setSaving(false)
    }
  }, [agentConfigId, editingSource, fetchSources, orgId])

  const handleDelete = useCallback(async () => {
    if (!confirmDeleteId || !agentConfigId) return
    const id = confirmDeleteId
    setConfirmDeleteId(null)
    try {
      await apiClient(`/api/admin/knowledge/sources/${id}?agentConfigId=${encodeURIComponent(agentConfigId)}`, { method: 'DELETE' })
      await bustConfigCache(orgId).catch(() => {})
      await fetchSources()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete Knowledge source')
    }
  }, [agentConfigId, confirmDeleteId, fetchSources, orgId])

  const toggleSource = useCallback(async (source: KnowledgeSource) => {
    if (!agentConfigId) return
    try {
      await apiClient(`/api/admin/knowledge/sources/${source.id}`, {
        method: 'PUT',
        body: {
          agentConfigId,
          enabled: !source.enabled,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      await fetchSources()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update Knowledge source')
    }
  }, [agentConfigId, fetchSources, orgId])

  const bindGptBotKb = useCallback(async (kb: GptBotKb) => {
    if (!agentConfigId) return
    try {
      await apiClient('/api/admin/knowledge/sources', {
        method: 'POST',
        body: {
          agentConfigId,
          name: kb.name,
          description: kb.desc || null,
          groupIds: [kb.id],
          embeddingRate: 0.9,
          topK: 15,
          rerankVersion: 'BGE-Rerank',
          docCorrelation: 0.3,
          enabled: true,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      setShowAddPicker(false)
      await fetchSources()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add Knowledge source')
    }
  }, [agentConfigId, fetchSources, orgId])

  const runTest = useCallback(async () => {
    if (!testQuery.trim() || !agentConfigId) return
    setTesting(true)
    setTestError(null)
    setTestResults(null)
    setRetrievalMeta(null)
    try {
      const result = await apiClient('/api/admin/knowledge/test', {
        method: 'POST',
        body: {
          agentConfigId,
          query: testQuery,
          sourceId: testSourceId || undefined,
          topK: testTopK,
        },
      })
      const data = result.data as any
      setTestResults(Array.isArray(data.list) ? data.list : [])
      setTestTotal(Number(data.total ?? data.list?.length ?? 0))
      setRetrievalMeta({
        query: String(data.query ?? testQuery),
        topK: Number(data.topK ?? testTopK),
        sourceName: data.source?.name ?? null,
        groupIds: Array.isArray(data.request?.groupIds) ? data.request.groupIds : undefined,
      })
    } catch (err) {
      setTestError(err instanceof ApiClientError ? err.envelope.error.message : err instanceof Error ? err.message : 'Test retrieval failed')
    } finally {
      setTesting(false)
    }
  }, [agentConfigId, testQuery, testSourceId, testTopK])

  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.knowledge"
      descriptionKey="knowledge"
    >
      <VersionContextBar />
      <PageLoader loading={loading} error={error} onRetry={() => load()}>
        <div className="px-8 py-8">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/70 bg-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                  <Search className="h-4 w-4 text-[#357f7c]" />
                </span>
                <div>
                  <h1 className="text-[22px] font-semibold text-[var(--mist)]">Knowledge</h1>
                  <p className="mt-1 text-[13px] leading-6 text-[var(--fog)]">
                    Enabled sources become `kb_search_*` tools. The agent chooses which sources to query based on source descriptions and current Procedure context.
                  </p>
                </div>
              </div>
            </div>

            <div className="inline-flex items-center gap-2 rounded-[18px] border border-black/[0.06] bg-white/[0.72] px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur-xl">
              <Bot className="h-4 w-4 text-[var(--color-accent-primary)]" />
              <span className="text-[12px] font-semibold text-[var(--color-accent-primary)]">
                {gptConnected ? `${enabledCount} tools active` : `${sources.length} sources configured`}
              </span>
            </div>
          </div>

          <div className="mb-6 rounded-[24px] border border-black/[0.06] bg-white/[0.74] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[var(--mist)]">GPTBots connection</p>
                <p className="mt-1 text-[12px] text-[var(--fog)]">
                  {gptKbsLoading
                    ? 'Checking GPTBots knowledge bases...'
                    : gptConnected
                      ? `Connected. ${gptKbs.length} knowledge base${gptKbs.length === 1 ? '' : 's'} available.`
                      : 'API key not configured for this Agent.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fetchGptKbs()}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-black/[0.06] bg-white/84 px-3 py-2 text-[12px] font-semibold text-[var(--mist)] transition-colors hover:text-[var(--color-accent-primary)]"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
                {gptKbsLoading ? <Loader2 className="h-4 w-4 animate-spin text-[var(--color-accent-primary)]" /> : gptConnected ? <CheckCircle2 className="h-4 w-4 text-malachite" /> : null}
              </div>
            </div>
            <div className="mt-4">
              <ApiKeyInput agentConfigId={agentConfigId} onSaved={fetchGptKbs} />
            </div>
          </div>

          <div className="mb-5 flex items-center gap-2 border-b border-[var(--color-border-subtle)]">
            <button
              type="button"
              onClick={() => setTab('sources')}
              className={`px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === 'sources'
                  ? 'border-b-2 border-[var(--color-accent-primary)] text-[var(--color-accent-primary)]'
                  : 'text-[var(--fog)] hover:text-[var(--mist)]'
              }`}
            >
              Sources ({sources.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('test')}
              className={`px-4 py-2.5 text-[13px] font-semibold transition-colors ${
                tab === 'test'
                  ? 'border-b-2 border-[var(--color-accent-primary)] text-[var(--color-accent-primary)]'
                  : 'text-[var(--fog)] hover:text-[var(--mist)]'
              }`}
            >
              Test retrieval
            </button>
          </div>

          {tab === 'sources' ? (
            <div>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-[14px] font-semibold text-[var(--mist)]">Knowledge sources</h2>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingSource(toEditingSource())}
                    className="inline-flex items-center gap-2 rounded-xl border border-black/[0.06] bg-white/84 px-3.5 py-2 text-[12px] font-semibold text-[var(--mist)] transition-colors hover:text-[var(--color-accent-primary)]"
                  >
                    <Plus className="h-4 w-4" />
                    New source
                  </button>
                  <button
                    type="button"
                    onClick={() => gptConnected && setShowAddPicker(true)}
                    disabled={!gptConnected}
                    className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-accent-primary)]/18 bg-[var(--color-accent-primary)]/[0.08] px-3.5 py-2 text-[12px] font-semibold text-[var(--color-accent-primary)] transition-colors hover:bg-[var(--color-accent-primary)]/[0.14] disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                    Bind GPTBots source
                  </button>
                </div>
              </div>

              {sources.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No Knowledge sources yet"
                  description="Create a source manually or bind an existing GPTBots knowledge base for this Agent."
                  action={{ label: 'New source', onClick: () => setEditingSource(toEditingSource()) }}
                  size="large"
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                  {sources.map((source) => (
                    <div
                      key={source.id}
                      className={`rounded-[24px] border border-black/[0.06] bg-white/[0.74] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl ${!source.enabled ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[14px] font-semibold text-[var(--mist)]">{source.name}</p>
                            <code className="rounded-full border border-black/[0.06] bg-white/82 px-2 py-1 text-[10px] text-[var(--fog)]">
                              {getToolName(source.name)}
                            </code>
                          </div>
                          {source.description ? (
                            <p className="mt-1 line-clamp-2 text-[12px] leading-6 text-[var(--fog)]">{source.description}</p>
                          ) : null}
                        </div>
                        <button type="button" onClick={() => toggleSource(source)}>
                          {source.enabled ? (
                            <ToggleRight className="h-6 w-6 text-malachite" />
                          ) : (
                            <ToggleLeft className="h-6 w-6 text-[var(--color-text-tertiary)]" />
                          )}
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {parseJsonArray(source.groupIds).map((groupId) => (
                          <span
                            key={groupId}
                            className="rounded-full border border-black/[0.06] bg-white/84 px-2.5 py-1 text-[10px] font-medium text-[var(--fog)]"
                            title={getKbName(gptKbs, groupId)}
                          >
                            {getKbName(gptKbs, groupId)}
                          </span>
                        ))}
                      </div>

                      <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--fog)]">
                        <span>topK: {source.topK}</span>
                        <span>embed: {source.embeddingRate}</span>
                        {source.rerankVersion ? <span>rerank: {source.rerankVersion}</span> : null}
                        {source.docCorrelation != null ? <span>min score: {source.docCorrelation}</span> : null}
                        {source.caseTypeTag ? <span className="text-[var(--color-accent-primary)]">procedure: {source.caseTypeTag}</span> : null}
                      </div>

                      <div className="mt-4 flex items-center gap-2 border-t border-[var(--color-border-subtle)] pt-3">
                        <button
                          type="button"
                          onClick={() => setEditingSource(toEditingSource(source))}
                          className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-[var(--mist)] transition-colors hover:bg-black/[0.04]"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(source.id)}
                          className="rounded-lg px-3 py-1.5 text-[12px] font-medium text-vermillion transition-colors hover:bg-vermillion/[0.06]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-black/[0.06] bg-white/[0.74] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
                <div className="flex gap-2">
                  <input
                    value={testQuery}
                    onChange={(event) => setTestQuery(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && runTest()}
                    placeholder="Enter a retrieval test query"
                    className="glass-input-console flex-1 text-[13px]"
                  />
                  <select
                    value={testSourceId}
                    onChange={(event) => setTestSourceId(event.target.value)}
                    className="glass-input-console text-[13px]"
                  >
                    <option value="">All enabled sources</option>
                    {sources.filter((source) => source.enabled).map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={testTopK}
                    onChange={(event) => setTestTopK(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
                    className="glass-input-console w-24 text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={runTest}
                    disabled={testing || !testQuery.trim()}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-accent-primary)] px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                    Search
                  </button>
                </div>
              </div>

              {testError ? (
                <div className="rounded-[20px] border border-vermillion/15 bg-vermillion/[0.06] px-4 py-3 text-[12px] text-vermillion">
                  {testError}
                </div>
              ) : null}

              {testResults ? (
                <div className="space-y-3">
                  <div className="rounded-[20px] border border-black/[0.06] bg-white/[0.74] px-4 py-3 text-[12px] text-[var(--fog)] shadow-[var(--shadow-card)] backdrop-blur-xl">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>query: <span className="font-mono text-[var(--mist)]">{retrievalMeta?.query ?? testQuery}</span></span>
                      <span>topK: <span className="font-mono text-[var(--mist)]">{retrievalMeta?.topK ?? testTopK}</span></span>
                      <span>source: <span className="font-mono text-[var(--mist)]">{retrievalMeta?.sourceName || 'all enabled sources'}</span></span>
                      <span>{testTotal} results</span>
                    </div>
                    {retrievalMeta?.groupIds?.length ? (
                      <p className="mt-1">group_ids: <span className="font-mono text-[var(--mist)]">{retrievalMeta.groupIds.join(', ')}</span></p>
                    ) : null}
                  </div>

                  {testResults.length === 0 ? (
                    <div className="rounded-[20px] border border-black/[0.06] bg-white/[0.74] px-5 py-8 text-center text-[13px] text-[var(--fog)] shadow-[var(--shadow-card)] backdrop-blur-xl">
                      No retrieval results found.
                    </div>
                  ) : (
                    testResults.map((result, index) => (
                      <div
                        key={`${result.data_id}-${index}`}
                        className="rounded-[20px] border border-black/[0.06] bg-white/[0.74] px-4 py-4 shadow-[var(--shadow-card)] backdrop-blur-xl"
                      >
                        <div className="mb-2 flex items-start justify-between gap-3">
                          <span className="truncate text-[11px] font-medium text-[var(--color-accent-primary)]">{result.document_name}</span>
                          <span className="text-[11px] font-semibold text-[var(--color-accent-primary)]">{(result.score * 100).toFixed(1)}%</span>
                        </div>
                        <div className="mb-2 flex flex-wrap gap-3 text-[10px] text-[var(--fog)]">
                          {result.data_id ? <span>doc/data: <span className="font-mono">{result.data_id}</span></span> : null}
                          {result.chunk_id != null ? <span>chunk: <span className="font-mono">{String(result.chunk_id)}</span></span> : null}
                        </div>
                        <p className="whitespace-pre-wrap text-[12px] leading-6 text-[var(--mist)]">{result.content}</p>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {editingSource ? (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh] backdrop-blur-sm"
            onClick={(event) => {
              if (event.target === event.currentTarget) {
                setEditingSource(null)
                setSaveError(null)
              }
            }}
          >
            <div className="mx-4 max-h-[82vh] w-full max-w-2xl overflow-auto rounded-[28px] border border-white/70 bg-[#fffdf8]/95 shadow-[0_24px_64px_rgba(15,23,42,0.18)]">
              <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-6 py-5">
                <div>
                  <h3 className="text-[16px] font-semibold text-[var(--mist)]">
                    {editingSource.id ? 'Edit Knowledge source' : 'New Knowledge source'}
                  </h3>
                  <p className="mt-1 text-[12px] text-[var(--fog)]">The source editor is aligned to the current backend contract. Procedure scope is optional and reuses current Procedure types.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingSource(null)
                    setSaveError(null)
                  }}
                  className="rounded-lg p-2 text-[var(--fog)] transition-colors hover:bg-black/[0.04]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-5 px-6 py-5">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Source name</span>
                    <input
                      value={editingSource.name}
                      onChange={(event) => setEditingSource((current) => current ? { ...current, name: event.target.value } : current)}
                      className="glass-input-console text-[13px]"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Procedure scope (optional)</span>
                    <select
                      value={editingSource.caseTypeTag}
                      onChange={(event) => setEditingSource((current) => current ? { ...current, caseTypeTag: event.target.value } : current)}
                      className="glass-input-console text-[13px]"
                    >
                      <option value="">All procedures</option>
                      {procedureScopeOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-[11px] font-medium text-[var(--fog)]">Description</span>
                  <textarea
                    value={editingSource.description}
                    onChange={(event) => setEditingSource((current) => current ? { ...current, description: event.target.value } : current)}
                    rows={3}
                    className="glass-input-console resize-y text-[13px]"
                  />
                </label>

                <div className="space-y-2">
                  <span className="text-[11px] font-medium text-[var(--fog)]">GPTBots knowledge bases</span>
                  <div className="flex flex-wrap gap-2">
                    {editingSource.groupIds.map((groupId) => (
                      <span
                        key={groupId}
                        className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-2.5 py-1 text-[11px] text-[var(--mist)]"
                      >
                        {getKbName(gptKbs, groupId)}
                        <button
                          type="button"
                          onClick={() => setEditingSource((current) => current ? { ...current, groupIds: current.groupIds.filter((id) => id !== groupId) } : current)}
                          className="text-[var(--fog)] transition-colors hover:text-vermillion"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                  <select
                    value=""
                    onChange={(event) => {
                      const value = event.target.value
                      if (!value) return
                      setEditingSource((current) => {
                        if (!current || current.groupIds.includes(value)) return current
                        return { ...current, groupIds: [...current.groupIds, value] }
                      })
                    }}
                    className="glass-input-console text-[13px]"
                  >
                    <option value="">+ Add knowledge base...</option>
                    {gptKbs.filter((kb) => !editingSource.groupIds.includes(kb.id)).map((kb) => (
                      <option key={kb.id} value={kb.id}>
                        {kb.name} ({kb.chunk} chunks, {kb.doc} docs)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Embedding rate ({editingSource.embeddingRate})</span>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.1"
                      value={editingSource.embeddingRate}
                      onChange={(event) => setEditingSource((current) => current ? { ...current, embeddingRate: Number(event.target.value) } : current)}
                      className="w-full accent-[var(--color-accent-primary)]"
                    />
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Top K</span>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={editingSource.topK}
                      onChange={(event) => setEditingSource((current) => current ? { ...current, topK: Number(event.target.value || 15) } : current)}
                      className="glass-input-console text-[13px]"
                    />
                  </label>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Reranker</span>
                    <select
                      value={editingSource.rerankVersion}
                      onChange={(event) => setEditingSource((current) => current ? { ...current, rerankVersion: event.target.value } : current)}
                      className="glass-input-console text-[13px]"
                    >
                      {RERANK_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1.5">
                    <span className="text-[11px] font-medium text-[var(--fog)]">Min relevance ({editingSource.docCorrelation.toFixed(2)})</span>
                    <input
                      type="range"
                      min="0.1"
                      max="0.95"
                      step="0.05"
                      value={editingSource.docCorrelation}
                      onChange={(event) => setEditingSource((current) => current ? { ...current, docCorrelation: Number(event.target.value) } : current)}
                      className="w-full accent-[var(--color-accent-primary)]"
                    />
                  </label>
                </div>

                <label className="inline-flex items-center gap-2 text-[13px] text-[var(--mist)]">
                  <input
                    type="checkbox"
                    checked={editingSource.enabled}
                    onChange={(event) => setEditingSource((current) => current ? { ...current, enabled: event.target.checked } : current)}
                    className="h-4 w-4 rounded border-[var(--color-border-subtle)]"
                  />
                  Enabled
                </label>
              </div>

              {saveError ? (
                <div className="border-t border-vermillion/10 bg-vermillion/[0.06] px-6 py-3 text-[12px] text-vermillion">
                  {saveError}
                </div>
              ) : null}

              <div className="flex items-center gap-2 border-t border-[var(--color-border-subtle)] px-6 py-4">
                <button
                  type="button"
                  onClick={() => {
                    setEditingSource(null)
                    setSaveError(null)
                  }}
                  className="rounded-xl border border-black/[0.06] bg-white/84 px-4 py-2 text-[12px] font-medium text-[var(--fog)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !editingSource.name.trim()}
                  className="rounded-xl bg-[var(--color-accent-primary)] px-4 py-2 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <ConfirmDialog
          open={!!confirmDeleteId}
          title="Delete Knowledge source?"
          message={confirmDeleteId ? `This will permanently delete ${sources.find((source) => source.id === confirmDeleteId)?.name || 'this source'}.` : ''}
          onCancel={() => setConfirmDeleteId(null)}
          onConfirm={handleDelete}
        />

        {showAddPicker ? (
          <div
            className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-[8vh] backdrop-blur-sm"
            onClick={(event) => {
              if (event.target === event.currentTarget) setShowAddPicker(false)
            }}
          >
            <div className="mx-4 max-h-[82vh] w-full max-w-xl overflow-auto rounded-[28px] border border-white/70 bg-[#fffdf8]/95 shadow-[0_24px_64px_rgba(15,23,42,0.18)]">
              <div className="flex items-center justify-between border-b border-[var(--color-border-subtle)] px-6 py-5">
                <div>
                  <h3 className="text-[16px] font-semibold text-[var(--mist)]">Bind GPTBots knowledge base</h3>
                  <p className="mt-1 text-[12px] text-[var(--fog)]">This creates a local Knowledge source row for the selected GPTBots knowledge base.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAddPicker(false)}
                  className="rounded-lg p-2 text-[var(--fog)] transition-colors hover:bg-black/[0.04]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="px-6 py-5">
                {availableKbs.length === 0 ? (
                  <div className="py-8 text-center text-[13px] text-[var(--fog)]">
                    {gptKbs.length === 0 ? 'No knowledge bases found in GPTBots.' : 'All GPTBots knowledge bases are already bound to this Agent.'}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {availableKbs.map((kb) => (
                      <div
                        key={kb.id}
                        className="flex items-center justify-between gap-3 rounded-[20px] border border-black/[0.06] bg-white/[0.72] px-4 py-3 shadow-[var(--shadow-card)] backdrop-blur-xl"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-[var(--mist)]">{kb.name}</p>
                          {kb.desc ? <p className="mt-0.5 line-clamp-1 text-[11px] text-[var(--fog)]">{kb.desc}</p> : null}
                          <p className="mt-1 text-[10px] text-[var(--fog)]">{kb.chunk} chunks · {kb.doc} docs</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => bindGptBotKb(kb)}
                          className="rounded-xl bg-[var(--color-accent-primary)] px-3 py-1.5 text-[11px] font-semibold text-white transition-opacity hover:opacity-90"
                        >
                          Bind
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </PageLoader>
    </BuildComponentsRouteShell>
  )
}
