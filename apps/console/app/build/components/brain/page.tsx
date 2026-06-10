import { Suspense } from 'react'
import BrainWorkspace from '@/components/brain/brain-workspace'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BrainComponentPage() {
  return (
    <BuildComponentsRouteShell
      currentLabel="Brain"
      description="Adjust memory, model, profile, and compact-test behavior inside the same Components workspace."
    >
      <Suspense fallback={<div className="intera-q2-panel px-5 py-5 text-[13px] text-[var(--color-text-secondary)]">Loading Brain workspace…</div>}>
        <BrainWorkspace />
      </Suspense>
    </BuildComponentsRouteShell>
  )
}
