'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search, Plus, Trash2, Edit3, ToggleLeft, ToggleRight,
  Play, RefreshCw, CheckCircle2, XCircle, Loader2,
  ChevronDown, ExternalLink, GripVertical, Eye, EyeOff, Key, Bot,
} from 'lucide-react'
import { useConsoleLocale } from '@/components/locale-provider'

// ── Types ──────────────────────────────────────────────────────────────

interface KnowledgeSource {
  id: string
  name: string
  description: string | null
  groupIds: string
  dataIds: string | null
  embeddingRate: number
  topK: number
  rerankVersion: string | null
  docCorrelation: number | null
  caseTypeTag: string | null
  enabled: boolean
}

interface GptBotKb {
  id: string
  name: string
  desc: string
  chunk: number
  doc: number
}

interface SearchResult {
  content: string
  data_id: string
  document_name: string
  score: number
}

// ── Helpers ─────────────────────────────────────────────────────────────

const RERANK_OPTIONS = [
  { value: '', label: 'None' },
  { value: 'Jina-reranker-v2-base-multilingual', label: 'Jina Reranker v2 (Multilingual)' },
  { value: 'BGE-Rerank', label: 'BGE Rerank' },
  { value: 'Jina-colbert-v2', label: 'Jina ColBERT v2' },
  { value: 'BCE-Rerank', label: 'BCE Rerank' },
]

const CASE_TYPE_OPTIONS = [
  { value: '', label: 'None (all case types)' },
  { value: 'deposit_issue', label: 'Deposit Issue' },
  { value: 'withdraw_issue', label: 'Withdrawal Issue' },
  { value: 'account_issue', label: 'Account Issue' },
  { value: 'other', label: 'Other' },
]

// ── Page ────────────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const { t } = useConsoleLocale()

  // State
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)


  // Edit panel
  const [editingSource, setEditingSource] = useState<Partial<KnowledgeSource> | null>(null)
  const [saving, setSaving] = useState(false)

  // GPTBots KB list
  const [gptKbs, setGptKbs] = useState<GptBotKb[]>([])
  const [gptKbsLoading, setGptKbsLoading] = useState(false)
  const [gptConnected, setGptConnected] = useState<boolean | null>(null)

  // Test panel
  const [testQuery, setTestQuery] = useState('')
  const [testSourceId, setTestSourceId] = useState('')
  const [testResults, setTestResults] = useState<SearchResult[] | null>(null)
  const [testTotal, setTestTotal] = useState(0)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  // ── Data loading ───────────────────────────────────────────────────

  const fetchSources = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/knowledge/sources')
      const data = await res.json()
      setSources(data.sources || [])
    } catch {
      setError('Failed to load knowledge sources')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchGptKbs = useCallback(async () => {
    setGptKbsLoading(true)
    try {
      const res = await fetch('/api/admin/knowledge/gptbots')
      const data = await res.json()
      if (data.knowledge_base) {
        setGptKbs(data.knowledge_base)
        setGptConnected(true)
      } else if (data.error) {
        setGptConnected(false)
      }
    } catch {
      setGptConnected(false)
    } finally {
      setGptKbsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSources()
    fetchGptKbs()
  }, [fetchSources, fetchGptKbs])

  // ── Tool name helper ───────────────────────────────────────────────

  const getToolName = (name: string) => `kb_search_${name.replace(/[^a-zA-Z0-9_-]/g, '_')}`

  // ── Source CRUD ────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!editingSource?.name) return
    setSaving(true)
    try {
      const isNew = !editingSource.id
      const url = isNew
        ? '/api/admin/knowledge/sources'
        : `/api/admin/knowledge/sources/${editingSource.id}`
      const method = isNew ? 'POST' : 'PUT'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingSource),
      })
      if (!res.ok) {
        const err = await res.json()
        alert(err.error || 'Save failed')
        return
      }
      setEditingSource(null)
      fetchSources()
    } catch {
      alert('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this knowledge source?')) return
    try {
      await fetch(`/api/admin/knowledge/sources/${id}`, { method: 'DELETE' })
      fetchSources()
    } catch {
      alert('Delete failed')
    }
  }

  const toggleSource = async (source: KnowledgeSource) => {
    try {
      await fetch(`/api/admin/knowledge/sources/${source.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !source.enabled }),
      })
      fetchSources()
    } catch {
      // ignore
    }
  }

  // ── Test search ────────────────────────────────────────────────────

  const runTest = async () => {
    if (!testQuery.trim()) return
    setTesting(true)
    setTestError(null)
    setTestResults(null)
    try {
      const res = await fetch('/api/admin/knowledge/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: testQuery,
          sourceId: testSourceId || undefined,
          topK: 5,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setTestError(data.error)
      } else {
        setTestResults(data.list || [])
        setTestTotal(data.total || 0)
      }
    } catch {
      setTestError('Test request failed')
    } finally {
      setTesting(false)
    }
  }

  // ── Parse group IDs for display ────────────────────────────────────

  const parseGroupIds = (groupIds: string): string[] => {
    try { return JSON.parse(groupIds) } catch { return [] }
  }

  const getKbName = (groupId: string): string => {
    const kb = gptKbs.find((k) => k.id === groupId)
    return kb ? `${kb.name} (${kb.chunk} chunks)` : groupId.slice(0, 8) + '…'
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto bg-transparent">
      {/* Header */}
      <div className="flex-shrink-0 px-8 pt-8 pb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, rgba(20,184,166,0.15), rgba(20,184,166,0.05))', color: '#14b8a6' }}>
                <Search className="w-4 h-4" />
              </div>
              <h1 className="text-[22px] font-bold tracking-[-0.025em] text-[var(--mist)]">
                {t('sidebar.knowledge')}
              </h1>
            </div>
            <p className="text-[13px] text-[var(--fog)] max-w-2xl leading-relaxed mt-1">
              Each enabled knowledge source becomes a <code className="text-[11px] bg-teal-500/[0.08] px-1 rounded">kb_search_*</code> tool for the agent.
              The agent reads each source&apos;s description and decides which one(s) to query — calling multiple in parallel when needed.
            </p>
          </div>

          {/* Tool generation info badge */}
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl border border-teal-500/15 bg-teal-500/[0.06]">
            <Bot className="w-4 h-4 text-teal-600" />
            <span className="text-[12px] font-semibold text-teal-700">
              {sources.filter(s => s.enabled).length} tools active
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 px-8 pb-8 space-y-6">

        {/* GPTBots connection status + API key config */}
        <div className="flex items-center gap-3 rounded-xl border border-black/[0.05] bg-white/60 backdrop-blur-sm px-4 py-3">
          {gptKbsLoading ? (
            <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
          ) : gptConnected ? (
            <CheckCircle2 className="w-4 h-4 text-teal-500" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
          <span className="text-[12px] text-[var(--mist)]">
            GPTBots API: {gptConnected ? `Connected (${gptKbs.length} knowledge bases)` : gptConnected === false ? `API key not configured or unreachable` : 'Checking…'}
          </span>
          {gptConnected && (
            <span className="text-[11px] text-[var(--fog)] hidden sm:inline">
              {gptKbs.map((k) => k.name).join(', ')}
            </span>
          )}
          <button
            onClick={fetchGptKbs}
            className="flex items-center gap-1 text-[11px] text-teal-600 hover:text-teal-700"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {/* GPTBots API key config */}
        <div className="flex items-center gap-3 rounded-xl border border-black/[0.05] bg-white/60 backdrop-blur-sm px-4 py-3">
          <ApiKeyInput onSaved={() => { fetchGptKbs() }} />
        </div>

        {/* Sources list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold text-[var(--mist)]">
              Knowledge Sources ({sources.length})
            </h2>
            <button
              onClick={() => setEditingSource({
                name: '', description: '', groupIds: '[]',
                embeddingRate: 0.9, topK: 5, rerankVersion: 'Jina-reranker-v2-base-multilingual',
                docCorrelation: 0.5, caseTypeTag: '', enabled: true,
              })}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-500/25 bg-teal-500/[0.06] text-[12px] font-semibold text-teal-600 hover:bg-teal-500/[0.12] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> Add Source
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-[13px] text-[var(--fog)] py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : sources.length === 0 ? (
            <div className="text-center py-12 text-[13px] text-[var(--fog)]">
              No knowledge sources configured. Click "Add Source" to connect a GPTBots knowledge base.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sources.map((s) => {
                const groupIds = parseGroupIds(s.groupIds)
                return (
                  <div
                    key={s.id}
                    className="relative rounded-xl border border-black/[0.05] bg-white/60 backdrop-blur-sm px-4 py-4"
                  >
                    {/* Top row: name + toggle */}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-[13px] font-semibold text-[var(--mist)] truncate">{s.name}</p>
                          <code className="text-[9px] font-mono text-teal-600 bg-teal-500/[0.08] px-1 py-0.5 rounded">{getToolName(s.name)}</code>
                        </div>
                        {s.description && (
                          <p className="text-[11px] text-[var(--fog)] mt-0.5 line-clamp-2">{s.description}</p>
                        )}
                      </div>
                      <button onClick={() => toggleSource(s)} className="flex-shrink-0 mt-0.5">
                        {s.enabled
                          ? <ToggleRight className="w-5 h-5 text-teal-500" />
                          : <ToggleLeft className="w-5 h-5 text-[var(--fog)]/40" />
                        }
                      </button>
                    </div>

                    {/* Group IDs */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {groupIds.map((gid) => (
                        <span key={gid} className="px-1.5 py-0.5 rounded-md border border-teal-500/15 bg-teal-500/[0.06] text-[10px] text-teal-700 font-mono"
                          title={getKbName(gid)}>
                          {getKbName(gid)}
                        </span>
                      ))}
                    </div>

                    {/* Params */}
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--fog)]">
                      <span>topK: {s.topK}</span>
                      <span>embed: {s.embeddingRate}</span>
                      {s.rerankVersion && <span>rerank: {s.rerankVersion?.slice(0, 15)}…</span>}
                      {s.docCorrelation != null && <span>minScore: {s.docCorrelation}</span>}
                      {s.caseTypeTag && <span className="text-teal-600">caseType: {s.caseTypeTag}</span>}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 mt-3 pt-2 border-t border-black/[0.04]">
                      <button
                        onClick={() => setEditingSource({ ...s })}
                        className="p-1.5 rounded-lg hover:bg-black/[0.04] text-[var(--fog)] transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--fog)] hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Test panel */}
        <div className="rounded-2xl border border-black/[0.05] bg-white/60 backdrop-blur-sm px-5 py-5">
          <h2 className="text-[13px] font-semibold text-[var(--mist)] mb-3 flex items-center gap-2">
            <Play className="w-4 h-4 text-teal-500" /> Test Retrieval
          </h2>

          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runTest()}
              placeholder="Enter a test query (e.g. 'deposit not showing')"
              className="flex-1 px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[13px] text-[var(--mist)] placeholder:text-[var(--fog)]/40 outline-none focus:border-teal-500/30"
            />
            <select
              value={testSourceId}
              onChange={(e) => setTestSourceId(e.target.value)}
              className="px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[12px] text-[var(--mist)] outline-none"
            >
              <option value="">All sources</option>
              {sources.filter((s) => s.enabled).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button
              onClick={runTest}
              disabled={testing || !testQuery.trim()}
              className="px-4 py-2 rounded-lg bg-teal-500 text-white text-[12px] font-semibold hover:bg-teal-600 transition-colors disabled:opacity-40"
            >
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
            </button>
          </div>

          {testError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 mb-3">
              {testError}
            </div>
          )}

          {testResults && (
            <div className="space-y-2">
              <p className="text-[11px] text-[var(--fog)]">{testTotal} results</p>
              {testResults.map((r, i) => (
                <div key={i} className="rounded-lg border border-black/[0.05] bg-white/80 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="text-[10px] text-teal-600 font-mono truncate">{r.document_name}</span>
                    <span className="flex-shrink-0 text-[11px] font-semibold text-teal-600">
                      {(r.score * 100).toFixed(1)}%
                    </span>
                  </div>
                  <p className="text-[12px] text-[var(--mist)] leading-relaxed line-clamp-4 whitespace-pre-wrap">
                    {r.content}
                  </p>
                </div>
              ))}
              {testResults.length === 0 && (
                <p className="text-[12px] text-[var(--fog)] py-4 text-center">No results found.</p>
              )}
            </div>
          )}
        </div>

      </div>

      {/* Edit Modal */}
      {editingSource && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/20 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) setEditingSource(null) }}>
          <div className="w-full max-w-lg mx-4 rounded-2xl border border-black/[0.08] bg-white shadow-2xl max-h-[80vh] overflow-auto">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-black/[0.06]">
              <h3 className="text-[15px] font-bold text-[var(--mist)]">
                {editingSource.id ? 'Edit Source' : 'Add Knowledge Source'}
              </h3>
              <button onClick={() => setEditingSource(null)} className="p-1 rounded-lg hover:bg-black/[0.04]">
                <XCircle className="w-5 h-5 text-[var(--fog)]" />
              </button>
            </div>

            {/* Modal body */}
            <div className="px-5 py-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Name *</label>
                <input
                  type="text"
                  value={editingSource.name || ''}
                  onChange={(e) => setEditingSource({ ...editingSource, name: e.target.value })}
                  placeholder="e.g. Deposit FAQ"
                  className="w-full px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[13px] text-[var(--mist)] outline-none focus:border-teal-500/30"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Description</label>
                <input
                  type="text"
                  value={editingSource.description || ''}
                  onChange={(e) => setEditingSource({ ...editingSource, description: e.target.value })}
                  placeholder="What this source covers"
                  className="w-full px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[13px] text-[var(--mist)] outline-none focus:border-teal-500/30"
                />
              </div>

              {/* Group IDs */}
              <div>
                <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">
                  GPTBots Knowledge Bases (group_ids)
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(parseGroupIds(editingSource.groupIds || '[]')).map((gid) => (
                    <span key={gid} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-teal-500/20 bg-teal-500/[0.06] text-[11px] text-teal-700">
                      {getKbName(gid)}
                      <button
                        onClick={() => {
                          const current = parseGroupIds(editingSource.groupIds || '[]')
                          setEditingSource({
                            ...editingSource,
                            groupIds: JSON.stringify(current.filter((id) => id !== gid)),
                          })
                        }}
                        className="text-teal-400 hover:text-red-500"
                      >
                        <XCircle className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <select
                  value=""
                  onChange={(e) => {
                    if (!e.target.value) return
                    const current = parseGroupIds(editingSource.groupIds || '[]')
                    if (!current.includes(e.target.value)) {
                      setEditingSource({
                        ...editingSource,
                        groupIds: JSON.stringify([...current, e.target.value]),
                      })
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[12px] text-[var(--mist)] outline-none"
                >
                  <option value="">+ Add knowledge base…</option>
                  {gptKbs.filter((k) => !parseGroupIds(editingSource.groupIds || '[]').includes(k.id)).map((k) => (
                    <option key={k.id} value={k.id}>{k.name} ({k.chunk} chunks, {k.doc} docs)</option>
                  ))}
                </select>
              </div>

              {/* Params row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">
                    Embedding Rate ({editingSource.embeddingRate ?? 0.9})
                  </label>
                  <input
                    type="range" min="0" max="1" step="0.1"
                    value={editingSource.embeddingRate ?? 0.9}
                    onChange={(e) => setEditingSource({ ...editingSource, embeddingRate: parseFloat(e.target.value) })}
                    className="w-full accent-teal-500"
                  />
                  <div className="flex justify-between text-[9px] text-[var(--fog)]">
                    <span>Keyword</span><span>Semantic</span>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Top-K</label>
                  <input
                    type="number" min={1} max={50}
                    value={editingSource.topK ?? 5}
                    onChange={(e) => setEditingSource({ ...editingSource, topK: parseInt(e.target.value) || 5 })}
                    className="w-full px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[13px] text-[var(--mist)] outline-none focus:border-teal-500/30"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Reranker</label>
                  <select
                    value={editingSource.rerankVersion || ''}
                    onChange={(e) => setEditingSource({ ...editingSource, rerankVersion: e.target.value || null })}
                    className="w-full px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[12px] text-[var(--mist)] outline-none"
                  >
                    {RERANK_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">
                    Min Relevance ({(editingSource.docCorrelation ?? 0.5).toFixed(2)})
                  </label>
                  <input
                    type="range" min="0.1" max="0.95" step="0.05"
                    value={editingSource.docCorrelation ?? 0.5}
                    onChange={(e) => setEditingSource({ ...editingSource, docCorrelation: parseFloat(e.target.value) })}
                    className="w-full accent-teal-500"
                  />
                </div>
              </div>

              {/* Case type association */}
              <div>
                <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Case Type (optional)</label>
                <select
                  value={editingSource.caseTypeTag || ''}
                  onChange={(e) => setEditingSource({ ...editingSource, caseTypeTag: e.target.value || null })}
                  className="w-full px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[12px] text-[var(--mist)] outline-none"
                >
                  {CASE_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Enabled */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editingSource.enabled ?? true}
                  onChange={(e) => setEditingSource({ ...editingSource, enabled: e.target.checked })}
                  className="w-4 h-4 rounded accent-teal-500"
                />
                <span className="text-[12px] text-[var(--mist)]">Enabled</span>
              </label>
            </div>

            {/* Modal footer */}
            <div className="flex items-center gap-2 px-5 py-3 border-t border-black/[0.06]">
              <button
                onClick={() => setEditingSource(null)}
                className="px-4 py-2 rounded-lg border border-black/[0.08] text-[12px] text-[var(--fog)] hover:bg-black/[0.02] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !editingSource.name}
                className="px-4 py-2 rounded-lg bg-teal-500 text-white text-[12px] font-semibold hover:bg-teal-600 transition-colors disabled:opacity-40"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ApiKeyInput({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/knowledge/gptbots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: key }),
      })
      if (!res.ok) throw new Error('save failed')
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
      onSaved()
    } catch { setStatus('error') }
    finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-2 w-full">
      <Key className="w-4 h-4 text-teal-500 flex-shrink-0" />
      <span className="text-[11px] font-semibold text-[var(--mist)] flex-shrink-0">API Key</span>
      <div className="relative flex-1">
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => { setKey(e.target.value); setStatus('idle') }}
          placeholder="app-..."
          className="w-full px-2.5 py-1.5 text-[12px] border border-black/[0.08] rounded-lg bg-white outline-none focus:border-teal-500/30 pr-8"
        />
        <button onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fog)]">
          {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
      </div>
      <button
        onClick={handleSave}
        disabled={saving || !key.trim()}
        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-teal-500 text-white hover:bg-teal-600 disabled:opacity-40 flex-shrink-0"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : status === 'saved' ? '✓ Saved' : status === 'error' ? 'Retry' : 'Save'}
      </button>
    </div>
  )
}
