import ProcedureRunDetailWorkspace from '@/components/operate/procedure-run-detail-workspace'

export default async function OperateCaseDetailPage({
  params,
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params
  return <ProcedureRunDetailWorkspace caseId={caseId} />
}
