'use client'

import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/api/client'
import { ConsoleAuthShell } from '@/components/auth/console-auth-shell'

type Health = 'unknown' | 'ok' | 'down'

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const params = useSearchParams()
  const next = params.get('next') || '/build/pilot-lab'
  const invite = params.get('invite')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<Health>('unknown')

  useEffect(() => {
    let cancelled = false
    apiClient<{ status: string }>('/api/health')
      .then((r) => {
        if (!cancelled) setHealth(r.data?.status === 'ok' ? 'ok' : 'down')
      })
      .catch(() => {
        if (!cancelled) setHealth('down')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const body = { email: email.trim(), password }
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError((typeof data.error === 'string' ? data.error : data.error?.message) || 'Login failed')
        return
      }
      window.location.href = next
    } catch {
      setError('Network error — try again')
    } finally {
      setLoading(false)
    }
  }

  const googleHref = `/api/auth/google${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`

  return (
    <ConsoleAuthShell
      headline={
        <>
          Where operating context
          <br />
          finds its <em className="text-[#357f7c] not-italic">clarity.</em>
        </>
      }
      description="Sign in to move from Build to Operate without leaving the same warm, quiet material system. Invitations, SSO, and direct credentials all stay in one place."
      statusLabel={
        health === 'down'
          ? 'Service degraded'
          : health === 'ok'
            ? 'All systems operational'
            : 'Checking service health'
      }
      statusTone={health === 'down' ? 'danger' : health === 'ok' ? 'success' : 'neutral'}
      statusDetail={invite ? 'Invitation acceptance happens after sign-in.' : 'SSO and password sign-in are both available.'}
      panelEyebrow="Agent Console"
      panelTitle={invite ? "You've been invited" : 'Welcome back'}
      panelDescription={
        invite
          ? "You've been invited to join an organization. Sign in to accept the invitation and continue into the Console."
          : 'Sign in to manage agents, ProcedureRuns, handoff activity, and organization access from one continuous workspace.'
      }
    >
      {invite ? (
        <div className="mb-5 rounded-[20px] border border-[#357f7c]/18 bg-[#357f7c]/[0.07] px-4 py-3 text-[13px] leading-6 text-[var(--mist)]">
          Sign in with Google using your <strong>invited email</strong> to accept the invitation automatically.
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="email" className="block text-[12px] font-semibold text-[var(--fog)]">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="username"
            autoFocus
            className="glass-input-console h-12 rounded-[16px] bg-white/90"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="password" className="block text-[12px] font-semibold text-[var(--fog)]">
              Password
            </label>
            <button
              type="button"
              className="text-[12px] font-medium text-[#357f7c] transition-colors hover:text-[#255b58]"
            >
              Forgot?
            </button>
          </div>

          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete="current-password"
              className="glass-input-console h-12 rounded-[16px] bg-white/90 pr-11"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-transparent text-[var(--fog)] transition-colors hover:border-black/[0.06] hover:bg-black/[0.03] hover:text-[var(--mist)]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((s) => !s)}
            >
              {showPassword ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
            </button>
          </div>
        </div>

        {error ? (
          <div
            className="rounded-[18px] border border-vermillion/18 bg-vermillion/[0.07] px-4 py-3 text-[13px] text-vermillion"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={loading || !password || !email.trim()}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-[18px] border border-[#357f7c]/20 bg-[#357f7c] px-4 text-[14px] font-semibold text-white shadow-[0_18px_30px_rgba(53,127,124,0.18)] transition-all hover:bg-[#2b6c69] disabled:cursor-not-allowed disabled:opacity-45"
        >
          {loading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              <span>Signing in…</span>
            </>
          ) : (
            <>
              <span>Sign in</span>
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </form>

      <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-[var(--smoke)]">
        <span className="h-px flex-1 bg-black/[0.08]" />
        <span>or continue with</span>
        <span className="h-px flex-1 bg-black/[0.08]" />
      </div>

      <a
        href={googleHref}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-[18px] border border-black/[0.08] bg-white/88 px-4 text-[14px] font-medium text-[var(--mist)] shadow-[0_12px_24px_rgba(21,23,25,0.04)] transition-all hover:border-[#357f7c]/18 hover:bg-white"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84.81-.62z" />
        </svg>
        Sign in with Google
      </a>

      <p className="mt-5 text-[12px] leading-6 text-[var(--fog)]">
        Protected by SSO. <button type="button" className="font-medium text-[#357f7c]">Contact your administrator</button>
      </p>
    </ConsoleAuthShell>
  )
}
