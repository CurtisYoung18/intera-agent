'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, Building2 } from 'lucide-react'
import InteraLogo from '@intera/shared/ui/intera-logo'

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
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        if (!data.isAuthenticated) {
          window.location.href = '/login'
          return
        }
        // Fetch the list of orgs for the current user
        return fetch('/api/auth/memberships')
      })
      .then((r) => (r ? r.json() : null))
      .then((data) => {
        if (cancelled) return
        if (data?.orgs && Array.isArray(data.orgs)) {
          setOrgs(data.orgs)
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
      const res = await fetch('/api/auth/switch-org', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to switch organization')
        setSwitching(null)
        return
      }
      window.location.href = '/ops/guide'
    } catch {
      setError('Network error — try again')
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
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <InteraLogo size={28} mode="idle" theme="dark" />
        </div>

        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold text-zinc-100 mb-2">
            Select Organization
          </h1>
          <p className="text-zinc-400 text-sm">
            Choose which organization you want to access.
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm text-center"
          >
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
          </div>
        ) : orgs.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-zinc-500 text-sm">
              You do not belong to any organization.
            </p>
            <p className="text-zinc-600 text-xs mt-2">
              Contact your administrator for an invitation.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {orgs.map((org) => (
              <button
                key={org.orgId}
                onClick={() => selectOrg(org.orgId)}
                disabled={switching !== null}
                className="w-full flex items-center gap-4 p-4 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 transition-colors text-left group disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center flex-shrink-0">
                  <Building2 className="w-5 h-5 text-zinc-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-100 font-medium truncate">
                    {org.name}
                  </div>
                  <div className="text-zinc-500 text-xs capitalize">
                    {roleLabel(org.role)}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {switching === org.orgId ? (
                    <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
                  ) : (
                    <ArrowRight className="w-5 h-5 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
