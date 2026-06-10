import KnowledgePage from '@/app/admin/knowledge/page'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BuildKnowledgePage() {
  return (
    <BuildComponentsRouteShell
      currentLabel="Knowledge"
      description="Keep retrieval-source editing and test flows intact while bringing the route into the same Build material family."
    >
      <KnowledgePage />
    </BuildComponentsRouteShell>
  )
}
