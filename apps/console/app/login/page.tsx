'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Building2, ShieldCheck, ArrowRight } from 'lucide-react'
import InteraLogo from '@intera/shared/ui/intera-logo'
import styles from './login.module.css'

type Mode = 'customer' | 'staff'
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

  const [mode, setMode] = useState<Mode>('customer')
  const [orgId, setOrgId] = useState('')
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
          <div className={styles.brandGlyph}>
            <span className={styles.brandDot} />
          </div>
          <InteraLogo size={22} />
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
            <h2 className={styles.formTitle}>Welcome back</h2>
            <p className={styles.formDesc}>Sign in to manage your agents and conversations.</p>
          </div>

          <div className={styles.modeToggle} role="tablist" aria-label="Sign-in mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'customer'}
              onClick={() => { setMode('customer'); setError('') }}
              className={`${styles.modeBtn} ${mode === 'customer' ? styles.modeBtnActive : ''}`}
            >
              <Building2 />
              Organization
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'staff'}
              onClick={() => { setMode('staff'); setError('') }}
              className={`${styles.modeBtn} ${mode === 'staff' ? styles.modeBtnActive : ''}`}
            >
              <ShieldCheck />
              Staff
            </button>
          </div>

          <form onSubmit={submit} className={styles.form}>
            {mode === 'customer' && (
              <div className={styles.field}>
                <label htmlFor="orgId">Organization ID</label>
                <input
                  id="orgId"
                  type="text"
                  value={orgId}
                  onChange={(e) => setOrgId(e.target.value)}
                  placeholder="your-org-id"
                  autoComplete="username"
                />
              </div>
            )}
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
              disabled={loading || !password || (mode === 'customer' && !orgId.trim())}
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

          <p className={styles.panelFoot}>
            Protected by SSO · <a href="#" onClick={(e) => e.preventDefault()}>Contact your administrator</a>
          </p>
        </div>
      </main>
    </div>
  )
}
