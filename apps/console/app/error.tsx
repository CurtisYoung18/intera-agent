'use client'

import { useEffect } from 'react'
import { isChunkLoadError, shouldAutoReload, markReloaded } from './_lib/chunk-error'

// Segment-level error boundary. Runtime chunk failures that happen AFTER initial load
// (e.g. a lazy import resolving to a chunk removed by a deploy) bubble here, to the
// nearest error.tsx, rather than to global-error.tsx. Shares the one-reload guard with
// global-error.tsx via the same sessionStorage key.
export default function ConsoleError({
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

  if (chunkError && typeof window !== 'undefined' && shouldAutoReload(window.sessionStorage)) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-8 text-center text-sm text-slate-500">
        <p>页面已更新，正在刷新… / Updating, reloading…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
      <h2 className="text-lg font-semibold text-slate-800">出错了 / Something went wrong</h2>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
      >
        重新加载 / Reload
      </button>
    </div>
  )
}
