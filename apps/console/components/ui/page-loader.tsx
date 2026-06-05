// PageLoader — standard data-state wrapper for admin pages.
// States: loading→Skeleton, error→error card+Retry, empty→muted text, data→children.

import { AlertCircle } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

interface PageLoaderProps {
  loading: boolean
  error: string | null
  onRetry: () => void
  empty?: boolean
  emptyMessage?: string
  children: React.ReactNode
}

export function PageLoader({
  loading,
  error,
  onRetry,
  empty = false,
  emptyMessage = 'No data available',
  children,
}: PageLoaderProps) {
  if (loading) {
    return (
      <div className="p-8 space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[60vh] w-full rounded-2xl" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center mt-20 space-y-4">
        <AlertCircle className="w-10 h-10 text-vermillion/60 mx-auto" />
        <p className="text-[var(--fog)]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-5 py-2.5 rounded-xl bg-indigo/[0.08] border border-indigo/20 text-indigo"
        >
          Retry
        </button>
      </div>
    )
  }

  if (empty) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center mt-20">
        <p className="text-[var(--fog)]">{emptyMessage}</p>
      </div>
    )
  }

  return <>{children}</>
}
