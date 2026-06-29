import { z } from 'zod'

export const agentOpsProposalCreateSchemaVersion = 'agentops.proposal-create.v1'

const secretLikePattern = /\b(api[_-]?key|access[_-]?token|auth(?:orization)?|bearer|password|secret|database[_-]?url|postgres(?:ql)?:\/\/|mysql:\/\/|mongodb(?:\+srv)?:\/\/|redis:\/\/|sk_live|sk-[a-z0-9]{8,})\b/i
const rawPayloadPattern = /[\r\n{}[\]"'`]/
const compactBlobPattern = /[A-Za-z0-9+/=]{96,}/

function isSafeRef(value: string): boolean {
  return !secretLikePattern.test(value)
    && !rawPayloadPattern.test(value)
    && !compactBlobPattern.test(value)
}

const safeMetadataString = (label: string, max = 160) => z.string()
  .trim()
  .min(1, `${label} is required`)
  .max(max, `${label} is too long`)
  .refine((value) => !secretLikePattern.test(value), `${label} must not contain secret-like values`)
  .refine((value) => !compactBlobPattern.test(value), `${label} must not contain raw payload blobs`)

const safeNarrativeString = (label: string, max = 2000) => z.string()
  .trim()
  .min(1, `${label} is required`)
  .max(max, `${label} is too long`)
  .refine((value) => !secretLikePattern.test(value), `${label} must not contain secret-like values`)
  .refine((value) => !compactBlobPattern.test(value), `${label} must not contain raw payload blobs`)

export const agentOpsEvidenceRefSchema = z.string()
  .trim()
  .min(3, 'Evidence ref is required')
  .max(160, 'Evidence ref is too long')
  .regex(/^[a-z][a-z0-9_.-]{1,31}:[A-Za-z0-9_./:@#-]{1,128}$/, 'Evidence refs must use type:id form')
  .refine(isSafeRef, 'Evidence refs must be refs only, not raw payloads or secrets')
export type AgentOpsEvidenceRef = z.infer<typeof agentOpsEvidenceRefSchema>

export const agentOpsExternalAgentSchema = z.object({
  name: safeMetadataString('externalAgent.name', 80),
  provider: safeMetadataString('externalAgent.provider', 80).optional(),
  runId: safeMetadataString('externalAgent.runId', 120).optional(),
  sessionId: safeMetadataString('externalAgent.sessionId', 120).optional(),
  version: safeMetadataString('externalAgent.version', 80).optional(),
}).strict()
export type AgentOpsExternalAgent = z.infer<typeof agentOpsExternalAgentSchema>

export const agentOpsProposalTargetSchema = z.object({
  agentId: z.string().trim().min(1, 'target.agentId is required').max(160),
}).strict()
export type AgentOpsProposalTarget = z.infer<typeof agentOpsProposalTargetSchema>

const agentOpsProposalCreateBaseShape = {
  schemaVersion: z.literal(agentOpsProposalCreateSchemaVersion),
  target: agentOpsProposalTargetSchema.optional(),
  baseDraftFingerprint: z.string().trim().regex(/^[a-f0-9]{64}$|^pre_build_family:.+$/, 'baseDraftFingerprint must be a draft fingerprint'),
  externalAgent: agentOpsExternalAgentSchema,
  reason: safeNarrativeString('reason', 2000),
  evidenceRefs: z.array(agentOpsEvidenceRefSchema).min(1, 'At least one evidence ref is required').max(20, 'Too many evidence refs'),
}

export const agentOpsProposalCreateEnvelopeSchema = z.object(agentOpsProposalCreateBaseShape).strict()
export type AgentOpsProposalCreateEnvelope = z.infer<typeof agentOpsProposalCreateEnvelopeSchema>

export function makeAgentOpsProposalCreateRequestSchema<TProposalSchema extends z.ZodTypeAny>(
  proposalSchema: TProposalSchema,
) {
  return z.object({
    ...agentOpsProposalCreateBaseShape,
    proposal: proposalSchema,
  }).strict().superRefine((value, ctx) => {
    const proposalFingerprint = typeof value.proposal === 'object' && value.proposal !== null
      ? (value.proposal as { baseDraftFingerprint?: unknown }).baseDraftFingerprint
      : undefined
    if (typeof proposalFingerprint === 'string' && proposalFingerprint !== value.baseDraftFingerprint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['proposal', 'baseDraftFingerprint'],
        message: 'proposal.baseDraftFingerprint must match baseDraftFingerprint',
      })
    }
  })
}

export type AgentOpsProposalCreateRequest<TProposal = unknown> =
  AgentOpsProposalCreateEnvelope & { proposal: TProposal }

export const agentOpsProposalCreateResponseSchema = z.object({
  proposalId: z.string(),
  status: z.literal('drafted'),
  baseDraftFingerprint: z.string(),
  evidenceRefs: z.array(agentOpsEvidenceRefSchema),
  activeAgentConfigUnchanged: z.literal(true),
}).strict()
export type AgentOpsProposalCreateResponse = z.infer<typeof agentOpsProposalCreateResponseSchema>
