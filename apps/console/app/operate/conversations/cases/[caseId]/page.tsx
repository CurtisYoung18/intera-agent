// Canonical ProcedureRun detail route reuses the legacy case detail implementation.
// Middleware already redirects `/ops/cases/:id` here, so this route must render the
// detail surface instead of treating `caseId` like a chat id.
export { default } from '@/app/ops/cases/[caseId]/page'
