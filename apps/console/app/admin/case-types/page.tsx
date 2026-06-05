'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Layers, Plus, Search, Wand2, ArrowRight, Settings2, Pencil, Trash2, ToggleLeft, ToggleRight, AlertCircle } from 'lucide-react'

import EmptyState from '@/components/ui/empty-state'
import TiltCard from '@/components/ui/tilt-card'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { useCapabilityBindings, checkItemBinding, toggleItemBinding, BindingIndicator } from '@/components/admin/binding-column'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import { PageLoader } from '@/components/ui/page-loader'

interface CaseTypeItem {
  id: string
  type: string
  displayName: string
  description: string
  icon: string
  defaultGoal: string
  stages: string
  requiredFacts: string
  escalateOn: string
  autoCloseConditions: string
  stageConfigs: string
  orchestratorConfig: string
  enabled: boolean
  requireHumanReview?: boolean
  executionMode?: string
  sop?: string | null
  sopMaxAutoTurns?: number
}

export default function CaseTypesPage() {
  const { t } = useConsoleLocale()
  const agentId = useSelectedAgentId()
  const { bindings, saveBindings } = useCapabilityBindings(agentId)
  const router = useRouter()
  const [items, setItems] = useState<CaseTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const { orgId } = useSession()

  const load = useCallback(async () => {
    try {
      const result = await apiClient<{ types: CaseTypeItem[] }>('/api/admin/case-types')
      const raw = (result.data.types || []) as CaseTypeItem[]
      setItems(raw.map((ct) => ({ ...ct, enabled: ct.enabled !== false })))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const emptyItem = (): CaseTypeItem => ({
    id: '',
    type: '',
    displayName: '',
    description: '',
    icon: '\u{1F4CB}',
    defaultGoal: '',
    stages: '["created","investigating","resolved"]',
    requiredFacts: '[]',
    escalateOn: '[]',
    autoCloseConditions: '[]',
    stageConfigs: '{}',
    orchestratorConfig: '{"enabled":false,"maxParallelAgents":3}',
    enabled: true,
    requireHumanReview: false,
    executionMode: 'stage',
    sop: null,
    sopMaxAutoTurns: 10,
  })

  const openDetail = (ct: CaseTypeItem) => {
    router.push(`/admin/case-types/${encodeURIComponent(ct.type)}`)
  }

  const openNew = async () => {
    setSaveStatus('saving')
    const draft = emptyItem()
    try {
      await apiClient('/api/admin/case-types', { method: 'POST', body: draft })
      await bustConfigCache(orgId)
      setSaveStatus('saved')
      router.push(`/admin/case-types/${encodeURIComponent(draft.type)}`)
    } catch {
      setSaveStatus('error')
    }
  }

  const toggleEnabled = useCallback(
    async (ct: CaseTypeItem) => {
      const updated = { ...ct, enabled: !ct.enabled }
      await apiClient(`/api/admin/case-types/${encodeURIComponent(ct.type)}`, { method: 'PUT', body: updated }).catch(() => {})
      await bustConfigCache(orgId)
      load()
    },
    [load, orgId],
  )

  const handleDelete = useCallback(
    async (type: string) => { setConfirmDeleteName(type) },
    [],
  )

  const confirmDelete = useCallback(async () => {
    const name = confirmDeleteName
    if (!name) return
    setConfirmDeleteName(null)
    await apiClient(`/api/admin/case-types/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(() => {})
    await bustConfigCache(orgId)
    load()
  }, [confirmDeleteName, load, orgId])

  const filtered = items.filter(
    (ct) =>
      !search ||
      ct.type.toLowerCase().includes(search.toLowerCase()) ||
      (ct.displayName || '').toLowerCase().includes(search.toLowerCase()),
  )
  const stageNames = (s: string) => {
    try {
      return JSON.parse(s || '[]').join(' → ')
    } catch {
      return s
    }
  }

  return (
    <div>
      <VersionContextBar />
      <PageLoader loading={loading} error={error} onRetry={() => window.location.reload()}>
        <div className="px-8 py-8 animate-fade-up">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('caseTypes.title')}</h1>
          <p className="text-[13px] text-[var(--fog)] mt-0.5">{t('caseTypes.subtitle', { n: items.length })}</p>
        </div>
        <button
          type="button"
          onClick={openNew}
          disabled={saveStatus === 'saving'}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-medium bg-indigo/[0.08] border border-indigo/20 text-indigo hover:bg-indigo/[0.15] transition-all disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> {saveStatus === 'saving' ? t('common.saving') : t('caseTypes.new')}
        </button>
      </div>
      {saveStatus === 'error' && (
        <div className="mb-4 text-[12px] text-vermillion bg-vermillion/[0.06] border border-vermillion/15 rounded-lg px-3 py-2">{t('common.saveFailed')}</div>
      )}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--smoke)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('caseTypes.searchPh')}
          className="glass-input-console pl-10 text-[13px]"
        />
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t('caseTypes.emptyTitle')}
          description={search ? t('common.noMatches') : t('caseTypes.emptyDesc')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((ct) => {
            const isSop = ct.executionMode === 'cc'
            const hasStageConfig = !isSop && (() => {
              try {
                const cfg = JSON.parse(ct.stageConfigs || '{}')
                return Object.keys(cfg).length > 0
              } catch {
                return false
              }
            })()
            return (
              <TiltCard key={ct.id || ct.type} accentColor="#b8944c" onClick={() => openDetail(ct)}>
                <div className={`p-5 ${!ct.enabled ? 'opacity-70' : ''}`}>
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gold/[0.08] text-lg flex-shrink-0">
                      {ct.icon || '\u{1F4CB}'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-[13px] font-semibold text-[var(--mist)]">{ct.displayName || ct.type}</div>
                        {isSop && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-malachite/[0.08] text-malachite font-medium flex items-center gap-1">
                            <Wand2 className="w-2.5 h-2.5" />
                            SOP
                          </span>
                        )}
                        {hasStageConfig && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-lavender/[0.08] text-lavender font-medium flex items-center gap-1">
                            <Settings2 className="w-2.5 h-2.5" />
                            Staged
                          </span>
                        )}
                        {!ct.enabled && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--smoke)]/10 text-[var(--fog)] font-medium">
                            {t('common.disabled')}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--fog)] font-mono">{ct.type}</div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleEnabled(ct)
                      }}
                      className="flex-shrink-0 transition-colors"
                      title={ct.enabled ? t('common.active') : t('common.disabled')}
                    >
                      {ct.enabled ? (
                        <ToggleRight className="w-7 h-7 text-malachite" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-[var(--smoke)]/30" />
                      )}
                    </button>
                  </div>
                  <p className="text-[12px] text-[var(--fog)] line-clamp-2 mb-3">
                    {ct.description || t('common.noDescription')}
                  </p>
                  <div className="text-[11px] text-[var(--smoke)] flex items-center gap-1 flex-wrap mb-2">
                    {stageNames(ct.stages)
                      .split(' → ')
                      .map((s: string, i: number, arr: string[]) => (
                        <span key={i} className="flex items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-lavender/[0.06] text-lavender">{s}</span>
                          {i < arr.length - 1 && <ArrowRight className="w-3 h-3 text-[var(--smoke)]/40" />}
                        </span>
                      ))}
                  </div>
                  <div className="flex items-center justify-between translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-200 ease-out">
                    <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--smoke)]">
                      {ct.enabled ? t('common.active') : t('common.disabled')}
                    </span>
                    {agentId && (() => {
                      const stats = checkItemBinding(bindings, 'caseTypes', ct.type)
                      return (
                        <BindingIndicator
                          isBound={stats.isBound}
                          isDrift={stats.isDrift}
                          otherVersionsBound={stats.otherVersionsBound}
                          onToggle={() => {
                            const newB = toggleItemBinding(bindings, 'caseTypes', ct.type)
                            saveBindings(newB)
                          }}
                        />
                      )
                    })()}
                    </div>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          openDetail(ct)
                        }}
                        className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
                        title={t('common.edit')}
                      >
                        <Pencil className="w-3.5 h-3.5 text-[var(--fog)]" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDelete(ct.type)
                        }}
                        className="p-1.5 rounded-lg hover:bg-vermillion/5 transition-colors"
                        title={t('common.delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-vermillion/60" />
                      </button>
                    </div>
                  </div>
                </div>
              </TiltCard>
            )
          })}
        </div>
      )}

      {/* ── Delete Confirmation Dialog ── */}
      <ConfirmDialog
        open={!!confirmDeleteName}
        title={t('confirm.deleteTitle', { entity: t('sidebar.caseTypes') })}
        message={confirmDeleteName ? t('common.permanentlyDelete', { name: confirmDeleteName }) : ''}
        onConfirm={confirmDelete}
        onCancel={() => setConfirmDeleteName(null)}
      />
        </div>
      </PageLoader>
    </div>
  )
}
