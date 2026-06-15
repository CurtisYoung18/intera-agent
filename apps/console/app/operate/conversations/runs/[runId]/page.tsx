import ProcedureRunDetailWorkspace from '@/components/operate/procedure-run-detail-workspace'

export default async function OperateProcedureRunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const { runId } = await params
  return <ProcedureRunDetailWorkspace runId={runId} />
}
