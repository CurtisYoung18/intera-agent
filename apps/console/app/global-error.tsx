'use client'

import { useEffect } from 'react'
import { isChunkLoadError, shouldAutoReload, markReloaded } from './_lib/chunk-error'

// Root-level error boundary. Next renders this in place of the entire document when an
// error escapes the root layout, so it MUST provide its own <html>/<body>. It cannot
// rely on the console's LocaleProvider or any layout context (those live inside the
// tree this boundary replaces), so all copy is static and bilingual.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const chunkError = isChunkLoadError(error)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!chunkError) return
    if (!shouldAutoReload(window.sessionStorage)) return
    markReloaded(window.sessionStorage)
    window.location.reload()
  }, [chunkError])

  const reloading =
    chunkError && typeof window !== 'undefined' && shouldAutoReload(window.sessionStorage)

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            padding: '2rem',
            textAlign: 'center',
            color: '#334155',
          }}
        >
          {reloading ? (
            <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
              页面已更新，正在刷新… / Updating, reloading…
            </p>
          ) : (
            <>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 600 }}>出错了 / Something went wrong</h2>
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  borderRadius: '0.375rem',
                  background: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                重新加载 / Reload
              </button>
            </>
          )}
        </div>
      </body>
    </html>
  )
}
