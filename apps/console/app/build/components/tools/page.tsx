import ToolsPage from '@/app/admin/tools/page'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BuildToolsPage() {
  return (
    <BuildComponentsRouteShell
      currentLabel="Tools"
      description="Open tool editing, mock-fixture, and endpoint test flows without leaving the local Components workspace."
    >
      <ToolsPage />
    </BuildComponentsRouteShell>
  )
}
