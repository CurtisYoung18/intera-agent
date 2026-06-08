'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Search, Plus, Trash2, Edit3, ToggleLeft, ToggleRight,
  Play, RefreshCw, CheckCircle2, XCircle, Loader2,
  Eye, EyeOff, Key, Bot,
} from 'lucide-react'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import ConfirmDialog from '@/components/ui/confirm-dialog'

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
  modelControlTopK: boolean
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

function parseGroupIds(groupIds: string): string[] {
  try { return JSON.parse(groupIds) } catch { return [] }
}

// ── Tab Bar ─────────────────────────────────────────────────────────────

function KnowledgeTabs({ activeTab, onTabChange, sourceCount }: {
  activeTab: 'sources' | 'test'
  onTabChange: (tab: 'sources' | 'test') => void
  sourceCount: number
}) {
  return (
    <div className="flex items-center gap-1 border-b border-[var(--border-subtle)]">
      <button
        onClick={() => onTabChange('sources')}
        className={`px-4 py-2.5 text-[13px] font-semibold transition-colors ${
          activeTab === 'sources'
            ? 'text-[var(--indigo)] border-b-2 border-[var(--indigo)]'
            : 'text-[var(--fog)] hover:text-[var(--mist)]'
        }`}
      >
        Sources ({sourceCount})
      </button>
      <button
        onClick={() => onTabChange('test')}
        className={`px-4 py-2.5 text-[13px] font-semibold transition-colors ${
          activeTab === 'test'
            ? 'text-[var(--indigo)] border-b-2 border-[var(--indigo)]'
            : 'text-[var(--fog)] hover:text-[var(--mist)]'
        }`}
      >
        Test Retrieval
      </button>
    </div>
  )
}

// ── GPTBots Connection (Collapsible) ───────────────────────────────────

function GptBotsConnection({ gptConnected, gptKbs, gptKbsLoading, onRefresh, onKeySaved }: {
  gptConnected: boolean | null
  gptKbs: GptBotKb[]
  gptKbsLoading: boolean
  onRefresh: () => void
  onKeySaved: () => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="glass-card px-4 py-3">
      {/* Collapsed status bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-3 w-full text-left"
      >
        {gptKbsLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-[var(--indigo)]" />
        ) : gptConnected ? (
          <CheckCircle2 className="w-4 h-4 text-[var(--malachite)]" />
        ) : (
          <XCircle className="w-4 h-4 text-[var(--vermillion)]" />
        )}
        <span className="text-[12px] text-[var(--mist)] flex-1">
          GPTBots API: {gptConnected ? `Connected (${gptKbs.length} knowledge bases)` : gptConnected === false ? 'API key not configured' : 'Checking...'}
        </span>
        <Loader2
          className={`w-3.5 h-3.5 text-[var(--fog)] transition-transform duration-[var(--dur-slow)] [var(--ease-glass)] ${expanded ? 'rotate-180' : ''}`}
          style={{ transition: 'transform var(--dur-slow) var(--ease-glass)' }}
        />
      </button>

      {/* Expanded: key input + refresh */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-[var(--border-subtle)] space-y-3">
          <ApiKeyInput onSaved={onKeySaved} />
          <div className="flex items-center justify-between">
            {gptConnected && gptKbs.length > 0 && (
              <span className="text-[11px] text-[var(--fog)] truncate mr-2">
                {gptKbs.map((k) => k.name).join(', ')}
              </span>
            )}
            <button
              onClick={onRefresh}
              className="flex items-center gap-1 text-[11px] text-[var(--indigo)] hover:text-[var(--lavender)] transition-colors flex-shrink-0"
            >
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Source Card ─────────────────────────────────────────────────────────

function SourceCard({ source, toolName, gptKbs, onToggle, onEdit, onDelete }: {
  source: KnowledgeSource
  toolName: string
  gptKbs: GptBotKb[]
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const groupIds = parseGroupIds(source.groupIds)

  const getKbName = (groupId: string): string => {
    const kb = gptKbs.find((k) => k.id === groupId)
    return kb ? `${kb.name} (${kb.chunk} chunks)` : groupId.slice(0, 8) + '...'
  }

  return (
    <div className={`glass-card px-4 py-4 ${!source.enabled ? 'opacity-55' : ''}`}>
      {/* Top row: name + toggle */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-[13px] font-semibold text-[var(--mist)] truncate">{source.name}</p>
            <code className="glass-pill text-[9px] font-mono px-1 py-0.5">{toolName}</code>
          </div>
          {source.description && (
            <p className="text-[11px] text-[var(--fog)] mt-0.5 line-clamp-2">{source.description}</p>
          )}
        </div>
        <button onClick={onToggle} className="flex-shrink-0 mt-0.5">
          {source.enabled
            ? <ToggleRight className="w-5 h-5 text-[var(--malachite)]" />
            : <ToggleLeft className="w-5 h-5 text-[var(--fog)]/40" />
          }
        </button>
      </div>

      {/* Group IDs */}
      <div className="flex flex-wrap gap-1 mb-2">
        {groupIds.map((gid) => (
          <span key={gid} className="glass-pill text-[10px] px-2 py-0.5 font-mono text-[var(--fog)]" title={getKbName(gid)}>
            {getKbName(gid)}
          </span>
        ))}
      </div>

      {/* Params */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--fog)]">
        <span>topK: {source.topK}</span>
        <span>embed: {source.embeddingRate}</span>
        {source.rerankVersion && <span>rerank: {source.rerankVersion?.slice(0, 15)}...</span>}
        {source.docCorrelation != null && <span>minScore: {source.docCorrelation}</span>}
        {source.caseTypeTag && <span className="text-[var(--indigo)]">caseType: {source.caseTypeTag}</span>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 mt-3 pt-2 border-t border-[var(--border-subtle)]">
        <button
          onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-black/[0.04] text-[var(--fog)] transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 rounded-lg hover:bg-red-50 text-[var(--fog)] hover:text-[var(--vermillion)] transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Test Retrieval Tab ──────────────────────────────────────────────────

function TestRetrieval({ sources, testQuery, testSourceId, testResults, testTotal, testing, testError, onQueryChange, onSourceChange, onSearch }: {
  sources: KnowledgeSource[]
  testQuery: string
  testSourceId: string
  testResults: SearchResult[] | null
  testTotal: number
  testing: boolean
  testError: string | null
  onQueryChange: (q: string) => void
  onSourceChange: (id: string) => void
  onSearch: () => void
}) {
  return (
    <div className="space-y-4">
      {/* Query input row */}
      <div className="glass-card px-4 py-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={testQuery}
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="Enter a test query (e.g. 'deposit not showing')"
            className="glass-input-console flex-1"
          />
          <select
            value={testSourceId}
            onChange={(e) => onSourceChange(e.target.value)}
            className="glass-input-console w-auto"
          >
            <option value="">All sources</option>
            {sources.filter((s) => s.enabled).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            onClick={onSearch}
            disabled={testing || !testQuery.trim()}
            className="px-4 py-2 rounded-xl bg-[var(--indigo)] text-white text-[12px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center gap-1.5"
          >
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Search
          </button>
        </div>
      </div>

      {/* Error */}
      {testError && (
        <div className="glass-card px-4 py-3 border-l-2 border-l-[var(--vermillion)]">
          <p className="text-[12px] text-[var(--vermillion)]">{testError}</p>
        </div>
      )}

      {/* Results */}
      {testResults && (
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--fog)] px-1">{testTotal} results</p>
          {testResults.map((r, i) => (
            <div key={i} className="glass-card px-4 py-3">
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-[10px] text-[var(--indigo)] font-mono truncate">{r.document_name}</span>
                <span className="flex-shrink-0 text-[11px] font-semibold text-[var(--indigo)]">
                  {(r.score * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-[12px] text-[var(--mist)] leading-relaxed line-clamp-4 whitespace-pre-wrap">
                {r.content}
              </p>
            </div>
          ))}
          {testResults.length === 0 && (
            <p className="text-[12px] text-[var(--fog)] py-8 text-center glass-card">No results found.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Page ───────────────────────────────────────────────────────────

export default function KnowledgePage() {
  const { t } = useConsoleLocale()
  const agentConfigId = useSelectedAgentId()
  const { orgId } = useSession()

  // Tab state
  const [activeTab, setActiveTab] = useState<'sources' | 'test'>('sources')

  // Source state
  const [sources, setSources] = useState<KnowledgeSource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Edit modal
  const [editingSource, setEditingSource] = useState<Partial<KnowledgeSource> | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // GPTBots KB list
  const [gptKbs, setGptKbs] = useState<GptBotKb[]>([])
  const [gptKbsLoading, setGptKbsLoading] = useState(false)
  const [gptConnected, setGptConnected] = useState<boolean | null>(null)

  // Add source picker
  const [showAddPicker, setShowAddPicker] = useState(false)

  // Test state
  const [testQuery, setTestQuery] = useState('')
  const [testSourceId, setTestSourceId] = useState('')
  const [testResults, setTestResults] = useState<SearchResult[] | null>(null)
  const [testTotal, setTestTotal] = useState(0)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)

  // ── Data loading ───────────────────────────────────────────────────

  const fetchSources = useCallback(async () => {
    try {
      const params = agentConfigId ? `?agentConfigId=${encodeURIComponent(agentConfigId)}` : ''
      const r = await apiClient<{ sources: KnowledgeSource[] }>(`/api/admin/knowledge/sources${params}`)
      setSources(r.data.sources || [])
    } catch {
      setError(t('knowledge.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [agentConfigId])

  const fetchGptKbs = useCallback(async () => {
    setGptKbsLoading(true)
    try {
      const r = await apiClient<{ knowledge_base?: GptBotKb[]; error?: string }>('/api/admin/knowledge/gptbots')
      if (r.data.knowledge_base) {
        setGptKbs(r.data.knowledge_base)
        setGptConnected(true)
      } else {
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

  // ── Binding-based filtering ────────────────────────────────────────

  const enabledCount = sources.filter(s => s.enabled).length

  // GPTBots KBs already used = IDs in groupIds of any source
  const usedKbIds = new Set(
    sources.flatMap(s => parseGroupIds(s.groupIds))
  )
  const availableKbs = gptKbs.filter(kb => !usedKbIds.has(kb.id))

  // ── Source CRUD ────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!editingSource?.name) return
    setSaving(true)
    setSaveError(null)
    try {
      const isNew = !editingSource.id
      const url = isNew
        ? '/api/admin/knowledge/sources'
        : `/api/admin/knowledge/sources/${editingSource.id}`
      const method = isNew ? 'POST' : 'PUT'

      await apiClient(url, { method, body: { ...editingSource, agentConfigId } })
      setEditingSource(null)
      setSaveError(null)
      fetchSources()
      await bustConfigCache(orgId).catch(() => {})
    } catch {
      setSaveError(t('knowledge.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = (id: string) => {
    setConfirmDeleteId(id)
  }

  const confirmDelete = async () => {
    const id = confirmDeleteId
    if (!id) return
    setConfirmDeleteId(null)
    try {
      await apiClient(`/api/admin/knowledge/sources/${id}?agentConfigId=${encodeURIComponent(agentConfigId ?? '')}`, { method: 'DELETE' })
      fetchSources()
    } catch {
      setError(t('knowledge.deleteFailed'))
    }
  }

  const toggleSource = async (source: KnowledgeSource) => {
    try {
      await apiClient(`/api/admin/knowledge/sources/${source.id}`, {
        method: 'PUT',
        body: { agentConfigId, enabled: !source.enabled },
      })
      fetchSources()
    } catch {
      setError(t('knowledge.saveFailed'))
    }
  }

  const bindGptBotKb = async (kb: GptBotKb) => {
    // If KB name already exists in local DB, just close the picker
    const existing = sources.find(s => s.name === kb.name)
    if (existing) {
      setShowAddPicker(false)
      return
    }

    // Create local KnowledgeSource from GPTBots KB
    try {
      await apiClient('/api/admin/knowledge/sources', {
        method: 'POST',
        body: {
          agentConfigId,
          name: kb.name,
          description: kb.desc || null,
          groupIds: JSON.stringify([kb.id]),
          embeddingRate: 0.9,
          topK: 15,
          rerankVersion: 'BGE-Rerank',
          docCorrelation: 0.3,
          enabled: true,
        },
      })
      fetchSources()
      setShowAddPicker(false)
    } catch {
      setError('Failed to add knowledge source')
    }
  }

  // ── Test search ────────────────────────────────────────────────────

  const runTest = async () => {
    if (!testQuery.trim()) return
    setTesting(true)
    setTestError(null)
    setTestResults(null)
    try {
      const res = await apiClient('/api/admin/knowledge/test', {
        method: 'POST',
        body: {
          query: testQuery,
          sourceId: testSourceId || undefined,
          topK: 15,
        },
      })
      const data = res.data as any
      if (data.list) setTestResults(data.list)
      if (data.total) setTestTotal(data.total)
    } catch {
      setTestError('Test request failed')
    } finally {
      setTesting(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div>
      <VersionContextBar />
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
                Each enabled knowledge source becomes a <code className="glass-pill text-[11px] px-1">kb_search_*</code> tool for the agent.
                The agent reads each source&apos;s description and decides which one(s) to query — calling multiple in parallel when needed.
              </p>
            </div>

            {/* Tool generation info badge — AC-B fix */}
            <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-xl glass-card">
              <Bot className="w-4 h-4 text-[var(--indigo)]" />
              <span className="text-[12px] font-semibold text-[var(--indigo)]">
                {gptConnected
                  ? <>{enabledCount} tools active</>
                  : <>{sources.length} sources configured</>
                }
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 px-8 pb-8 space-y-6">
          {/* GPTBots connection — collapsible */}
          <GptBotsConnection
            gptConnected={gptConnected}
            gptKbs={gptKbs}
            gptKbsLoading={gptKbsLoading}
            onRefresh={fetchGptKbs}
            onKeySaved={() => fetchGptKbs()}
          />

          {/* Tabs */}
          <KnowledgeTabs activeTab={activeTab} onTabChange={setActiveTab} sourceCount={sources.length} />

          {/* Tab content */}
          {activeTab === 'sources' ? (
            <div>
              {/* Sources header */}
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[13px] font-semibold text-[var(--mist)]">
                  Knowledge Sources ({sources.length})
                </h2>
                <button
                  onClick={() => gptConnected && setShowAddPicker(true)}
                  disabled={!gptConnected}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl glass-card text-[12px] font-semibold transition-opacity ${
                    gptConnected ? 'text-[var(--malachite)] hover:opacity-80' : 'text-[var(--fog)] opacity-40 cursor-not-allowed'
                  }`}
                  title={!gptConnected ? 'Configure GPTBots API key first' : undefined}
                >
                  <Plus className="w-3.5 h-3.5" /> Add Source
                </button>
              </div>

              {loading ? (
                <div className="flex items-center gap-2 text-[13px] text-[var(--fog)] py-8 justify-center">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : sources.length === 0 ? (
                <div className="glass-card text-center py-12 text-[13px] text-[var(--fog)]">
                  No knowledge sources for this agent. Add a source to get started.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {sources.map((s) => (
                    <SourceCard
                      key={s.id}
                      source={s}
                      toolName={getToolName(s.name)}
                      gptKbs={gptKbs}
                      onToggle={() => toggleSource(s)}
                      onEdit={() => setEditingSource({ ...s })}
                      onDelete={() => handleDelete(s.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <TestRetrieval
              sources={sources}
              testQuery={testQuery}
              testSourceId={testSourceId}
              testResults={testResults}
              testTotal={testTotal}
              testing={testing}
              testError={testError}
              onQueryChange={setTestQuery}
              onSourceChange={setTestSourceId}
              onSearch={runTest}
            />
          )}
        </div>

        {/* Edit Modal */}
        {editingSource && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/20 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) { setEditingSource(null); setSaveError(null) } }}>
            <div className="w-full max-w-lg mx-4 glass-card rounded-2xl shadow-2xl max-h-[80vh] overflow-auto">
              {/* Modal header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
                <h3 className="text-[15px] font-bold text-[var(--mist)]">
                  {editingSource.id ? 'Edit Source' : 'Add Knowledge Source'}
                </h3>
                <button onClick={() => { setEditingSource(null); setSaveError(null) }} className="p-1 rounded-lg hover:bg-black/[0.04]">
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
                    className="glass-input-console"
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
                    className="glass-input-console"
                  />
                </div>

                {/* Group IDs */}
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">
                    GPTBots Knowledge Bases (group_ids)
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(parseGroupIds(editingSource.groupIds || '[]')).map((gid) => (
                      <span key={gid} className="glass-pill text-[11px] text-[var(--indigo)] flex items-center gap-1">
                        {(() => {
                          const kb = gptKbs.find((k) => k.id === gid)
                          return kb ? `${kb.name} (${kb.chunk} chunks)` : gid.slice(0, 8) + '...'
                        })()}
                        <button
                          onClick={() => {
                            const current = parseGroupIds(editingSource.groupIds || '[]')
                            setEditingSource({
                              ...editingSource,
                              groupIds: JSON.stringify(current.filter((id) => id !== gid)),
                            })
                          }}
                          className="text-[var(--fog)] hover:text-[var(--vermillion)]"
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
                    className="glass-input-console"
                  >
                    <option value="">+ Add knowledge base...</option>
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
                      className="w-full accent-[var(--indigo)]"
                    />
                    <div className="flex justify-between text-[9px] text-[var(--fog)]">
                      <span>Keyword</span><span>Semantic</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Top-K</label>
                    <div className="flex items-center gap-3">
                      <input
                        type="number" min={1} max={50}
                        value={editingSource.topK ?? 15}
                        onChange={(e) => setEditingSource({ ...editingSource, topK: parseInt(e.target.value) || 15 })}
                        className="glass-input-console flex-1"
                      />
                      <label className="flex items-center gap-1.5 text-[11px] text-[var(--mist)] cursor-pointer select-none whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={editingSource.modelControlTopK ?? false}
                          onChange={(e) => setEditingSource({ ...editingSource, modelControlTopK: e.target.checked })}
                          className="accent-[var(--indigo)]"
                        />
                        Allow model to control
                      </label>
                    </div>
                    {editingSource.modelControlTopK && (
                      <p className="text-[10px] text-[var(--fog)] mt-1 opacity-60">
                        Model may request 1–30 results. Configured value ({editingSource.topK ?? 15}) is fallback.
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Reranker</label>
                    <select
                      value={editingSource.rerankVersion || ''}
                      onChange={(e) => setEditingSource({ ...editingSource, rerankVersion: e.target.value || null })}
                      className="glass-input-console"
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
                      className="w-full accent-[var(--indigo)]"
                    />
                  </div>
                </div>

                {/* Case type association */}
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--mist)] mb-1">Case Type (optional)</label>
                  <select
                    value={editingSource.caseTypeTag || ''}
                    onChange={(e) => setEditingSource({ ...editingSource, caseTypeTag: e.target.value || null })}
                    className="glass-input-console"
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
                    className="w-4 h-4 rounded accent-[var(--indigo)]"
                  />
                  <span className="text-[12px] text-[var(--mist)]">Enabled</span>
                </label>
              </div>

              {/* Modal footer */}
              {saveError && (
                <div className="px-5 py-2 text-[12px] text-[var(--vermillion)] bg-[var(--vermillion)]/[0.06] border-b border-[var(--vermillion)]/10">{saveError}</div>
              )}
              <div className="flex items-center gap-2 px-5 py-3 border-t border-[var(--border-subtle)]">
                <button
                  onClick={() => { setEditingSource(null); setSaveError(null) }}
                  className="px-4 py-2 rounded-xl glass-card text-[12px] text-[var(--fog)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !editingSource.name}
                  className="px-4 py-2 rounded-xl bg-[var(--indigo)] text-white text-[12px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-40"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <ConfirmDialog
          open={!!confirmDeleteId}
          title={t('knowledge.deleteConfirm')}
          message={t('common.permanentlyDelete', { name: sources.find(s => s.id === confirmDeleteId)?.name ?? '' })}
          onConfirm={confirmDelete}
          onCancel={() => setConfirmDeleteId(null)}
        />

        {/* Add Source Picker */}
        {showAddPicker && (
          <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/20 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) setShowAddPicker(false) }}>
            <div className="w-full max-w-lg mx-4 glass-card rounded-2xl shadow-2xl max-h-[80vh] overflow-auto">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-subtle)]">
                <h3 className="text-[15px] font-bold text-[var(--mist)]">Add Source to Agent</h3>
                <button onClick={() => setShowAddPicker(false)} className="p-1 rounded-lg hover:bg-black/[0.04]">
                  <XCircle className="w-5 h-5 text-[var(--fog)]" />
                </button>
              </div>
              <div className="px-5 py-4">
                {availableKbs.length === 0 ? (
                  <p className="text-[13px] text-[var(--fog)] py-8 text-center">
                    {gptKbs.length === 0
                      ? 'No knowledge bases found in GPTBots.'
                      : 'All knowledge bases are already bound to this agent.'}
                  </p>
                ) : (
                  <div className="space-y-2">
                    {availableKbs.map((kb) => (
                      <div key={kb.id} className="flex items-center justify-between gap-3 glass-card px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold text-[var(--mist)] truncate">{kb.name}</p>
                          {kb.desc && (
                            <p className="text-[11px] text-[var(--fog)] mt-0.5 line-clamp-1">{kb.desc}</p>
                          )}
                          <p className="text-[10px] text-[var(--fog)] mt-0.5">{kb.chunk} chunks · {kb.doc} docs</p>
                        </div>
                        <button
                          onClick={() => bindGptBotKb(kb)}
                          className="px-3 py-1.5 rounded-xl bg-[var(--indigo)] text-white text-[11px] font-semibold hover:opacity-90 transition-opacity flex-shrink-0"
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
        )}
      </div>
    </div>
  )
}

// ── API Key Input ───────────────────────────────────────────────────────

function ApiKeyInput({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')

  const handleSave = async () => {
    setSaving(true)
    try {
      await apiClient('/api/admin/knowledge/gptbots', { method: 'PUT', body: { apiKey: key } })
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2000)
      onSaved()
    } catch { setStatus('error') }
    finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-2 w-full">
      <Key className="w-4 h-4 text-[var(--indigo)] flex-shrink-0" />
      <span className="text-[11px] font-semibold text-[var(--mist)] flex-shrink-0">API Key</span>
      <div className="relative flex-1">
        <input
          type={show ? 'text' : 'password'}
          value={key}
          onChange={(e) => { setKey(e.target.value); setStatus('idle') }}
          placeholder="app-..."
          className="glass-input-console !py-1.5 !text-[12px] !pr-8"
        />
        <button onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--fog)]">
          {show ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
        </button>
      </div>
      <button
        onClick={handleSave}
        disabled={saving || !key.trim()}
        className="px-3 py-1.5 rounded-xl bg-[var(--indigo)] text-white text-[11px] font-semibold hover:opacity-90 disabled:opacity-40 flex-shrink-0 transition-opacity"
      >
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : status === 'saved' ? 'Saved' : status === 'error' ? 'Retry' : 'Save'}
      </button>
    </div>
  )
}
