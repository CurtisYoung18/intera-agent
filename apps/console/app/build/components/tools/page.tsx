'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  Box,
  Eye,
  Globe,
  Loader2,
  Lock,
  Plus,
  Puzzle,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Wrench,
  Zap,
  Plug,
  Wand2,
} from 'lucide-react'
import Link from 'next/link'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import ToolRenderHintsEditor from '@/components/admin/tool-render-hints-editor'
import type { LivechatRenderHint } from '@intera/shared/channels/render-hints'
import EmptyState from '@/components/ui/empty-state'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import SlidePanel from '@/components/ui/slide-panel'
import { PageLoader } from '@/components/ui/page-loader'
import { apiClient, ApiClientError, bustConfigCache } from '@/lib/api/client'
import { knowledgeSourceToolName } from '@/lib/agent/tool-names'
import { useSession } from '@/lib/hooks/use-session'
import type { ToolsListResponse, ToolCreateResponse } from '@intera/shared/contracts/tools'
import { normalizeToolMode, type ToolItem as ContractToolItem } from '@intera/shared/contracts/tools'
import { CHANNEL_TOOL_NAMES, SPECIAL_TOOL_NAMES, SYSTEM_TOOL_NAMES } from '@/lib/tool-classifications'

type ToolItem = ContractToolItem

type KnowledgeSourceRow = {
  id: string
  name: string
  description: string | null
  enabled: boolean
  topK: number
  rerankVersion: string | null
}

type ToolEditor = {
  id?: string
  name: string
  description: string
  mode: 'static_fixture' | 'http'
  endpoint: string
  httpMethod: 'GET' | 'POST'
  timeoutMs: number
  inputSchema: string
  outputSchema: string
  headers: string
  mockFixture: string
  renderHints: string
  guardPhase: 'pre' | 'post'
  toolCategory: string
  isConcurrencySafe: boolean
  enabled: boolean
}

function parseJsonField(raw: string | null | undefined): { ok: true; value: unknown } | { ok: false; error: string } {
  const trimmed = raw?.trim()
  if (!trimmed) return { ok: true, value: undefined }
  try {
    return { ok: true, value: JSON.parse(trimmed) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

function inferJsonSchema(obj: Record<string, unknown>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    const type =
      Array.isArray(value)
        ? 'array'
        : typeof value === 'number'
          ? 'number'
          : typeof value === 'boolean'
            ? 'boolean'
            : typeof value === 'object' && value !== null
              ? 'object'
              : 'string'
    properties[key] = { type }
  }
  return { type: 'object', properties }
}

function mockFixtureChips(raw?: string | null): string[] | null {
  const parsed = parseJsonField(raw ?? undefined)
  if (!parsed.ok) return null
  if (parsed.value === undefined) return []
  const value = parsed.value
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return []
    return entries.slice(0, 6).map(([key, entryValue]) => {
      const content = entryValue !== null && typeof entryValue === 'object' ? JSON.stringify(entryValue) : String(entryValue)
      const short = content.length > 36 ? `${content.slice(0, 36)}…` : content
      return `${key}: ${short}`
    })
  }
  return [JSON.stringify(value).slice(0, 120)]
}

const TOOL_DISPLAY_ALIASES: Record<string, { name?: string; description?: string }> = {
  read_chat_memory: {
    description:
      'Read the ProcedureRun working Memory for the current investigation. Returns confirmed facts, tools called so far, key events, and any compaction summary from earlier turns.',
  },
}

function displayToolName(tool: Pick<ToolItem, 'name'>) {
  return TOOL_DISPLAY_ALIASES[tool.name]?.name ?? tool.name
}

function displayToolDescription(tool: Pick<ToolItem, 'name' | 'description'>) {
  const raw = TOOL_DISPLAY_ALIASES[tool.name]?.description ?? tool.description ?? ''
  return raw
    .replace(/\bper-case\b/gi, 'ProcedureRun')
    .replace(/\bcase as resolved\b/gi, 'Procedure as resolved')
    .replace(/\bcases\b/gi, 'ProcedureRuns')
    .replace(/\bcase\b/gi, 'ProcedureRun')
    .replace(/\bplatform policy\b/gi, 'platform rule')
}

function getToolName(name: string, sourceId?: string) {
  return knowledgeSourceToolName(name, sourceId)
}

function toolIcon(tool: ToolItem) {
  const mode = normalizeToolMode(tool.mode)
  if (tool.isChannel) return Plug
  if (tool.isSystem) return Zap
  if (tool.isSpecial) return Search
  return mode === 'http' ? Globe : Box
}

function toolTone(tool: ToolItem) {
  if (tool.isChannel) return 'text-purple bg-purple/[0.08]'
  if (tool.isSystem) return 'text-amber bg-amber/[0.08]'
  if (tool.isSpecial) return 'text-teal-600 bg-teal-500/[0.08]'
  return normalizeToolMode(tool.mode) === 'http' ? 'text-sky bg-sky/[0.08]' : 'text-lavender bg-lavender/[0.08]'
}

function modeLabel(tool: ToolItem) {
  if (tool.isSystem) return 'Runtime-managed'
  if (tool.isChannel) return 'Channel-managed'
  if (tool.isSpecial) return 'Dedicated surface'
  return normalizeToolMode(tool.mode) === 'http' ? 'HTTP' : 'Static fixture'
}

function editorFromTool(tool?: ToolItem | null): ToolEditor {
  return {
    id: tool?.id,
    name: tool?.name || '',
    description: tool?.description || '',
    mode: normalizeToolMode(tool?.mode) === 'http' ? 'http' : 'static_fixture',
    endpoint: tool?.endpoint || '',
    httpMethod: (tool?.httpMethod === 'GET' ? 'GET' : 'POST'),
    timeoutMs: tool?.timeoutMs || 8000,
    inputSchema: tool?.inputSchema || '{}',
    outputSchema: tool?.outputSchema || '{}',
    headers: tool?.headers || '{}',
    mockFixture: tool?.mockFixture || tool?.staticFixture || '{"status":"ok"}',
    renderHints: tool?.renderHints || '{}',
    guardPhase: tool?.guardPhase === 'pre' ? 'pre' : 'post',
    toolCategory: tool?.toolCategory || '',
    isConcurrencySafe: tool?.isConcurrencySafe ?? true,
    enabled: tool?.enabled ?? true,
  }
}

function prefillDefaultMock(name: string) {
  if (name.startsWith('kb_search_')) {
    return JSON.stringify({ list: [], total: 0 }, null, 2)
  }
  return JSON.stringify({ status: 'ok' }, null, 2)
}

export default function BuildToolsPage() {
  const agentConfigId = useSelectedAgentId()
  const { orgId } = useSession()

  const [tools, setTools] = useState<ToolItem[]>([])
  const [knowledgeSources, setKnowledgeSources] = useState<KnowledgeSourceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [editing, setEditing] = useState<ToolEditor | null>(null)
  const [editingOriginalName, setEditingOriginalName] = useState<string>('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)
  const [viewTool, setViewTool] = useState<ToolItem | null>(null)

  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; status: number; latencyMs?: number; body: unknown } | null>(null)

  const load = useCallback(async () => {
    if (!agentConfigId) {
      setLoading(false)
      setError('Select an agent version first.')
      return
    }
    try {
      const [toolResult, knowledgeResult] = await Promise.all([
        apiClient<ToolsListResponse>(`/api/admin/tools?agentConfigId=${encodeURIComponent(agentConfigId)}`),
        apiClient<{ sources: KnowledgeSourceRow[] }>(`/api/admin/knowledge/sources?agentConfigId=${encodeURIComponent(agentConfigId)}`).catch(() => ({ data: { sources: [] } })),
      ])
      setTools(toolResult.data.tools || [])
      setKnowledgeSources(knowledgeResult.data.sources || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Tools workspace')
    } finally {
      setLoading(false)
    }
  }, [agentConfigId])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return tools
    return tools.filter((tool) =>
      tool.name.toLowerCase().includes(query) ||
      displayToolDescription(tool).toLowerCase().includes(query),
    )
  }, [search, tools])

  const systemTools = filtered.filter((tool) => tool.isSystem || SYSTEM_TOOL_NAMES.has(tool.name))
  const channelTools = filtered.filter((tool) => tool.isChannel || CHANNEL_TOOL_NAMES.has(tool.name))
  const specialTools = filtered.filter((tool) => tool.isSpecial || SPECIAL_TOOL_NAMES.has(tool.name))
  const customTools = filtered.filter((tool) => !tool.isSystem && !tool.isChannel && !tool.isSpecial && !SYSTEM_TOOL_NAMES.has(tool.name) && !CHANNEL_TOOL_NAMES.has(tool.name) && !SPECIAL_TOOL_NAMES.has(tool.name))

  const updateToolEnabled = useCallback(async (tool: ToolItem) => {
    if (!agentConfigId) return
    try {
      await apiClient(`/api/admin/tools/${encodeURIComponent(tool.name)}`, {
        method: 'PUT',
        body: {
          agentConfigId,
          enabled: !tool.enabled,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update Tool status')
    }
  }, [agentConfigId, load, orgId])

  const toggleKnowledgeSource = useCallback(async (source: KnowledgeSourceRow) => {
    if (!agentConfigId) return
    try {
      await apiClient(`/api/admin/knowledge/sources/${encodeURIComponent(source.id)}`, {
        method: 'PUT',
        body: {
          agentConfigId,
          enabled: !source.enabled,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update Knowledge source')
    }
  }, [agentConfigId, load, orgId])

  const openNew = () => {
    setEditing(editorFromTool())
    setEditingOriginalName('')
    setSaveError(null)
    setTestResult(null)
  }

  const openEdit = (tool: ToolItem) => {
    setEditing(editorFromTool(tool))
    setEditingOriginalName(tool.name)
    setSaveError(null)
    setTestResult(null)
  }

  const handleSave = useCallback(async () => {
    if (!editing || !agentConfigId) return
    setSaving(true)
    setSaveError(null)

    const schemaFields = [
      ['input schema', editing.inputSchema],
      ['output schema', editing.outputSchema],
      ['headers', editing.headers],
      ['mock fixture', editing.mockFixture],
      ['render hints', editing.renderHints],
    ] as const

    for (const [label, value] of schemaFields) {
      const parsed = parseJsonField(value)
      if (!parsed.ok) {
        setSaveError(`Invalid ${label} JSON: ${parsed.error}`)
        setSaving(false)
        return
      }
    }

    try {
      const isNew = !editingOriginalName
      const url = isNew ? '/api/admin/tools' : `/api/admin/tools/${encodeURIComponent(editingOriginalName)}`
      await apiClient<ToolCreateResponse>(url, {
        method: isNew ? 'POST' : 'PUT',
        body: {
          agentConfigId,
          name: editing.name,
          description: editing.description,
          mode: editing.mode,
          endpoint: editing.mode === 'http' ? editing.endpoint || null : null,
          httpMethod: editing.httpMethod,
          timeoutMs: editing.timeoutMs,
          inputSchema: editing.inputSchema,
          outputSchema: editing.outputSchema,
          headers: editing.mode === 'http' ? editing.headers : '{}',
          mockFixture: editing.mockFixture,
          renderHints: editing.renderHints,
          guardPhase: editing.mode === 'http' ? editing.guardPhase : 'post',
          toolCategory: editing.toolCategory || null,
          isConcurrencySafe: editing.isConcurrencySafe,
          enabled: editing.enabled,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      setEditing(null)
      setEditingOriginalName('')
      await load()
    } catch (err) {
      if (err instanceof ApiClientError) {
        setSaveError(err.envelope.error.message)
      } else if (err instanceof Error) {
        setSaveError(err.message)
      } else {
        setSaveError('Failed to save Tool')
      }
    } finally {
      setSaving(false)
    }
  }, [agentConfigId, editing, editingOriginalName, load, orgId])

  const confirmDelete = useCallback(async () => {
    if (!confirmDeleteName || !agentConfigId) return
    const name = confirmDeleteName
    setConfirmDeleteName(null)
    try {
      await apiClient(`/api/admin/tools/${encodeURIComponent(name)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'DELETE',
      })
      await bustConfigCache(orgId).catch(() => {})
      if (editingOriginalName === name) {
        setEditing(null)
        setEditingOriginalName('')
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete Tool')
    }
  }, [agentConfigId, confirmDeleteName, editingOriginalName, load, orgId])

  const handleTestEndpoint = useCallback(async () => {
    if (!editing || editing.mode !== 'http') return
    setTesting(true)
    setTestResult(null)
    try {
      const result = await apiClient('/api/admin/tools/test', {
        method: 'POST',
        body: {
          endpoint: editing.endpoint,
          httpMethod: editing.httpMethod,
          headers: editing.headers,
          timeoutMs: editing.timeoutMs,
        },
      })
      setTestResult(result.data as any)
    } catch (err) {
      if (err instanceof ApiClientError) {
        setTestResult({ ok: false, status: 0, body: err.envelope.error.message })
      } else {
        setTestResult({ ok: false, status: 0, body: 'Connection failed' })
      }
    } finally {
      setTesting(false)
    }
  }, [editing])

  const inferOutputSchema = useCallback(() => {
    if (!editing || !testResult?.body || typeof testResult.body !== 'object' || Array.isArray(testResult.body)) return
    const schema = inferJsonSchema(testResult.body as Record<string, unknown>)
    setEditing({ ...editing, outputSchema: JSON.stringify(schema, null, 2) })
  }, [editing, testResult])

  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.tools"
      descriptionKey="tools"
    >
      <VersionContextBar />
      <PageLoader loading={loading} error={error} onRetry={() => load()}>
        <div className="px-8 py-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-[20px] font-semibold text-[var(--mist)]">Tools</h1>
              <p className="mt-0.5 text-[13px] text-[var(--fog)]">
                Configure custom tools, inspect runtime-managed tools, and verify endpoint behavior without leaving Build.
              </p>
            </div>
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo/20 bg-indigo/[0.08] px-4 py-2.5 text-[13px] font-medium text-indigo transition-all hover:bg-indigo/[0.15]"
            >
              <Plus className="h-4 w-4" />
              New Tool
            </button>
          </div>

          <div className="relative mb-6 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--smoke)]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search tools..."
              className="glass-input-console pl-10 text-[13px]"
            />
          </div>

          {filtered.length === 0 && knowledgeSources.length === 0 ? (
            <EmptyState
              icon={Puzzle}
              title="No Tools yet"
              description={search ? 'No tools match the current search.' : 'Create a business tool or connect a Knowledge source to expose search tools.'}
              action={!search ? { label: 'New Tool', onClick: openNew } : undefined}
              size="large"
            />
          ) : (
            <div className="space-y-10">
              {systemTools.length > 0 ? (
                <section data-testid="runtime-tools-section">
                  <div className="mb-4 flex items-center gap-2">
                    <h2 className="text-[15px] font-semibold text-[var(--mist)]">Runtime-managed tools</h2>
                    <span className="rounded-full border border-amber/20 bg-amber/[0.08] px-2 py-0.5 text-[10px] font-medium text-amber">
                      Locked
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {systemTools.map((tool) => {
                      const Icon = toolIcon(tool)
                      return (
                        <button
                          key={tool.id || tool.name}
                          type="button"
                          onClick={() => setViewTool(tool)}
                          className="rounded-[24px] border border-black/[0.06] bg-white/[0.72] p-5 text-left shadow-[var(--shadow-card)] backdrop-blur-xl transition hover:border-amber/18"
                        >
                          <div className="mb-3 flex items-start gap-3">
                            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${toolTone(tool)}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-[13px] font-semibold text-[var(--mist)]">{displayToolName(tool)}</span>
                                <Lock className="h-3 w-3 flex-shrink-0 text-amber/80" />
                              </div>
                              <span className="mt-0.5 inline-block rounded-full bg-amber/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-amber">
                                {modeLabel(tool)}
                              </span>
                            </div>
                          </div>
                          <p className="line-clamp-3 text-[12px] text-[var(--fog)]">{displayToolDescription(tool) || 'No description.'}</p>
                          <div className="mt-4 flex items-center justify-between text-[10px] text-[var(--smoke)]">
                            <span>{tool.enabled ? 'Enabled' : 'Disabled'}</span>
                            <span className="inline-flex items-center gap-1">
                              <Eye className="h-3 w-3" />
                              View details
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              {channelTools.length > 0 ? (
                <section>
                  <div className="mb-4 flex items-center gap-2">
                    <h2 className="text-[15px] font-semibold text-[var(--mist)]">Channel tools</h2>
                    <span className="rounded-full border border-purple/20 bg-purple/[0.08] px-2 py-0.5 text-[10px] font-medium text-purple">
                      Runtime-managed
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {channelTools.map((tool) => {
                      const Icon = toolIcon(tool)
                      return (
                        <div key={tool.id || tool.name} className="rounded-[24px] border border-black/[0.06] bg-white/[0.72] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
                          <div className="mb-3 flex items-start gap-3">
                            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${toolTone(tool)}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-semibold text-[var(--mist)]">{displayToolName(tool)}</p>
                              <span className="mt-0.5 inline-block rounded-full bg-purple/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-purple">
                                {modeLabel(tool)}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => updateToolEnabled(tool)}
                              aria-label={`${tool.enabled ? 'Disable' : 'Enable'} ${displayToolName(tool)}`}
                              className="flex-shrink-0 transition-opacity hover:opacity-80"
                            >
                              {tool.enabled ? <ToggleRight className="h-7 w-7 text-malachite" /> : <ToggleLeft className="h-7 w-7 text-[var(--smoke)]/30" />}
                            </button>
                          </div>
                          <p className="text-[12px] text-[var(--fog)]">{displayToolDescription(tool) || 'No description.'}</p>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              <section>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-[var(--mist)]">Knowledge search tools</h2>
                  <span className="rounded-full border border-teal-500/20 bg-teal-500/[0.08] px-2 py-0.5 text-[10px] font-medium text-teal-600">
                    Auto-generated
                  </span>
                </div>
                <p className="mb-4 text-[12px] text-[var(--fog)]">
                  Each enabled source generates a <code className="rounded bg-teal-500/[0.08] px-1 text-[11px]">kb_search_&lt;name&gt;</code> tool. Configure source details in{' '}
                  <Link href="/build/components/knowledge" className="text-teal-600 underline">
                    Knowledge
                  </Link>.
                </p>
                {knowledgeSources.length === 0 ? (
                  <div className="rounded-xl border border-teal-500/15 bg-teal-500/[0.04] p-4 text-[12px] text-[var(--fog)]">
                    No Knowledge sources configured yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {knowledgeSources.map((source) => (
                      <div key={source.id} className="rounded-[24px] border border-teal-500/[0.12] bg-white/[0.72] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
                        <div className="mb-3 flex items-start gap-3">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-500/[0.08]">
                            <BookOpen className="h-5 w-5 text-teal-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px] font-semibold text-[var(--mist)]">
                              {getToolName(source.name, source.id)}
                            </p>
                            <span className="mt-0.5 inline-block rounded-full bg-teal-500/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-teal-600">
                              KB source
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleKnowledgeSource(source)}
                            aria-label={`${source.enabled ? 'Disable' : 'Enable'} ${getToolName(source.name, source.id)}`}
                            className="flex-shrink-0 transition-opacity hover:opacity-80"
                          >
                            {source.enabled ? <ToggleRight className="h-7 w-7 text-malachite" /> : <ToggleLeft className="h-7 w-7 text-[var(--smoke)]/30" />}
                          </button>
                        </div>
                        {source.description ? <p className="line-clamp-2 text-[12px] text-[var(--fog)]">{source.description}</p> : null}
                        <div className="mt-3 flex gap-2 text-[10px] text-[var(--smoke)]">
                          {source.rerankVersion ? <span className="rounded bg-teal-500/[0.06] px-1.5 py-0.5">{source.rerankVersion.split('-')[0]}</span> : null}
                          <span className="rounded bg-black/[0.04] px-1.5 py-0.5">topK {source.topK}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {specialTools.length > 0 ? (
                <section>
                  <div className="mb-4 flex items-center gap-2">
                    <h2 className="text-[15px] font-semibold text-[var(--mist)]">Special tools</h2>
                    <span className="rounded-full border border-teal-500/20 bg-teal-500/[0.08] px-2 py-0.5 text-[10px] font-medium text-teal-600">
                      Dedicated surfaces
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {specialTools.map((tool) => {
                      const Icon = toolIcon(tool)
                      return (
                        <div key={tool.id || tool.name} className="rounded-[24px] border border-black/[0.06] bg-white/[0.72] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl">
                          <div className="mb-3 flex items-start gap-3">
                            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${toolTone(tool)}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-semibold text-[var(--mist)]">{displayToolName(tool)}</p>
                              <span className="mt-0.5 inline-block rounded-full bg-teal-500/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-teal-600">
                                {modeLabel(tool)}
                              </span>
                            </div>
                            <button type="button" onClick={() => updateToolEnabled(tool)} className="flex-shrink-0 transition-opacity hover:opacity-80">
                              {tool.enabled ? <ToggleRight className="h-7 w-7 text-malachite" /> : <ToggleLeft className="h-7 w-7 text-[var(--smoke)]/30" />}
                            </button>
                          </div>
                          <p className="text-[12px] text-[var(--fog)]">{displayToolDescription(tool) || 'No description.'}</p>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ) : null}

              <section data-testid="custom-tools-section">
                <div className="mb-4 flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold text-[var(--mist)]">Custom tools</h2>
                  <span className="rounded-full border border-indigo/20 bg-indigo/[0.08] px-2 py-0.5 text-[10px] font-medium text-indigo">
                    Editable
                  </span>
                </div>
                {customTools.length === 0 ? (
                  <div className="rounded-xl border border-black/[0.06] bg-white/[0.72] p-5 text-[12px] text-[var(--fog)] shadow-[var(--shadow-card)] backdrop-blur-xl">
                    No custom tools yet. Create one to start wiring customer-facing capabilities.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {customTools.map((tool) => {
                      const Icon = toolIcon(tool)
                      const chips = mockFixtureChips(tool.mockFixture)
                      return (
                        <div
                          key={tool.id || tool.name}
                          role="button"
                          tabIndex={0}
                          onClick={() => openEdit(tool)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              openEdit(tool)
                            }
                          }}
                          className="rounded-[24px] border border-black/[0.06] bg-white/[0.72] p-5 text-left shadow-[var(--shadow-card)] backdrop-blur-xl transition hover:border-indigo/18"
                          aria-label={`Edit ${displayToolName(tool)}`}
                        >
                          <div className="mb-3 flex items-start gap-3">
                            <div className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${toolTone(tool)}`}>
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-semibold text-[var(--mist)]">{displayToolName(tool)}</p>
                              <div className="mt-0.5 flex items-center gap-2">
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${toolTone(tool)}`}>{modeLabel(tool)}</span>
                                {(() => {
                                  try {
                                    return tool.renderHints && JSON.parse(tool.renderHints)?.livechat
                                  } catch {
                                    return false
                                  }
                                })() ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo/[0.06] px-1.5 py-0.5 text-[9px] font-medium text-indigo">
                                    <Plug className="h-2.5 w-2.5" />
                                    LiveChat
                                  </span>
                                ) : null}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation()
                                updateToolEnabled(tool)
                              }}
                              aria-label={`${tool.enabled ? 'Disable' : 'Enable'} ${displayToolName(tool)}`}
                              className="flex-shrink-0 transition-opacity hover:opacity-80"
                            >
                              {tool.enabled ? <ToggleRight className="h-7 w-7 text-malachite" /> : <ToggleLeft className="h-7 w-7 text-[var(--smoke)]/30" />}
                            </button>
                          </div>

                          <p className="mb-3 line-clamp-2 text-[12px] text-[var(--fog)]">{displayToolDescription(tool) || 'No description.'}</p>

                          {normalizeToolMode(tool.mode) === 'static_fixture' ? (
                            <div className="mb-3 rounded-lg border border-[var(--color-border-subtle)] bg-black/[0.02] px-2.5 py-2">
                              <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-[var(--smoke)]">Fixture preview</div>
                              {!tool.mockFixture?.trim() ? (
                                <p className="text-[11px] italic text-[var(--smoke)]">No fixture yet.</p>
                              ) : chips === null ? (
                                <p className="text-[11px] text-vermillion/80">Malformed fixture JSON.</p>
                              ) : chips.length === 0 ? (
                                <span className="font-mono text-[11px] text-[var(--fog)]">{'{}'}</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {chips.map((chip, index) => (
                                    <span key={index} className="max-w-full truncate rounded-md border border-lavender/15 bg-lavender/[0.08] px-1.5 py-0.5 font-mono text-[10px] text-lavender/90" title={chip}>
                                      {chip}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ) : null}

                          <div className="flex items-center justify-between text-[10px] text-[var(--smoke)]">
                            <span>{tool.enabled ? 'Active' : 'Disabled'}</span>
                            <span className="inline-flex items-center gap-1">
                              <Wrench className="h-3 w-3" />
                              Edit
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>

        <SlidePanel open={!!viewTool} onClose={() => setViewTool(null)} title={viewTool ? displayToolName(viewTool) : 'Tool details'}>
          {viewTool ? (
            <div className="space-y-4 p-6">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${toolTone(viewTool)}`}>{modeLabel(viewTool)}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-amber/[0.08] px-2 py-0.5 text-[10px] font-medium text-amber">
                  <Lock className="h-3 w-3" />
                  Read-only
                </span>
              </div>

              <div>
                <p className="mb-1 text-[11px] font-medium text-[var(--fog)]">Description</p>
                <p className="text-[13px] leading-relaxed text-[var(--mist)]">{displayToolDescription(viewTool) || 'No description.'}</p>
              </div>

              <div>
                <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-[var(--fog)]">
                  <Eye className="h-3 w-3" />
                  Model preview
                </p>
                <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-xl border border-[var(--color-border-subtle)] bg-black/[0.04] p-3 font-mono text-[10px] text-[var(--mist)]">
{JSON.stringify({
  name: displayToolName(viewTool),
  description: displayToolDescription(viewTool) || '',
  input_schema: (() => {
    try {
      return JSON.parse(viewTool.inputSchema || '{}')
    } catch {
      return {}
    }
  })(),
}, null, 2)}
                </pre>
              </div>
            </div>
          ) : null}
        </SlidePanel>

        <SlidePanel open={!!editing} onClose={() => setEditing(null)} title={editingOriginalName ? 'Edit Tool' : 'New Tool'}>
          {editing ? (
            <div className="space-y-4 p-6">
              <label className="block space-y-1.5">
                <span className="text-[11px] text-[var(--fog)]">Name</span>
                <input
                  value={editing.name}
                  onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                  className="glass-input-console font-mono text-[13px]"
                  disabled={!!editingOriginalName}
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-[11px] text-[var(--fog)]">Mode</span>
                <select
                  value={editing.mode}
                  onChange={(event) => {
                    const nextMode = event.target.value as ToolEditor['mode']
                    setEditing({
                      ...editing,
                      mode: nextMode,
                      mockFixture: nextMode === 'static_fixture' && !editing.mockFixture.trim()
                        ? prefillDefaultMock(editing.name)
                        : editing.mockFixture,
                    })
                  }}
                  className="glass-input-console text-[13px]"
                >
                  <option value="static_fixture">Static fixture</option>
                  <option value="http">HTTP</option>
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-[11px] text-[var(--fog)]">Description</span>
                <input
                  value={editing.description}
                  onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                  className="glass-input-console text-[13px]"
                />
              </label>

              <details className="rounded-xl border border-indigo/15 bg-indigo/[0.02] px-4 py-3">
                <summary className="cursor-pointer list-none text-[11px] font-semibold text-indigo">
                  Model preview
                </summary>
                <pre className="mt-3 max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--color-border-subtle)] bg-black/[0.04] p-3 font-mono text-[10px] text-[var(--mist)]">
{JSON.stringify({
  name: editing.name || '(unnamed)',
  description: editing.description || '(no description)',
  input_schema: (() => {
    try {
      return JSON.parse(editing.inputSchema || '{}')
    } catch {
      return {}
    }
  })(),
}, null, 2)}
                </pre>
              </details>

              {editing.mode === 'static_fixture' ? (
                <div className="space-y-3 rounded-xl border border-lavender/25 bg-lavender/[0.05] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-lavender">Fixture response</span>
                    <button
                      type="button"
                      onClick={() => setEditing({ ...editing, mockFixture: prefillDefaultMock(editing.name) })}
                      className="inline-flex items-center gap-1 text-[10px] text-lavender/70 hover:text-lavender"
                    >
                      <Zap className="h-3 w-3" />
                      Reset default
                    </button>
                  </div>
                  <textarea
                    value={editing.mockFixture}
                    onChange={(event) => setEditing({ ...editing, mockFixture: event.target.value })}
                    rows={12}
                    spellCheck={false}
                    className="glass-input-console min-h-[220px] w-full resize-y font-mono text-[12px]"
                  />
                </div>
              ) : (
                <div className="space-y-3 rounded-xl border border-[var(--color-border-subtle)] bg-black/[0.02] p-4">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1.5">
                      <span className="text-[11px] text-[var(--fog)]">Endpoint</span>
                      <input
                        value={editing.endpoint}
                        onChange={(event) => setEditing({ ...editing, endpoint: event.target.value })}
                        className="glass-input-console font-mono text-[13px]"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] text-[var(--fog)]">Method</span>
                      <select
                        value={editing.httpMethod}
                        onChange={(event) => setEditing({ ...editing, httpMethod: event.target.value as ToolEditor['httpMethod'] })}
                        className="glass-input-console text-[13px]"
                      >
                        <option value="POST">POST</option>
                        <option value="GET">GET</option>
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] text-[var(--fog)]">Timeout</span>
                      <input
                        type="number"
                        value={editing.timeoutMs}
                        onChange={(event) => setEditing({ ...editing, timeoutMs: parseInt(event.target.value) || 8000 })}
                        className="glass-input-console font-mono text-[13px]"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-[11px] text-[var(--fog)]">Guard phase</span>
                      <select
                        value={editing.guardPhase}
                        onChange={(event) => setEditing({ ...editing, guardPhase: event.target.value as ToolEditor['guardPhase'] })}
                        className="glass-input-console text-[13px]"
                      >
                        <option value="pre">pre</option>
                        <option value="post">post</option>
                      </select>
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-[11px] text-[var(--fog)]">Headers JSON</span>
                    <textarea
                      value={editing.headers}
                      onChange={(event) => setEditing({ ...editing, headers: event.target.value })}
                      rows={4}
                      spellCheck={false}
                      className="glass-input-console w-full resize-y font-mono text-[12px]"
                    />
                  </label>

                  <button
                    type="button"
                    onClick={handleTestEndpoint}
                    disabled={testing}
                    className="inline-flex items-center gap-2 rounded-lg border border-sky/20 bg-sky/[0.06] px-3 py-1.5 text-[12px] text-sky transition-colors hover:bg-sky/[0.1]"
                  >
                    <Zap className="h-3.5 w-3.5" />
                    {testing ? 'Testing...' : 'Test endpoint'}
                  </button>

                  {testResult ? (
                    <div className={`rounded-lg border p-3 text-[11px] ${testResult.ok ? 'border-malachite/20 bg-malachite/[0.06]' : 'border-vermillion/20 bg-vermillion/[0.06]'}`}>
                      <div className="mb-2 flex items-center justify-between">
                        <span className={testResult.ok ? 'text-malachite' : 'text-vermillion'}>
                          {testResult.ok ? `HTTP ${testResult.status}` : `Error: ${String(testResult.body)}`}
                        </span>
                        {typeof testResult.latencyMs === 'number' ? <span className="text-[var(--fog)]">{testResult.latencyMs}ms</span> : null}
                      </div>
                      <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap rounded bg-black/[0.04] p-3 font-mono text-[10px] text-[var(--mist)]">
{typeof testResult.body === 'string' ? testResult.body : JSON.stringify(testResult.body, null, 2)}
                      </pre>
                      {testResult.ok && typeof testResult.body === 'object' && testResult.body !== null && !Array.isArray(testResult.body) ? (
                        <button
                          type="button"
                          onClick={inferOutputSchema}
                          className="mt-2 inline-flex items-center gap-1 text-[10px] text-indigo/80 hover:text-indigo"
                        >
                          <Wand2 className="h-3 w-3" />
                          Infer output schema from response
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}

              <div className="space-y-3">
                <label className="block space-y-1.5">
                  <span className="text-[11px] text-[var(--fog)]">Input schema JSON</span>
                  <textarea
                    value={editing.inputSchema}
                    onChange={(event) => setEditing({ ...editing, inputSchema: event.target.value })}
                    rows={5}
                    spellCheck={false}
                    className="glass-input-console w-full resize-y font-mono text-[12px]"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-[11px] text-[var(--fog)]">Output schema JSON</span>
                  <textarea
                    value={editing.outputSchema}
                    onChange={(event) => setEditing({ ...editing, outputSchema: event.target.value })}
                    rows={5}
                    spellCheck={false}
                    className="glass-input-console w-full resize-y font-mono text-[12px]"
                  />
                </label>

                <details className="rounded-xl border border-indigo/15 bg-indigo/[0.02] px-4 py-3">
                  <summary className="cursor-pointer list-none text-[11px] font-semibold text-indigo">
                    LiveChat render hints
                  </summary>
                  <div className="mt-3">
                    <ToolRenderHintsEditor
                      value={(() => {
                        try {
                          return editing.renderHints ? (JSON.parse(editing.renderHints)?.livechat as LivechatRenderHint) : undefined
                        } catch {
                          return undefined
                        }
                      })()}
                      onChange={(hint) => {
                        const current = (() => {
                          try {
                            return JSON.parse(editing.renderHints || '{}')
                          } catch {
                            return {}
                          }
                        })()
                        setEditing({ ...editing, renderHints: JSON.stringify({ ...current, livechat: hint }) })
                      }}
                      mockFixture={(() => {
                        try {
                          return JSON.parse(editing.mockFixture || '')
                        } catch {
                          return undefined
                        }
                      })()}
                    />
                  </div>
                </details>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-[11px] text-[var(--fog)]">Tool category</span>
                  <select
                    value={editing.toolCategory}
                    onChange={(event) => setEditing({ ...editing, toolCategory: event.target.value })}
                    className="glass-input-console text-[13px]"
                  >
                    <option value="">Default (operational)</option>
                    <option value="system_info">system_info</option>
                    <option value="operational">operational</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-[11px] text-[var(--fog)]">Concurrency safe</span>
                  <select
                    value={editing.isConcurrencySafe ? 'yes' : 'no'}
                    onChange={(event) => setEditing({ ...editing, isConcurrencySafe: event.target.value === 'yes' })}
                    className="glass-input-console text-[13px]"
                  >
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </div>

              <label className="inline-flex items-center gap-2 text-[12px] text-[var(--mist)]">
                <input
                  type="checkbox"
                  checked={editing.enabled}
                  onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })}
                  className="rounded border-black/[0.18] accent-indigo"
                />
                Enabled
              </label>

              {saveError ? (
                <div className="rounded-lg border border-vermillion/20 bg-vermillion/[0.06] px-3 py-2 text-[12px] text-vermillion">
                  {saveError}
                </div>
              ) : null}

              <div className="flex items-center justify-between gap-3 pt-2">
                {editingOriginalName ? (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteName(editingOriginalName)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-medium text-vermillion transition-colors hover:bg-vermillion/[0.06]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                ) : <span />}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-lg border border-[var(--color-border-subtle)] bg-white/[0.82] px-3 py-2 text-[12px] font-medium text-[var(--fog)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving || !editing.name.trim()}
                    className="inline-flex items-center gap-2 rounded-lg bg-[var(--mist)] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-[var(--mist)]/90 disabled:opacity-45"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </SlidePanel>

        <ConfirmDialog
          open={!!confirmDeleteName}
          title="Delete Tool?"
          message={confirmDeleteName ? `This will permanently delete ${confirmDeleteName}.` : ''}
          onCancel={() => setConfirmDeleteName(null)}
          onConfirm={confirmDelete}
        />
      </PageLoader>
    </BuildComponentsRouteShell>
  )
}
