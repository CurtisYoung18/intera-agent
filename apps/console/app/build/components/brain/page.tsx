import { Suspense } from 'react'
import BrainWorkspace from '@/components/brain/brain-workspace'

export default function BrainComponentPage() {
  return (
    <Suspense fallback={<main className="px-8 py-8 text-[13px] text-[var(--fog)]">Loading Brain workspace...</main>}>
      <BrainWorkspace />
    </Suspense>
  )
}
