'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Puzzle, Plus, Pencil, Trash2, Search, Wand2, Zap, Globe, Box, ToggleLeft, ToggleRight, Lock, Eye, ChevronDown, Plug, BookOpen } from 'lucide-react'
import Link from 'next/link'
import { ListSkeleton } from '@/components/ui/skeleton'
import EmptyState from '@/components/ui/empty-state'
import ImmersiveModal from '@/components/ui/immersive-modal'
import TiltCard from '@/components/ui/tilt-card'
import ConfirmDialog from '@/components/ui/confirm-dialog'

import { useConsoleLocale } from '@/components/locale-provider'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import ToolRenderHintsEditor from '@/components/admin/tool-render-hints-editor'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'
import { apiClient, ApiClientError, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import type { ToolsListResponse, ToolCreateResponse } from '@intera/shared/contracts/tools'

interface ToolItem {
  id: string; name: string; description: string; mode: string
  endpoint?: string | null; httpMethod?: string | null; timeoutMs?: number | null
  inputSchema?: string | null; outputSchema?: string | null; headers?: string | null
  mockFixture?: string | null; renderHints?: string | null; guardPhase?: string | null
  toolCategory?: string | null
  isConcurrencySafe: boolean; enabled: boolean
  isSystem?: boolean
  isChannel?: boolean
  isSpecial?: boolean
}

function parseJsonField(raw: string | null | undefined): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw?.trim()
  if (!trimmed) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

function inferJsonSchema(obj: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const type = Array.isArray(value) ? 'array' : typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : typeof value === 'object' && value !== null ? 'object' : 'string'
    properties[key] = { type }
  }
  return { type: 'object', properties }
}

function mockFixtureChips(raw?: string | null): string[] | null {
  const p = parseJsonField(raw ?? undefined)
  if (!p.ok) return null
  if (p.value === undefined) return []
  const v = p.value
  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
    const entries = Object.entries(v as Record<string, unknown>)
    if (entries.length === 0) return []
    return entries.slice(0, 6).map(([k, val]) => {
      const s =
        val !== null && typeof val === 'object' ? JSON.stringify(val) : String(val)
      const short = s.length > 36 ? `${s.slice(0, 36)}…` : s
      return `${k}: ${short}`
    })
  }
  return [JSON.stringify(v).slice(0, 120)]
}

interface KnowledgeSourceRow {
  id: string
  name: string
  description: string | null
  enabled: boolean
  topK: number
  rerankVersion: string | null
}

const TOOL_DISPLAY_ALIASES: Record<string, { name?: string; description?: string }> = {
  dispatch_case_agent: {
    name: 'start_procedure',
    description: 'Start or select an inline ProcedureRun for a single clear customer issue.',
  },
  finalize_case: {
    name: 'finalize_procedure',
    description: 'Mark the Procedure as resolved with a conclusion.',
  },
  read_chat_memory: {
    description:
      'Read the ProcedureRun working Memory for the current investigation. Returns confirmed facts, tools called so far, key events, and any compaction summary from earlier turns.',
  },
}

function displayToolName(tool: Pick<ToolItem, 'name'>): string {
  return TOOL_DISPLAY_ALIASES[tool.name]?.name ?? tool.name
}

function displayToolDescription(tool: Pick<ToolItem, 'name' | 'description'>): string {
  const raw = TOOL_DISPLAY_ALIASES[tool.name]?.description ?? tool.description ?? ''
  return raw
    .replace(/\bper-case\b/gi, 'ProcedureRun')
    .replace(/\bcase as resolved\b/gi, 'Procedure as resolved')
    .replace(/\bcases\b/gi, 'ProcedureRuns')
    .replace(/\bcase\b/gi, 'ProcedureRun')
    .replace(/\bplatform policy\b/gi, 'platform rule')
}

export default function ToolsPage() {
  const { t } = useConsoleLocale()
  const agentConfigId = useSelectedAgentId()
  const [tools, setTools] = useState<ToolItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<ToolItem | null>(null)
  const [viewTool, setViewTool] = useState<ToolItem | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [originalName, setOriginalName] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; status: number; body: unknown } | null>(null)
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSourceRow[]>([])
  const [kbLoading, setKbLoading] = useState(true)
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const { orgId } = useSession()

  const loadKnowledgeSources = useCallback(async () => {
    try {
      const r = await apiClient<{ sources: KnowledgeSourceRow[] }>('/api/admin/knowledge/sources')
      setKnowledgeSources(r.data.sources || [])
    } catch { /* ignore */ }
    finally { setKbLoading(false) }
  }, [])

  const toggleKnowledgeSource = useCallback(async (src: KnowledgeSourceRow) => {
    const updated = { ...src, enabled: !src.enabled }
    await apiClient(`/api/admin/knowledge/sources/${encodeURIComponent(src.id)}`, {
      method: 'PUT',
      body: { enabled: updated.enabled },
    })
    loadKnowledgeSources()
  }, [loadKnowledgeSources])

  const load = useCallback(async () => {
    try {
      const params = agentConfigId ? `?agentConfigId=${encodeURIComponent(agentConfigId)}` : ''
      const result = await apiClient<ToolsListResponse>(`/api/admin/tools${params}`)
      setTools(result.data.tools || [])
    } catch { /* apiClient throws on envelope errors; fall back gracefully */ }
    setLoading(false)
  }, [agentConfigId])

  useEffect(() => { load(); loadKnowledgeSources() }, [load, loadKnowledgeSources])

  const toggleEnabled = useCallback(async (tool: ToolItem) => {
    await apiClient(`/api/admin/tools/${encodeURIComponent(tool.name)}`, {
      method: 'PUT',
      body: { enabled: !tool.enabled },
    })
    load()
  }, [load])

  const handleSave = useCallback(async () => {
    if (!editing) return
    setSaveError(null)
    setSaveStatus('saving')
    const mf = editing.mockFixture?.trim()
    if (mf) {
      const parsed = parseJsonField(editing.mockFixture)
      if (!parsed.ok) {
        setSaveError(t('tools.mockInvalidJson', { detail: parsed.error }))
        setSaveStatus('error')
        return
      }
    }
    const urlName = isNew ? editing.name : originalName
    const url = isNew ? '/api/admin/tools' : `/api/admin/tools/${encodeURIComponent(urlName)}`
    try {
      await apiClient<ToolCreateResponse>(url, {
        method: isNew ? 'POST' : 'PUT',
        body: editing,
      })
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSaveError(err.envelope.error.message)
      } else {
        setSaveError(t('common.saveFailed'))
      }
      setSaveStatus('error')
      return
    }
    bustConfigCache(orgId).catch(() => {})
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
    setEditing(null); load()
  }, [editing, isNew, load, originalName, t])

  const handleDelete = useCallback(async (name: string) => {
    setConfirmDeleteName(name)
  }, [])

  const confirmDelete = useCallback(async () => {
    const name = confirmDeleteName
    if (!name) return
    setConfirmDeleteName(null)
    await apiClient(`/api/admin/tools/${encodeURIComponent(name)}?agentConfigId=${encodeURIComponent(agentConfigId ?? '')}`, { method: 'DELETE' })
    load()
  }, [confirmDeleteName, load])

  const handleTestEndpoint = useCallback(async () => {
    if (!editing) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await apiClient('/api/admin/tools/test', { method: 'POST', body: editing })
      setTestResult(r.data as any)
    } catch {
      setTestResult({ ok: false, status: 0, body: 'Connection failed' })
    }
    finally { setTesting(false) }
  }, [editing])

  const inferOutputSchema = useCallback(() => {
    if (!editing || !testResult?.body || typeof testResult.body !== 'object') return
    const schema = inferJsonSchema(testResult.body as Record<string, unknown>)
    setEditing({ ...editing, outputSchema: JSON.stringify(schema, null, 2) })
  }, [editing, testResult])

  const formatField = (field: keyof ToolItem) => {
    if (!editing) return
    try { setEditing({ ...editing, [field]: JSON.stringify(JSON.parse(String(editing[field] || '{}')), null, 2) }) } catch {}
  }

  const prefillDefaultMock = (_name: string): string | undefined => {
    return undefined
  }

  const openNew = () => {
    setEditing({ id: '', name: '', description: '', mode: 'static', mockFixture: '{"status":"ok"}', isConcurrencySafe: true, enabled: true })
    setIsNew(true); setOriginalName('')
  }

  const openEdit = (s: ToolItem) => { if (s.isSpecial || s.mode === 'engine_managed' || s.mode === 'channel') return; setEditing({ ...s }); setIsNew(false); setOriginalName(s.name) }

  const filtered = tools.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.description || '').toLowerCase().includes(search.toLowerCase())
  )

  const systemTools = filtered.filter(s => s.isSystem)
  const channelTools = filtered.filter(s => s.isChannel)
  const specialTools = filtered.filter(s => s.isSpecial)
  const businessTools = filtered.filter(s => !s.isSystem && !s.isChannel && !s.isSpecial)

  if (loading) return <div className="p-8"><ListSkeleton /></div>

  return (
    <div>
      <VersionContextBar />
      <div className="px-8 py-8 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('tools.title')}</h1>
          <p className="text-[13px] text-[var(--fog)] mt-0.5">{t('tools.subtitle', { n: tools.length })}</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all">
          <Plus className="w-4 h-4" /> {t('tools.new')}
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--smoke)]" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('tools.searchPh')} className="glass-input-console pl-10 text-[13px]" />
      </div>


      {filtered.length === 0 ? (
        <EmptyState icon={Puzzle} title={t('tools.noTools')} description={search ? t('common.noMatches') : t('tools.noToolsDesc')} />
      ) : (
        <div className="space-y-10">
          {/* ── System Tools ── */}
          {systemTools.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-[15px] font-semibold text-[var(--mist)]">{t('tools.systemTools')}</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-sky/[0.08] text-sky border border-sky/20">{t('tools.system')}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {systemTools.map(s => (
                  <TiltCard key={s.id || s.name} accentColor={s.mode === 'http' ? '#5bb8f7' : s.mode === 'engine_managed' ? '#d97706' : s.mode === 'channel' ? '#7c3aed' : '#8b6ff5'} onClick={() => setViewTool(s)}>
                    <div className="p-5">
                      {/* Top row: icon + name + lock (no toggle for system tools) */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.mode === 'http' ? 'bg-sky/[0.08]' : s.mode === 'engine_managed' ? 'bg-amber/[0.08]' : s.mode === 'channel' ? 'bg-purple/[0.08]' : 'bg-lavender/[0.08]'}`}>
                          {s.mode === 'http' ? <Globe className="w-5 h-5 text-sky" /> : s.mode === 'engine_managed' ? <Zap className="w-5 h-5 text-amber" /> : s.mode === 'channel' ? <Plug className="w-5 h-5 text-purple" /> : <Box className="w-5 h-5 text-lavender" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-[var(--mist)] truncate">{displayToolName(s)}</span>
                            <Lock className="w-3 h-3 text-amber/70 flex-shrink-0" />
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.mode === 'http' ? 'bg-sky/[0.08] text-sky' : s.mode === 'engine_managed' ? 'bg-amber/[0.08] text-amber' : s.mode === 'channel' ? 'bg-purple/[0.08] text-purple' : 'bg-lavender/[0.08] text-lavender'}`}>{s.mode === 'engine_managed' ? 'System' : s.mode === 'channel' ? 'Channel' : t(s.mode === 'http' ? 'common.http' : 'common.mock')}</span>
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-2">{displayToolDescription(s) || t('common.noDescription')}</p>

                      {/* Bottom: read-only hint slides up on hover */}
                      <div className="flex items-center justify-end translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 ease-out">
                        <span className="flex items-center gap-1 text-[10px] text-[var(--fog)]/60">
                          <Eye className="w-3 h-3" /> View details
                        </span>
                      </div>
                    </div>
                  </TiltCard>
                ))}
              </div>
            </section>
          )}

          {/* ── Channel Tools ── */}
          {channelTools.length > 0 && (
            <section className="mb-8">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="text-[15px] font-semibold text-[var(--mist)]">Channel Tools</h2>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple/[0.08] text-purple border border-purple/20">Channel</span>
              </div>
              <p className="text-[12px] text-[var(--fog)] mb-4">Behavior varies per channel — configured in each Channel&apos;s detail page.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {channelTools.map(s => (
                  <div key={s.id || s.name} className="rounded-2xl border border-purple/[0.12] bg-white/60 p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-purple/[0.08]">
                        <Plug className="w-5 h-5 text-purple" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-[13px] font-semibold text-[var(--mist)] truncate block">{displayToolName(s)}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-purple/[0.08] text-purple">Channel</span>
                        </div>
                      </div>
                      {/* Functional toggle for channel tools */}
                      <button
                        onClick={() => toggleEnabled(s)}
                        className="flex-shrink-0 transition-opacity hover:opacity-80"
                        title={s.enabled ? 'Click to disable' : 'Click to enable'}
                      >
                        {s.enabled
                          ? <ToggleRight className="w-7 h-7 text-malachite" />
                          : <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />}
                      </button>
                    </div>
                    {displayToolDescription(s) ? <p className="text-[12px] text-[var(--fog)] line-clamp-3">{displayToolDescription(s)}</p> : null}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Knowledge Search Tools (auto-generated kb_search_* per source) ── */}
          <section className="mb-8">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-[15px] font-semibold text-[var(--mist)]">Knowledge Search Tools</h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-teal-500/[0.08] text-teal-600 border border-teal-500/20">Auto-generated</span>
            </div>
            <p className="text-[12px] text-[var(--fog)] mb-4">
              Each source below auto-generates a <code className="text-[11px] bg-teal-500/[0.08] px-1 rounded">kb_search_&lt;name&gt;</code> tool.
              Toggle here or configure details on the{' '}
              <Link href="/admin/knowledge" className="text-teal-600 hover:text-teal-700 underline">Knowledge page</Link>.
            </p>
            {kbLoading ? (
              <div className="text-[12px] text-[var(--fog)]">Loading knowledge sources…</div>
            ) : knowledgeSources.length === 0 ? (
              <div className="rounded-xl border border-teal-500/15 bg-teal-500/[0.04] p-4 text-[12px] text-[var(--fog)]">
                No knowledge sources configured.{' '}
                <Link href="/admin/knowledge" className="text-teal-600 underline">Add one →</Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {knowledgeSources.map(src => (
                  <div key={src.id} className="rounded-2xl border border-teal-500/[0.12] bg-white/60 p-5">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-teal-500/[0.08]">
                        <BookOpen className="w-5 h-5 text-teal-500" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-[var(--mist)] truncate">kb_search_{src.name.replace(/[^a-zA-Z0-9_-]/g, '_')}</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-teal-500/[0.08] text-teal-600 mt-0.5 inline-block">KB source</span>
                      </div>
                      <button
                        onClick={() => toggleKnowledgeSource(src)}
                        className="flex-shrink-0 transition-opacity hover:opacity-80"
                        title={src.enabled ? 'Click to disable' : 'Click to enable'}
                      >
                        {src.enabled
                          ? <ToggleRight className="w-7 h-7 text-malachite" />
                          : <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />}
                      </button>
                    </div>
                    {src.description && (
                      <p className="mt-2 text-[12px] text-[var(--fog)] line-clamp-2">{src.description}</p>
                    )}
                    <div className="mt-2 flex gap-2 text-[10px] text-[var(--smoke)]">
                      {src.rerankVersion && <span className="px-1.5 py-0.5 rounded bg-teal-500/[0.06]">{src.rerankVersion.split('-')[0]}</span>}
                      <span className="px-1.5 py-0.5 rounded bg-black/[0.04]">topK {src.topK}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Special Tools ── */}
          {specialTools.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[15px] font-semibold text-[var(--mist)] mb-1">{t('tools.specialTools')}</h2>
              <p className="text-[12px] text-[var(--fog)] mb-4">Configured in dedicated pages</p>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {specialTools.map(s => (
                  <TiltCard key={s.id || s.name} accentColor="#14b8a6" onClick={() => s.mode !== 'engine_managed' && s.mode !== 'channel' && openEdit(s)}>
                    <div className="p-5">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-teal-500/[0.08]">
                          <Search className="w-5 h-5 text-teal-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-[var(--mist)] truncate">{displayToolName(s)}</div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); toggleEnabled(s) }} className="flex-shrink-0">
                          {s.enabled ? <ToggleRight className="w-7 h-7 text-malachite" /> : <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />}
                        </button>
                      </div>
                      <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-2">{displayToolDescription(s) || t('common.noDescription')}</p>
                    </div>
                  </TiltCard>
                ))}
              </div>
            </section>
          )}

          {/* ── Business Tools ── */}
          {businessTools.length > 0 && (
            <section>
              <h2 className="text-[15px] font-semibold text-[var(--mist)] mb-4">{t('tools.businessTools')}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {businessTools.map(s => (
                  <TiltCard key={s.id || s.name} accentColor={s.mode === 'http' ? '#5bb8f7' : s.mode === 'engine_managed' ? '#d97706' : s.mode === 'channel' ? '#7c3aed' : '#8b6ff5'} onClick={() => s.mode !== 'engine_managed' && s.mode !== 'channel' && openEdit(s)}>
                    <div className="p-5">
                      {/* Top row: icon + info + toggle */}
                      <div className="flex items-start gap-3 mb-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.mode === 'http' ? 'bg-sky/[0.08]' : s.mode === 'engine_managed' ? 'bg-amber/[0.08]' : s.mode === 'channel' ? 'bg-purple/[0.08]' : 'bg-lavender/[0.08]'}`}>
                          {s.mode === 'http' ? <Globe className="w-5 h-5 text-sky" /> : s.mode === 'engine_managed' ? <Zap className="w-5 h-5 text-amber" /> : s.mode === 'channel' ? <Plug className="w-5 h-5 text-purple" /> : <Box className="w-5 h-5 text-lavender" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold text-[var(--mist)] truncate">{displayToolName(s)}</div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${s.mode === 'http' ? 'bg-sky/[0.08] text-sky' : s.mode === 'engine_managed' ? 'bg-amber/[0.08] text-amber' : s.mode === 'channel' ? 'bg-purple/[0.08] text-purple' : 'bg-lavender/[0.08] text-lavender'}`}>{s.mode === 'engine_managed' ? 'System' : s.mode === 'channel' ? 'Channel' : t(s.mode === 'http' ? 'common.http' : 'common.mock')}</span>
                            {(() => { try { return s.renderHints && JSON.parse(s.renderHints)?.livechat } catch { return false } })() && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium bg-indigo/[0.06] text-indigo flex items-center gap-1"><Plug className="w-2.5 h-2.5" />LiveChat</span>
                            )}
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); toggleEnabled(s) }} className="flex-shrink-0 transition-colors">
                          {s.enabled
                            ? <ToggleRight className="w-7 h-7 text-malachite" />
                            : <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />
                          }
                        </button>
                      </div>

                      {/* Description */}
                      <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-3">{displayToolDescription(s) || t('common.noDescription')}</p>

                      {s.mode === 'static' && (
                        <div className="mb-3 rounded-lg border border-[var(--border-subtle)] bg-black/[0.02] px-2.5 py-2">
                          <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--smoke)] mb-1.5">{t('tools.mockCardPreview')}</div>
                          {(() => {
                            const chips = mockFixtureChips(s.mockFixture)
                            if (!s.mockFixture?.trim()) {
                              return <p className="text-[11px] text-[var(--smoke)] italic">{t('tools.noMockYet')}</p>
                            }
                            if (chips === null) {
                              return <p className="text-[11px] text-vermillion/80">{t('tools.mockMalformedCard')}</p>
                            }
                            if (chips.length === 0) {
                              return <span className="text-[11px] font-mono text-[var(--fog)]">{'{}'}</span>
                            }
                            return (
                              <div className="flex flex-wrap gap-1">
                                {chips.map((c, i) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-md bg-lavender/[0.08] text-lavender/90 font-mono max-w-full truncate border border-lavender/15" title={c}>{c}</span>
                                ))}
                              </div>
                            )
                          })()}
                        </div>
                      )}
                      {/* Bottom actions — slide up on hover */}
                      <div className="flex items-center justify-between translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 ease-out">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-[var(--smoke)]">{s.enabled ? t('common.active') : t('common.disabled')}</span>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={e => { e.stopPropagation(); openEdit(s) }}
                            className="p-1.5 rounded-lg hover:bg-black/5 transition-colors" title={t('common.edit')}>
                            <Pencil className="w-3.5 h-3.5 text-[var(--fog)]" />
                          </button>
                          <button onClick={e => { e.stopPropagation(); handleDelete(s.name) }}
                            className="p-1.5 rounded-lg hover:bg-vermillion/5 transition-colors" title={t('common.delete')}>
                            <Trash2 className="w-3.5 h-3.5 text-vermillion/60" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </TiltCard>
                ))}
              </div>
            </section>
          )}
        </div>
      )}


      {/* Read-only detail panel for system tools */}
      <ImmersiveModal open={!!viewTool} onClose={() => setViewTool(null)} title={viewTool?.name ?? ''}>
        {viewTool && (
          <div className="space-y-4">
            {/* Mode + locked badge */}
            <div className="flex items-center gap-2">
              <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${viewTool.mode === 'engine_managed' ? 'bg-amber/[0.08] text-amber' : viewTool.mode === 'channel' ? 'bg-purple/[0.08] text-purple' : 'bg-lavender/[0.08] text-lavender'}`}>
                {viewTool.mode === 'engine_managed' ? 'System' : viewTool.mode === 'channel' ? 'Channel' : viewTool.mode}
              </span>
              <span className="flex items-center gap-1 text-[11px] text-amber/80 bg-amber/[0.06] px-2 py-0.5 rounded-full">
                <Lock className="w-3 h-3" /> Read-only — managed by the engine
              </span>
            </div>
            {/* Description */}
            <div>
              <p className="text-[11px] font-medium text-[var(--fog)] mb-1">{t('common.description')}</p>
              <p className="text-[13px] text-[var(--mist)] leading-relaxed">{displayToolDescription(viewTool) || t('common.noDescription')}</p>
            </div>
            {/* LLM model view */}
            <div>
              <p className="text-[11px] font-medium text-[var(--fog)] mb-1 flex items-center gap-1"><Eye className="w-3 h-3" /> Model sees</p>
              <pre className="text-[10px] font-mono text-[var(--mist)] p-3 rounded-xl bg-black/[0.04] border border-[var(--border-subtle)] overflow-auto max-h-[260px] whitespace-pre-wrap">
{JSON.stringify({
  name: displayToolName(viewTool),
  description: displayToolDescription(viewTool) || '',
  input_schema: (() => { try { return JSON.parse(viewTool.inputSchema || '{}') } catch { return {} } })(),
}, null, 2)}
              </pre>
            </div>
            <div className="pt-4 border-t border-[var(--border-subtle)]">
              <button type="button" onClick={() => setViewTool(null)} className="w-full py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">
                Close
              </button>
            </div>
          </div>
        )}
      </ImmersiveModal>

      {/* Slide Panel Editor — same logic as before */}
      <ImmersiveModal open={!!editing} onClose={() => setEditing(null)} title={isNew ? t('tools.newTool') : t('tools.editTool')}>
        {editing && (
          <div className="space-y-4">
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)] flex items-center gap-1">
                {t('common.name')}
                {editing.isSystem && <Lock className="w-3 h-3 text-amber/70" />}
              </span>
              <input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} className="glass-input-console text-[13px] font-mono" disabled={!isNew || !!editing.isSystem} />
            </label>
            <label className="space-y-1.5 block">
              <span className="text-[11px] text-[var(--fog)] flex items-center gap-1">
                {t('common.mode')}
                {editing.isSystem && <Lock className="w-3 h-3 text-amber/70" />}
              </span>
              <select value={editing.mode} onChange={e => {
                const newMode = e.target.value
                const update: Partial<ToolItem> = { mode: newMode }
                if (newMode === 'static' && !editing.mockFixture?.trim()) {
                  update.mockFixture = prefillDefaultMock(editing.name) || '{"status":"ok"}'
                }
                setEditing({ ...editing, ...update })
              }} className="glass-input-console text-[13px]" disabled={!!editing.isSystem}>
                <option value="static">{t('common.mock')}</option><option value="http">{t('common.http')}</option><option value="engine_managed">System Managed</option>
              </select>
            </label>
            <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('common.description')}</span>
              <input value={editing.description || ''} onChange={e => setEditing({ ...editing, description: e.target.value })} className="glass-input-console text-[13px]" />
            </label>

            {/* Model Preview — LLM perspective of this tool */}
            <details className="rounded-xl border border-indigo/15 bg-indigo/[0.02] px-4 py-3">
              <summary className="text-[11px] font-semibold text-indigo cursor-pointer list-none flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" /> Model Preview (LLM sees)
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-indigo/60 group-open:rotate-180 transition-transform" />
              </summary>
              <pre className="mt-3 text-[10px] font-mono text-[var(--mist)] p-3 rounded-lg bg-black/[0.04] border border-[var(--border-subtle)] overflow-auto max-h-[200px] whitespace-pre-wrap">
{JSON.stringify({
  name: editing.name || '(unnamed)',
  description: editing.description || '(no description)',
  input_schema: (() => { try { return JSON.parse(editing.inputSchema || '{}') } catch { return {} } })(),
}, null, 2)}
              </pre>
            </details>

            {/* Static fixture — primary when mode is mock */}
            {editing.mode === 'static' ? (
              <div className="rounded-xl border border-lavender/25 bg-lavender/[0.05] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-lavender">{t('tools.mockResponseEditor')}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    {editing.name && prefillDefaultMock(editing.name) && (
                      <button type="button" onClick={() => setEditing({ ...editing, mockFixture: prefillDefaultMock(editing.name) })} className="text-[10px] text-lavender/70 hover:text-lavender flex items-center gap-1">
                        <Zap className="w-3 h-3" />{t('tools.resetDefault')}
                      </button>
                    )}
                    <button type="button" onClick={() => formatField('mockFixture')} className="text-[10px] text-indigo/70 hover:text-indigo flex items-center gap-1">
                      <Wand2 className="w-3 h-3" />{t('common.format')}
                    </button>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-3">
                  <label className="space-y-1.5 block min-h-0">
                    <span className="text-[10px] text-[var(--fog)]">{t('tools.mockSourceJson')}</span>
                    <textarea
                      value={editing.mockFixture || ''}
                      onChange={e => setEditing({ ...editing, mockFixture: e.target.value })}
                      rows={14}
                      spellCheck={false}
                      className="glass-input-console text-[12px] font-mono resize-y min-h-[220px] w-full"
                      placeholder={`{\n  "status": "pending"\n}`}
                    />
                  </label>
                  <div className="flex flex-col min-h-0">
                    <span className="text-[10px] text-[var(--fog)] mb-1">{t('tools.mockLivePreview')}</span>
                    {(() => {
                      const p = parseJsonField(editing.mockFixture)
                      if (!editing.mockFixture?.trim()) {
                        return (
                          <pre className="flex-1 text-[11px] font-mono text-[var(--smoke)] p-3 rounded-lg bg-black/[0.03] border border-[var(--border-subtle)] whitespace-pre-wrap">{t('tools.mockPreviewEmpty')}</pre>
                        )
                      }
                      if (!p.ok) {
                        return (
                          <pre className="flex-1 text-[11px] font-mono text-vermillion/90 p-3 rounded-lg bg-vermillion/[0.06] border border-vermillion/20 whitespace-pre-wrap">{t('tools.mockInvalidJson', { detail: p.error })}</pre>
                        )
                      }
                      return (
                        <pre className="flex-1 text-[11px] font-mono text-[var(--mist)] p-3 rounded-lg bg-black/[0.04] border border-[var(--border-subtle)] overflow-auto max-h-[340px] whitespace-pre-wrap">{JSON.stringify(p.value, null, 2)}</pre>
                      )
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <details className="rounded-xl border border-[var(--border-subtle)] bg-black/[0.02] px-4 py-3 group/mockfix">
                <summary className="text-[11px] font-medium text-[var(--fog)] cursor-pointer list-none flex items-center justify-between">
                  <span>{t('tools.mockOptionalHttp')}</span>
                  <span className="text-[10px] text-[var(--smoke)] opacity-70">{t('tools.mockOptionalToggle')}</span>
                </summary>
                <div className="mt-3 space-y-2 pt-2 border-t border-[var(--border-subtle)]">
                  <div className="flex justify-end">
                    <button type="button" onClick={() => formatField('mockFixture')} className="text-[10px] text-indigo/70 hover:text-indigo flex items-center gap-1">
                      <Wand2 className="w-3 h-3" />{t('common.format')}
                    </button>
                  </div>
                  <textarea
                    value={editing.mockFixture || ''}
                    onChange={e => setEditing({ ...editing, mockFixture: e.target.value })}
                    rows={5}
                    spellCheck={false}
                    className="glass-input-console text-[12px] font-mono resize-y w-full"
                  />
                  {(() => {
                    const p = parseJsonField(editing.mockFixture)
                    if (!editing.mockFixture?.trim()) return null
                    if (!p.ok) {
                      return <p className="text-[11px] text-vermillion/85">{t('tools.mockInvalidJson', { detail: p.error })}</p>
                    }
                    return (
                      <pre className="text-[11px] font-mono text-[var(--mist)] p-3 rounded-lg bg-black/[0.03] border border-[var(--border-subtle)] overflow-auto max-h-[160px]">{JSON.stringify(p.value, null, 2)}</pre>
                    )
                  })()}
                </div>
              </details>
            )}

            {/* LiveChat Render Hints */}
            <details className="rounded-xl border border-indigo/15 bg-indigo/[0.02] px-4 py-3">
              <summary className="text-[11px] font-semibold text-indigo cursor-pointer list-none flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Eye className="w-3.5 h-3.5" /> LiveChat Rich Rendering
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-indigo/60 group-open:rotate-180 transition-transform" />
              </summary>
              <div className="mt-3">
                <ToolRenderHintsEditor
                  value={(() => {
                    try { return editing.renderHints ? (JSON.parse(editing.renderHints)?.livechat as LivechatRenderHint) : undefined }
                    catch { return undefined }
                  })()}
                  onChange={(hint) => {
                    const current = (() => { try { return JSON.parse(editing.renderHints || '{}') } catch { return {} } })()
                    const updated = { ...current, livechat: hint }
                    setEditing({ ...editing, renderHints: JSON.stringify(updated) })
                  }}
                  mockFixture={(() => { try { return JSON.parse(editing.mockFixture || '') } catch { return undefined } })()}
                />
              </div>
            </details>

            <div className={`space-y-3 ${editing.mode === 'static' ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="border-t border-[var(--border-subtle)] pt-3"><span className="text-[11px] font-medium text-[var(--fog)]">{t('tools.httpConfig')}</span></div>
              <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('tools.endpoint')}</span>
                <input value={editing.endpoint || ''} onChange={e => setEditing({ ...editing, endpoint: e.target.value })} className="glass-input-console text-[13px] font-mono" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">{t('common.method')}</span>
                  <select value={editing.httpMethod || 'POST'} onChange={e => setEditing({ ...editing, httpMethod: e.target.value })} className="glass-input-console text-[13px]"><option>POST</option><option>GET</option></select>
                </label>
                <label className="space-y-1.5"><span className="text-[11px] text-[var(--fog)]">{t('tools.timeoutMs')}</span>
                  <input type="number" value={editing.timeoutMs || 10000} onChange={e => setEditing({ ...editing, timeoutMs: parseInt(e.target.value) || 10000 })} className="glass-input-console text-[13px] font-mono" />
                </label>
              </div>
              <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">{t('tools.guardPhase')}</span>
                <select value={editing.guardPhase || 'pre'} onChange={e => setEditing({ ...editing, guardPhase: e.target.value })} className="glass-input-console text-[13px]"><option value="pre">pre</option><option value="post">post</option></select>
              </label>
              <label className="space-y-1.5 block"><span className="text-[11px] text-[var(--fog)]">Tool Category</span>
                <select value={editing.toolCategory || ''} onChange={e => setEditing({ ...editing, toolCategory: (e.target.value || undefined) as 'system_info' | 'operational' | undefined })} className="glass-input-console text-[13px]">
                  <option value="">— Default (operational) —</option>
                  <option value="system_info">system_info — Always available to main agent</option>
                  <option value="operational">operational — Togglable per channel</option>
                </select>
              </label>
              <button onClick={handleTestEndpoint} disabled={testing} className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] bg-sky/[0.06] border border-sky/20 text-sky hover:bg-sky/[0.1] transition-all">
                <Zap className="w-3.5 h-3.5" />{testing ? t('tools.testing') : t('tools.testEndpoint')}
              </button>

              {testResult && (
                <div className={`rounded-lg p-3 text-[11px] ${testResult.ok ? 'bg-malachite/[0.06] border border-malachite/20' : 'bg-vermillion/[0.06] border border-vermillion/20'}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={testResult.ok ? 'text-malachite' : 'text-vermillion'}>
                      {testResult.ok ? `HTTP ${testResult.status}` : `Error: ${String(testResult.body)}`}
                    </span>
                    {testResult.ok && !!testResult.body && typeof testResult.body === 'object' && (
                      <button onClick={inferOutputSchema} className="text-[10px] px-2 py-0.5 rounded bg-malachite/[0.1] border border-malachite/20 text-malachite hover:bg-malachite/[0.2] transition-colors">
                        Infer outputSchema
                      </button>
                    )}
                  </div>
                  {testResult.ok && !!testResult.body && (
                    <pre className="text-[10px] font-mono text-[var(--mist)] max-h-[120px] overflow-auto whitespace-pre-wrap">{JSON.stringify(testResult.body, null, 2)}</pre>
                  )}
                </div>
              )}
            </div>
            {(['inputSchema', 'outputSchema', 'headers'] as const).map(f => {
              const fk = (
                {
                  inputSchema: 'tools.inputSchema',
                  outputSchema: 'tools.outputSchema',
                  headers: 'tools.headers',
                } as const
              )[f]
              const isInputLocked = f === 'inputSchema' && editing.isSystem
              return (
              <label key={f} className="space-y-1.5 block">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-[var(--fog)] flex items-center gap-1">
                    {t(fk)}
                    {isInputLocked && <Lock className="w-3 h-3 text-amber/70" />}
                  </span>
                  {!isInputLocked && (
                    <button type="button" onClick={() => formatField(f)} className="text-[10px] text-indigo/70 hover:text-indigo"><Wand2 className="w-3 h-3 inline mr-1" />{t('common.format')}</button>
                  )}
                </div>
                <textarea value={(editing[f] as string) || ''} onChange={e => setEditing({ ...editing, [f]: e.target.value })} rows={4} className="glass-input-console text-[12px] font-mono resize-y" disabled={isInputLocked} />
              </label>
            )})}
            <div className="flex items-center gap-4 pt-2">
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={editing.isConcurrencySafe} onChange={e => setEditing({ ...editing, isConcurrencySafe: e.target.checked })} className="accent-indigo rounded" /><span className="text-[12px] text-[var(--fog)]">{t('tools.concurrencySafe')}</span></label>
              <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={editing.enabled} onChange={e => setEditing({ ...editing, enabled: e.target.checked })} className="accent-indigo rounded" /><span className="text-[12px] text-[var(--fog)]">{t('common.enabled')}</span></label>
            </div>
            {saveError && (
              <div className="text-[12px] text-vermillion bg-vermillion/[0.06] border border-vermillion/15 rounded-lg px-3 py-2">{saveError}</div>
            )}
            <div className="flex items-center gap-3 pt-4 border-t border-[var(--border-subtle)]">
              <button type="button" onClick={handleSave} disabled={saveStatus === 'saving'} className="flex-1 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all disabled:opacity-50">{saveStatus === 'saving' ? t('common.saving') : t('common.save')}</button>
              <button type="button" onClick={() => { setEditing(null); setSaveError(null); setSaveStatus('idle') }} className="flex-1 py-2.5 rounded-xl text-[13px] text-[var(--fog)] border border-[var(--border-subtle)] hover:border-[var(--border-hover)] transition-all">{t('common.cancel')}</button>
            </div>
            {saveStatus === 'saved' && (
              <div className="text-[11px] text-malachite/80 text-center">{t('common.saved')}</div>
            )}
          </div>
        )}
      </ImmersiveModal>

      {/* ── Delete Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!confirmDeleteName}
        title={t('confirm.deleteTitle', { entity: t('sidebar.tools') })}
        message={confirmDeleteName ? t('common.permanentlyDelete', { name: confirmDeleteName }) : ''}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteName(null)}
      />
    </div>
  </div>
  )
}
