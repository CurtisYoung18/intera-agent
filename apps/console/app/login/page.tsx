'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, ShieldCheck, Building2 } from 'lucide-react'
import InteraLogo from '@intera/shared/ui/intera-logo'

type Mode = 'customer' | 'staff'

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const params = useSearchParams()
  const next = params.get('next') || '/ops/guide'

  const [mode, setMode] = useState<Mode>('customer')
  const [orgId, setOrgId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const body = mode === 'staff' ? { mode, password } : { mode, orgId: orgId.trim(), password }
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Login failed')
        return
      }
      // Full reload so server components pick up the new session cookie.
      window.location.href = next
    } catch {
      setError('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-[var(--paper,#faf9f5)] px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <InteraLogo size={28} />
          <p className="mt-3 text-[12px] text-[var(--fog)]">Agent Console</p>
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1 p-1 rounded-xl bg-black/[0.04] mb-5">
          <button
            type="button"
            onClick={() => { setMode('customer'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-all ${mode === 'customer' ? 'bg-white shadow-sm text-[var(--mist)]' : 'text-[var(--fog)]'}`}
          >
            <Building2 className="w-3.5 h-3.5" /> Organization
          </button>
          <button
            type="button"
            onClick={() => { setMode('staff'); setError('') }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-medium transition-all ${mode === 'staff' ? 'bg-white shadow-sm text-[var(--mist)]' : 'text-[var(--fog)]'}`}
          >
            <ShieldCheck className="w-3.5 h-3.5" /> Staff
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'customer' && (
            <div>
              <label className="block text-[11px] text-[var(--fog)] mb-1">Organization ID</label>
              <input
                type="text"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                placeholder="your-org-id"
                autoComplete="username"
                className="w-full px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[13px] outline-none focus:border-indigo/40"
              />
            </div>
          )}
          <div>
            <label className="block text-[11px] text-[var(--fog)] mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              autoComplete="current-password"
              className="w-full px-3 py-2 rounded-lg border border-black/[0.08] bg-white text-[13px] outline-none focus:border-indigo/40"
            />
          </div>

          {error && <p className="text-[11px] text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading || !password || (mode === 'customer' && !orgId.trim())}
            className="w-full py-2.5 rounded-lg bg-indigo text-white text-[13px] font-medium hover:bg-indigo/90 disabled:opacity-40 transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
