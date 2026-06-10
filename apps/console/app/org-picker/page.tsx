'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertCircle, ArrowRight, Building2, Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api/client'
import { ConsoleAuthShell } from '@/components/auth/console-auth-shell'

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
  const [error, setError] = useState<string | null>(errorParam || null)
  const [switching, setSwitching] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient<{ orgs: Membership[] }>('/api/auth/memberships')
      .then((r) => {
        if (cancelled) return
        if (r.data?.orgs && Array.isArray(r.data.orgs)) {
          setOrgs(r.data.orgs)
          setError(null)
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
    setError(null)
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

  const statusLabel = error
    ? 'Membership lookup needs attention'
    : loading
      ? 'Loading organization memberships'
      : `${orgs.length} organization${orgs.length === 1 ? '' : 's'} available`
  const statusDetail = error
    ? 'Retry membership lookup once your session is available.'
    : 'You can switch later from the identity menu.'

  return (
    <ConsoleAuthShell
      headline={
        <>
          Pick the organization
          <br />
          that should <em className="text-[#357f7c] not-italic">frame this session.</em>
        </>
      }
      description="If your account belongs to more than one workspace, choose the organization that should power the next Build, Operate, and Settings session."
      statusLabel={statusLabel}
      statusTone={error ? 'danger' : loading ? 'neutral' : 'success'}
      statusDetail={statusDetail}
      panelEyebrow="Workspace Access"
      panelTitle="Select Organization"
      panelDescription="Choose which organization you want to access before entering the Console."
      panelWidthClassName="max-w-[520px]"
    >
      {error ? (
        <div
          role="alert"
          className="mb-5 rounded-[18px] border border-vermillion/18 bg-vermillion/[0.07] px-4 py-3 text-[13px] text-vermillion"
        >
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[24px] border border-white/72 bg-white/[0.74] shadow-[0_18px_36px_rgba(21,23,25,0.05),inset_0_1px_0_rgba(255,255,255,0.7)]">
        {loading ? (
          <div className="space-y-3 px-4 py-4">
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-4 rounded-[18px] border border-black/[0.04] bg-white/78 px-4 py-4">
                <div className="h-11 w-11 animate-pulse rounded-[16px] bg-black/[0.05]" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3.5 w-32 animate-pulse rounded-full bg-black/[0.05]" />
                  <div className="h-2.5 w-20 animate-pulse rounded-full bg-black/[0.04]" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[18px] border border-vermillion/16 bg-vermillion/[0.08] text-vermillion">
              <AlertCircle className="h-5 w-5" />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-[var(--mist)]">Membership lookup failed</p>
            <p className="mt-2 text-[13px] leading-6 text-[var(--fog)]">
              We could not confirm your organization memberships yet. Retry once the session and membership data are available.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center justify-center rounded-[16px] border border-[#357f7c]/18 bg-[#357f7c]/[0.08] px-4 py-2.5 text-[13px] font-semibold text-[#357f7c] transition-all hover:bg-[#357f7c]/[0.14]"
            >
              Retry lookup
            </button>
          </div>
        ) : orgs.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[18px] border border-black/[0.05] bg-white/85 text-[var(--fog)]">
              <Building2 className="h-5 w-5" />
            </div>
            <p className="mt-4 text-[15px] font-semibold text-[var(--mist)]">No organization memberships</p>
            <p className="mt-2 text-[13px] leading-6 text-[var(--fog)]">
              You do not belong to any organization yet. Contact your administrator for an invitation.
            </p>
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {orgs.map((org) => (
              <button
                key={org.orgId}
                onClick={() => selectOrg(org.orgId)}
                disabled={switching !== null}
                className="group flex w-full items-center gap-4 rounded-[20px] border border-black/[0.05] bg-white/[0.82] px-4 py-4 text-left shadow-[0_12px_24px_rgba(21,23,25,0.04)] transition-all hover:border-[#357f7c]/16 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#357f7c]/18 disabled:cursor-not-allowed disabled:opacity-55"
              >
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-[16px] border border-[#357f7c]/16 bg-[#357f7c]/[0.08] text-[#357f7c]">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold text-[var(--mist)]">{org.name}</div>
                  <div className="mt-1 text-[12px] capitalize text-[var(--fog)]">{roleLabel(org.role)}</div>
                </div>
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border border-black/[0.05] bg-white/80 text-[var(--fog)] transition-colors group-hover:text-[#357f7c]">
                  {switching === org.orgId ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin text-[#357f7c]" />
                  ) : (
                    <ArrowRight className="h-4.5 w-4.5" />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </ConsoleAuthShell>
  )
}
