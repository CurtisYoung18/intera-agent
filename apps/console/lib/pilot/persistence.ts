import { apiOk } from '@intera/shared/contracts/envelope'
import {
  agentBuildBriefSchema,
  pilotInspectionTraceSchema,
  pilotInspectionTraceStepSchema,
  pilotBlockerSchema,
  pilotHandoffSchema,
  pilotMessageSchema,
  pilotModeSchema,
  pilotPermissionsSchema,
  pilotPlanningGroupSchema,
  pilotProposalSchema,
  pilotRunScenarioResponseSchema,
  pilotRiskSchema,
  pilotSessionSchema,
  pilotSessionSnapshotSchema,
  pilotSessionSummarySchema,
  pilotValidationTriageSchema,
  scratchBuildPlanSchema,
  templateRecommendationSchema,
  templateTailoringPlanSchema,
  pilotTodoItemSchema,
  pilotTodoPlanSchema,
  pilotValidationPlanSchema,
  type PilotArchiveSessionRequest,
  type PilotBuildBriefUpsertRequest,
  type PilotConfirmBriefRequest,
  type PilotCreateScratchBuildPlanRequest,
  type PilotCreateTemplateRecommendationRequest,
  type PilotCreateTemplateTailoringPlanRequest,
  type PilotGenerateHandoffRequest,
  type PilotGenerateReleaseHandoffRequest,
  type PilotManualCompactRequest,
  type PilotPermissions,
  type PilotPromotePlanningGroupsRequest,
  type PilotRecordInspectionTraceRequest,
  type PilotRunScenarioRequest,
  type PilotTakeoverSessionRequest,
} from '@intera/shared/contracts/pilot'
import { scenarioValidationSummarySchema, type ScenarioReceipt, type ScenarioValidationSummary } from '@intera/shared/contracts/scenarios'
import type { AuditWriter } from '@intera/shared/contracts/audit'
import type { RepoForOrg } from '@/lib/db/repo-for-org'
import type { RouteSession } from '@/lib/api/define-route'
import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { configPilotProposalSchema, type ConfigPilotProposal } from '@/lib/config-pilot/contracts'
import { applyConfigPilotProposal } from '@/lib/config-pilot/apply'
import { getScenario, appendScenarioReceipt, getScenarioValidationSummary } from '@/lib/scenarios/store'
import { runScenarioHarness } from '@/lib/scenarios/runner'
import { runScenarioAgentRuntime } from '@/lib/scenarios/runtime-runner'
import { buildPilotDraftFingerprint } from './fingerprint'

type AnyRecord = Record<string, any>
type PilotSessionTarget = string | {
  agentConfigId?: string
  agentFamilyKey?: string
  bindingScope?: 'draft_agent' | 'pre_build_family'
  currentMode?: string
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return new Date().toISOString()
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function jsonArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Array<Record<string, unknown>> : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : []
}

function planningGroups(value: unknown) {
  return Array.isArray(value) ? value.map((item) => pilotPlanningGroupSchema.parse(item)) : []
}

function normalizeSessionTarget(target: PilotSessionTarget) {
  if (typeof target === 'string') {
    return { agentConfigId: target, bindingScope: 'draft_agent' as const }
  }
  return {
    ...target,
    bindingScope: target.bindingScope ?? 'draft_agent',
  }
}

export function pilotPermissions(session: RouteSession): PilotPermissions {
  const role = session.role
  const canMutate = role === 'admin' || role === 'owner'
  const canRead = canMutate || role === 'operator'
  return pilotPermissionsSchema.parse({
    role,
    canRead,
    canPropose: canMutate,
    canAccept: canMutate,
    canApply: canMutate,
    canTakeOver: canMutate,
    canGenerateHandoff: canMutate,
    canPublish: false,
  })
}

function serializeSession(row: AnyRecord) {
  return pilotSessionSchema.parse({
    id: row.id,
    orgId: row.orgId,
    agentConfigId: row.agentConfigId ?? null,
    agentFamilyKey: row.agentFamilyKey ?? null,
    bindingScope: row.bindingScope,
    createdByUserId: row.createdByUserId,
    activeEditorUserId: row.activeEditorUserId ?? null,
    status: row.status,
    title: row.title,
    currentMode: pilotModeSchema.catch('critique_existing_agent').parse(row.currentMode),
    summary: row.summary ? pilotSessionSummarySchema.parse(row.summary) : null,
    pinnedState: jsonRecord(row.pinnedState),
    currentBuildBriefId: row.currentBuildBriefId ?? null,
    currentTodoPlanId: row.currentTodoPlanId ?? null,
    currentActiveTodoItemId: row.currentActiveTodoItemId ?? null,
    latestProposalId: row.latestProposalId ?? null,
    latestReceiptRunId: row.latestReceiptRunId ?? null,
    latestHandoffId: row.latestHandoffId ?? null,
    memoryDegraded: Boolean(row.memoryDegraded),
    compactedAt: row.compactedAt ? iso(row.compactedAt) : null,
    archivedAt: row.archivedAt ? iso(row.archivedAt) : null,
    isCurrent: Boolean(row.isCurrent),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  })
}

function serializeMessage(row: AnyRecord) {
  return pilotMessageSchema.parse({
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    kind: row.kind,
    content: row.content,
    structuredPayload: jsonRecord(row.structuredPayload),
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt),
  })
}

function serializeProposal(row: AnyRecord) {
  return pilotProposalSchema.parse({
    id: row.id,
    sessionId: row.sessionId,
    todoItemId: row.todoItemId ?? null,
    parentProposalId: row.parentProposalId ?? null,
    status: row.status,
    primarySurface: row.primarySurface,
    title: row.title,
    summary: row.summary,
    intentSummary: row.intentSummary ?? null,
    batchRationale: row.batchRationale ?? null,
    blastRadius: row.blastRadius ?? null,
    validationPlan: row.validationPlan ? pilotValidationPlanSchema.parse(row.validationPlan) : null,
    proposal: jsonRecord(row.proposal) ?? {},
    diffGroups: row.diffGroups ? jsonArray(row.diffGroups) : null,
    patchCount: row.patchCount,
    baseAgentConfigId: row.baseAgentConfigId,
    baseDraftFingerprint: row.baseDraftFingerprint,
    acceptedByUserId: row.acceptedByUserId ?? null,
    acceptedAt: row.acceptedAt ? iso(row.acceptedAt) : null,
    appliedByUserId: row.appliedByUserId ?? null,
    appliedAt: row.appliedAt ? iso(row.appliedAt) : null,
    appliedDraftAgentConfigId: row.appliedDraftAgentConfigId ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  })
}

function serializeTodoItem(row: AnyRecord) {
  return pilotTodoItemSchema.parse({
    id: row.id,
    sessionId: row.sessionId,
    planId: row.planId,
    type: row.type,
    status: row.status,
    title: row.title,
    description: row.description ?? null,
    isRequired: Boolean(row.isRequired),
    visibleReason: row.visibleReason ?? null,
    latestProposalId: row.latestProposalId ?? null,
    latestReceiptRunId: row.latestReceiptRunId ?? null,
    latestHandoffId: row.latestHandoffId ?? null,
    targetScenarioName: row.targetScenarioName ?? null,
    metadata: jsonRecord(row.metadata),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  })
}

function serializeTodoPlan(row: AnyRecord) {
  return pilotTodoPlanSchema.parse({
    id: row.id,
    sessionId: row.sessionId,
    title: row.title ?? null,
    isCurrent: Boolean(row.isCurrent),
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    items: (row.items ?? []).map(serializeTodoItem),
  })
}

function serializeHandoff(row: AnyRecord) {
  return pilotHandoffSchema.parse({
    id: row.id,
    sessionId: row.sessionId,
    draftAgentConfigId: row.draftAgentConfigId,
    draftFingerprint: row.draftFingerprint,
    handoffSummary: row.handoffSummary,
    readinessVerdict: row.readinessVerdict,
    blockers: Array.isArray(row.blockers) ? row.blockers.map((item: unknown) => pilotBlockerSchema.parse(item)) : [],
    risks: Array.isArray(row.risks) ? row.risks.map((item: unknown) => pilotRiskSchema.parse(item)) : [],
    referencedProposalIds: Array.isArray(row.referencedProposalIds) ? row.referencedProposalIds : [],
    referencedReceiptIds: Array.isArray(row.referencedReceiptIds) ? row.referencedReceiptIds : [],
    coveredTodoItemIds: Array.isArray(row.coveredTodoItemIds) ? row.coveredTodoItemIds : [],
    isCurrent: Boolean(row.isCurrent),
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  })
}

function serializeBuildBrief(row: AnyRecord) {
  return agentBuildBriefSchema.parse({
    id: row.id,
    orgId: row.orgId,
    agentFamilyKey: row.agentFamilyKey,
    sessionId: row.sessionId ?? null,
    revision: row.revision,
    status: row.status,
    businessGoal: row.businessGoal ?? null,
    targetChannels: stringArray(row.targetChannels),
    supportedUseCases: stringArray(row.supportedUseCases),
    outOfScopeUseCases: stringArray(row.outOfScopeUseCases),
    escalationPolicy: row.escalationPolicy ?? null,
    requiredToolsAndIntegrations: stringArray(row.requiredToolsAndIntegrations),
    toneAndResponseConstraints: stringArray(row.toneAndResponseConstraints),
    validationExpectations: stringArray(row.validationExpectations),
    openQuestions: stringArray(row.openQuestions),
    isCurrent: Boolean(row.isCurrent),
    confirmedAt: row.confirmedAt ? iso(row.confirmedAt) : null,
    confirmedByUserId: row.confirmedByUserId ?? null,
    supersededAt: row.supersededAt ? iso(row.supersededAt) : null,
    supersededById: row.supersededById ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  })
}

function serializeTemplateRecommendation(row: AnyRecord) {
  return templateRecommendationSchema.parse({
    id: row.id,
    orgId: row.orgId,
    briefId: row.briefId,
    candidateTemplates: Array.isArray(row.candidateTemplates) ? row.candidateTemplates : [],
    recommendedTemplateId: row.recommendedTemplateId ?? null,
    fitSummary: row.fitSummary,
    mismatchSummary: row.mismatchSummary ?? null,
    whyNotScratch: row.whyNotScratch ?? null,
    whyScratch: row.whyScratch ?? null,
    isCurrent: Boolean(row.isCurrent),
    supersededAt: row.supersededAt ? iso(row.supersededAt) : null,
    supersededById: row.supersededById ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  })
}

function serializeTemplateTailoringPlan(row: AnyRecord) {
  return templateTailoringPlanSchema.parse({
    id: row.id,
    orgId: row.orgId,
    briefId: row.briefId,
    recommendationId: row.recommendationId ?? null,
    selectedTemplateId: row.selectedTemplateId,
    fitAreas: stringArray(row.fitAreas),
    mismatchAreas: stringArray(row.mismatchAreas),
    requiredTailoringGroups: planningGroups(row.requiredTailoringGroups),
    recommendedTailoringGroups: planningGroups(row.recommendedTailoringGroups),
    firstValidationTargets: stringArray(row.firstValidationTargets),
    isCurrent: Boolean(row.isCurrent),
    supersededAt: row.supersededAt ? iso(row.supersededAt) : null,
    supersededById: row.supersededById ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  })
}

function serializeScratchBuildPlan(row: AnyRecord) {
  return scratchBuildPlanSchema.parse({
    id: row.id,
    orgId: row.orgId,
    briefId: row.briefId,
    scratchScope: row.scratchScope,
    proposedFoundationSurfaces: stringArray(row.proposedFoundationSurfaces),
    requiredBuildGroups: planningGroups(row.requiredBuildGroups),
    recommendedBuildGroups: planningGroups(row.recommendedBuildGroups),
    initialToolingPlan: stringArray(row.initialToolingPlan),
    initialValidationTargets: stringArray(row.initialValidationTargets),
    isCurrent: Boolean(row.isCurrent),
    supersededAt: row.supersededAt ? iso(row.supersededAt) : null,
    supersededById: row.supersededById ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  })
}

function serializeInspectionTrace(row: AnyRecord) {
  return pilotInspectionTraceSchema.parse({
    id: row.id,
    orgId: row.orgId,
    sessionId: row.sessionId,
    actionClass: row.actionClass,
    targetObjectRef: row.targetObjectRef ? jsonRecord(row.targetObjectRef) : null,
    steps: Array.isArray(row.steps) ? row.steps.map((step: unknown) => pilotInspectionTraceStepSchema.parse(step)) : [],
    evidenceSufficient: Boolean(row.evidenceSufficient),
    stopReason: row.stopReason ?? null,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: iso(row.createdAt),
  })
}

async function writePilotAudit(repo: RepoForOrg, session: RouteSession, action: string, target: string, before?: unknown, after?: unknown) {
  if (!session.userId) return
  const user = await repo.raw.user.findUnique({ where: { id: session.userId }, select: { id: true } })
  if (!user) return
  await repo.raw.auditLog.create({
    data: {
      orgId: repo.orgId,
      actorUserId: session.userId,
      action,
      target,
      before: before as any,
      after: after as any,
    },
  })
}

async function getAgentSummary(repo: RepoForOrg, agentConfigId: string): Promise<AnyRecord> {
  await assertAgentInOrg(repo, agentConfigId)
  const agent = await repo.raw.agentConfig.findUnique({
    where: { id: agentConfigId },
    select: { id: true, name: true, version: true, isActive: true },
  }) as AnyRecord | null
  if (!agent) throw new NotFoundError('Agent config not found')
  return agent
}

async function getSessionById(repo: RepoForOrg, sessionId: string): Promise<AnyRecord> {
  const row = await repo.raw.pilotSession.findFirst({
    where: { orgId: repo.orgId, id: sessionId },
  }) as AnyRecord | null
  if (!row) throw new NotFoundError('Pilot session not found')
  return row
}

async function getBuildBriefById(repo: RepoForOrg, briefId: string): Promise<AnyRecord> {
  const row = await repo.raw.agentBuildBrief.findFirst({
    where: { orgId: repo.orgId, id: briefId },
  }) as AnyRecord | null
  if (!row) throw new NotFoundError('Agent build brief not found')
  return row
}

export async function getOrCreateCurrentPilotSession(repo: RepoForOrg, session: RouteSession, target: PilotSessionTarget): Promise<AnyRecord> {
  const normalized = normalizeSessionTarget(target)
  if (normalized.bindingScope === 'pre_build_family') {
    if (!normalized.agentFamilyKey) throw new ValidationError('agentFamilyKey is required for pre-build Pilot sessions')
    const existing = await repo.raw.pilotSession.findFirst({
      where: {
        orgId: repo.orgId,
        agentFamilyKey: normalized.agentFamilyKey,
        bindingScope: 'pre_build_family',
        isCurrent: true,
      },
      orderBy: { updatedAt: 'desc' },
    }) as AnyRecord | null
    if (existing) return existing

    const created = await repo.raw.pilotSession.create({
      data: {
        orgId: repo.orgId,
        agentConfigId: null,
        agentFamilyKey: normalized.agentFamilyKey,
        bindingScope: 'pre_build_family',
        createdByUserId: session.userId ?? 'unknown',
        activeEditorUserId: session.userId ?? null,
        status: 'in_progress',
        title: `${normalized.agentFamilyKey} Pilot brief`,
        currentMode: normalized.currentMode ?? 'build_from_brief',
        summary: {
          confirmedGoals: [],
          openQuestions: ['Confirm the first build brief before template recommendation.'],
          nextRecommendedStep: 'Capture the business goal, target channels, use cases, and escalation policy.',
        },
        memoryDegraded: false,
        isCurrent: true,
      },
    }) as AnyRecord
    await repo.raw.pilotMessage.create({
      data: {
        orgId: repo.orgId,
        sessionId: created.id,
        role: 'system',
        kind: 'message',
        content: `Pre-build Pilot session created for ${normalized.agentFamilyKey}.`,
        createdByUserId: session.userId ?? null,
        structuredPayload: { agentFamilyKey: normalized.agentFamilyKey, bindingScope: 'pre_build_family' },
      },
    })
    await writePilotAudit(repo, session, 'pilot.session.create_pre_build', `pilot_session:${created.id}`, undefined, { agentFamilyKey: normalized.agentFamilyKey })
    return created
  }

  if (!normalized.agentConfigId) throw new ValidationError('agentConfigId is required for draft-bound Pilot sessions')
  const agent = await getAgentSummary(repo, normalized.agentConfigId)
  const existing = await repo.raw.pilotSession.findFirst({
    where: { orgId: repo.orgId, agentConfigId: normalized.agentConfigId, isCurrent: true },
    orderBy: { updatedAt: 'desc' },
  }) as AnyRecord | null
  if (existing) return existing

  const created = await repo.raw.pilotSession.create({
    data: {
      orgId: repo.orgId,
      agentConfigId: normalized.agentConfigId,
      agentFamilyKey: agent.name,
      bindingScope: 'draft_agent',
      createdByUserId: session.userId ?? 'unknown',
      activeEditorUserId: session.userId ?? null,
      status: 'in_progress',
      title: `${agent.name} v${agent.version} Pilot`,
      currentMode: normalized.currentMode ?? 'critique_existing_agent',
      summary: {
        confirmedGoals: [],
        openQuestions: [],
        nextRecommendedStep: 'Inspect current draft and choose one delivery change.',
      },
      memoryDegraded: false,
      isCurrent: true,
    },
  }) as AnyRecord

  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: created.id,
      role: 'system',
      kind: 'message',
      content: `Pilot session created for ${agent.name} v${agent.version}.`,
      createdByUserId: session.userId ?? null,
      structuredPayload: { agentConfigId: normalized.agentConfigId, agentName: agent.name, version: agent.version },
    },
  })
  await writePilotAudit(repo, session, 'pilot.session.create', `pilot_session:${created.id}`, undefined, { agentConfigId: normalized.agentConfigId })
  return created
}

export async function getPilotSessionSnapshot(repo: RepoForOrg, session: RouteSession, target: PilotSessionTarget) {
  const permissions = pilotPermissions(session)
  if (!permissions.canRead) throw new NotFoundError('Pilot session not found')
  const current = await getOrCreateCurrentPilotSession(repo, session, target)
  const [messages, proposals, todoPlans, handoffs, buildBriefs, inspectionTraces, draftFingerprint] = await Promise.all([
    repo.raw.pilotMessage.findMany({ where: { orgId: repo.orgId, sessionId: current.id }, orderBy: { createdAt: 'asc' }, take: 120 }) as Promise<AnyRecord[]>,
    repo.raw.pilotProposal.findMany({ where: { orgId: repo.orgId, sessionId: current.id }, orderBy: { createdAt: 'desc' }, take: 30 }) as Promise<AnyRecord[]>,
    repo.raw.pilotTodoPlan.findMany({
      where: { orgId: repo.orgId, sessionId: current.id },
      orderBy: { createdAt: 'desc' },
      include: { items: { orderBy: { createdAt: 'asc' } } },
      take: 10,
    }) as Promise<AnyRecord[]>,
    repo.raw.pilotHandoff.findMany({ where: { orgId: repo.orgId, sessionId: current.id }, orderBy: { createdAt: 'desc' }, take: 10 }) as Promise<AnyRecord[]>,
    repo.raw.agentBuildBrief.findMany({ where: { orgId: repo.orgId, agentFamilyKey: current.agentFamilyKey }, orderBy: { createdAt: 'desc' }, take: 10 }) as Promise<AnyRecord[]>,
    repo.raw.pilotInspectionTrace.findMany({ where: { orgId: repo.orgId, sessionId: current.id }, orderBy: { createdAt: 'desc' }, take: 20 }) as Promise<AnyRecord[]>,
    current.agentConfigId ? buildPilotDraftFingerprint(repo, current.agentConfigId) : Promise.resolve(`pre_build_family:${current.agentFamilyKey ?? current.id}`),
  ])
  const briefIds = buildBriefs.map((brief) => brief.id)
  const [templateRecommendations, templateTailoringPlans, scratchBuildPlans] = briefIds.length > 0 ? await Promise.all([
    repo.raw.templateRecommendation.findMany({ where: { orgId: repo.orgId, briefId: { in: briefIds } }, orderBy: { createdAt: 'desc' }, take: 10 }) as Promise<AnyRecord[]>,
    repo.raw.templateTailoringPlan.findMany({ where: { orgId: repo.orgId, briefId: { in: briefIds } }, orderBy: { createdAt: 'desc' }, take: 10 }) as Promise<AnyRecord[]>,
    repo.raw.scratchBuildPlan.findMany({ where: { orgId: repo.orgId, briefId: { in: briefIds } }, orderBy: { createdAt: 'desc' }, take: 10 }) as Promise<AnyRecord[]>,
  ]) : [[], [], []] as AnyRecord[][]

  return pilotSessionSnapshotSchema.parse({
    session: serializeSession(current),
    permissions,
    draftFingerprint,
    messages: messages.map(serializeMessage),
    proposals: proposals.map(serializeProposal),
    todoPlans: todoPlans.map(serializeTodoPlan),
    handoffs: handoffs.map(serializeHandoff),
    buildBriefs: buildBriefs.map(serializeBuildBrief),
    templateRecommendations: templateRecommendations.map(serializeTemplateRecommendation),
    templateTailoringPlans: templateTailoringPlans.map(serializeTemplateTailoringPlan),
    scratchBuildPlans: scratchBuildPlans.map(serializeScratchBuildPlan),
    inspectionTraces: inspectionTraces.map(serializeInspectionTrace),
  })
}

export async function takeOverPilotSession(repo: RepoForOrg, session: RouteSession, input: PilotTakeoverSessionRequest) {
  const existing = await getSessionById(repo, input.sessionId)
  if (existing.status === 'archived') throw new ConflictError('Archived Pilot sessions cannot be taken over')
  const updated = await repo.raw.pilotSession.update({
    where: { id: input.sessionId },
    data: {
      activeEditorUserId: session.userId ?? null,
      status: 'in_progress',
    },
  }) as AnyRecord
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      role: 'system',
      kind: 'takeover',
      content: input.reason ? `Pilot session taken over: ${input.reason}` : 'Pilot session taken over.',
      createdByUserId: session.userId ?? null,
      structuredPayload: { activeEditorUserId: session.userId ?? null },
    },
  })
  await writePilotAudit(repo, session, 'pilot.session.takeover', `pilot_session:${input.sessionId}`, { activeEditorUserId: existing.activeEditorUserId }, { activeEditorUserId: session.userId ?? null, reason: input.reason })
  return serializeSession(updated)
}

export async function archivePilotSession(repo: RepoForOrg, session: RouteSession, input: PilotArchiveSessionRequest) {
  const existing = await getSessionById(repo, input.sessionId)
  if (existing.status === 'archived') return serializeSession(existing)
  const updated = await repo.raw.pilotSession.update({
    where: { id: input.sessionId },
    data: {
      status: 'archived',
      isCurrent: false,
      archivedAt: new Date(),
    },
  }) as AnyRecord
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      role: 'system',
      kind: 'archive',
      content: input.reason ? `Pilot session archived: ${input.reason}` : 'Pilot session archived.',
      createdByUserId: session.userId ?? null,
      structuredPayload: { reason: input.reason ?? null },
    },
  })
  await writePilotAudit(repo, session, 'pilot.session.archive', `pilot_session:${input.sessionId}`, { status: existing.status, isCurrent: existing.isCurrent }, { status: 'archived', isCurrent: false, reason: input.reason })
  return serializeSession(updated)
}

export async function manualCompactPilotSession(repo: RepoForOrg, session: RouteSession, input: PilotManualCompactRequest) {
  const existing = await getSessionById(repo, input.sessionId)
  if (existing.status === 'archived') throw new ConflictError('Archived Pilot sessions cannot be compacted')
  const [latestProposal, currentBrief, currentPlan] = await Promise.all([
    repo.raw.pilotProposal.findFirst({ where: { orgId: repo.orgId, sessionId: input.sessionId }, orderBy: { createdAt: 'desc' } }) as Promise<AnyRecord | null>,
    repo.raw.agentBuildBrief.findFirst({ where: { orgId: repo.orgId, id: existing.currentBuildBriefId ?? '' } }) as Promise<AnyRecord | null>,
    repo.raw.pilotTodoPlan.findFirst({
      where: { orgId: repo.orgId, id: existing.currentTodoPlanId ?? '' },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    }) as Promise<AnyRecord | null>,
  ])
  const priorSummary = jsonRecord(existing.summary)
  const summary = pilotSessionSummarySchema.parse({
    confirmedGoals: currentBrief?.businessGoal ? [currentBrief.businessGoal] : stringArray(priorSummary?.confirmedGoals),
    openQuestions: currentBrief ? stringArray(currentBrief.openQuestions) : stringArray(priorSummary?.openQuestions),
    currentPlanSummary: currentPlan ? `${currentPlan.title ?? 'Current plan'}: ${(currentPlan.items ?? []).length} items` : priorSummary?.currentPlanSummary,
    latestProposalSummary: latestProposal?.summary ?? priorSummary?.latestProposalSummary,
    latestValidationSummary: priorSummary?.latestValidationSummary,
    nextRecommendedStep: currentPlan ? 'Continue the current visible TodoPlan item by item.' : 'Choose the next explicit Pilot action.',
  })
  const updated = await repo.raw.pilotSession.update({
    where: { id: input.sessionId },
    data: {
      summary,
      memoryDegraded: false,
      compactedAt: new Date(),
    },
  }) as AnyRecord
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      role: 'system',
      kind: 'compact',
      content: 'Pilot session memory compacted from durable artifacts and timeline state.',
      createdByUserId: session.userId ?? null,
      structuredPayload: { summary },
    },
  })
  await writePilotAudit(repo, session, 'pilot.session.manual_compact', `pilot_session:${input.sessionId}`, { memoryDegraded: existing.memoryDegraded }, { memoryDegraded: false })
  return serializeSession(updated)
}

export async function upsertAgentBuildBrief(repo: RepoForOrg, session: RouteSession, input: PilotBuildBriefUpsertRequest) {
  const pilotSession = input.sessionId
    ? await getSessionById(repo, input.sessionId)
    : await getOrCreateCurrentPilotSession(repo, session, { agentFamilyKey: input.agentFamilyKey, bindingScope: 'pre_build_family', currentMode: 'build_from_brief' })
  if (pilotSession.agentFamilyKey && pilotSession.agentFamilyKey !== input.agentFamilyKey) {
    throw new ConflictError('Build brief agent family does not match the Pilot session')
  }
  const existing = await repo.raw.agentBuildBrief.findFirst({
    where: { orgId: repo.orgId, agentFamilyKey: input.agentFamilyKey, isCurrent: true },
    orderBy: { revision: 'desc' },
  }) as AnyRecord | null
  if (existing) {
    await repo.raw.agentBuildBrief.update({
      where: { id: existing.id },
      data: {
        status: 'superseded',
        isCurrent: false,
        supersededAt: new Date(),
      },
    })
  }
  const created = await repo.raw.agentBuildBrief.create({
    data: {
      orgId: repo.orgId,
      agentFamilyKey: input.agentFamilyKey,
      sessionId: pilotSession.id,
      revision: (existing?.revision ?? 0) + 1,
      status: 'draft',
      businessGoal: input.businessGoal ?? null,
      targetChannels: input.targetChannels as any,
      supportedUseCases: input.supportedUseCases as any,
      outOfScopeUseCases: input.outOfScopeUseCases as any,
      escalationPolicy: input.escalationPolicy ?? null,
      requiredToolsAndIntegrations: input.requiredToolsAndIntegrations as any,
      toneAndResponseConstraints: input.toneAndResponseConstraints as any,
      validationExpectations: input.validationExpectations as any,
      openQuestions: input.openQuestions as any,
      isCurrent: true,
      createdByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  if (existing) {
    await repo.raw.agentBuildBrief.update({
      where: { id: existing.id },
      data: { supersededById: created.id },
    })
  }
  await repo.raw.pilotSession.update({
    where: { id: pilotSession.id },
    data: {
      currentBuildBriefId: created.id,
      currentMode: 'build_from_brief',
      status: 'in_progress',
      summary: pilotSessionSummarySchema.parse({
        confirmedGoals: input.businessGoal ? [input.businessGoal] : [],
        openQuestions: input.openQuestions,
        nextRecommendedStep: 'Confirm the brief when the build basis is recommendation-safe.',
      }),
    },
  })
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: pilotSession.id,
      role: 'pilot',
      kind: 'brief',
      content: `Build brief revision ${created.revision} saved for ${input.agentFamilyKey}.`,
      createdByUserId: session.userId ?? null,
      structuredPayload: { briefId: created.id, revision: created.revision },
    },
  })
  await writePilotAudit(repo, session, 'pilot.build_brief.upsert', `agent_build_brief:${created.id}`, existing ? { priorBriefId: existing.id } : undefined, { agentFamilyKey: input.agentFamilyKey, revision: created.revision })
  return serializeBuildBrief(created)
}

export async function confirmAgentBuildBrief(repo: RepoForOrg, session: RouteSession, input: PilotConfirmBriefRequest) {
  const brief = await getBuildBriefById(repo, input.briefId)
  if (!brief.isCurrent) throw new ConflictError('Only the current build brief can be confirmed')
  const criticalFields = [
    brief.businessGoal,
    stringArray(brief.targetChannels).length > 0,
    stringArray(brief.supportedUseCases).length > 0,
    stringArray(brief.outOfScopeUseCases).length > 0,
    brief.escalationPolicy,
  ]
  if (criticalFields.some((field) => !field)) {
    throw new ValidationError('Build brief is not recommendation-safe yet')
  }
  const updated = await repo.raw.agentBuildBrief.update({
    where: { id: input.briefId },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
      confirmedByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  if (brief.sessionId) {
    await repo.raw.pilotSession.update({
      where: { id: brief.sessionId },
      data: {
        currentBuildBriefId: input.briefId,
        currentMode: 'template_tailoring',
      },
    })
    await repo.raw.pilotMessage.create({
      data: {
        orgId: repo.orgId,
        sessionId: brief.sessionId,
        role: 'system',
        kind: 'brief',
        content: 'Build brief confirmed. Template recommendation is now allowed.',
        createdByUserId: session.userId ?? null,
        structuredPayload: { briefId: input.briefId },
      },
    })
  }
  await writePilotAudit(repo, session, 'pilot.build_brief.confirm', `agent_build_brief:${input.briefId}`, { status: brief.status }, { status: 'confirmed' })
  return serializeBuildBrief(updated)
}

export async function createTemplateRecommendation(repo: RepoForOrg, session: RouteSession, input: PilotCreateTemplateRecommendationRequest) {
  const brief = await getBuildBriefById(repo, input.briefId)
  if (brief.status !== 'confirmed') throw new ConflictError('Template recommendation requires a confirmed build brief')
  const existing = await repo.raw.templateRecommendation.findFirst({
    where: { orgId: repo.orgId, briefId: input.briefId, isCurrent: true },
    orderBy: { createdAt: 'desc' },
  }) as AnyRecord | null
  if (existing) {
    await repo.raw.templateRecommendation.update({
      where: { id: existing.id },
      data: { isCurrent: false, supersededAt: new Date() },
    })
  }
  const created = await repo.raw.templateRecommendation.create({
    data: {
      orgId: repo.orgId,
      briefId: input.briefId,
      candidateTemplates: input.candidateTemplates as any,
      recommendedTemplateId: input.recommendedTemplateId ?? null,
      fitSummary: input.fitSummary,
      mismatchSummary: input.mismatchSummary ?? null,
      whyNotScratch: input.whyNotScratch ?? null,
      whyScratch: input.whyScratch ?? null,
      isCurrent: true,
      createdByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  if (existing) {
    await repo.raw.templateRecommendation.update({ where: { id: existing.id }, data: { supersededById: created.id } })
  }
  if (brief.sessionId) {
    await repo.raw.pilotMessage.create({
      data: {
        orgId: repo.orgId,
        sessionId: brief.sessionId,
        role: 'pilot',
        kind: 'recommendation',
        content: input.fitSummary,
        createdByUserId: session.userId ?? null,
        structuredPayload: { recommendationId: created.id, recommendedTemplateId: input.recommendedTemplateId ?? null },
      },
    })
  }
  await writePilotAudit(repo, session, 'pilot.template_recommendation.create', `template_recommendation:${created.id}`, existing ? { priorRecommendationId: existing.id } : undefined, { briefId: input.briefId, recommendedTemplateId: input.recommendedTemplateId ?? null })
  return serializeTemplateRecommendation(created)
}

export async function createTemplateTailoringPlan(repo: RepoForOrg, session: RouteSession, input: PilotCreateTemplateTailoringPlanRequest) {
  const brief = await getBuildBriefById(repo, input.briefId)
  const existing = await repo.raw.templateTailoringPlan.findFirst({
    where: { orgId: repo.orgId, briefId: input.briefId, selectedTemplateId: input.selectedTemplateId, isCurrent: true },
    orderBy: { createdAt: 'desc' },
  }) as AnyRecord | null
  if (existing) {
    await repo.raw.templateTailoringPlan.update({
      where: { id: existing.id },
      data: { isCurrent: false, supersededAt: new Date() },
    })
  }
  const created = await repo.raw.templateTailoringPlan.create({
    data: {
      orgId: repo.orgId,
      briefId: input.briefId,
      recommendationId: input.recommendationId ?? null,
      selectedTemplateId: input.selectedTemplateId,
      fitAreas: input.fitAreas as any,
      mismatchAreas: input.mismatchAreas as any,
      requiredTailoringGroups: input.requiredTailoringGroups as any,
      recommendedTailoringGroups: input.recommendedTailoringGroups as any,
      firstValidationTargets: input.firstValidationTargets as any,
      isCurrent: true,
      createdByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  if (existing) {
    await repo.raw.templateTailoringPlan.update({ where: { id: existing.id }, data: { supersededById: created.id } })
  }
  if (brief.sessionId) {
    await repo.raw.pilotMessage.create({
      data: {
        orgId: repo.orgId,
        sessionId: brief.sessionId,
        role: 'pilot',
        kind: 'plan',
        content: `Template tailoring plan created for ${input.selectedTemplateId}.`,
        createdByUserId: session.userId ?? null,
        structuredPayload: { tailoringPlanId: created.id, selectedTemplateId: input.selectedTemplateId },
      },
    })
  }
  await writePilotAudit(repo, session, 'pilot.template_tailoring_plan.create', `template_tailoring_plan:${created.id}`, existing ? { priorPlanId: existing.id } : undefined, { briefId: input.briefId, selectedTemplateId: input.selectedTemplateId })
  return serializeTemplateTailoringPlan(created)
}

export async function createScratchBuildPlan(repo: RepoForOrg, session: RouteSession, input: PilotCreateScratchBuildPlanRequest) {
  const brief = await getBuildBriefById(repo, input.briefId)
  const existing = await repo.raw.scratchBuildPlan.findFirst({
    where: { orgId: repo.orgId, briefId: input.briefId, scratchScope: input.scratchScope, isCurrent: true },
    orderBy: { createdAt: 'desc' },
  }) as AnyRecord | null
  if (existing) {
    await repo.raw.scratchBuildPlan.update({
      where: { id: existing.id },
      data: { isCurrent: false, supersededAt: new Date() },
    })
  }
  const created = await repo.raw.scratchBuildPlan.create({
    data: {
      orgId: repo.orgId,
      briefId: input.briefId,
      scratchScope: input.scratchScope,
      proposedFoundationSurfaces: input.proposedFoundationSurfaces as any,
      requiredBuildGroups: input.requiredBuildGroups as any,
      recommendedBuildGroups: input.recommendedBuildGroups as any,
      initialToolingPlan: input.initialToolingPlan as any,
      initialValidationTargets: input.initialValidationTargets as any,
      isCurrent: true,
      createdByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  if (existing) {
    await repo.raw.scratchBuildPlan.update({ where: { id: existing.id }, data: { supersededById: created.id } })
  }
  if (brief.sessionId) {
    await repo.raw.pilotMessage.create({
      data: {
        orgId: repo.orgId,
        sessionId: brief.sessionId,
        role: 'pilot',
        kind: 'plan',
        content: `Scratch build plan created for scope ${input.scratchScope}.`,
        createdByUserId: session.userId ?? null,
        structuredPayload: { scratchBuildPlanId: created.id, scratchScope: input.scratchScope },
      },
    })
  }
  await writePilotAudit(repo, session, 'pilot.scratch_build_plan.create', `scratch_build_plan:${created.id}`, existing ? { priorPlanId: existing.id } : undefined, { briefId: input.briefId, scratchScope: input.scratchScope })
  return serializeScratchBuildPlan(created)
}

function todoItemsFromGroups(groups: Array<ReturnType<typeof pilotPlanningGroupSchema.parse>>, sessionId: string, planId: string) {
  return groups.map((group, index) => ({
    orgId: undefined,
    sessionId,
    planId,
    type: 'config_change',
    status: index === 0 ? 'active' : 'pending',
    title: group.title,
    description: group.description ?? null,
    isRequired: group.isRequired,
    visibleReason: group.expectedEffect ?? group.targetSurface ?? null,
    targetScenarioName: group.firstValidationTargets[0] ?? null,
    metadata: {
      groupKey: group.groupKey,
      targetSurface: group.targetSurface ?? null,
      firstValidationTargets: group.firstValidationTargets,
    },
  }))
}

export async function promotePlanningGroupsToTodoPlan(repo: RepoForOrg, session: RouteSession, input: PilotPromotePlanningGroupsRequest) {
  const pilotSession = await getSessionById(repo, input.sessionId)
  if (pilotSession.status === 'archived') throw new ConflictError('Archived Pilot sessions cannot receive new TodoPlans')
  const source = input.sourceType === 'template_tailoring_plan'
    ? await repo.raw.templateTailoringPlan.findFirst({ where: { orgId: repo.orgId, id: input.sourceId } }) as AnyRecord | null
    : await repo.raw.scratchBuildPlan.findFirst({ where: { orgId: repo.orgId, id: input.sourceId } }) as AnyRecord | null
  if (!source) throw new NotFoundError('Planning source artifact not found')
  const requiredGroups = input.sourceType === 'template_tailoring_plan'
    ? planningGroups(source.requiredTailoringGroups)
    : planningGroups(source.requiredBuildGroups)
  const recommendedGroups = input.sourceType === 'template_tailoring_plan'
    ? planningGroups(source.recommendedTailoringGroups)
    : planningGroups(source.recommendedBuildGroups)
  const promotedRecommended = new Set(input.groupKeys)
  const groups = [
    ...requiredGroups.map((group) => ({ ...group, isRequired: true })),
    ...recommendedGroups.filter((group) => promotedRecommended.has(group.groupKey)).map((group) => ({ ...group, isRequired: false })),
  ]
  if (groups.length === 0) throw new ValidationError('No planning groups were eligible for promotion')
  await repo.raw.pilotTodoPlan.updateMany({
    where: { orgId: repo.orgId, sessionId: input.sessionId, isCurrent: true },
    data: { isCurrent: false },
  })
  const plan = await repo.raw.pilotTodoPlan.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      title: input.sourceType === 'template_tailoring_plan' ? 'Template tailoring build plan' : 'Scratch build plan',
      isCurrent: true,
      createdByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  const itemInputs = todoItemsFromGroups(groups, input.sessionId, plan.id)
  const createdItems: AnyRecord[] = []
  for (const item of itemInputs) {
    const created = await repo.raw.pilotTodoItem.create({
      data: { ...item, orgId: repo.orgId },
    }) as AnyRecord
    createdItems.push(created)
  }
  await repo.raw.pilotSession.update({
    where: { id: input.sessionId },
    data: {
      currentTodoPlanId: plan.id,
      currentActiveTodoItemId: createdItems[0]?.id ?? null,
      currentMode: input.sourceType === 'template_tailoring_plan' ? 'template_tailoring' : 'build_from_brief',
    },
  })
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      role: 'pilot',
      kind: 'plan',
      content: `Promoted ${createdItems.length} planning ${createdItems.length === 1 ? 'group' : 'groups'} into the current TodoPlan.`,
      createdByUserId: session.userId ?? null,
      structuredPayload: { planId: plan.id, itemIds: createdItems.map((item) => item.id), sourceType: input.sourceType, sourceId: input.sourceId },
    },
  })
  await writePilotAudit(repo, session, 'pilot.todo_plan.promote', `pilot_todo_plan:${plan.id}`, undefined, { sourceType: input.sourceType, sourceId: input.sourceId, itemCount: createdItems.length })
  return serializeTodoPlan({ ...plan, items: createdItems })
}

export async function recordPilotInspectionTrace(repo: RepoForOrg, session: RouteSession, input: PilotRecordInspectionTraceRequest) {
  await getSessionById(repo, input.sessionId)
  const trace = await repo.raw.pilotInspectionTrace.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      actionClass: input.actionClass,
      targetObjectRef: input.targetObjectRef as any,
      steps: input.steps as any,
      evidenceSufficient: input.evidenceSufficient,
      stopReason: input.stopReason ?? null,
      createdByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      role: 'system',
      kind: 'trace',
      content: `Inspection trace recorded for ${input.actionClass}.`,
      createdByUserId: session.userId ?? null,
      structuredPayload: { traceId: trace.id, evidenceSufficient: input.evidenceSufficient, stopReason: input.stopReason ?? null },
    },
  })
  return serializeInspectionTrace(trace)
}

function buildValidationTriage(receipt: ScenarioReceipt, validation: ScenarioValidationSummary) {
  const runtimeBacked = receipt.executionMode === 'agentRuntime'
  const releaseReadinessEffect = receipt.status === 'blocked'
    ? 'runtime_blocked'
    : receipt.status !== 'pass'
      ? 'failed_blocks_release'
      : runtimeBacked && validation.runtimeValidated
        ? 'restores_runtime_validation'
        : 'debug_only_fixture'
  const modeLabel = runtimeBacked ? 'Runtime-backed' : 'Fixture-only'
  const statusPhrase = `${modeLabel} Scenario ${receipt.scenarioName} finished with ${receipt.status}.`
  const summary = receipt.summary ? `${statusPhrase} ${receipt.summary}` : statusPhrase
  const nextRecommendedStep = releaseReadinessEffect === 'restores_runtime_validation'
    ? 'Use this runtime-backed receipt in the release handoff after closing any remaining required Pilot todos.'
    : releaseReadinessEffect === 'debug_only_fixture'
      ? 'Treat this as debugging evidence only; run the same named Scenario in runtime-backed mode before release review.'
      : releaseReadinessEffect === 'runtime_blocked'
        ? 'Resolve the runtime blocker, then rerun the same named Scenario before claiming validation.'
        : 'Inspect the failed receipt, draft the smallest config change, and rerun the same named Scenario.'

  return pilotValidationTriageSchema.parse({
    scenarioName: receipt.scenarioName,
    receiptRunId: receipt.runId,
    status: receipt.status,
    executionMode: receipt.executionMode,
    validationState: validation.state,
    runtimeBacked,
    releaseReadinessEffect,
    summary,
    nextRecommendedStep,
    failureReasons: receipt.failureReasons.map((reason) => reason.message),
  })
}

export async function runPilotScenarioValidation(repo: RepoForOrg, session: RouteSession, input: PilotRunScenarioRequest) {
  const pilotSession = await getSessionById(repo, input.sessionId)
  if (pilotSession.status === 'archived') throw new ConflictError('Archived Pilot sessions cannot run validation')
  if (pilotSession.agentConfigId && pilotSession.agentConfigId !== input.agentConfigId) {
    throw new ConflictError('Pilot session is bound to a different draft Agent')
  }
  await assertAgentInOrg(repo, input.agentConfigId)

  const scenario = await getScenario(input.agentConfigId, input.scenarioName)
  if (!scenario) throw new NotFoundError(`Scenario "${input.scenarioName}" not found`)

  const receipt = input.executionMode === 'agentRuntime'
    ? await runScenarioAgentRuntime(scenario, {
      orgId: session.orgId,
      agentConfigId: input.agentConfigId,
      userId: session.userId,
    })
    : runScenarioHarness(scenario, input.observed)
  const savedReceipt = await appendScenarioReceipt(input.agentConfigId, receipt, { scenarioSnapshot: scenario })
  const validation = scenarioValidationSummarySchema.parse(await getScenarioValidationSummary(input.agentConfigId))
  const triage = buildValidationTriage(savedReceipt, validation)

  let todoItem: AnyRecord | null = null
  if (input.todoItemId) {
    todoItem = await repo.raw.pilotTodoItem.findFirst({
      where: { orgId: repo.orgId, sessionId: input.sessionId, id: input.todoItemId },
    }) as AnyRecord | null
    if (!todoItem) throw new NotFoundError('Pilot Todo item not found')
  } else {
    todoItem = await repo.raw.pilotTodoItem.findFirst({
      where: {
        orgId: repo.orgId,
        sessionId: input.sessionId,
        targetScenarioName: input.scenarioName,
        status: { in: ['active', 'pending', 'blocked'] },
      },
      orderBy: { createdAt: 'asc' },
    }) as AnyRecord | null
  }

  let updatedTodoItem: AnyRecord | null = null
  if (todoItem) {
    const nextStatus = triage.releaseReadinessEffect === 'restores_runtime_validation'
      ? 'completed'
      : triage.releaseReadinessEffect === 'failed_blocks_release' || triage.releaseReadinessEffect === 'runtime_blocked'
        ? 'blocked'
        : 'active'
    updatedTodoItem = await repo.raw.pilotTodoItem.update({
      where: { id: todoItem.id },
      data: {
        latestReceiptRunId: savedReceipt.runId,
        status: nextStatus,
        metadata: {
          ...(jsonRecord(todoItem.metadata) ?? {}),
          latestValidationTriage: triage,
        },
      },
    }) as AnyRecord
  }

  let currentActiveTodoItemId = pilotSession.currentActiveTodoItemId
  if (updatedTodoItem) {
    if (updatedTodoItem.status === 'completed') {
      const nextItem = await repo.raw.pilotTodoItem.findFirst({
        where: {
          orgId: repo.orgId,
          sessionId: input.sessionId,
          status: { in: ['active', 'pending'] },
        },
        orderBy: { createdAt: 'asc' },
      }) as AnyRecord | null
      currentActiveTodoItemId = nextItem?.id ?? null
    } else {
      currentActiveTodoItemId = updatedTodoItem.id
    }
  }

  const priorSummary = pilotSessionSummarySchema.parse(jsonRecord(pilotSession.summary) ?? {})
  await repo.raw.pilotSession.update({
    where: { id: input.sessionId },
    data: {
      latestReceiptRunId: savedReceipt.runId,
      currentMode: 'validation_triage',
      currentActiveTodoItemId,
      summary: pilotSessionSummarySchema.parse({
        ...priorSummary,
        latestValidationSummary: triage.summary,
        nextRecommendedStep: triage.nextRecommendedStep,
      }),
    },
  })
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      role: 'pilot',
      kind: 'receipt',
      content: `${triage.summary} ${triage.nextRecommendedStep}`,
      createdByUserId: session.userId ?? null,
      structuredPayload: {
        receiptRunId: savedReceipt.runId,
        scenarioName: savedReceipt.scenarioName,
        status: savedReceipt.status,
        executionMode: savedReceipt.executionMode,
        validationState: validation.state,
        releaseReadinessEffect: triage.releaseReadinessEffect,
        todoItemId: updatedTodoItem?.id ?? null,
      },
    },
  })
  const trace = await repo.raw.pilotInspectionTrace.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      actionClass: 'validation_summary',
      targetObjectRef: { type: 'receipt', id: savedReceipt.runId, label: savedReceipt.scenarioName },
      steps: [
        {
          toolFamily: 'run_named_scenario',
          target: savedReceipt.scenarioName,
          visibility: 'full',
          summary: `${savedReceipt.executionMode} run returned ${savedReceipt.status}.`,
          evidenceSufficientAfterStep: triage.releaseReadinessEffect === 'restores_runtime_validation',
        },
        {
          toolFamily: 'inspect_validation_artifact',
          target: savedReceipt.runId,
          visibility: 'metadata_only',
          summary: triage.summary,
          evidenceSufficientAfterStep: triage.releaseReadinessEffect === 'restores_runtime_validation',
        },
      ],
      evidenceSufficient: triage.releaseReadinessEffect === 'restores_runtime_validation',
      stopReason: triage.nextRecommendedStep,
      createdByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  await writePilotAudit(repo, session, 'pilot.validation.run_scenario', `scenario:${input.scenarioName}`, undefined, {
    sessionId: input.sessionId,
    agentConfigId: input.agentConfigId,
    receiptRunId: savedReceipt.runId,
    status: savedReceipt.status,
    executionMode: savedReceipt.executionMode,
    releaseReadinessEffect: triage.releaseReadinessEffect,
  })

  return pilotRunScenarioResponseSchema.parse({
    receipt: savedReceipt,
    validation,
    triage,
    todoItem: updatedTodoItem ? serializeTodoItem(updatedTodoItem) : null,
    inspectionTrace: serializeInspectionTrace(trace),
  })
}

export async function persistConfigPilotProposal(
  repo: RepoForOrg,
  session: RouteSession,
  input: { agentConfigId: string; request: string },
  proposal: ConfigPilotProposal,
  baseDraftFingerprint: string,
) {
  const current = await getOrCreateCurrentPilotSession(repo, session, input.agentConfigId)
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: current.id,
      role: 'user',
      kind: 'message',
      content: input.request,
      createdByUserId: session.userId ?? null,
    },
  })
  const validationPlan = pilotValidationPlanSchema.parse({
    requiredScenarios: proposal.receiptSuggestions ?? [],
    recommendedScenarios: proposal.runSuggestions ?? [],
    manualPlaygroundChecks: [],
    releaseBlockingCondition: 'Runtime-backed Scenario receipt must pass after apply.',
  })
  const record = await repo.raw.pilotProposal.create({
    data: {
      orgId: repo.orgId,
      sessionId: current.id,
      status: 'drafted',
      primarySurface: proposal.targetSurface,
      title: proposal.title,
      summary: proposal.summary,
      intentSummary: proposal.summary,
      batchRationale: proposal.rationale ?? null,
      blastRadius: proposal.patches.length > 1 ? `${proposal.patches.length} typed patches` : 'Single typed patch',
      validationPlan: validationPlan as any,
      proposal: proposal as any,
      diffGroups: (proposal.diffGroups ?? []) as any,
      patchCount: proposal.patches.length,
      baseAgentConfigId: input.agentConfigId,
      baseDraftFingerprint,
      createdByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  await repo.raw.pilotSession.update({
    where: { id: current.id },
    data: {
      latestProposalId: record.id,
      status: 'in_progress',
      latestHandoffId: null,
    },
  })
  await repo.raw.pilotHandoff.updateMany({
    where: { orgId: repo.orgId, sessionId: current.id, isCurrent: true },
    data: { isCurrent: false },
  })
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: current.id,
      role: 'pilot',
      kind: 'proposal',
      content: proposal.summary,
      createdByUserId: session.userId ?? null,
      structuredPayload: { proposalId: record.id, targetSurface: proposal.targetSurface, patchCount: proposal.patches.length } as any,
    },
  })
  await writePilotAudit(repo, session, 'pilot.proposal.create', `pilot_proposal:${record.id}`, undefined, { agentConfigId: input.agentConfigId, patchCount: proposal.patches.length })
  return serializeProposal(record)
}

export async function recordAgentOpsProposalMetadata(
  repo: RepoForOrg,
  session: RouteSession,
  input: {
    sessionId: string
    proposalId: string
    agentConfigId: string
    schemaVersion: string
    externalAgent: Record<string, unknown>
    evidenceRefs: string[]
    reason: string
  },
) {
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      role: 'system',
      kind: 'trace',
      content: 'AgentOps proposal intake metadata recorded.',
      createdByUserId: session.userId ?? null,
      structuredPayload: {
        source: input.schemaVersion,
        proposalId: input.proposalId,
        agentConfigId: input.agentConfigId,
        externalAgent: input.externalAgent,
        evidenceRefs: input.evidenceRefs,
        reason: input.reason,
      } as any,
    },
  })
  await writePilotAudit(repo, session, 'agentops.proposal.create', `pilot_proposal:${input.proposalId}`, undefined, {
    agentConfigId: input.agentConfigId,
    source: input.schemaVersion,
    externalAgent: input.externalAgent,
    evidenceRefs: input.evidenceRefs,
    reason: input.reason,
  })
}

export async function acceptPilotProposal(repo: RepoForOrg, session: RouteSession, proposalId: string, reason?: string) {
  const existing = await repo.raw.pilotProposal.findFirst({
    where: { id: proposalId, orgId: repo.orgId },
  }) as AnyRecord | null
  if (!existing) throw new NotFoundError('Pilot proposal not found')
  if (existing.status === 'applied') throw new ConflictError('Pilot proposal has already been applied')
  if (existing.status !== 'drafted' && existing.status !== 'accepted') {
    throw new ConflictError(`Pilot proposal cannot be accepted from status "${existing.status}"`)
  }
  const updated = await repo.raw.pilotProposal.update({
    where: { id: proposalId },
    data: {
      status: 'accepted',
      acceptedByUserId: session.userId ?? null,
      acceptedAt: new Date(),
    },
  }) as AnyRecord
  await repo.raw.pilotSession.update({
    where: { id: existing.sessionId },
    data: { latestProposalId: proposalId },
  })
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: existing.sessionId,
      role: 'system',
      kind: 'accept',
      content: reason ? `Proposal accepted: ${reason}` : 'Proposal accepted.',
      createdByUserId: session.userId ?? null,
      structuredPayload: { proposalId },
    },
  })
  await writePilotAudit(repo, session, 'pilot.proposal.accept', `pilot_proposal:${proposalId}`, { status: existing.status }, { status: 'accepted', reason })
  return serializeProposal(updated)
}

export async function applyAcceptedPilotProposal(repo: RepoForOrg, session: RouteSession, audit: AuditWriter, proposalId: string) {
  const existing = await repo.raw.pilotProposal.findFirst({
    where: { id: proposalId, orgId: repo.orgId },
  }) as AnyRecord | null
  if (!existing) throw new NotFoundError('Pilot proposal not found')
  if (existing.status === 'applied') {
    return { proposal: serializeProposal(existing), apply: null, alreadyApplied: true }
  }
  if (existing.status !== 'accepted') {
    throw new ConflictError('Pilot proposal must be accepted before apply')
  }
  const currentFingerprint = await buildPilotDraftFingerprint(repo, existing.baseAgentConfigId)
  if (currentFingerprint !== existing.baseDraftFingerprint) {
    await repo.raw.pilotProposal.update({ where: { id: proposalId }, data: { status: 'stale' } })
    throw new ConflictError('Draft changed after this Pilot proposal was created. Review or revise before applying.')
  }

  const proposal = configPilotProposalSchema.parse(existing.proposal)
  const apply = await applyConfigPilotProposal({
    agentConfigId: existing.baseAgentConfigId,
    accepted: true,
    proposal,
  }, repo, audit)

  const updated = await repo.raw.pilotProposal.update({
    where: { id: proposalId },
    data: {
      status: 'applied',
      appliedByUserId: session.userId ?? null,
      appliedAt: new Date(),
      appliedDraftAgentConfigId: apply.draftAgentConfigId,
    },
  }) as AnyRecord
  await repo.raw.pilotSession.update({
    where: { id: existing.sessionId },
    data: {
      agentConfigId: apply.draftAgentConfigId,
      bindingScope: 'draft_agent',
      latestProposalId: proposalId,
      latestHandoffId: null,
      status: 'in_progress',
    },
  })
  await repo.raw.pilotHandoff.updateMany({
    where: { orgId: repo.orgId, sessionId: existing.sessionId, isCurrent: true },
    data: { isCurrent: false },
  })
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: existing.sessionId,
      role: 'system',
      kind: 'apply',
      content: `Applied ${apply.appliedPatches.length} draft ${apply.appliedPatches.length === 1 ? 'change' : 'changes'} and rebound the Pilot session to draft ${apply.draftAgentConfigId}. Validation is stale until a fresh runtime-backed receipt passes.`,
      createdByUserId: session.userId ?? null,
      structuredPayload: { proposalId, draftAgentConfigId: apply.draftAgentConfigId, validation: apply.validation, rebind: 'draft_agent' },
    },
  })
  await writePilotAudit(repo, session, 'pilot.proposal.apply', `pilot_proposal:${proposalId}`, { status: existing.status }, { status: 'applied', draftAgentConfigId: apply.draftAgentConfigId })
  return { proposal: serializeProposal(updated), apply, alreadyApplied: false }
}

export async function generatePilotHandoff(repo: RepoForOrg, session: RouteSession, input: PilotGenerateHandoffRequest) {
  const pilotSession = await repo.raw.pilotSession.findFirst({
    where: { id: input.sessionId, orgId: repo.orgId, isCurrent: true },
  }) as AnyRecord | null
  if (!pilotSession) throw new NotFoundError('Pilot session not found')
  await assertAgentInOrg(repo, input.draftAgentConfigId)
  const blockingItems = await repo.raw.pilotTodoItem.findMany({
    where: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      isRequired: true,
      status: { in: ['pending', 'active', 'blocked'] },
    },
  }) as AnyRecord[]
  const blockers = [
    ...input.blockers,
    ...blockingItems.map((item) => ({
      code: 'required_todo_incomplete',
      message: `Required Pilot item is still ${item.status}: ${item.title}`,
      linkedObjectRef: { type: 'todo_item' as const, id: item.id, label: item.title },
    })),
  ]
  const readinessVerdict = blockers.length > 0 ? 'not_ready' : input.readinessVerdict
  const draftFingerprint = await buildPilotDraftFingerprint(repo, input.draftAgentConfigId)
  await repo.raw.pilotHandoff.updateMany({
    where: { orgId: repo.orgId, sessionId: input.sessionId, isCurrent: true },
    data: { isCurrent: false },
  })
  const handoff = await repo.raw.pilotHandoff.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      draftAgentConfigId: input.draftAgentConfigId,
      draftFingerprint,
      handoffSummary: input.handoffSummary,
      readinessVerdict,
      blockers,
      risks: input.risks,
      referencedProposalIds: input.referencedProposalIds,
      referencedReceiptIds: input.referencedReceiptIds,
      coveredTodoItemIds: input.coveredTodoItemIds,
      createdByUserId: session.userId ?? null,
    },
  }) as AnyRecord
  await repo.raw.pilotSession.update({
    where: { id: input.sessionId },
    data: {
      latestHandoffId: handoff.id,
      status: readinessVerdict === 'ready_for_release_review' ? 'handoff_ready' : 'in_progress',
    },
  })
  await repo.raw.pilotMessage.create({
    data: {
      orgId: repo.orgId,
      sessionId: input.sessionId,
      role: 'pilot',
      kind: 'handoff',
      content: input.handoffSummary,
      createdByUserId: session.userId ?? null,
      structuredPayload: { handoffId: handoff.id, readinessVerdict, blockers },
    },
  })
  await writePilotAudit(repo, session, 'pilot.handoff.create', `pilot_handoff:${handoff.id}`, undefined, { readinessVerdict, blockerCount: blockers.length })
  return serializeHandoff(handoff)
}

export async function generatePilotReleaseHandoffFromState(repo: RepoForOrg, session: RouteSession, input: PilotGenerateReleaseHandoffRequest) {
  const pilotSession = await getSessionById(repo, input.sessionId)
  if (pilotSession.status === 'archived') throw new ConflictError('Archived Pilot sessions cannot generate release handoffs')
  const draftAgentConfigId = input.draftAgentConfigId ?? pilotSession.agentConfigId
  if (!draftAgentConfigId) throw new ValidationError('draftAgentConfigId is required for release handoff generation')
  const draft = await getAgentSummary(repo, draftAgentConfigId)
  const [proposals, todoItems, validation, channels] = await Promise.all([
    repo.raw.pilotProposal.findMany({
      where: { orgId: repo.orgId, sessionId: input.sessionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }) as Promise<AnyRecord[]>,
    repo.raw.pilotTodoItem.findMany({
      where: { orgId: repo.orgId, sessionId: input.sessionId },
      orderBy: { createdAt: 'asc' },
    }) as Promise<AnyRecord[]>,
    getScenarioValidationSummary(draftAgentConfigId).then((summary) => scenarioValidationSummarySchema.parse(summary)),
    repo.raw.channelBinding.findMany({
      where: { agentConfigId: draftAgentConfigId },
      orderBy: { channel: 'asc' },
    }) as Promise<AnyRecord[]>,
  ])
  const appliedProposals = proposals.filter((proposal) => proposal.status === 'applied')
  const changedSurfaces = [...new Set(appliedProposals.map((proposal) => String(proposal.primarySurface)).filter(Boolean))]
  const referencedProposalIds = appliedProposals.map((proposal) => String(proposal.id))
  const referencedReceiptIds = [
    validation.lastRuntimeReceiptId,
    validation.lastReceiptId,
    pilotSession.latestReceiptRunId,
  ].filter((id): id is string => Boolean(id))
  const uniqueReceiptIds = [...new Set(referencedReceiptIds)]
  const completedTodoItemIds = todoItems
    .filter((item) => item.status === 'completed')
    .map((item) => String(item.id))

  const blockers = []
  if (!validation.runtimeValidated) {
    blockers.push({
      code: validation.state === 'Validation failed' ? 'runtime_receipt_failed' : 'runtime_receipt_missing',
      message: validation.state === 'Validation failed'
        ? 'Latest Scenario validation failed; rerun a passing runtime-backed Scenario before Release review.'
        : 'A fresh runtime-backed Scenario receipt is required before Release review.',
      linkedObjectRef: validation.lastReceiptId
        ? { type: 'receipt' as const, id: validation.lastReceiptId, label: validation.state }
        : undefined,
    })
  }

  const enabledChannels = channels.filter((channel) => channel.enabled)
  const risks = []
  if (enabledChannels.length === 0) {
    risks.push({
      code: 'channel_binding_unconfirmed',
      message: 'No enabled channel binding is present on this draft; confirm channel and secret readiness before customer launch.',
      severity: 'P1' as const,
    })
  }
  if (changedSurfaces.length === 0) {
    risks.push({
      code: 'no_applied_pilot_changes',
      message: 'No applied Pilot proposal is recorded in this session; verify whether Release review is premature.',
      severity: 'P2' as const,
    })
  }

  const summaryLines = [
    `Pilot release handoff for ${draft.name} v${draft.version}.`,
    `Changed surfaces: ${changedSurfaces.length > 0 ? changedSurfaces.join(', ') : 'none recorded'}.`,
    `Validation: ${validation.state}${validation.runtimeValidated ? ' with runtime-backed receipt' : '; runtime-backed receipt still required'}.`,
    uniqueReceiptIds.length > 0 ? `Referenced receipts: ${uniqueReceiptIds.join(', ')}.` : 'Referenced receipts: none.',
    enabledChannels.length > 0
      ? `Enabled channels: ${enabledChannels.map((channel) => channel.channel).join(', ')}.`
      : 'Enabled channels: none recorded.',
    'Release owns publish, activation, rollback, and package export decisions.',
  ]

  return generatePilotHandoff(repo, session, {
    sessionId: input.sessionId,
    draftAgentConfigId,
    handoffSummary: summaryLines.join(' '),
    readinessVerdict: blockers.length === 0 ? 'ready_for_release_review' : 'not_ready',
    blockers,
    risks,
    referencedProposalIds,
    referencedReceiptIds: uniqueReceiptIds,
    coveredTodoItemIds: completedTodoItemIds,
  })
}

export function pilotSnapshotEnvelope(snapshot: unknown) {
  return apiOk(snapshot)
}
