'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import InteraLogo from '@intera/shared/ui/intera-logo'
import styles from './login.module.css'

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
  const next = params.get('next') || '/ops/guide'
  const invite = params.get('invite')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState<Health>('unknown')

  useEffect(() => {
    let cancelled = false
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => {
        if (!cancelled) setHealth(j?.status === 'ok' ? 'ok' : 'down')
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

  return (
    <div className={styles.shell}>
      {/* ── Brand panel (left) ── */}
      <aside className={styles.brand} aria-hidden>
        <div className={`${styles.orb} ${styles.orbA}`} />
        <div className={`${styles.orb} ${styles.orbB}`} />
        <div className={`${styles.orb} ${styles.orbC}`} />
        <div className={styles.grain} />

        <div className={styles.brandTop}>
          <InteraLogo size={22} mode="idle" theme="dark" />
        </div>

        <div className={styles.brandMid}>
          <div className={styles.brandEyebrow}>Customer Support, Resolved</div>
          <h1 className={styles.brandHeadline}>
            The console where <em>every</em> conversation finds its answer.
          </h1>
          <p className={styles.brandSub}>
            Configure agents, tune guardrails, and watch cases resolve themselves — all from one calm, considered workspace.
          </p>
        </div>

        <div className={styles.brandStatus}>
          <span className={`${styles.live} ${health === 'down' ? styles.liveDown : ''}`} />
          {health === 'down' ? 'Service degraded' : 'All systems operational'}
        </div>
      </aside>

      {/* ── Form panel (right) ── */}
      <main className={styles.panel}>
        <div className={styles.formWrap}>
          <div className={styles.formHead}>
            <div className={styles.formEyebrow}>Agent Console</div>
            <h2 className={styles.formTitle}>{invite ? "You've been invited" : 'Welcome back'}</h2>
            <p className={styles.formDesc}>
              {invite
                ? "You've been invited to join an organization. Sign in to accept."
                : 'Sign in to manage your agents and conversations.'}
            </p>
          </div>

          {invite && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(99,102,241,0.06), rgba(139,111,245,0.06))',
              border: '1px solid rgba(99,102,241,0.12)',
              borderRadius: 12,
              padding: '12px 16px',
              marginBottom: 16,
              fontSize: 13,
              color: 'var(--mist)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}>
              <span style={{ fontSize: 16 }}>📨</span>
              <span>Sign in with Google using your <strong>invited email</strong> to accept the invitation automatically.</span>
            </div>
          )}

          <form onSubmit={submit} className={styles.form}>
            <div className={styles.field}>
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="username"
              />
            </div>
            <div className={styles.field}>
              <div className={styles.rowBetween}>
                <label htmlFor="password">Password</label>
                <a href="#" className={styles.forgot} onClick={(e) => e.preventDefault()}>Forgot?</a>
              </div>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className={styles.errorBox} role="alert">
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !password || !email.trim()}
              className={styles.submitBtn}
            >
              {loading ? (
                <>
                  <div className={styles.spinner} />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <span>Sign in</span>
                  <ArrowRight />
                </>
              )}
            </button>
          </form>

          {/* ── Google SSO ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0' }}>
            <div style={{ flex: 1, height: 1, background: 'var(--border-color, #e5e7eb)' }} />
            <span style={{ fontSize: 12, color: 'var(--fog, #9ca3af)', whiteSpace: 'nowrap' }}>or continue with</span>
            <div style={{ flex: 1, height: 1, background: 'var(--border-color, #e5e7eb)' }} />
          </div>

          <a
            href={`/api/auth/google${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              width: '100%',
              padding: '10px 16px',
              borderRadius: 12,
              border: '1px solid var(--border-color, #e5e7eb)',
              background: 'var(--surface, #fff)',
              color: 'var(--mist, #374151)',
              fontSize: 14,
              fontWeight: 500,
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-hover, #f3f4f6)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--surface, #fff)')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </a>

          <p className={styles.panelFoot}>
            Protected by SSO · <a href="#" onClick={(e) => e.preventDefault()}>Contact your administrator</a>
          </p>
        </div>
      </main>
    </div>
  )
}
