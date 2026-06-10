import { Suspense } from 'react'
import BrainWorkspace from '@/components/brain/brain-workspace'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BrainComponentPage() {
  return (
    <BuildComponentsRouteShell
      currentLabel="Brain"
      description="Adjust memory, model, profile, and compact-test behavior inside the same Components workspace."
    >
      <Suspense fallback={<main className="px-8 py-8 text-[13px] text-[var(--fog)]">Loading Brain workspace...</main>}>
        <BrainWorkspace />
      </Suspense>
    </BuildComponentsRouteShell>
  )
}
