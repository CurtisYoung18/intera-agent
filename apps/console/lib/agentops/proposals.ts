import type { AuditWriter } from '@intera/shared/contracts/audit'
import {
  agentOpsProposalCreateResponseSchema,
  makeAgentOpsProposalCreateRequestSchema,
  type AgentOpsProposalCreateRequest,
  type AgentOpsProposalCreateResponse,
} from '@intera/shared/contracts/agentops/proposals'
import type { RepoForOrg } from '@/lib/db/repo-for-org'
import type { RouteSession } from '@/lib/api/define-route'
import { ConflictError, ValidationError } from '@/lib/api/define-route'
import { configPilotProposalSchema, type ConfigPilotProposal } from '@/lib/config-pilot/contracts'
import { buildPilotDraftFingerprint } from '@/lib/pilot/fingerprint'
import {
  persistConfigPilotProposal,
  recordAgentOpsProposalMetadata,
} from '@/lib/pilot/persistence'

export const agentOpsConfigPilotProposalCreateRequestSchema =
  makeAgentOpsProposalCreateRequestSchema(configPilotProposalSchema)

export type AgentOpsConfigPilotProposalCreateRequest =
  AgentOpsProposalCreateRequest<ConfigPilotProposal>

interface CreateAgentOpsDraftProposalInput {
  repo: RepoForOrg
  session: RouteSession
  pathAgentId: string
  input: AgentOpsConfigPilotProposalCreateRequest
  audit: AuditWriter
}

function withoutClientProposalIds(proposal: ConfigPilotProposal): ConfigPilotProposal {
  const {
    id: _id,
    pilotProposalId: _pilotProposalId,
    ...rest
  } = proposal
  return rest
}

export async function createAgentOpsDraftProposal({
  repo,
  session,
  pathAgentId,
  input,
  audit,
}: CreateAgentOpsDraftProposalInput): Promise<AgentOpsProposalCreateResponse> {
  if (input.target?.agentId && input.target.agentId !== pathAgentId) {
    throw new ValidationError('target.agentId must match route agentId', {
      'target.agentId': 'Must match the route agentId',
    })
  }

  if (input.proposal.baseDraftFingerprint && input.proposal.baseDraftFingerprint !== input.baseDraftFingerprint) {
    throw new ValidationError('proposal.baseDraftFingerprint must match baseDraftFingerprint', {
      'proposal.baseDraftFingerprint': 'Must match baseDraftFingerprint',
    })
  }

  const currentFingerprint = await buildPilotDraftFingerprint(repo, pathAgentId)
  if (currentFingerprint !== input.baseDraftFingerprint) {
    throw new ConflictError('Draft fingerprint mismatch; refresh the Agent draft before proposing')
  }

  const proposal = {
    ...withoutClientProposalIds(input.proposal),
    baseDraftFingerprint: input.baseDraftFingerprint,
  }
  const stored = await persistConfigPilotProposal(
    repo,
    session,
    {
      agentConfigId: pathAgentId,
      request: `AgentOps proposal from ${input.externalAgent.name}: ${input.reason}`,
    },
    proposal,
    input.baseDraftFingerprint,
  )

  await recordAgentOpsProposalMetadata(repo, session, {
    sessionId: stored.sessionId,
    proposalId: stored.id,
    agentConfigId: pathAgentId,
    schemaVersion: input.schemaVersion,
    externalAgent: input.externalAgent,
    evidenceRefs: input.evidenceRefs,
    reason: input.reason,
  })

  await audit({
    action: 'agentops.proposal.create',
    target: `agent_config:${pathAgentId}`,
    after: {
      proposalId: stored.id,
      status: stored.status,
      baseDraftFingerprint: stored.baseDraftFingerprint,
      evidenceRefs: input.evidenceRefs,
      externalAgent: input.externalAgent,
      activeAgentConfigUnchanged: true,
    },
  })

  return agentOpsProposalCreateResponseSchema.parse({
    proposalId: stored.id,
    status: 'drafted',
    baseDraftFingerprint: stored.baseDraftFingerprint,
    evidenceRefs: input.evidenceRefs,
    activeAgentConfigUnchanged: true,
  })
}
