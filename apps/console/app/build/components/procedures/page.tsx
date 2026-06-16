'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowUpRight, Layers, Loader2, Plus, Search, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'
import EmptyState from '@/components/ui/empty-state'
import ConfirmDialog from '@/components/ui/confirm-dialog'
import { PageLoader } from '@/components/ui/page-loader'
import VersionContextBar, { useSelectedAgentId } from '@/components/admin/version-context-bar'
import { useConsoleLocale } from '@/components/locale-provider'
import { apiClient, bustConfigCache } from '@/lib/api/client'
import { useSession } from '@/lib/hooks/use-session'
import { parseProcedure, type CaseTypeItem } from '@intera/shared/contracts/case-types'
import { NEW_PROCEDURE_SENTINEL } from './_shared'

function procedureStepCount(item: CaseTypeItem) {
  return parseProcedure(item.procedure ?? null)?.steps.length ?? 0
}

export default function BuildProceduresPage() {
  const { t } = useConsoleLocale()
  const agentConfigId = useSelectedAgentId()
  const { orgId } = useSession()
  const router = useRouter()

  const [items, setItems] = useState<CaseTypeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [savingName, setSavingName] = useState<string | null>(null)
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!agentConfigId) {
      setItems([])
      setError(t('caseTypes.error.selectAgent'))
      setLoading(false)
      return
    }

    try {
      const result = await apiClient<{ types: CaseTypeItem[] }>(
        `/api/admin/case-types?agentConfigId=${encodeURIComponent(agentConfigId)}`,
      )
      setItems(result.data.types || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('caseTypes.error.load'))
    } finally {
      setLoading(false)
    }
  }, [agentConfigId, t])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return items
    return items.filter((item) => {
      const haystacks = [
        item.type,
        item.displayName,
        item.description ?? '',
        item.defaultGoal,
      ]
      return haystacks.some((value) => value.toLowerCase().includes(query))
    })
  }, [items, search])

  const handleCreate = useCallback(async () => {
    if (!agentConfigId) return
    router.push(`/build/components/procedures/${NEW_PROCEDURE_SENTINEL}`)
  }, [agentConfigId, router])

  const handleToggle = useCallback(async (item: CaseTypeItem) => {
    if (!agentConfigId) return
    setSavingName(item.type)
    try {
      await apiClient(`/api/admin/case-types/${encodeURIComponent(item.type)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'PUT',
        body: {
          agentConfigId,
          enabled: !item.enabled,
        },
      })
      await bustConfigCache(orgId).catch(() => {})
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('caseTypes.error.update'))
    } finally {
      setSavingName(null)
    }
  }, [agentConfigId, load, orgId, t])

  const handleDelete = useCallback(async () => {
    if (!agentConfigId || !confirmDeleteName) return
    const type = confirmDeleteName
    setSavingName(type)
    setConfirmDeleteName(null)
    try {
      await apiClient(`/api/admin/case-types/${encodeURIComponent(type)}?agentConfigId=${encodeURIComponent(agentConfigId)}`, {
        method: 'DELETE',
      })
      await bustConfigCache(orgId).catch(() => {})
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('caseTypes.error.delete'))
    } finally {
      setSavingName(null)
    }
  }, [agentConfigId, confirmDeleteName, load, orgId, t])

  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.procedures"
      descriptionKey="procedures"
    >
      <VersionContextBar />
      <PageLoader loading={loading} error={error} onRetry={() => load()}>
        <div className="px-8 py-8">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <h1 className="text-[20px] font-semibold text-[var(--mist)]">{t('caseTypes.title')}</h1>
              <p className="mt-0.5 text-[13px] text-[var(--fog)]">{t('caseTypes.subtitle', { n: items.length })}</p>
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={!agentConfigId}
              className="flex items-center gap-2 rounded-xl border border-indigo/20 bg-indigo/[0.08] px-4 py-2.5 text-[13px] font-medium text-indigo transition-all hover:bg-indigo/[0.15] disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {t('caseTypes.new')}
            </button>
          </div>

          <div className="relative mb-6 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--smoke)]" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('caseTypes.searchPh')}
              className="glass-input-console pl-10 text-[13px]"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={Layers}
              title={t('caseTypes.emptyTitle')}
              description={search ? t('common.noMatches') : t('caseTypes.emptyDesc')}
              action={!search ? { label: t('caseTypes.new'), onClick: handleCreate } : undefined}
              size="large"
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {filtered.map((item) => {
                const steps = procedureStepCount(item)
                const busy = savingName === item.type
                return (
                  <div
                    key={item.id}
                    className="rounded-[24px] border border-black/[0.06] bg-white/[0.72] p-5 shadow-[var(--shadow-card)] backdrop-blur-xl"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => router.push(`/build/components/procedures/${encodeURIComponent(item.type)}`)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-[14px] font-semibold text-[var(--mist)]">
                            {item.displayName || item.type}
                          </p>
                          <p className="truncate font-mono text-[11px] text-[var(--fog)]">{item.type}</p>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleToggle(item)}
                        disabled={busy}
                        className="flex-shrink-0 transition-opacity hover:opacity-80 disabled:opacity-40"
                        title={item.enabled ? 'Disable Procedure type' : 'Enable Procedure type'}
                      >
                        {item.enabled ? <ToggleRight className="h-7 w-7 text-malachite" /> : <ToggleLeft className="h-7 w-7 text-[var(--smoke)]/40" />}
                      </button>
                    </div>

                    <p className="mt-4 line-clamp-2 min-h-[2.75rem] text-[13px] leading-6 text-[var(--fog)]">
                      {item.description || item.defaultGoal || 'Open this Procedure type to define step-by-step actions, required facts, escalation conditions, and Hook bindings.'}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-full border border-[#357f7c]/18 bg-[#357f7c]/[0.07] px-2.5 py-1 text-[11px] font-medium text-[#357f7c]">
                        {steps} step{steps === 1 ? '' : 's'}
                      </span>
                      <span className="rounded-full border border-black/[0.06] bg-white/82 px-2.5 py-1 text-[11px] font-medium text-[var(--fog)]">
                        max {item.maxAutoTurns ?? 10} turns
                      </span>
                      <span className="rounded-full border border-black/[0.06] bg-white/82 px-2.5 py-1 text-[11px] font-medium text-[var(--fog)]">
                        {item.enabled ? 'Routing enabled' : 'Routing disabled'}
                      </span>
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteName(item.type)}
                        disabled={busy}
                        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-vermillion transition-colors hover:bg-vermillion/[0.06] disabled:opacity-40"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/build/components/procedures/${encodeURIComponent(item.type)}`)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-white/84 px-3 py-1.5 text-[12px] font-medium text-[var(--mist)] transition-colors hover:border-indigo/18 hover:text-indigo"
                      >
                        Open
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PageLoader>

      <ConfirmDialog
        open={!!confirmDeleteName}
        title={t('confirm.deleteTitle', { entity: t('sidebar.procedures') })}
        message={confirmDeleteName ? t('common.permanentlyDelete', { name: confirmDeleteName }) : ''}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDeleteName(null)}
      />
    </BuildComponentsRouteShell>
  )
}
