import { Suspense } from 'react'
import BrainWorkspace from '@/components/brain/brain-workspace'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BrainComponentPage() {
  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.brain"
      descriptionKey="brain"
    >
      <Suspense
        fallback={
          <div className="intera-q2-panel px-5 py-5">
            <div className="h-5 w-40 animate-pulse rounded-full bg-black/[0.06]" />
            <div className="mt-3 h-24 animate-pulse rounded-[20px] bg-black/[0.04]" />
          </div>
        }
      >
        <BrainWorkspace />
      </Suspense>
    </BuildComponentsRouteShell>
  )
}
