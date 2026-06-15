import { NotFoundError } from '@/lib/api/define-route'
import type { RepoForOrg } from '@/lib/db/repo-for-org'

export async function resolveProcedureRun(repo: RepoForOrg, runId: string) {
  const run = await repo.raw.procedureRun.findFirst({
    where: { id: runId, orgId: repo.orgId },
    select: { id: true, caseId: true, chatId: true },
  })
  if (!run) throw new NotFoundError('ProcedureRun not found')

  const caseData = await repo.case.findFirst({
    where: { id: run.caseId },
  })
  if (!caseData) throw new NotFoundError('ProcedureRun not found')

  return { run, caseData }
}
