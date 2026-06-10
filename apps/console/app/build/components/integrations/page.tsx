import IntegrationsWorkspace from '@/components/integrations/integrations-workspace'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BuildIntegrationsPage() {
  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.integrations"
      descriptionKey="integrations"
    >
      <IntegrationsWorkspace />
    </BuildComponentsRouteShell>
  )
}
