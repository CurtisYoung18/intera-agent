// Skeleton loader with shimmer — replaces "Loading…" text

import { ConsoleSurface } from '@/components/ui/console-chrome'

interface SkeletonProps {
  className?: string
}

export function Skeleton({ className = '' }: SkeletonProps) {
  return (
    <div
      className={`console-skeleton animate-shimmer rounded-md ${className}`}
    />
  )
}

export function CardSkeleton() {
  return (
    <ConsoleSurface className="space-y-3 p-5" padding="none">
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-1/2" />
    </ConsoleSurface>
  )
}

export function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  )
}
