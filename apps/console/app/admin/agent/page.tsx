'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { AlertCircle, GitBranch, Loader2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import AgentBlueprint from '@/components/admin/agent-blueprint'
import AgentVersionPicker from '@/components/admin/agent-version-picker'
import { useConsoleLocale } from '@/components/locale-provider'

function AgentConfigPage() {
  const { t } = useConsoleLocale()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [agentList, setAgentList] = useState<{ id: string; name: string; version: number; isActive: boolean }[]>([])
  const [currentAgentId, setCurrentAgentId] = useState<string | null>(null)
  const [pickerRefreshKey, setPickerRefreshKey] = useState(0)
  const [forking, setForking] = useState(false)
  const [forkError, setForkError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const router = useRouter()

  // Fetch agent configs list and resolve currentAgentId
  useEffect(() => {
    fetch('/api/admin/agent-configs')
      .then((r) => r.json())
      .then((d) => {
        if (d.configs?.length) {
          setAgentList(d.configs)
          const urlAgentId = searchParams.get('agentId')
          const resolveStored = (id: string): string | null => {
            const found = d.configs.find((c: { id: string }) => c.id === id)
            if (!found) return null
            if (found.isActive) return found.id
            const activeSibling = d.configs.find(
              (c: { name: string; isActive: boolean }) => c.name === found.name && c.isActive,
            )
            return activeSibling ? activeSibling.id : found.id
          }
          if (urlAgentId) {
            const resolved = resolveStored(urlAgentId)
            if (resolved) setCurrentAgentId(resolved)
          } else {
            const stored = (() => { try { return localStorage.getItem('intera-agent-id') } catch { return null } })()
            if (stored) {
              const resolved = resolveStored(stored)
              if (resolved) {
                setCurrentAgentId(resolved)
                if (resolved !== stored) {
                  try { localStorage.setItem('intera-agent-id', resolved) } catch { /* */ }
                }
              }
            }
            if (!currentAgentId) {
              const firstActive = d.configs.find((c: { isActive: boolean }) => c.isActive)
              setCurrentAgentId((firstActive ?? d.configs[0]).id)
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleFork = useCallback(async () => {
    if (!currentAgentId || forking) return
    setForking(true)
    setForkError(null)
    try {
      const r = await fetch(`/api/admin/agent-configs/${currentAgentId}/fork`, { method: 'POST' })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) {
        setForkError(d.error || t('agentVersion.forkError'))
        return
      }
      if (d.config?.id) {
        const newId = d.config.id
        setPickerRefreshKey(k => k + 1)
        setCurrentAgentId(newId)
        try { localStorage.setItem('intera-agent-id', newId) } catch { /* */ }
        router.push(`/admin/agent?agentId=${newId}`)
      }
    } catch {
      setForkError(t('agentVersion.forkError'))
    } finally {
      setForking(false)
    }
  }, [currentAgentId, forking, router, t])

  if (loading)
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[60vh] w-full rounded-2xl" />
      </div>
    )
  if (error)
    return (
      <div className="p-8 max-w-lg mx-auto text-center mt-20 space-y-4">
        <AlertCircle className="w-10 h-10 text-vermillion/60 mx-auto" />
        <p className="text-[var(--fog)]">{error || t('common.failedLoad')}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl bg-indigo/[0.08] border border-indigo/20 text-indigo"
        >
          {t('common.retry')}
        </button>
      </div>
    )

  return (
    <div className="flex" style={{ height: 'calc(100vh - 64px)' }}>
      <div className="flex-1 min-w-0 overflow-hidden relative">
        {/* Agent selector + fork */}
        {agentList.length > 0 && (
          <div className="absolute top-4 left-4 right-4 z-10 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <AgentVersionPicker
                key={pickerRefreshKey}
                agentId={currentAgentId}
                onChange={(id) => {
                  setCurrentAgentId(id)
                  try { localStorage.setItem('intera-agent-id', id) } catch { /* ignore */ }
                  router.push(`/admin/agent?agentId=${id}`)
                }}
                onAgentsChanged={() => setPickerRefreshKey(k => k + 1)}
              />
              <button
                type="button"
                onClick={handleFork}
                disabled={!currentAgentId || forking}
                title={t('agentVersion.forkAsNew')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-black/[0.08] bg-white/70 px-2.5 py-1.5 text-[11px] font-semibold text-indigo backdrop-blur hover:bg-indigo/[0.06] hover:border-indigo/20 disabled:opacity-50 transition-colors"
              >
                {forking ? <Loader2 className="w-3 h-3 animate-spin" /> : <GitBranch className="w-3 h-3" />}
                <span>{t('agentVersion.forkAsNew')}</span>
              </button>
              {forkError && (
                <span className="text-[10.5px] text-vermillion bg-vermillion/[0.06] border border-vermillion/15 rounded-md px-2 py-1">
                  {forkError}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Agent Blueprint — read-only health dashboard, click to navigate */}
        <AgentBlueprint
          agentId={currentAgentId}
        />
      </div>
    </div>
  )
}

export default function AgentConfigPageWrapper() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><p className="text-sm text-[var(--fog)]">Loading...</p></div>}>
      <AgentConfigPage />
    </Suspense>
  )
}
