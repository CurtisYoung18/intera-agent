import HookBuilder from '@/components/admin/hook-builder'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BuildHooksPage() {
  return (
    <BuildComponentsRouteShell
      currentLabelKey="sidebar.hooks"
      descriptionKey="hooks"
    >
      <HookBuilder embedded />
    </BuildComponentsRouteShell>
  )
}
