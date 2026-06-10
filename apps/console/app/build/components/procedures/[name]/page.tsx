import ProcedureDetailPage from '@/app/admin/case-types/[name]/page'
import { BuildComponentsRouteShell } from '../../_components/components-route-shell'

export default function BuildProcedureDetailPage() {
  return (
    <BuildComponentsRouteShell
      currentLabel="Procedures"
      description="Inspect and save Procedure details while staying inside the local Components route family."
    >
      <ProcedureDetailPage />
    </BuildComponentsRouteShell>
  )
}
