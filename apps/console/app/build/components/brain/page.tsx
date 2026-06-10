import { Suspense } from 'react'
import BrainWorkspace from '@/components/brain/brain-workspace'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BrainComponentPage() {
  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.brain"
      descriptionKey="brain"
    >
      <Suspense fallback={<div className="intera-q2-panel px-5 py-5 text-[13px] text-[var(--color-text-secondary)]">Loading Brain workspace…</div>}>
        <BrainWorkspace />
      </Suspense>
    </BuildComponentsRouteShell>
  )
}
