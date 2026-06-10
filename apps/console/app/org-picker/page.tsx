'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Building2 } from 'lucide-react'
import { apiClient } from '@/lib/api/client'

interface Membership {
  orgId: string
  role: string
  name: string
}

export default function OrgPickerPage() {
  return (
    <Suspense fallback={null}>
      <OrgPicker />
    </Suspense>
  )
}

function OrgPicker() {
  const params = useSearchParams()
  const errorParam = params.get('error')

  const [orgs, setOrgs] = useState<Membership[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(errorParam || '')
  const [switching, setSwitching] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient<{ orgs: Membership[] }>('/api/auth/memberships')
      .then((r) => {
        if (cancelled) return
        if (r.data?.orgs && Array.isArray(r.data.orgs)) {
          setOrgs(r.data.orgs)
        } else {
          setError('Unable to load organizations')
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load organizations')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const selectOrg = async (orgId: string) => {
    setSwitching(orgId)
    setError('')
    try {
      await apiClient('/api/auth/switch-org', { method: 'POST', body: { orgId } })
      window.location.href = '/build/pilot-lab'
    } catch {
      setError('Network error. Try again.')
      setSwitching(null)
    }
  }

  const roleLabel = (role: string): string => {
    const labels: Record<string, string> = {
      owner: 'Owner',
      admin: 'Admin',
      operator: 'Operator',
      viewer: 'Viewer',
    }
    return labels[role] || role
  }

  return (
    <div className="intera-q2-page min-h-[100dvh] px-4 py-8 text-[var(--color-text-primary)] sm:px-8 lg:px-12">
      <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-2xl flex-col justify-center">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[var(--radius-panel)] border border-[rgba(53,127,124,0.18)] bg-white/80 text-[var(--color-accent-primary)] shadow-[0_1px_2px_rgba(21,23,25,0.04)]">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
              Workspace
            </p>
            <h1 className="mt-1 text-[24px] font-semibold leading-8 text-[var(--color-text-primary)]">
              Select Organization
            </h1>
          </div>
        </div>
        <p className="mb-6 max-w-xl text-sm leading-6 text-[var(--color-text-secondary)]">
          Choose which organization you want to access.
        </p>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-[var(--radius-control)] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        <div className="overflow-hidden rounded-[var(--radius-panel)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shadow-[0_1px_2px_rgba(21,23,25,0.03)]">
          {loading ? (
            <div>
              {[0, 1].map((row) => (
                <div
                  key={row}
                  className="flex items-center gap-4 border-b border-[var(--color-border-subtle)] px-4 py-4 last:border-b-0"
                >
                  <div className="h-10 w-10 flex-shrink-0 animate-pulse rounded-[var(--radius-control)] bg-[var(--color-bg-surface-muted)]" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-3 w-28 animate-pulse rounded-full bg-[var(--color-bg-surface-muted)]" />
                    <div className="h-2.5 w-16 animate-pulse rounded-full bg-[var(--color-bg-surface-muted)]" />
                  </div>
                </div>
              ))}
            </div>
          ) : orgs.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <p className="text-sm text-[var(--color-text-secondary)]">
                You do not belong to any organization.
              </p>
              <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">
                Contact your administrator for an invitation.
              </p>
            </div>
          ) : (
            <div>
              {orgs.map((org) => (
                <button
                  key={org.orgId}
                  onClick={() => selectOrg(org.orgId)}
                  disabled={switching !== null}
                  className="group flex w-full items-center gap-4 border-b border-[var(--color-border-subtle)] px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-[var(--color-bg-surface-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgba(53,127,124,0.28)] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[rgba(53,127,124,0.14)] bg-[rgba(53,127,124,0.08)]">
                    <Building2 className="h-5 w-5 text-[var(--color-accent-primary)]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--color-text-primary)]">
                      {org.name}
                    </div>
                    <div className="mt-0.5 text-xs capitalize text-[var(--color-text-tertiary)]">
                      {roleLabel(org.role)}
                    </div>
                  </div>
                  <div className="flex-shrink-0">
                    {switching === org.orgId ? (
                      <div className="h-5 w-5 rounded-full border-2 border-[var(--color-border-strong)] border-t-[var(--color-accent-primary)] animate-spin" />
                    ) : (
                      <ArrowRight className="h-5 w-5 text-[var(--color-text-tertiary)] transition-colors group-hover:text-[var(--color-accent-primary)]" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
