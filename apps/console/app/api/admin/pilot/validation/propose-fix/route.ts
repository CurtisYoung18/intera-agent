// POST /api/admin/pilot/validation/propose-fix
// Drafts a follow-up ConfigPilot proposal from a failed or blocked Scenario receipt.

import { defineRoute, ConflictError, NotFoundError } from '@/lib/api/define-route'
import { assertAgentInOrg } from '@/lib/api/assert-agent-in-org'
import { apiOk } from '@intera/shared/contracts/envelope'
import {
  pilotProposeReceiptFixRequestSchema,
  pilotProposeReceiptFixResponseSchema,
  pilotValidationPlanSchema,
  type PilotProposeReceiptFixRequest,
} from '@intera/shared/contracts/pilot'
import type { ScenarioReceipt } from '@intera/shared/contracts/scenarios'
import { listScenarios } from '@/lib/scenarios/store'
import { getConfigPilotContext } from '@/lib/config-pilot/context'
import { proposeConfigPilotChange } from '@/lib/config-pilot/model'
import { persistConfigPilotProposal, recordPilotInspectionTrace } from '@/lib/pilot/persistence'

function failedCheckLines(receipt: ScenarioReceipt): string[] {
  const checks = receipt.checks
    .filter((check) => !check.passed)
    .map((check) => `- ${check.name}: ${check.detail ?? check.code ?? 'expectation failed'}`)
  const reasons = receipt.failureReasons.map((reason) => `- ${reason.code}: ${reason.message}`)
  return checks.length > 0 ? checks : reasons
}

function buildFixRequest(receipt: ScenarioReceipt, operatorInstruction?: string): string {
  const evidenceMode = receipt.executionMode === 'agentRuntime'
    ? 'runtime-backed dry-run evidence'
    : 'fixture-only debugging evidence'
  const failures = failedCheckLines(receipt)
  return [
    operatorInstruction?.trim() || 'Draft the smallest safe config change that addresses this failed Scenario receipt.',
    `Scenario: ${receipt.scenarioName}`,
    `Receipt: ${receipt.runId}`,
    `Status: ${receipt.status}`,
    `Evidence mode: ${evidenceMode}`,
    receipt.summary ? `Receipt summary: ${receipt.summary}` : null,
    failures.length > 0 ? `Failed expectations:\n${failures.join('\n')}` : 'Failed expectations: no structured failure reason was recorded.',
    'Return a minimal draft-only typed proposal. Prefer one targeted Brain, Procedure, Hook, Hook binding, Tool, Knowledge, Integration, or Scenario patch. Do not publish, activate, deploy, roll back, or claim release readiness. The required validation after apply is a fresh runtime-backed rerun of the same named Scenario.',
  ].filter(Boolean).join('\n')
}

export const POST = defineRoute<PilotProposeReceiptFixRequest>({
  method: 'POST',
  inputSchema: pilotProposeReceiptFixRequestSchema,
  requireRole: ['owner', 'admin'],
  async handler({ input, repo, session, audit }) {
    await assertAgentInOrg(repo, input.agentConfigId)
    const pilotSession = await repo.raw.pilotSession.findFirst({
      where: { orgId: repo.orgId, id: input.sessionId, isCurrent: true },
    }) as { id: string; status: string; agentConfigId?: string | null } | null
    if (!pilotSession) throw new NotFoundError('Pilot session not found')
    if (pilotSession.status === 'archived') throw new ConflictError('Archived Pilot sessions cannot draft receipt fixes')
    if (pilotSession.agentConfigId && pilotSession.agentConfigId !== input.agentConfigId) {
      throw new ConflictError('Pilot session is bound to a different draft Agent')
    }

    const scenarioState = await listScenarios(input.agentConfigId)
    const receipt = scenarioState.receipts.find((item) => item.runId === input.receiptRunId)
    if (!receipt) throw new NotFoundError('Scenario receipt not found')
    if (receipt.status === 'pass') throw new ConflictError('Passing receipts do not need a fix proposal')

    const request = buildFixRequest(receipt, input.operatorInstruction)
    const context = await getConfigPilotContext(repo, session, input.agentConfigId)
    const result = await proposeConfigPilotChange({ agentConfigId: input.agentConfigId, request }, context)
    const stored = await persistConfigPilotProposal(repo, session, { agentConfigId: input.agentConfigId, request }, result.proposal, context.draftFingerprint)
    const todoItem = await repo.raw.pilotTodoItem.findFirst({
      where: { orgId: repo.orgId, sessionId: input.sessionId, latestReceiptRunId: input.receiptRunId },
      orderBy: { updatedAt: 'desc' },
    }) as { id: string } | null
    const validationPlan = pilotValidationPlanSchema.parse({
      ...(stored.validationPlan ?? {}),
      requiredScenarios: [receipt.scenarioName],
      releaseBlockingCondition: 'Rerun the same named Scenario in runtime-backed mode after apply.',
    })
    await repo.raw.pilotProposal.update({
      where: { id: stored.id },
      data: {
        todoItemId: todoItem?.id ?? null,
        intentSummary: `Fix ${receipt.status} receipt ${receipt.runId} for ${receipt.scenarioName}.`,
        validationPlan: validationPlan as any,
      },
    })
    if (todoItem) {
      await repo.raw.pilotTodoItem.update({
        where: { id: todoItem.id },
        data: { latestProposalId: stored.id, status: 'active' },
      })
    }
    await repo.raw.pilotSession.update({
      where: { id: input.sessionId },
      data: {
        latestProposalId: stored.id,
        currentMode: 'validation_triage',
        status: 'in_progress',
      },
    })
    const trace = await recordPilotInspectionTrace(repo, session, {
      sessionId: input.sessionId,
      actionClass: 'revision',
      targetObjectRef: { type: 'receipt', id: receipt.runId, label: receipt.scenarioName },
      steps: [
        {
          toolFamily: 'inspect_validation_artifact',
          target: receipt.runId,
          visibility: 'metadata_only',
          summary: `Read ${receipt.status} ${receipt.executionMode} receipt for ${receipt.scenarioName}.`,
          evidenceSufficientAfterStep: true,
        },
        {
          toolFamily: 'draft_batch_proposal',
          target: stored.id,
          visibility: 'metadata_only',
          summary: 'Drafted a receipt-linked follow-up proposal; human accept and draft-only apply are still required.',
          evidenceSufficientAfterStep: true,
        },
      ],
      evidenceSufficient: true,
      stopReason: 'Review the receipt-linked diff, accept explicitly, apply draft-only, then rerun runtime-backed validation.',
    })
    result.proposal.pilotProposalId = stored.id
    result.proposal.baseDraftFingerprint = stored.baseDraftFingerprint
    await audit({
      action: 'pilot.validation.propose_fix',
      target: `scenario_receipt:${receipt.runId}`,
      after: {
        sessionId: input.sessionId,
        agentConfigId: input.agentConfigId,
        pilotProposalId: stored.id,
        scenarioName: receipt.scenarioName,
      },
    })
    return apiOk(pilotProposeReceiptFixResponseSchema.parse({
      proposal: result.proposal,
      modelUsed: result.modelUsed,
      promptVersion: result.promptVersion,
      sourceReceiptRunId: receipt.runId,
      inspectionTrace: trace,
    }))
  },
})
