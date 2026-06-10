import CaseTypesPage from '@/app/admin/case-types/page'
import { BuildComponentsRouteShell } from '../_components/components-route-shell'

export default function BuildProceduresPage() {
  return (
    <BuildComponentsRouteShell
      currentLabel="Procedures"
      description="Keep the existing Procedure builder flows, but anchor them inside the Build material system and local Components navigation."
    >
      <CaseTypesPage />
    </BuildComponentsRouteShell>
  )
}
