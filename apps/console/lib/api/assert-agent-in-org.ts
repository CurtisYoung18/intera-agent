// Cross-tenant ownership guard for agent sub-module routes.
//
// After the 2026-06-06 agent-scoped migration, Tool / Policy / CaseType /
// KnowledgeSource / ChannelBinding lost their `org_id` column and are scoped
// only by `agentConfigId`. Admin routes reach those rows via `repo.raw.*`
// (UNSCOPED Prisma) keyed by a CLIENT-SUPPLIED `agentConfigId` / `agentId`.
// Without a server-side ownership check, org A can read/write/delete org B's
// sub-modules simply by passing org B's id.
//
// This helper closes that hole: it looks the agentConfig up through the
// ORG-SCOPED `repo.agentConfig` model. The `scopedModel` proxy injects the
// caller's `orgId` into the `where`, so a foreign or missing id resolves to
// `null`. We then throw `NotFoundError` (mapped to a 404 ApiEnvelope by the
// defineRoute pipeline) — never leaking whether the id exists in another org.

import { NotFoundError } from '@/lib/api/define-route'
import type { RepoForOrg } from '@/lib/db/repo-for-org'

/**
 * Assert that `agentConfigId` belongs to the caller's org (via `repo.orgId`).
 *
 * Call this at the top of any handler that reaches an agent sub-module through
 * `repo.raw.*` keyed by a client-supplied id, BEFORE the unscoped access.
 *
 * @throws {NotFoundError} when the id is missing, or does not resolve to an
 *   agentConfig in the caller's org. defineRoute maps this to a 404 envelope.
 */
export async function assertAgentInOrg(
  repo: RepoForOrg,
  agentConfigId: string | null | undefined,
): Promise<void> {
  if (!agentConfigId) {
    throw new NotFoundError('Agent config not found')
  }

  // Org-scoped lookup: the scopedModel proxy injects `orgId`, so a foreign id
  // (or a non-existent one) returns null.
  const config = await repo.agentConfig.findUnique({
    where: { id: agentConfigId },
    select: { id: true },
  })

  if (!config) {
    throw new NotFoundError('Agent config not found')
  }
}
