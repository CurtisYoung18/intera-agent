import HooksPage from '@/app/admin/hooks/page'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BuildHooksPage() {
  return (
    <BuildComponentsRouteShell
      currentLabel="Hooks"
      description="Review Hook definitions and binding scopes with the same Build shell language used by Release and Pilot Lab."
    >
      <HooksPage />
    </BuildComponentsRouteShell>
  )
}
