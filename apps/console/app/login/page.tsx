'use client'

import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { apiClient } from '@/lib/api/client'
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
  const next = params.get('next') || '/build/release'
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
    <div className={styles.shell}>
      <aside className={styles.brand} aria-hidden>
        <div className={`${styles.orb} ${styles.orbA}`} />
        <div className={`${styles.orb} ${styles.orbB}`} />
        <div className={`${styles.orb} ${styles.orbC}`} />
        <div className={styles.grain} />

        <div className={styles.brandTop}>
          <span className={styles.pill}>Context Lens · Agent Studio</span>
        </div>

        <div className={styles.brandMid}>
          <div className={styles.lockup}>
            <InteraLogo size={88} mode="idle" theme="light" showTag />
          </div>
          <h1 className={styles.brandHeadline}>
            Where messy context<br />finds its <em>clarity.</em>
          </h1>
        </div>

        <div className={styles.brandStatus}>
          <span className={`${styles.live} ${health === 'down' ? styles.liveDown : ''}`} />
          {health === 'down' ? 'Service degraded' : 'All systems operational'}
        </div>
      </aside>

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
            <div className={styles.inviteNote}>
              <span className={styles.inviteDot}>📨</span>
              <span>
                Sign in with Google using your <strong>invited email</strong> to accept the invitation automatically.
              </span>
            </div>
          )}

          <form onSubmit={submit} className={styles.form}>
            <div className={styles.field}>
              <div className={styles.fieldHead}>
                <label htmlFor="email">Email</label>
              </div>
              <div className={styles.inputShell}>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="username"
                />
              </div>
            </div>

            <div className={styles.field}>
              <div className={styles.fieldHead}>
                <label htmlFor="password">Password</label>
                <a href="#" className={styles.link} onClick={(e) => e.preventDefault()}>
                  Forgot?
                </a>
              </div>
              <div className={styles.inputShell}>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className={styles.revealBtn}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((s) => !s)}
                >
                  {showPassword ? <EyeOff aria-hidden size={16} /> : <Eye aria-hidden size={16} />}
                </button>
              </div>
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

          <div className={styles.sepWrap}>
            <span className={styles.sepLine} />
            <span>or continue with</span>
            <span className={styles.sepLine} />
          </div>

          <a href={googleHref} className={styles.googleBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84.81-.62z" />
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
