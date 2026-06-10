import IntegrationsPage from '@/app/admin/integrations/page'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BuildIntegrationsPage() {
  return (
    <BuildComponentsRouteShell
      currentLabel="Integrations"
      description="Channels and API-key surfaces stay in their current flows, but the route now reads as part of the Build workspace."
    >
      <IntegrationsPage />
    </BuildComponentsRouteShell>
  )
}
